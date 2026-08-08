"""Timezone handling service for NicotineTracker.

This service provides centralized timezone conversion functions to ensure
consistent handling of user timezones throughout the application.
"""
import logging
import re
from dataclasses import dataclass
from datetime import datetime, date, time, timedelta
from typing import Optional, Tuple
import pytz
from pytz import timezone as pytz_timezone

from services.request_context import get_request_id

logger = logging.getLogger(__name__)
CANONICAL_TIMEZONES = frozenset(pytz.all_timezones)


class InvalidEventTimeError(ValueError):
    """A user-entered event time is not valid for the claimed timezone.

    Raised when a local event timestamp is nonexistent in the zone, or the
    claimed UTC offset disagrees with the zone at that instant. Unlike the
    daily reset, event times are never silently shifted or guessed.
    """


_UTC_OFFSET_PATTERN = re.compile(r"^([+-])(\d{2}):?(\d{2})$")


def _parse_utc_offset(value) -> timedelta:
    """Normalize a claimed UTC offset ("+03:00", "-0500", or timedelta)."""
    if isinstance(value, timedelta):
        return value
    if not isinstance(value, str):
        raise InvalidEventTimeError(
            f"UTC offset must be a string like '+03:00' or a timedelta, got {type(value).__name__}"
        )
    match = _UTC_OFFSET_PATTERN.match(value.strip())
    if not match:
        raise InvalidEventTimeError(f"Malformed UTC offset: {value!r}")
    sign, hours_text, minutes_text = match.groups()
    hours, minutes = int(hours_text), int(minutes_text)
    if minutes > 59 or hours > 14 or (hours == 14 and minutes > 0):
        raise InvalidEventTimeError(f"UTC offset out of range: {value!r}")
    offset = timedelta(hours=hours, minutes=minutes)
    return offset if sign == "+" else -offset


def parse_local_event_time(
    timezone_name: str,
    local_datetime: datetime,
    utc_offset,
) -> datetime:
    """Parse a user-entered local event time into an aware UTC datetime.

    ``local_datetime`` must be naive; ``utc_offset`` is the offset the
    client observed at the event ("+03:00" or a timedelta). The offset
    cross-checks the zone: it disambiguates fall-back overlaps and exposes
    clock/zone disagreements instead of silently trusting one side.

    Raises:
        pytz.exceptions.UnknownTimeZoneError: invalid timezone identifier.
        InvalidEventTimeError: nonexistent wall time, offset mismatch,
            malformed offset, or an already-aware ``local_datetime``.
    """
    tz = get_timezone_object(timezone_name)
    if not isinstance(local_datetime, datetime) or local_datetime.tzinfo is not None:
        raise InvalidEventTimeError(
            "local_datetime must be a naive datetime in the user's timezone"
        )
    claimed_offset = _parse_utc_offset(utc_offset)

    try:
        exact = tz.localize(local_datetime, is_dst=None)
    except pytz.exceptions.NonExistentTimeError:
        raise InvalidEventTimeError(
            f"{local_datetime!r} never happened in {timezone_name} "
            "(spring-forward gap); event times are not shifted"
        ) from None
    except pytz.exceptions.AmbiguousTimeError:
        candidates = (
            tz.localize(local_datetime, is_dst=True),
            tz.localize(local_datetime, is_dst=False),
        )
        matches = [c for c in candidates if c.utcoffset() == claimed_offset]
        if len(matches) != 1:
            raise InvalidEventTimeError(
                f"{local_datetime!r} is ambiguous in {timezone_name} and the "
                f"claimed offset {claimed_offset} matches neither occurrence"
            ) from None
        exact = matches[0]
    else:
        if exact.utcoffset() != claimed_offset:
            raise InvalidEventTimeError(
                f"offset mismatch for {local_datetime!r} in {timezone_name}: "
                f"zone is {exact.utcoffset()}, claimed {claimed_offset}"
            )
    return exact.astimezone(pytz.UTC)


def to_naive_utc(value: datetime) -> datetime:
    """Return the naive UTC wall clock for a datetime.

    ``DateTime`` columns store naive UTC, so query bounds and stored values
    are normalized at the service boundary and comparisons never mix aware
    and naive values. A naive input is already assumed to be UTC.
    """
    if value.tzinfo is not None:
        return value.astimezone(pytz.UTC).replace(tzinfo=None)
    return value


@dataclass(frozen=True)
class UserDayWindow:
    """The canonical user-day boundary.

    Intervals are half-open: ``start_utc <= event_time < end_utc``. An event
    at exactly ``end_utc`` belongs to the next user day. ``start_utc`` and
    ``end_utc`` are timezone-aware UTC datetimes.
    """

    local_date: date
    start_utc: datetime
    end_utc: datetime


