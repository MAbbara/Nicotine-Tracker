"""
Contract tests for the canonical half-open user-day window.

Every user-day boundary in the application is derived from
``get_user_day_window``; intervals are half-open:
``start_utc <= event_time < end_utc``.
"""
import pytest
import logging
from dataclasses import FrozenInstanceError
from datetime import date, datetime, time, timedelta, timezone

import pytz
import services.timezone_service as timezone_module

from services.request_context import get_request_id
from services.timezone_service import (
    InvalidEventTimeError,
    UserDayWindow,
    UserWeekWindow,
    get_timezone_object,
    get_current_user_day,
    get_user_date_boundaries,
    get_user_day_boundaries,
    get_user_day_window,
    get_user_week_boundaries,
    get_user_week_boundaries_with_reset,
    get_user_week_window,
    parse_local_event_time,
    resolve_timezone,
    validate_timezone,
)


class TestUserDayWindowBasics:
    """Canonical window shape and half-open boundaries."""

    def test_user_day_window_utc_midnight_reset(self):
        window = get_user_day_window("UTC", date(2026, 7, 26))
        assert window.local_date == date(2026, 7, 26)
        assert window.start_utc == datetime(2026, 7, 26, 0, 0, tzinfo=timezone.utc)
        assert window.end_utc == datetime(2026, 7, 27, 0, 0, tzinfo=timezone.utc)

    def test_user_day_window_is_half_open_at_custom_reset(self):
        window = get_user_day_window(
            "Asia/Riyadh", date(2026, 7, 26), reset_time=time(4, 0)
        )
        assert window.local_date == date(2026, 7, 26)
        assert window.start_utc == datetime(2026, 7, 26, 1, 0, tzinfo=timezone.utc)
        assert window.end_utc == datetime(2026, 7, 27, 1, 0, tzinfo=timezone.utc)

    def test_user_day_window_is_a_frozen_value_object(self):
        window = get_user_day_window("UTC", date(2026, 7, 26))
        assert isinstance(window, UserDayWindow)
        with pytest.raises(FrozenInstanceError):
            window.local_date = date(2026, 7, 27)
        assert window == UserDayWindow(
            local_date=date(2026, 7, 26),
            start_utc=datetime(2026, 7, 26, 0, 0, tzinfo=timezone.utc),
            end_utc=datetime(2026, 7, 27, 0, 0, tzinfo=timezone.utc),
        )


class TestUserDayWindowDST:
    """DST transition rules for the reset boundary.

    America/New_York springs forward 2026-03-08 02:00 -> 03:00 and falls
    back 2026-11-01 02:00 -> 01:00.
    """

    def test_spring_forward_midnight_reset_is_a_23_hour_day(self):
        window = get_user_day_window("America/New_York", date(2026, 3, 8))
        assert window.start_utc == datetime(2026, 3, 8, 5, 0, tzinfo=timezone.utc)
        assert window.end_utc == datetime(2026, 3, 9, 4, 0, tzinfo=timezone.utc)
        assert window.end_utc - window.start_utc == timedelta(hours=23)

    def test_fall_back_midnight_reset_is_a_25_hour_day(self):
        window = get_user_day_window("America/New_York", date(2026, 11, 1))
        assert window.start_utc == datetime(2026, 11, 1, 4, 0, tzinfo=timezone.utc)
        assert window.end_utc == datetime(2026, 11, 2, 5, 0, tzinfo=timezone.utc)
        assert window.end_utc - window.start_utc == timedelta(hours=25)

    def test_nonexistent_reset_time_shifts_forward_by_the_dst_gap(self):
        # 2026-03-08 02:30 never happens in New York; the 1-hour gap shifts
        # the reset to 03:30 EDT = 07:30 UTC. The next day's reset exists
        # normally at 02:30 EDT = 06:30 UTC, so the day stays 23 hours.
        window = get_user_day_window(
            "America/New_York", date(2026, 3, 8), reset_time=time(2, 30)
        )
        assert window.start_utc == datetime(2026, 3, 8, 7, 30, tzinfo=timezone.utc)
        assert window.end_utc == datetime(2026, 3, 9, 6, 30, tzinfo=timezone.utc)
        assert window.end_utc - window.start_utc == timedelta(hours=23)

    def test_ambiguous_reset_time_uses_the_earlier_occurrence(self):
        # 2026-11-01 01:30 happens twice; the earlier occurrence is the
        # DST (EDT) one = 05:30 UTC. The next day's reset is unambiguous
        # at 01:30 EST = 06:30 UTC, so the day stays 25 hours.
        window = get_user_day_window(
            "America/New_York", date(2026, 11, 1), reset_time=time(1, 30)
        )
        assert window.start_utc == datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc)
        assert window.end_utc == datetime(2026, 11, 2, 6, 30, tzinfo=timezone.utc)
        assert window.end_utc - window.start_utc == timedelta(hours=25)

    @pytest.mark.parametrize(
        ("now_utc", "reset_time", "expected_local_date"),
        (
            pytest.param(
                datetime(2026, 3, 8, 7, 0, tzinfo=timezone.utc),
                time(2, 30),
                date(2026, 3, 7),
                id="spring-gap-before-shifted-reset",
            ),
            pytest.param(
                datetime(2026, 11, 1, 6, 15, tzinfo=timezone.utc),
                time(1, 30),
                date(2026, 11, 1),
                id="fall-overlap-after-earlier-reset",
            ),
        ),
    )
    def test_current_user_day_uses_canonical_dst_reset_window(
        self, monkeypatch, now_utc, reset_time, expected_local_date
    ):
        class FrozenDateTime(datetime):
            @classmethod
            def now(cls, tz=None):
                return now_utc.astimezone(tz) if tz else now_utc.replace(tzinfo=None)

        monkeypatch.setattr(timezone_module, "datetime", FrozenDateTime)

        assert get_current_user_day(
            "America/New_York", reset_time
        ) == expected_local_date


