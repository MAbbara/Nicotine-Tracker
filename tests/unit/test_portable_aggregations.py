"""Portable craving aggregation tests (Task 5).

These tests pin the database-portable, timezone-aware behavior required from
``services.craving_service`` pattern analytics:

- weekday aggregation must work on SQLite as well as MySQL/MariaDB (no
  ``func.dayofweek``), and
- weekday / time-of-day buckets must be computed in the user's local
  timezone, not in storage UTC.

Timestamps are kept recent relative to ``datetime.utcnow()`` so the suite is
stable regardless of when it runs, and are naive UTC datetimes, matching the
repository storage contract. Nothing here patches the SQL path: failures must
expose the real implementation defects.
"""
import logging
from datetime import datetime, timedelta

from models import User, Craving
from services.craving_service import (
    get_comprehensive_craving_analytics,
    get_craving_patterns_by_day_of_week,
    get_craving_patterns_by_time_of_day,
    get_craving_vs_consumption_correlation,
)

DAY_NAMES = [
    'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]

NIGHT = 'Night (12AM-6AM)'
MORNING = 'Morning (6AM-12PM)'
AFTERNOON = 'Afternoon (12PM-6PM)'
EVENING = 'Evening (6PM-12AM)'
TIME_BUCKETS = [NIGHT, MORNING, AFTERNOON, EVENING]


def _recent_weekday_at(weekday, hour, minute=0):
    """Most recent UTC occurrence of ``weekday`` (Mon=0) at hour:minute.

    Never returns a future timestamp and always lands within the last 7 days,
    so results stay inside any reasonable ``days=`` analysis window.
    """
    now = datetime.utcnow()
    days_back = (now.weekday() - weekday) % 7
    candidate = (now - timedelta(days=days_back)).replace(
        hour=hour, minute=minute, second=0, microsecond=0
    )
    if candidate > now:
        candidate -= timedelta(days=7)
    return candidate


def _recent_time_at(hour, minute=0):
    """Most recent UTC occurrence of a wall-clock time, within the last 24h."""
    now = datetime.utcnow()
    candidate = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if candidate > now:
        candidate -= timedelta(days=1)
    return candidate


def _make_user(db_session, email, timezone):
    user = User(email=email, email_verified=True, timezone=timezone)
    user.set_password('password123')
    db_session.add(user)
    db_session.commit()
    return user


def _insert_craving(db_session, user_id, craving_time, intensity=5):
    craving = Craving(user_id=user_id, craving_time=craving_time, intensity=intensity)
    db_session.add(craving)
    db_session.commit()
    return craving


def test_craving_weekday_patterns_are_portable(db_session, test_user):
    """A UTC craving on a Monday must aggregate under 'Monday' on any backend.

    RED on SQLite today: the query uses MySQL-only ``func.dayofweek``, which
    SQLite cannot compile. This failure must come from the dialect
    incompatibility, not from fixture setup, so the fixture sanity check
    below deliberately asserts the stored timestamp really is a Monday.
    """
    monday_utc = _recent_weekday_at(weekday=0, hour=12)
    assert monday_utc.weekday() == 0, 'fixture setup: timestamp must be a Monday'
    _insert_craving(db_session, test_user.id, monday_utc)

    result = get_craving_patterns_by_day_of_week(test_user.id, days=30)

    assert result['Monday'] == 1
    for day in DAY_NAMES:
        if day != 'Monday':
            assert result[day] == 0, f'{day} should have no cravings'


def test_craving_weekday_patterns_roll_over_in_user_timezone(db_session):
    """Sunday 22:30 UTC is Monday 01:30 in Asia/Riyadh (UTC+3).

    The event belongs to the user's local Monday, not the storage-UTC Sunday.
    """
    user = _make_user(db_session, 'riyadh-weekday@example.com', 'Asia/Riyadh')
    sunday_utc = _recent_weekday_at(weekday=6, hour=22, minute=30)
    assert sunday_utc.weekday() == 6, 'fixture setup: timestamp must be a Sunday'
    _insert_craving(db_session, user.id, sunday_utc)

    result = get_craving_patterns_by_day_of_week(user.id, days=30)

    assert result['Monday'] == 1
    assert result['Sunday'] == 0


def test_craving_time_of_day_rolls_over_in_user_timezone(db_session):
    """21:30 UTC is 00:30 local in Asia/Riyadh (UTC+3): Night, not Evening."""
    user = _make_user(db_session, 'riyadh-hour@example.com', 'Asia/Riyadh')
    event_utc = _recent_time_at(hour=21, minute=30)
    _insert_craving(db_session, user.id, event_utc)

    result = get_craving_patterns_by_time_of_day(user.id, days=30)

    assert result[NIGHT] == 1
    assert result[EVENING] == 0


def test_craving_time_of_day_bucket_boundaries_for_utc_user(db_session, test_user):
    """Exact 06:00/12:00/18:00 edges plus one representative hour per bucket.

    Buckets are half-open: [06:00, 12:00) is Morning, so exact boundaries
    open the bucket that starts at them.
    """
    events = [
        (3, 0),    # representative Night hour
        (6, 0),    # exact Morning boundary
        (9, 0),    # representative Morning hour
        (12, 0),   # exact Afternoon boundary
        (15, 0),   # representative Afternoon hour
        (18, 0),   # exact Evening boundary
        (21, 0),   # representative Evening hour
    ]
    for hour, minute in events:
        _insert_craving(db_session, test_user.id, _recent_time_at(hour, minute))

    result = get_craving_patterns_by_time_of_day(test_user.id, days=30)

    assert result[NIGHT] == 1
    assert result[MORNING] == 2
    assert result[AFTERNOON] == 2
    assert result[EVENING] == 2


def test_craving_patterns_do_not_leak_between_users(db_session, test_user):
    """Another user's cravings must never be counted for ``test_user``."""
    other = _make_user(db_session, 'other@example.com', 'UTC')
    _insert_craving(db_session, other.id, _recent_time_at(hour=9, minute=30))

    by_day = get_craving_patterns_by_day_of_week(test_user.id, days=30)
    by_time = get_craving_patterns_by_time_of_day(test_user.id, days=30)

    assert all(count == 0 for count in by_day.values())
    assert all(count == 0 for count in by_time.values())


def test_craving_patterns_empty_data_returns_zero_filled_buckets(db_session, test_user):
    """With no matching rows every weekday/time bucket is present and zero."""
    by_day = get_craving_patterns_by_day_of_week(test_user.id, days=30)

    assert set(by_day) == set(DAY_NAMES)
    assert all(count == 0 for count in by_day.values())

    by_time = get_craving_patterns_by_time_of_day(test_user.id, days=30)

    assert set(by_time) == set(TIME_BUCKETS)
    assert all(count == 0 for count in by_time.values())


def test_comprehensive_patterns_share_one_timezone_resolution(
    db_session,
    caplog,
):
    """One comprehensive request resolves a blank legacy timezone once."""
    user = _make_user(db_session, 'blank-timezone@example.com', '')
    _insert_craving(db_session, user.id, _recent_time_at(hour=9, minute=30))

    with caplog.at_level(logging.WARNING):
        result = get_comprehensive_craving_analytics(user.id, days=30)

    assert sum(result['time_patterns'].values()) == 1
    assert sum(result['day_patterns'].values()) == 1

    warnings = [
        record
        for record in caplog.records
        if 'Invalid persisted timezone' in record.getMessage()
    ]
    assert len(warnings) == 1


def test_outcome_rates_exclude_missing_blank_and_invalid_legacy_values(
    db_session,
    test_user,
):
    """Counting unresolved legacy values would dilute the resolved denominator."""
    for outcome in (
        "resisted",
        "used_nicotine",
        "used_alternative",
        None,
        "",
        "legacy_invalid",
    ):
        craving = _insert_craving(
            db_session,
            test_user.id,
            _recent_time_at(hour=9, minute=30),
        )
        craving.outcome = outcome
        db_session.commit()

    result = get_craving_vs_consumption_correlation(test_user.id, days=30)

    assert result == {
        "total_cravings": 3,
        "resisted_count": 1,
        "used_nicotine_count": 1,
        "used_alternative_count": 1,
        "resistance_rate": 66.7,
    }