@dataclass(frozen=True)
class UserWeekWindow:
    """A user week composed from seven consecutive :class:`UserDayWindow`s.

    Weeks run Monday through Sunday in the user's timezone. ``start_utc``
    is Monday's window start and ``end_utc`` is Sunday's window end, so the
    week is exactly the union of its half-open days — 167/168/169 hours
    across DST transitions, never a smeared 7×24h average.
    """

    week_start_date: date
    start_utc: datetime
    end_utc: datetime
    days: tuple


def get_user_week_window(
    timezone_name: str,
    local_date: date,
    reset_time: time = time.min,
) -> UserWeekWindow:
    """Return the week (Monday-Sunday) containing ``local_date``.

    The week is literally composed from day windows: each day's ``end_utc``
    is the next day's ``start_utc``.
    """
    monday = local_date - timedelta(days=local_date.weekday())
    days = tuple(
        get_user_day_window(
            timezone_name, monday + timedelta(days=offset), reset_time
        )
        for offset in range(7)
    )
    return UserWeekWindow(
        week_start_date=monday,
        start_utc=days[0].start_utc,
        end_utc=days[-1].end_utc,
        days=days,
    )


def get_user_day_window(
    timezone_name: str,
    local_date: date,
    reset_time: time = time.min,
) -> UserDayWindow:
    """Return the half-open UTC window for one user day.

    The window covers ``[reset_time on local_date, reset_time on the next
    local day)`` in the user's timezone, expressed in UTC.
    """
    tz = get_timezone_object(timezone_name)
    start_local = _localize_reset(tz, datetime.combine(local_date, reset_time))
    next_local = _localize_reset(
        tz, datetime.combine(local_date + timedelta(days=1), reset_time)
    )
    return UserDayWindow(
        local_date=local_date,
        start_utc=start_local.astimezone(pytz.UTC),
        end_utc=next_local.astimezone(pytz.UTC),
    )


def _localize_reset(tz: pytz.BaseTzInfo, naive: datetime) -> datetime:
    """Localize a daily reset wall-clock time with fixed DST rules.

    Only daily reset times use this rule; user-entered event times must be
    rejected instead (see the event parser).

    - A nonexistent reset (spring-forward gap) shifts forward by the DST gap.
    - An ambiguous reset (fall-back overlap) uses the earlier occurrence,
      which is the DST interpretation for the normal fall-back case.
    """
    try:
        return tz.localize(naive, is_dst=None)
    except pytz.exceptions.NonExistentTimeError:
        dst_interpretation = tz.localize(naive, is_dst=True)
        std_interpretation = tz.localize(naive, is_dst=False)
        gap = abs(std_interpretation.utcoffset() - dst_interpretation.utcoffset())
        # The shifted wall time exists by construction: it lands on the far
        # side of the gap. ``is_dst=None`` proves that instead of guessing.
        return tz.localize(naive + gap, is_dst=None)
    except pytz.exceptions.AmbiguousTimeError:
        candidates = (
            tz.localize(naive, is_dst=True),
            tz.localize(naive, is_dst=False),
        )
        return min(candidates, key=lambda candidate: candidate.astimezone(pytz.UTC))


def get_timezone_object(timezone_str: str) -> pytz.BaseTzInfo:
    """Return the timezone for a user-submitted identifier, or raise.

    User input must be rejected, never silently reinterpreted: invalid
    identifiers raise :class:`pytz.exceptions.UnknownTimeZoneError`.
    Persisted legacy values go through :func:`resolve_timezone` instead.
    """
    if (
        not isinstance(timezone_str, str)
        or timezone_str not in CANONICAL_TIMEZONES
    ):
        raise pytz.exceptions.UnknownTimeZoneError(timezone_str)
    return pytz_timezone(timezone_str)


def resolve_timezone(timezone_name: Optional[str]) -> pytz.BaseTzInfo:
    """Resolve a persisted timezone identifier, falling back to UTC.

    Only legacy persisted identifiers may be invalid; that path logs a
    warning carrying the request correlation ID. Blank and unset legacy
    values are invalid too and must never fall back silently.
    """
    try:
        return get_timezone_object(timezone_name)
    except pytz.exceptions.UnknownTimeZoneError:
        logger.warning(
            "Invalid persisted timezone %r; falling back to UTC (request %s)",
            timezone_name,
            get_request_id(),
        )
        return pytz.UTC


