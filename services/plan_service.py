"""Transactional application boundary for reduction-plan lifecycle changes."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import hashlib
import json
import re
import time as _clock

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError

from extensions import db
from models import (
    OnboardingDraft,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    ReductionPlan,
    User,
    UserPreferences,
    UserPreferredPouch,
)
from services.baseline_service import BaselineService
from services.onboarding_draft_service import OnboardingDraftService
from services.plan_schedule import (
    GeneratedPlanDay,
    GeneratedPlanPreview,
    PlanGenerationInput,
    PlanScheduleGenerator,
    PlanValidationError,
    StageTarget,
)
from services.timezone_service import (
    get_current_user_day,
    get_timezone_object,
    get_user_day_window,
    resolve_timezone,
)


_BASELINE_SOURCES = {'manual', 'recent_logs', 'observe', 'legacy_goal'}
_TWO_PLACES = Decimal('0.01')
_REVISION_REASONS = {
    'user_edit', 'difficulty_adjustment', 'resume', 'boundary_change', 'other'
}
_REVISION_CHANGE_FIELDS = {
    'pace', 'target_date', 'duration_days', 'end_target_pouches',
    'end_target_mg', 'stage_targets'
}
_ACTIVATION_WINNER_CONFIRM_SECONDS = 0.25
_ACTIVATION_WINNER_POLL_SECONDS = 0.01
_ACTIVATION_TRANSACTION_RETRY_LIMIT = 2
_ONBOARDING_SUPPORT_KEYS = frozenset({
    'difficult_times',
    'common_triggers',
    'preferred_pouch_ids',
    'reminder_window',
})
_REMINDER_WINDOW_TIMES = {
    'none': None,
    'morning': time(8, 0),
    'afternoon': time(14, 0),
    'evening': time(19, 0),
}


class PlanServiceError(Exception):
    """Base class for stable lifecycle failures mapped by the API layer."""


class PlanNotFoundError(PlanServiceError):
    """The plan does not exist for the requesting user."""


class PreviewStaleError(PlanServiceError):
    """The confirmed digest no longer describes the persisted preview."""


class ActivePlanConflictError(PlanServiceError):
    """The user already has a different active plan."""


class PlanStateError(PlanServiceError):
    """The requested transition is not valid from the plan's current state."""


class _ActivationConfirmationContention(Exception):
    """A confirmation SELECT hit retryable backend contention."""


def _promote_onboarding_support_preferences(user_id, onboarding_draft):
    """Promote validated support answers without committing independently."""
    if onboarding_draft is None:
        return
    payload = onboarding_draft.structured_payload or {}
    support_keys = _ONBOARDING_SUPPORT_KEYS.intersection(payload)
    if not support_keys:
        return

    pouch_ids = payload.get('preferred_pouch_ids')
    if 'preferred_pouch_ids' in support_keys:
        OnboardingDraftService._validate_pouch_ownership(
            user_id, pouch_ids or [],
        )

    preference_keys = support_keys.intersection({
        'difficult_times', 'common_triggers', 'reminder_window',
    })
    preferences = None
    if preference_keys:
        preferences = db.session.execute(
            select(UserPreferences).where(
                UserPreferences.user_id == user_id
            ).with_for_update()
        ).scalar_one_or_none()
        if preferences is None:
            preferences = UserPreferences(user_id=user_id)
            db.session.add(preferences)

    if 'difficult_times' in support_keys:
        preferences.difficult_times = list(payload['difficult_times'])
    if 'common_triggers' in support_keys:
        preferences.common_triggers = list(payload['common_triggers'])
    if 'reminder_window' in support_keys:
        reminder_time = _REMINDER_WINDOW_TIMES[payload['reminder_window']]
        preferences.daily_reminders = reminder_time is not None
        preferences.reminder_time = reminder_time
    if 'preferred_pouch_ids' in support_keys:
        UserPreferredPouch.query.filter_by(user_id=user_id).delete(
            synchronize_session=False
        )
        db.session.add_all([
            UserPreferredPouch(
                user_id=user_id,
                pouch_id=pouch_id,
                rank=rank,
            )
            for rank, pouch_id in enumerate(pouch_ids or [])
        ])


