"""Goal-related service functions.

These helpers encapsulate operations for creating and managing goals.
"""
from datetime import date, datetime
import re
import time as _clock
from typing import Dict, Iterable, Optional

from extensions import db
from models import Goal, User
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError


_ACTIVATION_CONFIRM_SECONDS = 0.25
_ACTIVATION_POLL_SECONDS = 0.01
_ACTIVATION_RETRY_LIMIT = 2


class ActiveGoalConflict(ValueError):
    """Activating a goal would duplicate an active user-owned goal type."""


class _ActivationConfirmationContention(Exception):
    """A winner-confirmation read encountered recognized contention."""


def _is_active_goal_contention_error(exc):
    """Recognize only the active-slot unique or documented lock signals."""
    if isinstance(exc, IntegrityError):
        original = getattr(exc, 'orig', None)
        diagnostic = getattr(original, 'diag', None)
        constraint_name = (
            getattr(original, 'constraint_name', None)
            or getattr(diagnostic, 'constraint_name', None)
        )
        if constraint_name == 'uq_goal_user_type_active_slot':
            return True
        message = ' '.join(str(original).lower().split())
        if message == (
            'unique constraint failed: goal.user_id, goal.goal_type, '
            'goal.active_slot'
        ):
            return True
        return bool(re.search(
            r"(?:for key|constraint)\s+['\"`]"
            r"(?:[^'\"`]+\.)?uq_goal_user_type_active_slot['\"`]",
            message,
        ))
    original = getattr(exc, 'orig', None)
    arguments = getattr(original, 'args', ())
    mysql_code = arguments[0] if arguments else None
    if mysql_code in {1205, 1213}:
        return True
    return re.fullmatch(
        r'(?:database is locked|database table is locked|'
        r'database schema is locked)(?:: [a-z_][a-z0-9_.$-]*)?',
        str(original).strip().lower(),
    ) is not None


def _different_active_goal_exists(user_id, goal_type, goal_id):
    query = select(Goal.id).where(
        Goal.user_id == user_id,
        Goal.goal_type == goal_type,
        Goal.active_slot == 1,
    )
    if goal_id is not None:
        query = query.where(Goal.id != goal_id)
    try:
        return db.session.execute(query.limit(1)).first() is not None
    except OperationalError as exc:
        if _is_active_goal_contention_error(exc):
            raise _ActivationConfirmationContention() from exc
        raise


def _activation_conflict_is_confirmed(exc, state):
    """Return True for a winner, False for absence, or None if unknown."""
    if isinstance(exc, IntegrityError):
        return True if _is_active_goal_contention_error(exc) else None
    if not _is_active_goal_contention_error(exc):
        return None
    goal_type = state.get('goal_type')
    if not goal_type or not state.get('activating'):
        return False
    deadline = _clock.monotonic() + _ACTIVATION_CONFIRM_SECONDS
    verified_absence = False
    while True:
        remaining = deadline - _clock.monotonic()
        if remaining <= 0:
            return False if verified_absence else None
        try:
            if _different_active_goal_exists(
                    state['user_id'], goal_type, state.get('goal_id')):
                db.session.rollback()
                return True
            verified_absence = True
        except _ActivationConfirmationContention:
            verified_absence = False
        except Exception:
            # Winner confirmation is advisory. Preserve the original database
            # error if this follow-up read fails for an unrelated reason.
            try:
                db.session.rollback()
            except Exception:
                pass
            return None
        db.session.rollback()
        remaining = deadline - _clock.monotonic()
        if remaining <= 0:
            return False if verified_absence else None
        _clock.sleep(min(_ACTIVATION_POLL_SECONDS, remaining))


def _assert_no_active_sibling(user_id, goal_type, goal_id=None):
    query = select(Goal.id).where(
        Goal.user_id == user_id,
        Goal.goal_type == goal_type,
        Goal.active_slot == 1,
    )
    if goal_id is not None:
        query = query.where(Goal.id != goal_id)
    if db.session.execute(query.limit(1)).first() is not None:
        raise ActiveGoalConflict(goal_type)


def _run_goal_transaction(user_id, mutation, *, retry_count=0):
    """Run one create/edit/toggle mutation under the same boundary."""
    state = {
        'user_id': user_id,
        'goal_type': None,
        'goal_id': None,
        'activating': False,
    }
    try:
        owner = db.session.execute(
            select(User.id).where(User.id == user_id).with_for_update()
        ).scalar_one_or_none()
        if owner is None:
            return None
        result = mutation(state)
        db.session.commit()
        return result
    except (IntegrityError, OperationalError) as exc:
        db.session.rollback()
        confirmation = _activation_conflict_is_confirmed(exc, state)
        if confirmation is True:
            raise ActiveGoalConflict(state.get('goal_type')) from exc
        if (
            confirmation is False
            and retry_count < _ACTIVATION_RETRY_LIMIT
            and isinstance(exc, OperationalError)
            and _is_active_goal_contention_error(exc)
        ):
            return _run_goal_transaction(
                user_id, mutation, retry_count=retry_count + 1
            )
        raise
    except Exception:
        db.session.rollback()
        raise