def convert_user_time_to_utc(user_timezone: str, local_date: date, local_time: Optional[time] = None) -> Tuple[datetime, date, Optional[time]]:
    """
    Convert user's local date/time to UTC datetime.
    
    Args:
        user_timezone: User's timezone string (e.g., 'America/New_York')
        local_date: Date in user's timezone
        local_time: Time in user's timezone (optional)
    
    Returns:
        Tuple of (utc_datetime, utc_date, utc_time)
    """
    if local_time is None:
        local_time = time(12, 0)  # Default to noon if no time provided
    
    # Create timezone objects
    user_tz = resolve_timezone(user_timezone)
    
    # Create naive datetime in user's timezone
    naive_datetime = datetime.combine(local_date, local_time)
    
    # Localize to user's timezone
    localized_datetime = user_tz.localize(naive_datetime)
    
    # Convert to UTC
    utc_datetime = localized_datetime.astimezone(pytz.UTC)
    
    return utc_datetime, utc_datetime.date(), utc_datetime.time()


def convert_utc_to_user_time(user_timezone: str, utc_datetime: datetime) -> Tuple[datetime, date, time]:
    """
    Convert UTC datetime to user's local time.
    
    Args:
        user_timezone: User's timezone string
        utc_datetime: UTC datetime
    
    Returns:
        Tuple of (local_datetime, local_date, local_time)
    """
    # Ensure UTC datetime is timezone-aware
    if utc_datetime.tzinfo is None:
        utc_datetime = pytz.UTC.localize(utc_datetime)
    elif utc_datetime.tzinfo != pytz.UTC:
        utc_datetime = utc_datetime.astimezone(pytz.UTC)
    
    # Convert to user's timezone
    user_tz = resolve_timezone(user_timezone)
    local_datetime = utc_datetime.astimezone(user_tz)
    
    return local_datetime, local_datetime.date(), local_datetime.time()


def get_user_date_boundaries(user_timezone: str, target_date: date) -> Tuple[datetime, datetime]:
    """
    Get the UTC boundaries for a date in the user's timezone.

    Temporary tuple wrapper over :func:`get_user_day_window` at a midnight
    reset; the returned ``end`` is exclusive (half-open), not ``time.max``.

    Args:
        user_timezone: User's timezone string
        target_date: The date in user's timezone

    Returns:
        Tuple of (start_utc_datetime, end_utc_datetime_exclusive)
    """
    persisted_timezone = resolve_timezone(user_timezone)
    window = get_user_day_window(persisted_timezone.zone, target_date)
    return window.start_utc, window.end_utc


def get_current_user_time(user_timezone: str) -> Tuple[datetime, date, time]:
    """
    Get current time in user's timezone.
    
    Args:
        user_timezone: User's timezone string
    
    Returns:
        Tuple of (local_datetime, local_date, local_time)
    """
    utc_now = datetime.now(pytz.UTC)
    return convert_utc_to_user_time(user_timezone, utc_now)


def get_user_week_boundaries(user_timezone: str, target_date: date) -> Tuple[datetime, datetime]:
    """
    Get the UTC boundaries for the week containing target_date.

    Temporary tuple wrapper over :func:`get_user_week_window` at a midnight
    reset; the returned ``week_end_utc`` is exclusive (half-open).

    Args:
        user_timezone: User's timezone string
        target_date: A date within the target week

    Returns:
        Tuple of (week_start_utc, week_end_utc_exclusive)
    """
    persisted_timezone = resolve_timezone(user_timezone)
    week = get_user_week_window(persisted_timezone.zone, target_date)
    return week.start_utc, week.end_utc


def format_time_for_user(user_timezone: str, utc_datetime: datetime, format_str: str = '%Y-%m-%d %H:%M') -> str:
    """
    Format UTC datetime for display in user's timezone.
    
    Args:
        user_timezone: User's timezone string
        utc_datetime: UTC datetime to format
        format_str: Format string for datetime formatting
    
    Returns:
        Formatted datetime string in user's timezone
    """
    local_datetime, _, _ = convert_utc_to_user_time(user_timezone, utc_datetime)
    return local_datetime.strftime(format_str)


def get_timezone_offset(user_timezone: str) -> str:
    """
    Get timezone offset string for display (e.g., '-05:00', '+02:00').
    
    Args:
        user_timezone: User's timezone string
    
    Returns:
        Timezone offset string
    """
    user_tz = resolve_timezone(user_timezone)
    now = datetime.now(user_tz)
    offset = now.strftime('%z')
    
    # Format as +/-HH:MM
    if len(offset) == 5:
        return f"{offset[:3]}:{offset[3:]}"
    return offset


def validate_timezone(timezone_str: str) -> bool:
    """
    Validate if timezone string is valid.
    
    Args:
        timezone_str: Timezone string to validate
    
    Returns:
        True if valid, False otherwise
    """
    return isinstance(timezone_str, str) and timezone_str in CANONICAL_TIMEZONES