class TestTimezoneValidation:
    """User-submitted identifiers are rejected; only invalid legacy
    persisted zones may fall back to UTC, with a correlation-ID warning."""

    def test_get_timezone_object_rejects_invalid_user_input(self):
        with pytest.raises(pytz.exceptions.UnknownTimeZoneError):
            get_timezone_object("Not/AZone")
        with pytest.raises(pytz.exceptions.UnknownTimeZoneError):
            get_timezone_object("")

    def test_validate_timezone_rejects_invalid_user_input(self):
        assert validate_timezone("Not/AZone") is False
        assert validate_timezone("Asia/Riyadh") is True

    @pytest.mark.parametrize("timezone_name", ("Invalid/Legacy_Zone", "", None))
    def test_canonical_user_day_window_rejects_invalid_timezone(self, timezone_name):
        with pytest.raises(pytz.exceptions.UnknownTimeZoneError):
            get_user_day_window(timezone_name, date(2026, 7, 26))

    @pytest.mark.parametrize("persisted_timezone", ("Invalid/Legacy_Zone", "", None))
    def test_explicit_persisted_timezone_fallback_warns_with_request_id(
        self, app, caplog, persisted_timezone
    ):
        with caplog.at_level(logging.WARNING, logger="services.timezone_service"):
            resolved = resolve_timezone(persisted_timezone)

        assert resolved is pytz.UTC

        # The fallback is loud: one warning carrying the correlation ID.
        assert len(caplog.records) == 1
        record = caplog.records[0]
        assert record.levelno == logging.WARNING
        assert repr(persisted_timezone) in record.getMessage()
        assert get_request_id() in record.getMessage()
        assert record.request_id == get_request_id()


class TestUserWeekWindow:
    """Week windows are composed from day windows, Monday through Sunday."""

    def test_week_window_is_composed_from_day_windows(self):
        # 2026-07-26 is a Sunday; its week starts Monday 2026-07-20.
        week = get_user_week_window(
            "Asia/Riyadh", date(2026, 7, 26), reset_time=time(4, 0)
        )
        assert isinstance(week, UserWeekWindow)
        assert week.week_start_date == date(2026, 7, 20)
        assert len(week.days) == 7

        monday = get_user_day_window("Asia/Riyadh", date(2026, 7, 20), time(4, 0))
        sunday = get_user_day_window("Asia/Riyadh", date(2026, 7, 26), time(4, 0))
        assert week.start_utc == monday.start_utc
        assert week.end_utc == sunday.end_utc
        assert week.days[0] == monday
        assert week.days[-1] == sunday

    def test_week_window_days_tile_without_gaps_or_overlaps(self):
        week = get_user_week_window("America/New_York", date(2026, 3, 11))
        for earlier, later in zip(week.days, week.days[1:]):
            assert earlier.end_utc == later.start_utc
        assert week.start_utc == week.days[0].start_utc
        assert week.end_utc == week.days[-1].end_utc

    def test_week_window_spanning_dst_transition_keeps_exact_day_lengths(self):
        # The week of the 2026 spring forward contains one 23-hour day and
        # six 24-hour days: 167 hours total, not 168 or a smeared average.
        week = get_user_week_window("America/New_York", date(2026, 3, 8))
        lengths = [day.end_utc - day.start_utc for day in week.days]
        assert lengths.count(timedelta(hours=23)) == 1
        assert lengths.count(timedelta(hours=24)) == 6
        assert week.end_utc - week.start_utc == timedelta(hours=167)