def _is_activation_contention_error(exc):
    """Recognize the exact active-slot unique error or a lock signal."""
    if isinstance(exc, IntegrityError):
        original = getattr(exc, 'orig', None)
        diagnostic = getattr(original, 'diag', None)
        constraint_name = (
            getattr(original, 'constraint_name', None)
            or getattr(diagnostic, 'constraint_name', None)
        )
        if constraint_name == 'uq_reduction_plan_user_active_slot':
            return True
        message = ' '.join(str(original).lower().split())
        if message == (
            'unique constraint failed: reduction_plan.user_id, '
            'reduction_plan.active_slot'
        ):
            return True
        return bool(re.search(
            r"(?:for key|constraint)\s+['\"`]"
            r"(?:[^'\"`]+\.)?uq_reduction_plan_user_active_slot['\"`]",
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


def _active_plan_confirmation_query(
    user_id, plan_id=None, mysql_timeout_ms=None
):
    query = select(ReductionPlan.id).where(
        ReductionPlan.user_id == user_id,
        ReductionPlan.active_slot == 1,
    )
    if plan_id is not None:
        query = query.where(ReductionPlan.id != plan_id)
    if mysql_timeout_ms is not None:
        query = query.prefix_with(
            f'/*+ MAX_EXECUTION_TIME({int(mysql_timeout_ms)}) */',
            dialect='mysql',
        )
    return query.limit(1)


def _restore_sqlite_busy_timeout(connection, prior_timeout):
    try:
        connection.exec_driver_sql(
            f'PRAGMA busy_timeout = {prior_timeout}'
        )
        restored_timeout = int(
            connection.exec_driver_sql('PRAGMA busy_timeout').scalar()
        )
        if restored_timeout != prior_timeout:
            raise RuntimeError(
                'SQLite busy_timeout restoration could not be confirmed: '
                f'expected {prior_timeout}, found {restored_timeout}'
            )
    except Exception:
        connection.invalidate()
        raise


def _persisted_different_active_plan_exists(
    user_id, plan_id, remaining_seconds
):
    remaining_ms = int(max(0.0, remaining_seconds) * 1000)
    if remaining_ms <= 0:
        return False
    dialect_name = db.session.get_bind().dialect.name
    query = _active_plan_confirmation_query(
        user_id,
        plan_id,
        mysql_timeout_ms=(remaining_ms if dialect_name == 'mysql' else None),
    )
    if dialect_name != 'sqlite':
        try:
            return db.session.execute(query).first() is not None
        except OperationalError as exc:
            if _is_activation_contention_error(exc):
                raise _ActivationConfirmationContention() from exc
            raise

    connection = db.session.connection()
    prior_timeout = int(
        connection.exec_driver_sql('PRAGMA busy_timeout').scalar()
    )
    bounded_timeout = min(prior_timeout, remaining_ms)
    connection.exec_driver_sql(
        f'PRAGMA busy_timeout = {bounded_timeout}'
    )
    result = False
    query_contention = None
    try:
        try:
            result = db.session.execute(query).first() is not None
        except OperationalError as exc:
            if not _is_activation_contention_error(exc):
                raise
            query_contention = exc
    finally:
        _restore_sqlite_busy_timeout(connection, prior_timeout)
    if query_contention is not None:
        raise _ActivationConfirmationContention() from query_contention
    return result


def _activation_conflict_is_confirmed(exc, user_id, plan_id=None):
    """Return True for a winner, False for absence, or None if unverifiable."""
    try:
        if isinstance(exc, IntegrityError):
            return (
                True if _is_activation_contention_error(exc) else None
            )
        if not _is_activation_contention_error(exc):
            return None
        deadline = _clock.monotonic() + _ACTIVATION_WINNER_CONFIRM_SECONDS
        verified_absence = False
        while True:
            remaining = deadline - _clock.monotonic()
            if remaining <= 0:
                return False if verified_absence else None
            try:
                if _persisted_different_active_plan_exists(
                    user_id, plan_id, remaining
                ):
                    db.session.rollback()
                    return True
                verified_absence = True
            except _ActivationConfirmationContention:
                verified_absence = False
            db.session.rollback()
            remaining = deadline - _clock.monotonic()
            if remaining <= 0:
                return False if verified_absence else None
            _clock.sleep(min(_ACTIVATION_WINNER_POLL_SECONDS, remaining))
    except Exception:
        # Confirmation must never replace the original operation error or
        # become retryable when its own query/connection/restoration fails.
        try:
            db.session.rollback()
        except Exception:
            pass
        return None


def _activation_transaction_should_retry(
    exc, confirmation_result, retry_count
):
    """Retry only verified no-winner contention within the finite cap."""
    return (
        confirmation_result is False
        and retry_count < _ACTIVATION_TRANSACTION_RETRY_LIMIT
        and isinstance(exc, OperationalError)
        and _is_activation_contention_error(exc)
    )


def _fixed_decimal(value):
    if value is None:
        return None
    return format(
        Decimal(value).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP),
        '.2f',
    )


def _aware_utc(value=None):
    instant = value or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        return instant.replace(tzinfo=timezone.utc)
    return instant.astimezone(timezone.utc)


def _effective_local_date(timezone_name, reset_time, instant):
    user_timezone = resolve_timezone(timezone_name)
    candidate = instant.astimezone(user_timezone).date()
    window = get_user_day_window(user_timezone.zone, candidate, reset_time)
    if instant < window.start_utc:
        return candidate - timedelta(days=1)
    return candidate


def _boundary_day_payload(row):
    return {
        'id': row.id,
        'revision_id': row.revision_id,
        'local_date': row.local_date.isoformat(),
        'target_pouches': row.target_pouches,
        'nicotine_ceiling_mg': _fixed_decimal(row.nicotine_ceiling_mg),
    }


def _boundary_future_payload(day):
    return {
        'local_date': day.local_date.isoformat(),
        'target_pouches': day.target_pouches,
        'nicotine_ceiling_mg': _fixed_decimal(day.nicotine_ceiling_mg),
    }


def _apply_pending_preferences(user, preferences):
    user.timezone = preferences.pending_timezone
    preferences.daily_reset_time = preferences.pending_daily_reset_time
    preferences.pending_timezone = None
    preferences.pending_daily_reset_time = None
    preferences.boundary_change_effective_at_utc = None
    preferences.boundary_change_target_local_date = None


def _canonical_generation_inputs(
    generation_input: PlanGenerationInput, preview
) -> dict:
    explicit_stages = None
    if generation_input.stage_targets is not None:
        explicit_stages = [
            {
                'start_date': stage.start_date.isoformat(),
                'end_date': stage.end_date.isoformat(),
                'target_pouches': stage.target_pouches,
                'nicotine_ceiling_mg': _fixed_decimal(
                    stage.nicotine_ceiling_mg
                ),
            }
            for stage in preview.normalized_stages
        ]
    return {
        'mode': generation_input.mode,
        'start_date': preview.days[0].local_date.isoformat(),
        'baseline_pouches': _fixed_decimal(generation_input.baseline_pouches),
        'baseline_mg': _fixed_decimal(
            preview.days[0].nicotine_ceiling_mg
            if generation_input.target_basis == 'nicotine_mg'
            else generation_input.baseline_mg
        ),
        'baseline_mg_per_pouch': _fixed_decimal(
            generation_input.baseline_mg_per_pouch
        ),
        'pace': generation_input.pace,
        'target_basis': generation_input.target_basis or 'observe',
        'end_target_pouches': preview.days[-1].target_pouches,
        'end_target_mg': _fixed_decimal(
            preview.days[-1].nicotine_ceiling_mg
        ),
        'target_date': preview.days[-1].local_date.isoformat(),
        'duration_days': len(preview.days),
        'stage_targets': explicit_stages,
    }


def _event_clock(user, now=None):
    instant = now or datetime.now(timezone.utc)
    if instant.tzinfo is None:
        instant = instant.replace(tzinfo=timezone.utc)
    else:
        instant = instant.astimezone(timezone.utc)
    user_timezone = resolve_timezone(user.timezone)
    reset_time = (
        user.preferences.daily_reset_time
        if user.preferences and user.preferences.daily_reset_time
        else time.min
    )
    candidate = instant.astimezone(user_timezone).date()
    window = get_user_day_window(user_timezone.zone, candidate, reset_time)
    local_date = candidate if instant >= window.start_utc else candidate - timedelta(days=1)
    return instant.replace(tzinfo=None), local_date


def _reference_date(user):
    reset_time = (
        user.preferences.daily_reset_time
        if user.preferences and user.preferences.daily_reset_time
        else time.min
    )
    return get_current_user_day(user.timezone, reset_time)


def _validate_baseline_source(baseline_source):
    if baseline_source not in _BASELINE_SOURCES:
        raise ValueError('unsupported baseline source')


def _add_new_plan(user, generation_input, baseline_source, preview):
    canonical_inputs = _canonical_generation_inputs(generation_input, preview)
    plan = ReductionPlan(
        user_id=user.id,
        mode=generation_input.mode,
        status='draft',
        start_date=preview.days[0].local_date,
        target_date=preview.days[-1].local_date,
        baseline_pouches=generation_input.baseline_pouches,
        baseline_mg=(
            preview.days[0].nicotine_ceiling_mg
            if generation_input.target_basis == 'nicotine_mg'
            else generation_input.baseline_mg
        ),
        baseline_mg_per_pouch=generation_input.baseline_mg_per_pouch,
        baseline_source=baseline_source,
        pace=generation_input.pace,
        end_target_pouches=preview.days[-1].target_pouches,
        end_target_mg=preview.days[-1].nicotine_ceiling_mg,
    )
    db.session.add(plan)
    db.session.flush()

    revision = PlanRevision(
        plan_id=plan.id,
        effective_date=preview.days[0].local_date,
        pace=generation_input.pace,
        target_date=preview.days[-1].local_date,
        end_target_pouches=preview.days[-1].target_pouches,
        end_target_mg=preview.days[-1].nicotine_ceiling_mg,
        generation_inputs=canonical_inputs,
        preview_digest=preview.digest,
        reason='initial',
    )
    db.session.add(revision)
    db.session.flush()
    plan.active_revision_id = revision.id
    db.session.add_all([
        PlanDay(
            plan_id=plan.id,
            revision_id=revision.id,
            local_date=day.local_date,
            target_pouches=day.target_pouches,
            nicotine_ceiling_mg=day.nicotine_ceiling_mg,
        )
        for day in preview.days
    ])
    return plan


def _revision_preview(user, plan, changes, effective_date, now=None):
    unknown_fields = set(changes) - _REVISION_CHANGE_FIELDS
    if unknown_fields:
        raise PlanValidationError({
            'changes': f'contains unsupported fields: {sorted(unknown_fields)}'
        })
    _, current_local_date = _event_clock(user, now=now)
    earliest_effective_date = current_local_date + timedelta(days=1)
    if effective_date < earliest_effective_date:
        raise PlanValidationError({
            'effective_date': 'must be after the current user day'
        })
    if plan.status not in {'active', 'paused'}:
        raise PlanStateError('only active or paused plans can be revised')

    anchor = PlanDay.query.filter_by(
        plan_id=plan.id, local_date=effective_date
    ).first()
    if anchor is None:
        raise PlanValidationError({
            'effective_date': 'must fall within the existing schedule'
        })
    if plan.mode == 'observe':
        raise PlanStateError('observe plans do not support targeted revisions')

    duration_days = changes.get('duration_days')
    target_date = changes.get('target_date')
    if 'duration_days' not in changes and 'target_date' not in changes:
        duration_days = (plan.target_date - effective_date).days + 1
        target_date = plan.target_date
    nicotine_first = (
        'end_target_mg' in changes or anchor.target_pouches is None
    )
    if nicotine_first:
        generation_input = PlanGenerationInput(
            mode=plan.mode,
            target_basis='nicotine_mg',
            start_date=effective_date,
            baseline_pouches=(
                Decimal(anchor.target_pouches)
                if anchor.target_pouches is not None else None
            ),
            baseline_mg=Decimal(anchor.nicotine_ceiling_mg),
            baseline_mg_per_pouch=(
                Decimal(plan.baseline_mg_per_pouch)
                if plan.baseline_mg_per_pouch is not None else None
            ),
            pace=changes.get('pace', plan.pace),
            end_target_mg=changes.get('end_target_mg', plan.end_target_mg),
            target_date=target_date,
            duration_days=duration_days,
        )
    else:
        strength = Decimal(plan.baseline_mg_per_pouch)
        generation_input = PlanGenerationInput(
            mode=plan.mode,
            target_basis='legacy_pouches',
            start_date=effective_date,
            baseline_pouches=Decimal(anchor.target_pouches),
            baseline_mg=Decimal(anchor.nicotine_ceiling_mg),
            baseline_mg_per_pouch=strength,
            pace=changes.get('pace', plan.pace),
            end_target_pouches=changes.get(
                'end_target_pouches', plan.end_target_pouches
            ),
            target_date=target_date,
            duration_days=duration_days,
            stage_targets=changes.get('stage_targets'),
        )
    generated = PlanScheduleGenerator.generate(
        generation_input, reference_date=current_local_date
    )
    protected_rows = PlanDay.query.filter(
        PlanDay.plan_id == plan.id,
        PlanDay.local_date < effective_date,
    ).order_by(PlanDay.local_date).all()
    lifecycle_payload = {
        'plan_id': plan.id,
        'earliest_effective_date': earliest_effective_date.isoformat(),
        'pure_digest': generated.digest,
        'protected_days': [
            {
                'id': row.id,
                'revision_id': row.revision_id,
                'local_date': row.local_date.isoformat(),
                'target_pouches': row.target_pouches,
                'nicotine_ceiling_mg': _fixed_decimal(
                    row.nicotine_ceiling_mg
                ),
            }
            for row in protected_rows
        ],
    }
    digest = hashlib.sha256(json.dumps(
        lifecycle_payload, sort_keys=True, separators=(',', ':')
    ).encode()).hexdigest()
    return (
        GeneratedPlanPreview(
            days=generated.days,
            normalized_stages=generated.normalized_stages,
            digest=digest,
        ),
        generation_input,
    )


def _normalized_stages(days):
    stages = []
    stage_start = days[0]
    previous = days[0]
    for day in days[1:]:
        if (
            day.target_pouches != previous.target_pouches
            or day.nicotine_ceiling_mg != previous.nicotine_ceiling_mg
        ):
            stages.append(StageTarget(
                stage_start.local_date,
                previous.local_date,
                previous.target_pouches,
                previous.nicotine_ceiling_mg,
            ))
            stage_start = day
        previous = day
    stages.append(StageTarget(
        stage_start.local_date,
        previous.local_date,
        previous.target_pouches,
        previous.nicotine_ceiling_mg,
    ))
    return tuple(stages)


def _resume_preview(user, plan, resume_date, now=None):
    if plan.status != 'paused':
        raise PlanStateError('only paused plans can resume')
    _, current_local_date = _event_clock(user, now=now)
    if resume_date <= current_local_date:
        raise PlanValidationError({
            'resume_date': 'must be after the current user day'
        })
    paused_event = PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='paused'
    ).order_by(
        PlanStatusEvent.effective_at_utc.desc(),
        PlanStatusEvent.id.desc(),
    ).first()
    if paused_event is None:
        raise PlanStateError('paused plan has no pause history')
    source_rows = PlanDay.query.filter(
        PlanDay.plan_id == plan.id,
        PlanDay.local_date > paused_event.local_date,
    ).order_by(PlanDay.local_date).all()
    if not source_rows:
        raise PlanStateError('plan has no remaining schedule to resume')
    try:
        days = tuple(
            GeneratedPlanDay(
                local_date=resume_date + timedelta(days=index),
                target_pouches=row.target_pouches,
                nicotine_ceiling_mg=row.nicotine_ceiling_mg,
            )
            for index, row in enumerate(source_rows)
        )
    except OverflowError as exc:
        raise PlanValidationError({
            'resume_date': 'the resumed schedule exceeds the date range'
        }) from exc
    protected_rows = PlanDay.query.filter(
        PlanDay.plan_id == plan.id,
        PlanDay.local_date < resume_date,
    ).order_by(PlanDay.local_date).all()
    payload = {
        'plan_id': plan.id,
        'resume_date': resume_date.isoformat(),
        'current_local_date': current_local_date.isoformat(),
        'source_days': [
            {
                'id': row.id,
                'revision_id': row.revision_id,
                'local_date': row.local_date.isoformat(),
                'target_pouches': row.target_pouches,
                'nicotine_ceiling_mg': _fixed_decimal(row.nicotine_ceiling_mg),
            }
            for row in source_rows
        ],
        'protected_days': [
            {
                'id': row.id,
                'revision_id': row.revision_id,
                'local_date': row.local_date.isoformat(),
                'target_pouches': row.target_pouches,
                'nicotine_ceiling_mg': _fixed_decimal(row.nicotine_ceiling_mg),
            }
            for row in protected_rows
        ],
    }
    digest = hashlib.sha256(json.dumps(
        payload, sort_keys=True, separators=(',', ':')
    ).encode()).hexdigest()
    preview = GeneratedPlanPreview(
        days=days,
        normalized_stages=(
            () if plan.mode == 'observe' else _normalized_stages(days)
        ),
        digest=digest,
    )
    if plan.mode == 'observe':
        generation_input = PlanGenerationInput(
            mode='observe',
            target_basis='observe',
            start_date=resume_date,
            target_date=days[-1].local_date,
            duration_days=len(days),
        )
    else:
        if days[0].target_pouches is None:
            generation_input = PlanGenerationInput(
                mode=plan.mode,
                target_basis='nicotine_mg',
                start_date=resume_date,
                baseline_mg=Decimal(days[0].nicotine_ceiling_mg),
                pace=plan.pace,
                end_target_mg=Decimal(days[-1].nicotine_ceiling_mg),
                target_date=days[-1].local_date,
                duration_days=len(days),
            )
        else:
            strength = Decimal(plan.baseline_mg_per_pouch)
            generation_input = PlanGenerationInput(
                mode=plan.mode,
                target_basis='legacy_pouches',
                start_date=resume_date,
                baseline_pouches=Decimal(days[0].target_pouches),
                baseline_mg=Decimal(days[0].nicotine_ceiling_mg),
                baseline_mg_per_pouch=strength,
                pace=plan.pace,
                end_target_pouches=days[-1].target_pouches,
                target_date=days[-1].local_date,
                duration_days=len(days),
            )
    return preview, generation_input