def get_common_timezones() -> list:
    """
    Get list of common timezone choices for forms.
    
    Returns:
        List of (timezone_id, display_name) tuples
    """
    common_timezones = [
        ('UTC', 'UTC (Coordinated Universal Time)'),
        ('US/Eastern', 'US Eastern Time'),
        ('US/Central', 'US Central Time'),
        ('US/Mountain', 'US Mountain Time'),
        ('US/Pacific', 'US Pacific Time'),
        ('Europe/London', 'London (GMT/BST)'),
        ('Europe/Paris', 'Paris (CET/CEST)'),
        ('Europe/Berlin', 'Berlin (CET/CEST)'),
        ('Europe/Rome', 'Rome (CET/CEST)'),
        ('Europe/Madrid', 'Madrid (CET/CEST)'),
        ('Asia/Tokyo', 'Tokyo (JST)'),
        ('Asia/Shanghai', 'Shanghai (CST)'),
        ('Asia/Kolkata', 'India (IST)'),
        ('Australia/Sydney', 'Sydney (AEST/AEDT)'),
        ('Australia/Melbourne', 'Melbourne (AEST/AEDT)'),
        ('Canada/Eastern', 'Canada Eastern'),
        ('Canada/Central', 'Canada Central'),
        ('Canada/Mountain', 'Canada Mountain'),
        ('Canada/Pacific', 'Canada Pacific'),
    ]
    
    return common_timezones


def get_user_day_boundaries(user_timezone: str, target_date: date, reset_time: time = None) -> Tuple[datetime, datetime]:
    """
    Get the UTC boundaries for a user's custom day based on reset time.

    Temporary tuple wrapper over :func:`get_user_day_window`; the returned
    ``day_end_utc`` is exclusive (half-open), not one microsecond before
    the next reset.

    Args:
        user_timezone: User's timezone string
        target_date: The date in user's timezone
        reset_time: Time when the day resets (defaults to midnight)

    Returns:
        Tuple of (day_start_utc, day_end_utc_exclusive)
    """
    persisted_timezone = resolve_timezone(user_timezone)
    window = get_user_day_window(
        persisted_timezone.zone, target_date, reset_time or time.min
    )
    return window.start_utc, window.end_utc


def get_current_user_day(user_timezone: str, reset_time: time = None) -> date:
    """
    Get the current user day based on their timezone and reset time.
    
    Args:
        user_timezone: User's timezone string
        reset_time: Time when the day resets (defaults to midnight)
    
    Returns:
        Current user day as date
    """
    if reset_time is None:
        reset_time = time(0, 0)  # Default to midnight
    
    # Resolve this persisted preference explicitly, then compare against the
    # candidate date's canonical reset instant. A wall-clock comparison is
    # wrong when the reset is shifted by a spring gap or repeated at fall-back.
    user_tz = resolve_timezone(user_timezone)
    now_utc = datetime.now(pytz.UTC)
    now_local = now_utc.astimezone(user_tz)
    candidate_date = now_local.date()
    candidate_window = get_user_day_window(
        user_tz.zone, candidate_date, reset_time
    )

    if now_utc < candidate_window.start_utc:
        return candidate_date - timedelta(days=1)
    return candidate_date


def get_user_week_boundaries_with_reset(user_timezone: str, target_date: date, reset_time: time = None) -> Tuple[datetime, datetime]:
    """
    Get the UTC boundaries for the week containing target_date, using a
    custom daily reset time.

    Temporary tuple wrapper over :func:`get_user_week_window`; the returned
    ``week_end_utc`` is exclusive (half-open).

    Args:
        user_timezone: User's timezone string
        target_date: A date within the target week
        reset_time: Time when days reset (defaults to midnight)

    Returns:
        Tuple of (week_start_utc, week_end_utc_exclusive)
    """
    persisted_timezone = resolve_timezone(user_timezone)
    week = get_user_week_window(
        persisted_timezone.zone, target_date, reset_time or time.min
    )
    return week.start_utc, week.end_utc


def get_all_timezones_for_dropdown() -> list:
    """
    Get all available timezones formatted for dropdown selection.
    
    Returns:
        List of dictionaries with 'value', 'label', and 'group' keys
    """
    timezones = []
    
    # Get all timezone names and sort them
    all_timezones = sorted(pytz.all_timezones)
    
    for tz_name in all_timezones:
        try:
            tz = pytz_timezone(tz_name)
            # Get current time to show offset
            now = datetime.now(tz)
            offset = now.strftime('%z')
            
            # Format offset for display (e.g., +0500 -> +05:00)
            if len(offset) == 5:
                offset = f"{offset[:3]}:{offset[3:]}"
            elif len(offset) == 0:
                offset = "+00:00"
            
            # Create display name with offset
            display_name = f"{tz_name} (UTC{offset})"
            
            # Group by region
            if '/' in tz_name:
                group = tz_name.split('/')[0]
            else:
                group = 'Other'
            
            timezones.append({
                'value': tz_name,
                'label': display_name,
                'group': group
            })
        except Exception:
            # Skip invalid timezones
            continue
    
    return timezones
