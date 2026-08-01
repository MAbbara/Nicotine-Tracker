"""Read-only discovery of migration-created legacy-goal draft plans.

The additive reduction-plan migration backfills one inactive ``reduce``
draft per active legacy ``daily_pouches`` goal, recording the source goal
IDs in ``ReductionPlan.legacy_goal_ids`` and a tamper-evident digest in
``migration_fingerprint``. This service reads and explains those rows —
plus the active legacy goals that stayed unattached context — without
changing them.

Contract notes:

- Only the requesting user's ``draft`` plans with
  ``baseline_source='legacy_goal'`` and a non-null migration fingerprint
  are considered; stable order is plan ID.
- A candidate is valid review data only when exactly one of its source
  goals is the user's own ``daily_pouches`` goal and the plan's persisted
  ``end_target_pouches`` (the authoritative end-target prefill) is present.
  Missing, foreign, or non-pouch sources make the plan invalid review data.
- A ``daily_mg`` source attaches as ``nicotine_context`` only while it is
  active, belongs to the same user, and exactly matches the pouch goal's
  start and end dates; zero or multiple matches remain separate context.
- ``unattached_context_goals`` lists the user's active ``daily_mg`` and
  ``weekly_reduction`` goals not attached to a valid candidate, in goal-ID
  order. Inactive context goals are omitted; foreign goals never leak.
- ``migration_fingerprint`` is never exposed in the public dataclasses.
  This service never mutates ``Goal`` or ``ReductionPlan`` rows.
"""

from dataclasses import dataclass
from datetime import date

from extensions import db
from models import Goal, ReductionPlan, User

_CONTEXT_GOAL_TYPES = ('daily_mg', 'weekly_reduction')


@dataclass(frozen=True)
class LegacyGoalRecord:
    id: int
    goal_type: str
    target_value: int
    start_date: date | None
    end_date: date | None
    is_active: bool


@dataclass(frozen=True)
class LegacyGoalDraftCandidate:
    plan_id: int
    end_target_pouches: int
    source_goal_ids: tuple[int, ...]
    pouch_goal: LegacyGoalRecord
    nicotine_context: LegacyGoalRecord | None
    explanation: str


@dataclass(frozen=True)
class LegacyGoalDraftReview:
    candidates: tuple[LegacyGoalDraftCandidate, ...]
    unattached_context_goals: tuple[LegacyGoalRecord, ...]


def _record(goal) -> LegacyGoalRecord:
    return LegacyGoalRecord(
        id=goal.id,
        goal_type=goal.goal_type,
        target_value=goal.target_value,
        start_date=goal.start_date,
        end_date=goal.end_date,
        is_active=bool(goal.is_active),
    )


def _coerce_source_ids(raw) -> tuple[int, ...]:
    """Normalize persisted ``legacy_goal_ids`` to a sorted tuple of ints."""
    if not isinstance(raw, (list, tuple)):
        return ()
    return tuple(sorted({value for value in raw if type(value) is int}))


def _explanation(end_target_pouches: int, has_nicotine_context: bool) -> str:
    noun = 'pouch' if end_target_pouches == 1 else 'pouches'
    base = f'Migrated from your goal of {end_target_pouches} {noun} per day.'
    if has_nicotine_context:
        return base + ' A matching daily nicotine goal is included as context.'
    return base + ' No matching daily nicotine goal is included.'


class LegacyGoalService:
    """Read-only discovery; never an authorization oracle or a mutator."""

    @classmethod
    def get_draft_candidates(cls, user_id: int) -> LegacyGoalDraftReview:
        with db.session.no_autoflush:
            if db.session.get(User, user_id) is None:
                return LegacyGoalDraftReview(
                    candidates=(), unattached_context_goals=(),
                )

            plans = (
                ReductionPlan.query
                .filter(
                    ReductionPlan.user_id == user_id,
                    ReductionPlan.status == 'draft',
                    ReductionPlan.baseline_source == 'legacy_goal',
                    ReductionPlan.migration_fingerprint.isnot(None),
                )
                .order_by(ReductionPlan.id)
                .all()
            )

            plan_source_ids = {}
            referenced_ids = set()
            for plan in plans:
                source_ids = _coerce_source_ids(plan.legacy_goal_ids)
                plan_source_ids[plan.id] = source_ids
                referenced_ids.update(source_ids)
            goals_by_id = {}
            if referenced_ids:
                goals_by_id = {
                    goal.id: goal
                    for goal in Goal.query.filter(
                        Goal.id.in_(referenced_ids)
                    ).all()
                }

            candidates = []
            attached_goal_ids = set()
            for plan in plans:
                source_ids = plan_source_ids[plan.id]
                source_goals = [
                    goals_by_id[goal_id]
                    for goal_id in source_ids
                    if goal_id in goals_by_id
                ]
                pouch_goals = [
                    goal for goal in source_goals
                    if goal.user_id == user_id
                    and goal.goal_type == 'daily_pouches'
                ]
                if (not source_ids or len(pouch_goals) != 1
                        or plan.end_target_pouches is None):
                    # Invalid review data: missing, foreign, or non-pouch pouch
                    # source, or no persisted authoritative end target.
                    continue
                pouch_goal = pouch_goals[0]
                matching_mg = [
                    goal for goal in source_goals
                    if goal.goal_type == 'daily_mg'
                    and goal.user_id == user_id
                    and goal.is_active
                    and goal.start_date == pouch_goal.start_date
                    and goal.end_date == pouch_goal.end_date
                ]
                context = matching_mg[0] if len(matching_mg) == 1 else None
                if context is not None:
                    attached_goal_ids.add(context.id)
                candidates.append(LegacyGoalDraftCandidate(
                    plan_id=plan.id,
                    end_target_pouches=plan.end_target_pouches,
                    source_goal_ids=source_ids,
                    pouch_goal=_record(pouch_goal),
                    nicotine_context=(
                        _record(context) if context is not None else None
                    ),
                    explanation=_explanation(
                        plan.end_target_pouches, context is not None,
                    ),
                ))

            unattached = tuple(
                _record(goal)
                for goal in (
                    Goal.query
                    .filter(
                        Goal.user_id == user_id,
                        Goal.is_active.is_(True),
                        Goal.goal_type.in_(_CONTEXT_GOAL_TYPES),
                    )
                    .order_by(Goal.id)
                    .all()
                )
                if goal.id not in attached_goal_ids
            )

            return LegacyGoalDraftReview(
                candidates=tuple(candidates),
                unattached_context_goals=unattached,
            )
