"""Transparent baseline suggestions from complete user days."""

from dataclasses import dataclass
from datetime import date, time, timedelta
from decimal import Decimal
from statistics import median

from extensions import db
from models import User
from services.log_service import (
    get_historical_nicotine_strength,
    group_logs_by_effective_day,
    logs_for_user_interval,
)
from services.timezone_service import (
    get_current_user_day,
    get_user_day_window,
    resolve_timezone,
)


_CENT = Decimal('0.01')


def _two_places(value) -> Decimal:
    return Decimal(value).quantize(_CENT)


@dataclass(frozen=True)
class BaselineSuggestion:
    available: bool
    pouches_per_day: Decimal | None
    nicotine_mg_per_day: Decimal | None
    median_mg_per_pouch: Decimal | None
    logged_days_used: int
    window_start: date
    window_end: date
    reason: str | None = None

    @property
    def remaining_logged_days_needed(self) -> int:
        return max(0, BaselineService.MIN_LOGGED_DAYS - self.logged_days_used)

    @property
    def explanation(self) -> str:
        if self.available:
            return (
                f'Based on {self.logged_days_used} logged days from '
                f'{self.window_start.isoformat()} to {self.window_end.isoformat()}.'
            )
        if self.reason == 'unknown_strength':
            return 'Some logged nicotine strengths are unknown. Enter them manually or observe first.'
        remaining = self.remaining_logged_days_needed
        noun = 'day' if remaining == 1 else 'days'
        return f'Log {remaining} more complete {noun}, or enter a baseline manually.'


class BaselineService:
    MIN_LOGGED_DAYS = 4
    LOOKBACK_DAYS = 14

    @classmethod
    def suggest(
        cls, user_id: int, as_of_local_date: date | None = None
    ) -> BaselineSuggestion:
        user = db.session.get(User, user_id)
        if user is None:
            raise ValueError('user not found')

        resolved, reset_time = cls._user_clock(user)
        current_day = as_of_local_date or get_current_user_day(
            resolved.zone, reset_time
        )
        window_end = current_day - timedelta(days=1)
        window_start = window_end - timedelta(days=cls.LOOKBACK_DAYS - 1)
        return cls._suggest_window(
            user_id, resolved, reset_time, window_start, window_end
        )

    @classmethod
    def suggest_for_window(
        cls, user_id: int, window_start: date, window_end: date
    ) -> BaselineSuggestion:
        """Baseline derived strictly from one completed local-date window.

        Logs whose effective user day falls outside ``[window_start,
        window_end]`` never influence the result, regardless of when they
        were logged. The same logged-day and median rules as
        :meth:`suggest` apply unchanged.
        """
        if (
            not isinstance(window_start, date)
            or not isinstance(window_end, date)
            or window_start > window_end
        ):
            raise ValueError('baseline window must be ordered local dates')
        user = db.session.get(User, user_id)
        if user is None:
            raise ValueError('user not found')

        resolved, reset_time = cls._user_clock(user)
        return cls._suggest_window(
            user_id, resolved, reset_time, window_start, window_end
        )

    @staticmethod
    def _user_clock(user):
        resolved = resolve_timezone(user.timezone)
        preferences = getattr(user, 'preferences', None)
        reset_time = (
            preferences.daily_reset_time
            if preferences and preferences.daily_reset_time else time.min
        )
        return resolved, reset_time

    @classmethod
    def _suggest_window(
        cls, user_id, resolved, reset_time, window_start, window_end
    ) -> BaselineSuggestion:
        start = get_user_day_window(
            resolved.zone, window_start, reset_time
        ).start_utc
        end = get_user_day_window(
            resolved.zone, window_end, reset_time
        ).end_utc
        logs = logs_for_user_interval(user_id, start, end)
        grouped = group_logs_by_effective_day(logs, resolved, reset_time)
        logged_days = [
            grouped[day]
            for day in sorted(grouped)
            if (
                window_start <= day <= window_end
                and grouped[day]
                and sum(max(0, log.quantity or 0) for log in grouped[day]) > 0
            )
        ]
        day_count = len(logged_days)

        daily_pouches = []
        daily_mg = []
        weighted_strengths = []
        unknown_strength = False
        for day_logs in logged_days:
            pouch_total = sum(max(0, log.quantity or 0) for log in day_logs)
            daily_pouches.append(Decimal(pouch_total))
            nicotine_total = Decimal('0')
            for log in day_logs:
                quantity = max(0, log.quantity or 0)
                strength = get_historical_nicotine_strength(log)
                if strength is None and quantity:
                    unknown_strength = True
                    continue
                if strength is not None:
                    normalized = Decimal(str(strength))
                    nicotine_total += normalized * quantity
                    weighted_strengths.extend([normalized] * quantity)
            daily_mg.append(nicotine_total)

        pouch_median = (
            _two_places(median(daily_pouches)) if daily_pouches else None
        )
        if unknown_strength:
            return BaselineSuggestion(
                available=False,
                pouches_per_day=pouch_median,
                nicotine_mg_per_day=None,
                median_mg_per_pouch=None,
                logged_days_used=day_count,
                window_start=window_start,
                window_end=window_end,
                reason='unknown_strength',
            )
        if day_count < cls.MIN_LOGGED_DAYS:
            return BaselineSuggestion(
                available=False,
                pouches_per_day=None,
                nicotine_mg_per_day=None,
                median_mg_per_pouch=None,
                logged_days_used=day_count,
                window_start=window_start,
                window_end=window_end,
                reason='insufficient_data',
            )
        nicotine_median = _two_places(median(daily_mg))
        strength_median = (
            _two_places(median(weighted_strengths))
            if weighted_strengths
            else None
        )
        return BaselineSuggestion(
            available=True,
            pouches_per_day=pouch_median,
            nicotine_mg_per_day=nicotine_median,
            median_mg_per_pouch=strength_median,
            logged_days_used=day_count,
            window_start=window_start,
            window_end=window_end,
            reason=None,
        )
