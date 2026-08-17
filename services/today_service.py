"""Canonical composition for the authenticated Today destination."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
import logging

from sqlalchemy import case, or_

from models import (
    Craving,
    DailyCheckIn,
    Log,
    PlanDay,
    PlanStatusEvent,
    Pouch,
    ReductionPlan,
    User,
    UserPreferredPouch,
)
from services.api_types import (
    CanonicalCheckIn,
    CanonicalLog,
    CheckInTimelineItem,
    CravingTimelineItem,
    LogTimelineItem,
    SmartDefault,
    TodayPlan,
    TodaySummary,
)
from services.coaching_service import CoachingService
from services.request_context import get_request_id
from services.serializers import canonical_craving_for_timezone
from services.timezone_service import (
    get_user_day_window,
    resolve_timezone,
    to_naive_utc,
)


logger = logging.getLogger(__name__)


class TodayService:
    """Compose one ownership-scoped, timezone-canonical user day."""

    @classmethod
    def get_summary(
        cls,
        user_id: int,
        local_date: date | None = None,
        now: datetime | None = None,
    ) -> TodaySummary:
        user = User.query.filter_by(id=user_id).one_or_none()
        if user is None:
            raise LookupError("user not found")

        instant = cls._normalize_now(now)
        user_timezone = resolve_timezone(user.timezone)
        reset_time = (
            user.preferences.daily_reset_time
            if user.preferences and user.preferences.daily_reset_time
            else time.min
        )
        selected_date = local_date or cls._local_date_for_instant(
            instant, user_timezone.zone, reset_time
        )
        window = get_user_day_window(
            user_timezone.zone, selected_date, reset_time
        )
        plan, plan_days = cls._active_plan(user_id)
        today_plan, milestones = cls._today_plan(
            plan, plan_days, selected_date
        )
        logs = cls._logs_for_window(user_id, window)
        cravings = cls._cravings_for_window(user_id, window)
        check_in_row = DailyCheckIn.query.filter_by(
            user_id=user_id, local_date=selected_date
        ).one_or_none()
        check_in = cls._canonical_check_in(check_in_row)
        timeline = cls._timeline(
            logs, cravings, check_in_row, user_timezone
        )
        smart_default = cls._smart_default(user_id)
        review_recommended = cls._review_recommended(
            user_id,
            plan,
            instant,
            user_timezone.zone,
            reset_time,
        )
        actual_pouches = sum(log.quantity for log in logs)
        known_nicotine = sum(
            (
                Decimal(log.quantity) * Decimal(log.nicotine_mg_snapshot)
                for log in logs
                if log.nicotine_mg_snapshot is not None
            ),
            Decimal("0"),
        )
        unknown_strength_events = sum(
            1 for log in logs if log.nicotine_mg_snapshot is None
        )
        targeted = (
            today_plan is not None
            and today_plan.status == "active"
            and today_plan.mode != "observe"
            and today_plan.nicotine_ceiling_mg is not None
        )
        if targeted:
            pouch_status = (
                cls._guardrail_state(
                    Decimal(actual_pouches), Decimal(today_plan.target_pouches)
                )
                if today_plan.target_pouches is not None
                else "neutral"
            )
            nicotine_state = cls._guardrail_state(
                known_nicotine, Decimal(today_plan.nicotine_ceiling_mg)
            )
            if unknown_strength_events:
                nicotine_state = "unknown"
            component_states = {pouch_status, nicotine_state}
            if unknown_strength_events:
                status = "unknown"
            elif "exceeded" in component_states:
                status = "exceeded"
            elif "met" in component_states:
                status = "met"
            elif "approaching" in component_states:
                status = "approaching"
            else:
                status = "on_track"
        else:
            status = pouch_status = nicotine_state = "neutral"
        remaining_pouches = (
            max(today_plan.target_pouches - actual_pouches, 0)
            if targeted and today_plan.target_pouches is not None else None
        )
        remaining_nicotine = (
            max(today_plan.nicotine_ceiling_mg - known_nicotine, Decimal("0"))
            if targeted and not unknown_strength_events else None
        )
        check_in_eligible = (
            status in {"met", "exceeded"}
            or window.end_utc - timedelta(hours=2) <= instant < window.end_utc
        )
        try:
            coaching = CoachingService.message_for_today(
                status=status,
                has_unresolved_craving=any(
                    craving.outcome is None for craving in cravings
                ),
                check_in_eligible=check_in_eligible,
            )
        except Exception:
            logger.warning(
                "Today coaching unavailable (request %s)",
                get_request_id(),
                exc_info=True,
            )
            coaching = None

        return TodaySummary(
            local_date=selected_date,
            window=window,
            plan=today_plan,
            actual_pouches=actual_pouches,
            actual_nicotine_mg=(
                None if unknown_strength_events else known_nicotine
            ),
            known_nicotine_mg=known_nicotine,
            unknown_strength_events=unknown_strength_events,
            remaining_pouches=remaining_pouches,
            remaining_nicotine_mg=remaining_nicotine,
            status=status,
            pouch_status=pouch_status,
            nicotine_state=nicotine_state,
            timeline=timeline,
            smart_default=smart_default,
            check_in=check_in,
            coaching=coaching,
            check_in_eligible=check_in_eligible,
            review_recommended=review_recommended,
            milestones=milestones,
            generated_at=instant,
        )

    @staticmethod
    def _logs_for_window(user_id: int, window) -> tuple[Log, ...]:
        return tuple(
            Log.query.filter(
                Log.user_id == user_id,
                Log.log_time >= to_naive_utc(window.start_utc),
                Log.log_time < to_naive_utc(window.end_utc),
            )
            .order_by(Log.log_time, Log.id)
            .all()
        )

    @staticmethod
    def _cravings_for_window(user_id: int, window) -> tuple[Craving, ...]:
        return tuple(
            Craving.query.filter(
                Craving.user_id == user_id,
                Craving.craving_time >= to_naive_utc(window.start_utc),
                Craving.craving_time < to_naive_utc(window.end_utc),
            )
            .order_by(Craving.craving_time, Craving.id)
            .all()
        )

    @staticmethod
    def _smart_default(user_id: int) -> SmartDefault | None:
        eligible = or_(Pouch.created_by.is_(None), Pouch.created_by == user_id)
        recent = (
            Pouch.query.join(Log, Log.pouch_id == Pouch.id)
            .filter(Log.user_id == user_id, eligible)
            .order_by(Log.log_time.desc(), Log.id.desc())
            .first()
        )
        if recent is not None:
            return SmartDefault(
                pouch_id=recent.id,
                brand=recent.brand,
                nicotine_mg=Decimal(recent.nicotine_mg),
                source="recent",
            )

        preferred = (
            Pouch.query.join(
                UserPreferredPouch,
                UserPreferredPouch.pouch_id == Pouch.id,
            )
            .filter(
                UserPreferredPouch.user_id == user_id,
                eligible,
            )
            .order_by(UserPreferredPouch.rank, UserPreferredPouch.id)
            .first()
        )
        if preferred is not None:
            return SmartDefault(
                pouch_id=preferred.id,
                brand=preferred.brand,
                nicotine_mg=Decimal(preferred.nicotine_mg),
                source="preferred",
            )
        return None

    @staticmethod
    def _review_recommended(
        user_id: int,
        plan: ReductionPlan | None,
        instant: datetime,
        timezone_name: str,
        reset_time: time,
    ) -> bool:
        if plan is None or plan.mode == "observe":
            return False
        current_local_date = TodayService._local_date_for_instant(
            instant, timezone_name, reset_time
        )
        candidate_rows = (
            PlanDay.query.filter(
                PlanDay.plan_id == plan.id,
                PlanDay.target_pouches.isnot(None),
                PlanDay.nicotine_ceiling_mg.isnot(None),
                PlanDay.local_date < current_local_date,
            )
            .order_by(PlanDay.local_date.desc(), PlanDay.id.desc())
            .limit(100)
            .all()
        )
        status_events = tuple(
            PlanStatusEvent.query.filter_by(plan_id=plan.id)
            .order_by(
                PlanStatusEvent.effective_at_utc,
                PlanStatusEvent.id,
            )
            .all()
        )
        completed = []
        for row in candidate_rows:
            window = get_user_day_window(
                timezone_name, row.local_date, reset_time
            )
            if (
                window.end_utc <= instant
                and not TodayService._window_was_paused(
                    window, status_events
                )
            ):
                completed.append((row, window))
            if len(completed) == 5:
                break
        if not completed:
            return False

        earliest = min(window.start_utc for _, window in completed)
        latest = max(window.end_utc for _, window in completed)
        logs = Log.query.filter(
            Log.user_id == user_id,
            Log.log_time >= to_naive_utc(earliest),
            Log.log_time < to_naive_utc(latest),
        ).all()
        exceeded_days = 0
        for day, window in completed:
            start = to_naive_utc(window.start_utc)
            end = to_naive_utc(window.end_utc)
            day_logs = [
                row for row in logs if start <= row.log_time < end
            ]
            pouches = sum(row.quantity for row in day_logs)
            known_mg = sum(
                (
                    Decimal(row.quantity) * Decimal(row.nicotine_mg_snapshot)
                    for row in day_logs
                    if row.nicotine_mg_snapshot is not None
                ),
                Decimal("0"),
            )
            if (
                pouches > day.target_pouches
                or known_mg > Decimal(day.nicotine_ceiling_mg)
            ):
                exceeded_days += 1
        return exceeded_days >= 3

    @staticmethod
    def _window_was_paused(window, status_events: tuple[PlanStatusEvent, ...]) -> bool:
        start = to_naive_utc(window.start_utc)
        end = to_naive_utc(window.end_utc)
        state_at_start = None
        for event in status_events:
            effective = to_naive_utc(event.effective_at_utc)
            if effective <= start:
                state_at_start = event.status
            if start <= effective < end and event.status == "paused":
                return True
        return state_at_start == "paused"

    @staticmethod
    def _aware_utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    @staticmethod
    def _canonical_check_in(
        row: DailyCheckIn | None,
    ) -> CanonicalCheckIn | None:
        if row is None:
            return None
        return CanonicalCheckIn(
            id=row.id,
            local_date=row.local_date,
            mood=row.mood,
            confidence=row.confidence,
            reflection=row.reflection,
            context=row.context,
        )

    @classmethod
    def _timeline(
        cls,
        logs: tuple[Log, ...],
        cravings: tuple[Craving, ...],
        check_in_row: DailyCheckIn | None,
        user_timezone,
    ) -> tuple:
        linked_cravings = {}
        for craving in cravings:
            if craving.linked_log_id is not None:
                linked_cravings.setdefault(craving.linked_log_id, craving.id)

        items = []
        for log in logs:
            occurred_utc = cls._aware_utc(log.log_time)
            strength = (
                Decimal(log.nicotine_mg_snapshot)
                if log.nicotine_mg_snapshot is not None else None
            )
            canonical = CanonicalLog(
                id=log.id,
                client_event_id=log.client_event_id,
                occurred_at_utc=occurred_utc,
                occurred_at_local=occurred_utc.astimezone(user_timezone),
                pouch_id=log.pouch_id,
                product_brand=(
                    log.product_brand_snapshot or log.custom_brand or None
                ),
                nicotine_mg=strength,
                quantity=log.quantity,
                total_nicotine_mg=(
                    Decimal(log.quantity) * strength
                    if strength is not None else None
                ),
                notes=log.notes,
                linked_craving_id=linked_cravings.get(log.id),
            )
            items.append(LogTimelineItem(
                type="log",
                id=log.id,
                occurred_at_utc=occurred_utc,
                occurred_at_local=canonical.occurred_at_local,
                state="confirmed",
                label="Nicotine logged",
                data=canonical,
            ))

        for craving in cravings:
            occurred_utc = cls._aware_utc(craving.craving_time)
            canonical = canonical_craving_for_timezone(
                craving, user_timezone.zone
            )
            outcome = canonical.outcome
            state = outcome or "unresolved"
            label = (
                "Craving recorded" if outcome is None
                else f"Craving · {outcome.replace('_', ' ')}"
            )
            items.append(CravingTimelineItem(
                type="craving",
                id=craving.id,
                occurred_at_utc=occurred_utc,
                occurred_at_local=canonical.occurred_at_local,
                state=state,
                label=label,
                data=canonical,
            ))

        if check_in_row is not None:
            occurred_utc = cls._aware_utc(check_in_row.created_at)
            canonical = cls._canonical_check_in(check_in_row)
            items.append(CheckInTimelineItem(
                type="check_in",
                id=check_in_row.id,
                occurred_at_utc=occurred_utc,
                occurred_at_local=occurred_utc.astimezone(user_timezone),
                state="completed",
                label="Daily check-in",
                data=canonical,
            ))

        return tuple(sorted(
            items,
            key=lambda item: (item.occurred_at_utc, item.type, item.id),
        ))

    @staticmethod
    def _guardrail_state(actual: Decimal, guardrail: Decimal) -> str:
        if actual > guardrail:
            return "exceeded"
        if guardrail > 0 and actual == guardrail:
            return "met"
        if guardrail > 0 and actual >= guardrail * Decimal("0.8"):
            return "approaching"
        return "on_track"

    @staticmethod
    def _active_plan(
        user_id: int,
    ) -> tuple[ReductionPlan | None, tuple[PlanDay, ...]]:
        plan = (
            ReductionPlan.query.filter(
                ReductionPlan.user_id == user_id,
                ReductionPlan.status.in_(("active", "paused")),
            )
            .order_by(
                case((ReductionPlan.status == "active", 0), else_=1),
                ReductionPlan.updated_at.desc(),
                ReductionPlan.id.desc(),
            )
            .first()
        )
        if plan is None:
            return None, ()
        days = tuple(
            PlanDay.query.filter_by(plan_id=plan.id)
            .order_by(PlanDay.local_date, PlanDay.id)
            .all()
        )
        return plan, days

    @classmethod
    def _today_plan(
        cls,
        plan: ReductionPlan | None,
        plan_days: tuple[PlanDay, ...],
        selected_date: date,
    ) -> tuple[TodayPlan | None, tuple[str, ...]]:
        if plan is None:
            return None, ()
        matching = next(
            (day for day in plan_days if day.local_date == selected_date), None
        )
        day_number = next(
            (
                index
                for index, day in enumerate(plan_days, start=1)
                if day.local_date == selected_date
            ),
            0,
        )
        stage_label, milestones = cls._stage_context(
            plan, plan_days, selected_date, day_number
        )
        return TodayPlan(
            id=plan.id,
            mode=plan.mode,
            status=plan.status,
            local_date=selected_date,
            day_number=day_number,
            target_pouches=(matching.target_pouches if matching else None),
            nicotine_ceiling_mg=(
                matching.nicotine_ceiling_mg if matching else None
            ),
            pace=plan.pace,
            stage_label=stage_label,
        ), milestones

    @staticmethod
    def _stage_context(
        plan: ReductionPlan,
        plan_days: tuple[PlanDay, ...],
        selected_date: date,
        day_number: int,
    ) -> tuple[str, tuple[str, ...]]:
        if plan.mode == "observe":
            return "Observe and learn", ()
        fallback = f"Plan day {day_number}" if day_number else "Plan schedule"
        revision = plan.active_revision
        raw_stages = (
            revision.generation_inputs.get("stage_targets")
            if revision and isinstance(revision.generation_inputs, dict)
            else None
        )
        if not isinstance(raw_stages, list) or not raw_stages:
            current = next(
                (
                    day for day in plan_days
                    if day.local_date == selected_date
                ),
                None,
            )
            next_reduction = next(
                (
                    day for day in plan_days
                    if current is not None
                    and current.target_pouches is not None
                    and day.local_date > selected_date
                    and day.target_pouches is not None
                    and day.target_pouches < current.target_pouches
                ),
                None,
            )
            if next_reduction is None:
                return fallback, ()
            return fallback, (
                f"Next reduction: {next_reduction.target_pouches} pouches on "
                f"{next_reduction.local_date.strftime('%b')} "
                f"{next_reduction.local_date.day}",
            )
        try:
            stages = tuple({
                "start": date.fromisoformat(stage["start_date"]),
                "end": date.fromisoformat(stage["end_date"]),
                "target": int(stage["target_pouches"]),
            } for stage in raw_stages)
        except (KeyError, TypeError, ValueError):
            return fallback, ()
        current_index = next(
            (
                index
                for index, stage in enumerate(stages)
                if stage["start"] <= selected_date <= stage["end"]
            ),
            None,
        )
        if current_index is None:
            return fallback, ()
        current = stages[current_index]
        label = (
            f"Stage {current_index + 1} of {len(stages)} · "
            f"{current['target']} pouches"
        )
        milestones = [
            f"Completed {stage['target']}-pouch stage"
            for stage in stages
            if stage["end"] < selected_date
        ]
        next_reduction = next(
            (
                stage for stage in stages[current_index + 1:]
                if stage["target"] < current["target"]
            ),
            None,
        )
        if next_reduction is not None:
            start = next_reduction["start"]
            milestones.append(
                f"Next reduction: {next_reduction['target']} pouches on "
                f"{start.strftime('%b')} {start.day}"
            )
        return label, tuple(milestones)

    @staticmethod
    def _normalize_now(now: datetime | None) -> datetime:
        instant = now or datetime.now(timezone.utc)
        if instant.tzinfo is None:
            return instant.replace(tzinfo=timezone.utc)
        return instant.astimezone(timezone.utc)

    @staticmethod
    def _local_date_for_instant(
        instant: datetime, timezone_name: str, reset_time: time
    ) -> date:
        zone = resolve_timezone(timezone_name)
        candidate = instant.astimezone(zone).date()
        candidate_window = get_user_day_window(
            timezone_name, candidate, reset_time
        )
        if instant < candidate_window.start_utc:
            return candidate - timedelta(days=1)
        return candidate
