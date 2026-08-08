"""Journey progress composed from the canonical Today user-day authority."""

from decimal import Decimal

from models import PlanDay
from services.api_types import (
    JourneyNextChange,
    JourneyProgress,
    JourneyProgressStatus,
    TodaySummary,
)
from services.today_service import TodayService


class JourneyProgressService:
    """Expose Journey facts without duplicating Today aggregation rules."""

    @classmethod
    def get(cls, user_id: int) -> JourneyProgress:
        today = TodayService.get_summary(user_id)
        return cls.from_summary(today)

    @classmethod
    def from_summary(cls, today: TodaySummary) -> JourneyProgress:
        """Build Journey progress from the caller's canonical Today summary."""
        ceiling = today.plan.nicotine_ceiling_mg if today.plan else None
        paused = today.plan is not None and today.plan.status == 'paused'
        complete = today.unknown_strength_events == 0
        status = 'no_ceiling' if paused else cls._status(
            known_mg=today.known_nicotine_mg,
            ceiling_mg=ceiling,
            total_complete=complete,
        )
        return JourneyProgress(
            known_mg=today.known_nicotine_mg,
            total_complete=complete,
            ceiling_mg=ceiling,
            remaining_mg=today.remaining_nicotine_mg,
            status=status,
            pouches_logged=today.actual_pouches,
            next_change=cls._next_change(today),
        )

    @staticmethod
    def _status(
        *,
        known_mg: Decimal,
        ceiling_mg: Decimal | None,
        total_complete: bool,
    ) -> JourneyProgressStatus:
        if not total_complete:
            return 'nicotine_total_incomplete'
        if ceiling_mg is None:
            return 'no_ceiling'
        if known_mg < ceiling_mg:
            return 'below_ceiling'
        if known_mg == ceiling_mg:
            return 'at_ceiling'
        return 'above_ceiling'

    @staticmethod
    def _next_change(today) -> JourneyNextChange | None:
        if today.plan is None:
            return None
        if today.plan.status == 'paused':
            return JourneyNextChange(
                kind=(
                    'observation_paused'
                    if today.plan.mode == 'observe'
                    else 'resume_required'
                ),
                local_date=None,
                ceiling_mg=None,
                change_mg=None,
            )
        current_ceiling = today.plan.nicotine_ceiling_mg
        rows = (
            PlanDay.query.filter(
                PlanDay.plan_id == today.plan.id,
                PlanDay.local_date > today.local_date,
            )
            .order_by(PlanDay.local_date, PlanDay.id)
            .all()
        )
        row = next(
            (
                candidate for candidate in rows
                if candidate.nicotine_ceiling_mg != current_ceiling
            ),
            None,
        )
        if row is None:
            return None
        next_ceiling = row.nicotine_ceiling_mg
        change = (
            Decimal(next_ceiling) - Decimal(current_ceiling)
            if next_ceiling is not None and current_ceiling is not None
            else None
        )
        return JourneyNextChange(
            kind=(
                'first_ceiling'
                if current_ceiling is None else 'ceiling_change'
            ),
            local_date=row.local_date,
            ceiling_mg=next_ceiling,
            change_mg=change,
        )