class TestTupleWrappers:
    """Temporary tuple-returning wrappers derive from the one window
    algorithm; there is no second, inclusive-end boundary implementation."""

    def test_get_user_date_boundaries_is_the_midnight_window(self):
        window = get_user_day_window("Asia/Riyadh", date(2026, 7, 26))
        assert get_user_date_boundaries("Asia/Riyadh", date(2026, 7, 26)) == (
            window.start_utc,
            window.end_utc,
        )

    def test_get_user_day_boundaries_is_the_reset_window(self):
        window = get_user_day_window("Asia/Riyadh", date(2026, 7, 26), time(4, 0))
        assert get_user_day_boundaries(
            "Asia/Riyadh", date(2026, 7, 26), time(4, 0)
        ) == (window.start_utc, window.end_utc)

    def test_get_user_day_boundaries_defaults_to_midnight(self):
        window = get_user_day_window("UTC", date(2026, 7, 26))
        assert get_user_day_boundaries("UTC", date(2026, 7, 26)) == (
            window.start_utc,
            window.end_utc,
        )

    def test_get_user_week_boundaries_is_the_midnight_week_window(self):
        week = get_user_week_window("UTC", date(2026, 7, 26))
        assert get_user_week_boundaries("UTC", date(2026, 7, 26)) == (
            week.start_utc,
            week.end_utc,
        )

    def test_get_user_week_boundaries_with_reset_is_the_reset_week_window(self):
        week = get_user_week_window("America/New_York", date(2026, 3, 8), time(4, 0))
        assert get_user_week_boundaries_with_reset(
            "America/New_York", date(2026, 3, 8), time(4, 0)
        ) == (week.start_utc, week.end_utc)

    def test_wrapper_end_is_exclusive_not_time_max(self):
        # The old contract ended at next-day-minus-one-microsecond; the new
        # contract's end is the next window's exact start.
        _, end_utc = get_user_day_boundaries("UTC", date(2026, 7, 26))
        assert end_utc == datetime(2026, 7, 27, 0, 0, tzinfo=timezone.utc)
        assert end_utc.microsecond == 0


class TestParseLocalEventTime:
    """Offset-aware parser for user-entered event times (logs/cravings).

    Unlike the daily reset, event times are real-world observations: a
    nonexistent wall time is invalid input and is rejected, never shifted.
    """

    def test_valid_unambiguous_event_returns_utc(self):
        event = parse_local_event_time(
            "Asia/Riyadh", datetime(2026, 7, 26, 14, 30), "+03:00"
        )
        assert event == datetime(2026, 7, 26, 11, 30, tzinfo=timezone.utc)

    def test_accepts_offset_as_timedelta(self):
        event = parse_local_event_time(
            "Asia/Riyadh", datetime(2026, 7, 26, 14, 30), timedelta(hours=3)
        )
        assert event == datetime(2026, 7, 26, 11, 30, tzinfo=timezone.utc)

    def test_rejects_nonexistent_event_time_instead_of_shifting(self):
        # 02:30 never happened on spring-forward day. Even though the
        # claimed -04:00 offset matches the post-gap zone, a user-entered
        # event time is never shifted like a daily reset would be.
        with pytest.raises(InvalidEventTimeError):
            parse_local_event_time(
                "America/New_York", datetime(2026, 3, 8, 2, 30), "-04:00"
            )

    def test_rejects_offset_mismatch_on_unambiguous_time(self):
        # Riyadh is always +03:00; a +05:00 claim cannot be this zone.
        with pytest.raises(InvalidEventTimeError):
            parse_local_event_time(
                "Asia/Riyadh", datetime(2026, 7, 26, 14, 30), "+05:00"
            )

    def test_ambiguous_event_is_resolved_by_the_claimed_offset(self):
        edt_event = parse_local_event_time(
            "America/New_York", datetime(2026, 11, 1, 1, 30), "-04:00"
        )
        assert edt_event == datetime(2026, 11, 1, 5, 30, tzinfo=timezone.utc)
        est_event = parse_local_event_time(
            "America/New_York", datetime(2026, 11, 1, 1, 30), "-05:00"
        )
        assert est_event == datetime(2026, 11, 1, 6, 30, tzinfo=timezone.utc)

    def test_ambiguous_event_with_unrelated_offset_is_rejected(self):
        with pytest.raises(InvalidEventTimeError):
            parse_local_event_time(
                "America/New_York", datetime(2026, 11, 1, 1, 30), "+03:00"
            )

    def test_rejects_malformed_offset(self):
        with pytest.raises(InvalidEventTimeError):
            parse_local_event_time(
                "Asia/Riyadh", datetime(2026, 7, 26, 14, 30), "noon-ish"
            )

    def test_rejects_invalid_timezone_identifier(self):
        with pytest.raises(pytz.exceptions.UnknownTimeZoneError):
            parse_local_event_time(
                "Not/AZone", datetime(2026, 7, 26, 14, 30), "+03:00"
            )

    def test_rejects_already_aware_datetime(self):
        aware = datetime(2026, 7, 26, 14, 30, tzinfo=timezone.utc)
        with pytest.raises(InvalidEventTimeError):
            parse_local_event_time("Asia/Riyadh", aware, "+03:00")