def set_goal_active(
        user_id: int, goal_id: int, is_active: bool, *, commit: bool = True
) -> Optional[Goal]:
    """Set one owned goal's state through the shared transaction boundary."""
    if not commit:
        raise ValueError('goal activation must commit atomically')

    def mutation(state):
        goal = db.session.execute(
            select(Goal).where(
                Goal.id == goal_id,
                Goal.user_id == user_id,
            ).with_for_update()
        ).scalar_one_or_none()
        if goal is None:
            return None
        state.update({
            'goal_type': goal.goal_type,
            'goal_id': goal.id,
            'activating': bool(is_active),
        })
        if is_active:
            _assert_no_active_sibling(user_id, goal.goal_type, goal.id)
        goal.is_active = bool(is_active)
        goal.active_slot = 1 if is_active else None
        goal.updated_at = datetime.utcnow()
        return goal

    return _run_goal_transaction(user_id, mutation)

def create_goal(user_id: int,
                goal_type: str,
                target_value: int,
                start_date: date = None,
                end_date: date = None,
                enable_notifications: bool = True,
                notification_threshold: float = 0.8) -> Goal:
    """Create and persist a goal for the user."""
    def mutation(state):
        state.update({
            'goal_type': goal_type,
            'goal_id': None,
            'activating': True,
        })
        _assert_no_active_sibling(user_id, goal_type)
        goal = Goal(
            user_id=user_id,
            goal_type=goal_type,
            target_value=target_value,
            start_date=start_date or date.today(),
            end_date=end_date,
            is_active=True,
            active_slot=1,
            enable_notifications=enable_notifications,
            notification_threshold=notification_threshold,
        )
        db.session.add(goal)
        return goal

    return _run_goal_transaction(user_id, mutation)


def update_goal(
        user_id: int, goal_id: int, *, target_value: int,
        end_date: Optional[date], enable_notifications: bool,
        notification_threshold: float, is_active: bool) -> Optional[Goal]:
    """Edit one owned goal, including activation, in one transaction."""
    def mutation(state):
        goal = db.session.execute(
            select(Goal).where(
                Goal.id == goal_id,
                Goal.user_id == user_id,
            ).with_for_update()
        ).scalar_one_or_none()
        if goal is None:
            return None
        state.update({
            'goal_type': goal.goal_type,
            'goal_id': goal.id,
            'activating': bool(is_active),
        })
        if is_active:
            _assert_no_active_sibling(user_id, goal.goal_type, goal.id)
        goal.target_value = target_value
        goal.end_date = end_date
        goal.enable_notifications = enable_notifications
        goal.notification_threshold = notification_threshold
        goal.is_active = bool(is_active)
        goal.active_slot = 1 if is_active else None
        goal.updated_at = datetime.utcnow()
        return goal

    return _run_goal_transaction(user_id, mutation)


def toggle_goal_active(user_id: int, goal_id: int) -> Optional[Goal]:
    """Toggle one owned goal atomically from its locked persisted state."""
    def mutation(state):
        goal = db.session.execute(
            select(Goal).where(
                Goal.id == goal_id,
                Goal.user_id == user_id,
            ).with_for_update()
        ).scalar_one_or_none()
        if goal is None:
            return None
        requested_state = not goal.is_active
        state.update({
            'goal_type': goal.goal_type,
            'goal_id': goal.id,
            'activating': requested_state,
        })
        if requested_state:
            _assert_no_active_sibling(user_id, goal.goal_type, goal.id)
        goal.is_active = requested_state
        goal.active_slot = 1 if requested_state else None
        goal.updated_at = datetime.utcnow()
        return goal

    return _run_goal_transaction(user_id, mutation)


def get_active_goals(user_id: int) -> Iterable[Goal]:
    """Retrieve all active goals for a given user."""
    return Goal.query.filter_by(user_id=user_id, is_active=True).all()


def get_all_goals(user_id: int) -> Iterable[Goal]:
    """Retrieve all goals for a given user, including inactive ones."""
    return Goal.query.filter_by(user_id=user_id).all()


def get_goal_analytics(user_id: int) -> Dict:
    """Get comprehensive goal analytics."""
    all_goals_list = get_all_goals(user_id)
    active_goals_list = [g for g in all_goals_list if g.is_active]

    return {
        "total_goals": len(all_goals_list),
        "active_goals": len(active_goals_list),
    }


def deactivate_goal(goal_id: int) -> Optional[Goal]:

    """Deactivate a specific goal."""
    goal = db.session.get(Goal, goal_id)
    if goal:
        goal.is_active = False
        goal.active_slot = None
        db.session.commit()
    return goal