class PlanService:
    """Owns plan transactions; routes never persist schedules directly."""

    @classmethod
    def preview_initial(
        cls, user_id, generation_input: PlanGenerationInput, baseline_source
    ) -> GeneratedPlanPreview:
        """Generate an initial schedule without changing persisted state."""
        user = db.session.get(User, user_id)
        if user is None:
            raise ValueError('user not found')
        _validate_baseline_source(baseline_source)
        return PlanScheduleGenerator.generate(
            generation_input, reference_date=_reference_date(user)
        )

    @classmethod
    def create_draft(
        cls, user_id, generation_input: PlanGenerationInput, baseline_source
    ) -> ReductionPlan:
        try:
            user = db.session.get(User, user_id)
            if user is None:
                raise ValueError('user not found')
            _validate_baseline_source(baseline_source)
            preview = PlanScheduleGenerator.generate(
                generation_input, reference_date=_reference_date(user)
            )
            plan = _add_new_plan(
                user, generation_input, baseline_source, preview
            )
            db.session.commit()
            return plan
        except Exception:
            db.session.rollback()
            raise

    @classmethod
    def create_from_preview(
        cls,
        user_id,
        generation_input: PlanGenerationInput,
        baseline_source,
        preview_digest,
        activation,
        result_builder=None,
    ) -> ReductionPlan:
        return cls._create_from_preview_transaction(
            user_id,
            generation_input,
            baseline_source,
            preview_digest,
            activation,
            retry_count=0,
            result_builder=result_builder,
        )

    @classmethod
    def _create_from_preview_transaction(
        cls,
        user_id,
        generation_input: PlanGenerationInput,
        baseline_source,
        preview_digest,
        activation,
        retry_count,
        result_builder=None,
    ) -> ReductionPlan:
        try:
            if activation not in {'draft', 'activate'}:
                raise ValueError('activation must be draft or activate')
            user_query = select(User).where(User.id == user_id)
            if activation == 'activate':
                user_query = user_query.with_for_update()
            user = db.session.execute(user_query).scalar_one_or_none()
            if user is None:
                raise ValueError('user not found')
            onboarding_draft = db.session.execute(
                select(OnboardingDraft).where(
                    OnboardingDraft.user_id == user_id
                ).with_for_update()
            ).scalar_one_or_none()
            _validate_baseline_source(baseline_source)
            preview = PlanScheduleGenerator.generate(
                generation_input, reference_date=_reference_date(user)
            )
            if preview.digest != preview_digest:
                raise PreviewStaleError('preview digest is stale')

            if activation == 'activate':
                conflict = db.session.execute(
                    select(ReductionPlan.id).where(
                        ReductionPlan.user_id == user_id,
                        ReductionPlan.active_slot == 1,
                    )
                ).first()
                if conflict is not None:
                    raise ActivePlanConflictError(
                        'another plan is already active'
                    )

            plan = _add_new_plan(
                user, generation_input, baseline_source, preview
            )
            if activation == 'activate':
                effective_at_utc, local_date = _event_clock(user)
                plan.status = 'active'
                plan.active_slot = 1
                db.session.add(PlanStatusEvent(
                    plan_id=plan.id,
                    status='active',
                    effective_at_utc=effective_at_utc,
                    local_date=local_date,
                    reason='activated',
                ))

            _promote_onboarding_support_preferences(
                user_id, onboarding_draft,
            )
            db.session.flush()
            built_result = (
                result_builder(plan) if result_builder is not None else None
            )

            if onboarding_draft is not None:
                db.session.delete(onboarding_draft)
            db.session.commit()
            return plan if result_builder is None else built_result
        except (IntegrityError, OperationalError) as exc:
            db.session.rollback()
            confirmation_result = None
            if activation == 'activate':
                confirmation_result = _activation_conflict_is_confirmed(
                    exc, user_id
                )
            if confirmation_result is True:
                raise ActivePlanConflictError(
                    'another plan is already active'
                ) from exc
            if _activation_transaction_should_retry(
                exc, confirmation_result, retry_count
            ):
                return cls._create_from_preview_transaction(
                    user_id,
                    generation_input,
                    baseline_source,
                    preview_digest,
                    activation,
                    retry_count=retry_count + 1,
                    result_builder=result_builder,
                )
            raise
        except Exception:
            db.session.rollback()
            raise

    @classmethod
    def activate(cls, user_id, plan_id, preview_digest) -> ReductionPlan:
        return cls._activate_transaction(
            user_id,
            plan_id,
            preview_digest,
            retry_count=0,
        )

    @classmethod
    def _activate_transaction(
        cls, user_id, plan_id, preview_digest, retry_count
    ) -> ReductionPlan:
        try:
            user = db.session.execute(
                select(User).where(User.id == user_id).with_for_update()
            ).scalar_one_or_none()
            if user is None:
                raise PlanNotFoundError('plan not found')
            plan = db.session.execute(
                select(ReductionPlan).where(
                    ReductionPlan.id == plan_id,
                    ReductionPlan.user_id == user_id,
                ).with_for_update()
            ).scalar_one_or_none()
            if plan is None:
                raise PlanNotFoundError('plan not found')
            if plan.status != 'draft':
                raise PlanStateError('only draft plans can be activated')
            revision = db.session.get(PlanRevision, plan.active_revision_id)
            if revision is None or revision.preview_digest != preview_digest:
                raise PreviewStaleError('preview digest is stale')
            conflict = db.session.execute(
                select(ReductionPlan.id).where(
                    ReductionPlan.user_id == user_id,
                    ReductionPlan.active_slot == 1,
                    ReductionPlan.id != plan.id,
                )
            ).first()
            if conflict is not None:
                raise ActivePlanConflictError('another plan is already active')

            effective_at_utc, local_date = _event_clock(user)
            plan.status = 'active'
            plan.active_slot = 1
            db.session.add(PlanStatusEvent(
                plan_id=plan.id,
                status='active',
                effective_at_utc=effective_at_utc,
                local_date=local_date,
                reason='activated',
            ))
            db.session.commit()
            return plan
        except (IntegrityError, OperationalError) as exc:
            db.session.rollback()
            confirmation_result = _activation_conflict_is_confirmed(
                exc, user_id, plan_id
            )
            if confirmation_result is True:
                raise ActivePlanConflictError(
                    'another plan is already active'
                ) from exc
            if _activation_transaction_should_retry(
                exc, confirmation_result, retry_count
            ):
                return cls._activate_transaction(
                    user_id,
                    plan_id,
                    preview_digest,
                    retry_count=retry_count + 1,
                )
            raise
        except Exception:
            db.session.rollback()
            raise

    @classmethod
    def _transition(
        cls,
        user_id,
        plan_id,
        *,
        allowed_statuses,
        target_status,
        reason,
        now,
        result_builder=None,
    ) -> ReductionPlan:
        try:
            user = db.session.execute(
                select(User).where(User.id == user_id).with_for_update()
            ).scalar_one_or_none()
            if user is None:
                raise PlanNotFoundError('plan not found')
            plan = db.session.execute(
                select(ReductionPlan).where(
                    ReductionPlan.id == plan_id,
                    ReductionPlan.user_id == user_id,
                ).with_for_update()
            ).scalar_one_or_none()
            if plan is None:
                raise PlanNotFoundError('plan not found')
            if plan.status not in allowed_statuses:
                raise PlanStateError(
                    f'cannot {target_status} a {plan.status} plan'
                )

            effective_at_utc, local_date = _event_clock(user, now=now)
            plan.status = target_status
            plan.active_slot = None
            db.session.add(PlanStatusEvent(
                plan_id=plan.id,
                status=target_status,
                effective_at_utc=effective_at_utc,
                local_date=local_date,
                reason=reason,
            ))
            db.session.flush()
            built_result = (
                result_builder(plan) if result_builder is not None else None
            )
            db.session.commit()
            return plan if result_builder is None else built_result
        except Exception:
            db.session.rollback()
            raise

    @classmethod
    def pause(
        cls, user_id, plan_id, reason=None, now=None, result_builder=None
    ) -> ReductionPlan:
        return cls._transition(
            user_id,
            plan_id,
            allowed_statuses={'active'},
            target_status='paused',
            reason=reason,
            now=now,
            result_builder=result_builder,
        )

    @classmethod
    def complete(cls, user_id, plan_id, now=None) -> ReductionPlan:
        return cls._transition(
            user_id,
            plan_id,
            allowed_statuses={'active', 'paused'},
            target_status='completed',
            reason='completed',
            now=now,
        )

    @classmethod
    def archive(
        cls, user_id, plan_id, reason=None, now=None
    ) -> ReductionPlan:
        return cls._transition(
            user_id,
            plan_id,
            allowed_statuses={'draft', 'active', 'paused', 'completed'},
            target_status='archived',
            reason=reason,
            now=now,
        )

    @classmethod
    def finish_observe(cls, user_id, plan_id, now=None) -> ReductionPlan:
        """Complete an Observe plan and optionally draft a baseline proposal.

        One transaction marks the Observe plan completed and, when the
        plan's scheduled local-date window holds enough evidence, creates
        one separate inactive ``reduce`` draft carrying the suggested
        baseline. The proposal is intentionally incomplete (no pace,
        targets, dates, revision, or schedule) and nothing is activated
        automatically. Insufficient or unknown-strength evidence still
        completes Observe so the API can prompt for a manual baseline.
        """
        try:
            user = db.session.execute(
                select(User).where(User.id == user_id).with_for_update()
            ).scalar_one_or_none()
            if user is None:
                raise PlanNotFoundError('plan not found')
            plan = db.session.execute(
                select(ReductionPlan).where(
                    ReductionPlan.id == plan_id,
                    ReductionPlan.user_id == user_id,
                ).with_for_update()
            ).scalar_one_or_none()
            if plan is None:
                raise PlanNotFoundError('plan not found')
            if plan.mode != 'observe':
                raise PlanStateError('only observe plans can finish observing')
            if plan.status not in {'active', 'paused'}:
                raise PlanStateError(
                    f'cannot finish a {plan.status} observe plan'
                )

            effective_at_utc, current_local_date = _event_clock(user, now=now)
            final_scheduled_day = plan.target_date
            if (
                final_scheduled_day is None
                or current_local_date <= final_scheduled_day
            ):
                raise PlanStateError(
                    'the observe period is not complete yet'
                )

            suggestion = BaselineService.suggest_for_window(
                user_id, plan.start_date, plan.target_date
            )

            plan.status = 'completed'
            plan.active_slot = None
            db.session.add(PlanStatusEvent(
                plan_id=plan.id,
                status='completed',
                effective_at_utc=effective_at_utc,
                local_date=current_local_date,
                reason='observe_finished',
            ))
            if suggestion.available:
                db.session.add(ReductionPlan(
                    user_id=user_id,
                    mode='reduce',
                    status='draft',
                    baseline_pouches=suggestion.pouches_per_day,
                    baseline_mg=suggestion.nicotine_mg_per_day,
                    baseline_mg_per_pouch=suggestion.median_mg_per_pouch,
                    baseline_source='observe',
                ))
            db.session.commit()
            return plan
        except Exception:
            db.session.rollback()
            raise

    @classmethod
    def preview_revision(
        cls, user_id, plan_id, changes, effective_date, now=None
    ) -> GeneratedPlanPreview:
        user = db.session.get(User, user_id)
        plan = ReductionPlan.query.filter_by(
            id=plan_id, user_id=user_id
        ).first()
        if user is None or plan is None:
            raise PlanNotFoundError('plan not found')
        preview, _ = _revision_preview(
            user, plan, changes, effective_date, now=now
        )
        return preview

    @classmethod
    def apply_revision(
        cls,
        user_id,
        plan_id,
        changes,
        effective_date,
        preview_digest,
        reason,
        note=None,
        now=None,
        result_builder=None,
    ) -> PlanRevision:
        try:
            if reason not in _REVISION_REASONS:
                raise PlanValidationError({'reason': 'is not supported'})
            normalized_note = note.strip() if note is not None else None
            if normalized_note == '':
                normalized_note = None
            if normalized_note is not None and len(normalized_note) > 2000:
                raise PlanValidationError({
                    'note': 'must be 2,000 characters or fewer'
                })
            user = db.session.execute(
                select(User).where(User.id == user_id).with_for_update()
            ).scalar_one_or_none()
            plan = db.session.execute(
                select(ReductionPlan).where(
                    ReductionPlan.id == plan_id,
                    ReductionPlan.user_id == user_id,
                ).with_for_update()
            ).scalar_one_or_none()
            if user is None or plan is None:
                raise PlanNotFoundError('plan not found')
            preview, generation_input = _revision_preview(
                user, plan, changes, effective_date, now=now
            )
            if preview.digest != preview_digest:
                raise PreviewStaleError('preview digest is stale')

            PlanDay.query.filter(
                PlanDay.plan_id == plan.id,
                PlanDay.local_date >= effective_date,
            ).delete(synchronize_session=False)
            canonical_inputs = _canonical_generation_inputs(
                generation_input, preview
            )
            revision = PlanRevision(
                plan_id=plan.id,
                effective_date=effective_date,
                pace=generation_input.pace,
                target_date=preview.days[-1].local_date,
                end_target_pouches=generation_input.end_target_pouches,
                end_target_mg=preview.days[-1].nicotine_ceiling_mg,
                generation_inputs=canonical_inputs,
                preview_digest=preview.digest,
                reason=reason,
                note=normalized_note,
            )
            db.session.add(revision)
            db.session.flush()
            db.session.add_all([
                PlanDay(
                    plan_id=plan.id,
                    revision_id=revision.id,
                    local_date=day.local_date,
                    target_pouches=day.target_pouches,
                    nicotine_ceiling_mg=day.nicotine_ceiling_mg,
                )
                for day in preview.days
            ])
            plan.active_revision_id = revision.id
            plan.pace = generation_input.pace
            plan.target_date = preview.days[-1].local_date
            plan.end_target_mg = preview.days[-1].nicotine_ceiling_mg
            plan.end_target_pouches = preview.days[-1].target_pouches
            db.session.flush()
            built_result = (
                result_builder(plan) if result_builder is not None else None
            )
            db.session.commit()
            return revision if result_builder is None else built_result
        except Exception:
            db.session.rollback()
            raise

    @classmethod
    def preview_resume(
        cls, user_id, plan_id, resume_date, now=None
    ) -> GeneratedPlanPreview:
        user = db.session.get(User, user_id)
        plan = ReductionPlan.query.filter_by(
            id=plan_id, user_id=user_id
        ).first()
        if user is None or plan is None:
            raise PlanNotFoundError('plan not found')
        preview, _ = _resume_preview(user, plan, resume_date, now=now)
        return preview

    @classmethod
    def resume(
        cls, user_id, plan_id, resume_date, preview_digest, now=None,
        result_builder=None,
    ) -> ReductionPlan:
        return cls._resume_transaction(
            user_id,
            plan_id,
            resume_date,
            preview_digest,
            now=now,
            retry_count=0,
            result_builder=result_builder,
        )

    @classmethod
    def _resume_transaction(
        cls,
        user_id,
        plan_id,
        resume_date,
        preview_digest,
        now,
        retry_count,
        result_builder=None,
    ) -> ReductionPlan:
        try:
            user = db.session.execute(
                select(User).where(User.id == user_id).with_for_update()
            ).scalar_one_or_none()
            plan = db.session.execute(
                select(ReductionPlan).where(
                    ReductionPlan.id == plan_id,
                    ReductionPlan.user_id == user_id,
                ).with_for_update()
            ).scalar_one_or_none()
            if user is None or plan is None:
                raise PlanNotFoundError('plan not found')
            conflict = db.session.execute(
                select(ReductionPlan.id).where(
                    ReductionPlan.user_id == user_id,
                    ReductionPlan.active_slot == 1,
                    ReductionPlan.id != plan.id,
                )
            ).first()
            if conflict is not None:
                raise ActivePlanConflictError('another plan is already active')
            preview, generation_input = _resume_preview(
                user, plan, resume_date, now=now
            )
            if preview.digest != preview_digest:
                raise PreviewStaleError('preview digest is stale')

            PlanDay.query.filter(
                PlanDay.plan_id == plan.id,
                PlanDay.local_date >= resume_date,
            ).delete(synchronize_session=False)
            revision = PlanRevision(
                plan_id=plan.id,
                effective_date=resume_date,
                pace=plan.pace,
                target_date=preview.days[-1].local_date,
                end_target_pouches=preview.days[-1].target_pouches,
                end_target_mg=preview.days[-1].nicotine_ceiling_mg,
                generation_inputs=_canonical_generation_inputs(
                    generation_input, preview
                ),
                preview_digest=preview.digest,
                reason='resume',
            )
            db.session.add(revision)
            db.session.flush()
            db.session.add_all([
                PlanDay(
                    plan_id=plan.id,
                    revision_id=revision.id,
                    local_date=day.local_date,
                    target_pouches=day.target_pouches,
                    nicotine_ceiling_mg=day.nicotine_ceiling_mg,
                )
                for day in preview.days
            ])
            effective_at_utc, local_date = _event_clock(user, now=now)
            plan.active_revision_id = revision.id
            plan.target_date = preview.days[-1].local_date
            plan.end_target_mg = preview.days[-1].nicotine_ceiling_mg
            plan.end_target_pouches = preview.days[-1].target_pouches
            plan.status = 'active'
            plan.active_slot = 1
            db.session.add(PlanStatusEvent(
                plan_id=plan.id,
                status='active',
                effective_at_utc=effective_at_utc,
                local_date=local_date,
                reason='resumed',
            ))
            db.session.flush()
            built_result = (
                result_builder(plan) if result_builder is not None else None
            )
            db.session.commit()
            return plan if result_builder is None else built_result
        except (IntegrityError, OperationalError) as exc:
            db.session.rollback()
            confirmation_result = _activation_conflict_is_confirmed(
                exc, user_id, plan_id
            )
            if confirmation_result is True:
                raise ActivePlanConflictError(
                    'another plan is already active'
                ) from exc
            if _activation_transaction_should_retry(
                exc, confirmation_result, retry_count
            ):
                return cls._resume_transaction(
                    user_id,
                    plan_id,
                    resume_date,
                    preview_digest,
                    now=now,
                    retry_count=retry_count + 1,
                    result_builder=result_builder,
                )
            raise
        except Exception:
            db.session.rollback()
            raise

    @classmethod
    def apply_boundary_change(cls, user_id, now=None) -> PlanRevision | None:
        """Apply a due scheduled day-boundary change transactionally."""
        try:
            user = db.session.execute(
                select(User).where(User.id == user_id).with_for_update()
            ).scalar_one_or_none()
            if user is None:
                raise PlanNotFoundError('plan not found')
            preferences = db.session.execute(
                select(UserPreferences).where(
                    UserPreferences.user_id == user_id
                ).with_for_update()
            ).scalar_one_or_none()
            if preferences is None:
                return None

            pending_fields = (
                preferences.pending_timezone,
                preferences.pending_daily_reset_time,
                preferences.boundary_change_effective_at_utc,
                preferences.boundary_change_target_local_date,
            )
            if all(value is None for value in pending_fields):
                return None
            if any(value is None for value in pending_fields):
                raise PlanStateError('pending boundary change is incomplete')
            if (
                not isinstance(preferences.pending_timezone, str)
                or not isinstance(preferences.pending_daily_reset_time, time)
                or preferences.pending_daily_reset_time.second != 0
                or preferences.pending_daily_reset_time.microsecond != 0
                or not isinstance(
                    preferences.boundary_change_effective_at_utc, datetime
                )
                or type(preferences.boundary_change_target_local_date) is not date
            ):
                raise PlanStateError('pending boundary change is corrupt')
            try:
                get_timezone_object(preferences.pending_timezone)
                scheduled_window = get_user_day_window(
                    preferences.pending_timezone,
                    preferences.boundary_change_target_local_date,
                    preferences.pending_daily_reset_time,
                )
            except Exception as exc:
                raise PlanStateError(
                    'pending boundary change is corrupt'
                ) from exc
            scheduled_start = scheduled_window.start_utc.replace(tzinfo=None)
            if scheduled_start != preferences.boundary_change_effective_at_utc:
                raise PlanStateError('pending boundary change is corrupt')

            instant = _aware_utc(now)
            if instant < _aware_utc(
                preferences.boundary_change_effective_at_utc
            ):
                return None

            plan = db.session.execute(
                select(ReductionPlan).where(
                    ReductionPlan.user_id == user_id,
                    ReductionPlan.active_slot == 1,
                ).with_for_update()
            ).scalar_one_or_none()
            if plan is None:
                _apply_pending_preferences(user, preferences)
                db.session.commit()
                return None
            old_local_date = _effective_local_date(
                user.timezone,
                preferences.daily_reset_time or time.min,
                instant,
            )
            pending_local_date = _effective_local_date(
                preferences.pending_timezone,
                preferences.pending_daily_reset_time,
                instant,
            )
            protected_cutoff = max(old_local_date, pending_local_date)
            rows = db.session.execute(
                select(PlanDay).where(
                    PlanDay.plan_id == plan.id
                ).order_by(PlanDay.local_date).with_for_update()
            ).scalars().all()
            protected_rows = [
                row for row in rows if row.local_date <= protected_cutoff
            ]
            future_rows = [
                row for row in rows if row.local_date > protected_cutoff
            ]
            redated_days = tuple(
                GeneratedPlanDay(
                    local_date=protected_cutoff + timedelta(days=index + 1),
                    target_pouches=row.target_pouches,
                    nicotine_ceiling_mg=row.nicotine_ceiling_mg,
                )
                for index, row in enumerate(future_rows)
            )

            if not redated_days:
                _apply_pending_preferences(user, preferences)
                db.session.commit()
                return None

            digest_payload = {
                'plan_id': plan.id,
                'pending_timezone': preferences.pending_timezone,
                'pending_daily_reset_time': (
                    preferences.pending_daily_reset_time.isoformat()
                ),
                'boundary_change_effective_at_utc': (
                    preferences.boundary_change_effective_at_utc.isoformat()
                ),
                'boundary_change_target_local_date': (
                    preferences.boundary_change_target_local_date.isoformat()
                ),
                'protected_days': [
                    _boundary_day_payload(row) for row in protected_rows
                ],
                'future_days': [
                    _boundary_future_payload(day) for day in redated_days
                ],
            }
            digest = hashlib.sha256(json.dumps(
                digest_payload, sort_keys=True, separators=(',', ':')
            ).encode()).hexdigest()
            if plan.mode == 'observe':
                normalized_stages = ()
                generation_input = PlanGenerationInput(
                    mode='observe',
                    target_basis='observe',
                    start_date=redated_days[0].local_date,
                    target_date=redated_days[-1].local_date,
                    duration_days=len(redated_days),
                )
            elif redated_days[0].target_pouches is None:
                normalized_stages = _normalized_stages(redated_days)
                generation_input = PlanGenerationInput(
                    mode=plan.mode,
                    target_basis='nicotine_mg',
                    start_date=redated_days[0].local_date,
                    baseline_mg=Decimal(
                        redated_days[0].nicotine_ceiling_mg
                    ),
                    pace=plan.pace,
                    end_target_mg=Decimal(
                        redated_days[-1].nicotine_ceiling_mg
                    ),
                    target_date=redated_days[-1].local_date,
                    duration_days=len(redated_days),
                )
            else:
                normalized_stages = _normalized_stages(redated_days)
                generation_input = PlanGenerationInput(
                    mode=plan.mode,
                    target_basis='legacy_pouches',
                    start_date=redated_days[0].local_date,
                    baseline_pouches=Decimal(redated_days[0].target_pouches),
                    baseline_mg=Decimal(redated_days[0].nicotine_ceiling_mg),
                    baseline_mg_per_pouch=Decimal(plan.baseline_mg_per_pouch),
                    pace=plan.pace,
                    end_target_pouches=redated_days[-1].target_pouches,
                    target_date=redated_days[-1].local_date,
                    duration_days=len(redated_days),
                    stage_targets=normalized_stages,
                )
            preview = GeneratedPlanPreview(
                days=redated_days,
                normalized_stages=normalized_stages,
                digest=digest,
            )

            for row in future_rows:
                db.session.delete(row)
            revision = PlanRevision(
                plan_id=plan.id,
                effective_date=redated_days[0].local_date,
                pace=plan.pace,
                target_date=redated_days[-1].local_date,
                end_target_pouches=redated_days[-1].target_pouches,
                end_target_mg=redated_days[-1].nicotine_ceiling_mg,
                generation_inputs=_canonical_generation_inputs(
                    generation_input, preview
                ),
                preview_digest=digest,
                reason='boundary_change',
            )
            db.session.add(revision)
            db.session.flush()
            db.session.add_all([
                PlanDay(
                    plan_id=plan.id,
                    revision_id=revision.id,
                    local_date=day.local_date,
                    target_pouches=day.target_pouches,
                    nicotine_ceiling_mg=day.nicotine_ceiling_mg,
                )
                for day in redated_days
            ])
            plan.active_revision_id = revision.id
            plan.target_date = redated_days[-1].local_date
            plan.end_target_mg = redated_days[-1].nicotine_ceiling_mg
            plan.end_target_pouches = redated_days[-1].target_pouches
            _apply_pending_preferences(user, preferences)
            db.session.commit()
            return revision
        except Exception:
            db.session.rollback()
            raise
