"""
Unit tests for service layer components.
"""
import logging

import pytest
from datetime import datetime, timezone, timedelta, date, time
from unittest.mock import Mock, patch
from models import User, Pouch, Log, Goal, UserPreferences
from models.notification import NotificationQueue
from services import user_service, log_service, goal_service, timezone_service
from services.notification_service import NotificationService
from services.request_context import get_request_id

class TestUserService:
    """Test cases for user_service."""

    def test_create_user(self, db_session):
        """Test user creation service."""
        user = user_service.create_user(
            email='newuser@example.com',
            password='securepassword123',
            age=30
        )
        assert user.email == 'newuser@example.com'
        assert user.age == 30
        assert user.check_password('securepassword123')
        assert not user.check_password('wrongpassword')

    def test_get_user_daily_intake(self, db_session, test_user, test_pouch):
        """Test calculation of daily nicotine intake for a user."""
        # Create logs for today
        log1 = Log(user_id=test_user.id, pouch_id=test_pouch.id, quantity=2, log_time=datetime.utcnow())
        log2 = Log(user_id=test_user.id, custom_brand="Custom", custom_nicotine_mg=8, quantity=1, log_time=datetime.utcnow())
        db_session.add_all([log1, log2])
        db_session.commit()

        intake = user_service.get_user_daily_intake(test_user)
        assert intake['total_pouches'] == 3
        assert intake['total_mg'] == (2 * test_pouch.nicotine_mg) + 8
        assert intake['sessions'] == 2

class TestLogService:
    """Test cases for LogService."""

    def test_get_user_logs(self, db_session, test_user, test_log):
        """Test retrieving user logs."""
        logs = log_service.get_user_logs(test_user.id)
        assert len(logs) == 1
        assert logs[0].id == test_log.id

    def test_get_logs_by_date_range(self, db_session, test_user, test_pouch):
        """Test getting logs within a specific date range."""
        log1 = log_service.create_log_entry(user_id=test_user.id, pouch_id=test_pouch.id, quantity=1, log_time=datetime.utcnow() - timedelta(days=2))
        log2 = log_service.create_log_entry(user_id=test_user.id, pouch_id=test_pouch.id, quantity=1, log_time=datetime.utcnow())
        
        start_date = date.today() - timedelta(days=1)
        end_date = date.today()

        logs = log_service.get_logs_by_date_range(test_user.id, start_date, end_date)

        
        assert len(logs) == 1
        assert logs[0].id == log2.id

    def test_get_average_daily_usage(self, db_session, test_user, test_pouch):
        """Test calculating average daily usage."""
        # Create logs over a few days
        log_service.create_log_entry(user_id=test_user.id, pouch_id=test_pouch.id, quantity=5, log_time=datetime.utcnow() - timedelta(days=2))
        log_service.create_log_entry(user_id=test_user.id, pouch_id=test_pouch.id, quantity=3, log_time=datetime.utcnow() - timedelta(days=1))
        log_service.create_log_entry(user_id=test_user.id, pouch_id=test_pouch.id, quantity=4, log_time=datetime.utcnow())
        
        avg_usage = log_service.get_average_daily_usage(test_user.id)
        assert avg_usage == pytest.approx(4.0)

class TestGoalService:
    """Test cases for GoalService."""

    def test_create_goal(self, db_session, test_user):
        """Test creating a new goal for a user."""
        goal = goal_service.create_goal(
            user_id=test_user.id,
            goal_type='daily_pouches',
            target_value=5
        )
        assert goal.user_id == test_user.id
        assert goal.target_value == 5
        assert goal.is_active is True

    def test_get_active_goals(self, db_session, test_user, test_goal):
        """Test retrieving active goals for a user."""
        active_goals = goal_service.get_active_goals(test_user.id)
        assert len(active_goals) == 1
        assert active_goals[0].id == test_goal.id
    
    def test_deactivate_goal(self, db_session, test_goal):
        """Test deactivating a goal."""
        goal_service.deactivate_goal(test_goal.id)
        assert test_goal.is_active is False


class TestNotificationService:
    """Weekly report reads obey the half-open user-week contract."""

    def test_weekly_report_excludes_log_at_exact_end_boundary(
        self, db_session, test_user
    ):
        preferences = UserPreferences(
            user_id=test_user.id,
            notification_channel=['email'],
            weekly_reports=True,
        )
        included = Log(
            user_id=test_user.id,
            custom_brand='Included',
            custom_nicotine_mg=4,
            quantity=2,
            log_date=date(2026, 7, 26),
            log_time=datetime(2026, 7, 26, 23, 59, 59),
        )
        exact_end = Log(
            user_id=test_user.id,
            custom_brand='Next week',
            custom_nicotine_mg=4,
            quantity=9,
            log_date=date(2026, 7, 27),
            log_time=datetime(2026, 7, 27, 0, 0, 0),
        )
        db_session.add_all([preferences, included, exact_end])
        db_session.commit()

        frozen_current_time = (
            datetime(2026, 7, 27, 12, 0, tzinfo=timezone.utc),
            date(2026, 7, 27),
            time(12, 0),
        )
        with patch(
            'services.notification_service.tz_service.get_current_user_time',
            return_value=frozen_current_time,
        ):
            queued = NotificationService().queue_weekly_report(test_user)

        queued_report = NotificationQueue.query.filter_by(
            user_id=test_user.id, category='weekly_report'
        ).one()
        assert len(queued) == 1
        assert queued[0].id == queued_report.id
        assert queued_report.extra_data['total_logs'] == 1
        assert queued_report.extra_data['total_pouches'] == 2

class TestTimezoneService:
    """Test cases for TimezoneService."""

    def test_convert_to_user_timezone(self):
        """Test timezone conversion."""
        utc_time = datetime(2024, 1, 1, 12, 0, 0, tzinfo=timezone.utc)
        user_time, _, _ = timezone_service.convert_utc_to_user_time('America/New_York', utc_time)
        
        assert user_time.hour == 7
        assert user_time.tzinfo is not None

    def test_get_user_day_boundaries(self):
        """Test getting user day boundaries."""
        user_tz = 'America/New_York'
        target_date = date(2024, 1, 1)
        start_utc, end_utc = timezone_service.get_user_day_boundaries(user_tz, target_date)
        
        # Half-open contract: [start, end); the end is the next day's exact
        # start, not 23:59:59.999999.
        assert start_utc.isoformat() == "2024-01-01T05:00:00+00:00"
        assert end_utc.isoformat() == "2024-01-02T05:00:00+00:00"


class TestDailyIntakeHalfOpenContract:
    """Service- and model-level daily reads share one half-open user-day
    window over ``Log.log_time``: ``start_utc <= event < end_utc`` with
    database-naive UTC values normalized at the boundary.
    """

    def _make_user(self, db_session, email, tz_name, reset_time=None):
        user = User(email=email, email_verified=True, timezone=tz_name)
        user.set_password('password123')
        db_session.add(user)
        db_session.flush()
        preferences = UserPreferences(
            user_id=user.id, daily_reset_time=reset_time
        )
        db_session.add(preferences)
        db_session.commit()
        return user

    def _make_log(self, db_session, user, naive_utc, log_date=None, mg=4):
        log = Log(
            user_id=user.id,
            custom_brand='Contract Brand',
            custom_nicotine_mg=mg,
            quantity=1,
            log_time=naive_utc,
        )
        if log_date is not None:
            log.log_date = log_date
        db_session.add(log)
        db_session.commit()
        return log

    def test_service_intake_includes_exact_window_start(self, db_session):
        user = self._make_user(
            db_session, 'start@example.com', 'UTC', reset_time=time(4, 0)
        )
        self._make_log(db_session, user, datetime(2026, 7, 26, 4, 0, 0))
        assert user_service.get_user_daily_intake(
            user, date(2026, 7, 26)
        )['total_pouches'] == 1
        assert user_service.get_user_daily_intake(
            user, date(2026, 7, 25)
        )['total_pouches'] == 0

    def test_service_intake_exact_end_belongs_to_next_day(self, db_session):
        user = self._make_user(
            db_session, 'end@example.com', 'UTC', reset_time=time(4, 0)
        )
        self._make_log(db_session, user, datetime(2026, 7, 27, 4, 0, 0))
        assert user_service.get_user_daily_intake(
            user, date(2026, 7, 26)
        )['total_pouches'] == 0
        assert user_service.get_user_daily_intake(
            user, date(2026, 7, 27)
        )['total_pouches'] == 1

    def test_service_intake_without_timezone_reads_log_time_not_log_date(
        self, db_session
    ):
        # The deprecated log_date deliberately disagrees with log_time;
        # every read must follow log_time.
        user = self._make_user(db_session, 'legacy@example.com', 'UTC')
        self._make_log(
            db_session,
            user,
            datetime(2026, 7, 26, 10, 0),
            log_date=date(2026, 7, 25),
        )
        assert user_service.get_user_daily_intake(
            user, date(2026, 7, 26), use_timezone=False
        )['total_pouches'] == 1
        assert user_service.get_user_daily_intake(
            user, date(2026, 7, 25), use_timezone=False
        )['total_pouches'] == 0

    def test_service_intake_spans_25_hour_fall_back_day(self, db_session):
        # 2026-11-01 in New York runs 04:00Z to 05:00Z next day (25 hours).
        user = self._make_user(db_session, 'dst@example.com', 'America/New_York')
        self._make_log(db_session, user, datetime(2026, 11, 1, 4, 30))
        self._make_log(db_session, user, datetime(2026, 11, 1, 5, 30))
        self._make_log(db_session, user, datetime(2026, 11, 2, 5, 0))
        intake = user_service.get_user_daily_intake(user, date(2026, 11, 1))
        assert intake['total_pouches'] == 2
        assert intake['sessions'] == 2
        assert intake['total_mg'] == 8

    def test_model_intake_respects_daily_reset_time(self, db_session):
        user = self._make_user(
            db_session, 'model-reset@example.com', 'UTC', reset_time=time(4, 0)
        )
        # 02:00 UTC is before the 04:00 reset: it belongs to 2026-07-25.
        self._make_log(db_session, user, datetime(2026, 7, 26, 2, 0))
        assert user.get_daily_intake(date(2026, 7, 25))['total_pouches'] == 1
        assert user.get_daily_intake(date(2026, 7, 26))['total_pouches'] == 0

    def test_model_intake_exact_end_belongs_to_next_day(self, db_session):
        user = self._make_user(
            db_session, 'model-end@example.com', 'UTC', reset_time=time(4, 0)
        )
        self._make_log(db_session, user, datetime(2026, 7, 27, 4, 0, 0))
        assert user.get_daily_intake(date(2026, 7, 26))['total_pouches'] == 0
        assert user.get_daily_intake(date(2026, 7, 27))['total_pouches'] == 1

    def test_model_intake_without_timezone_reads_log_time_not_log_date(
        self, db_session
    ):
        user = self._make_user(db_session, 'model-legacy@example.com', 'UTC')
        self._make_log(
            db_session,
            user,
            datetime(2026, 7, 26, 10, 0),
            log_date=date(2026, 7, 25),
        )
        assert user.get_daily_intake(
            date(2026, 7, 26), use_timezone=False
        )['total_pouches'] == 1
        assert user.get_daily_intake(
            date(2026, 7, 25), use_timezone=False
        )['total_pouches'] == 0

    @pytest.mark.parametrize("reader", ("service", "model"))
    def test_persisted_blank_timezone_fallback_is_explicit_and_correlated(
        self, app, db_session, caplog, reader
    ):
        user = self._make_user(db_session, f'{reader}-blank@example.com', '')
        self._make_log(db_session, user, datetime(2026, 7, 26, 10, 0))

        with caplog.at_level(logging.WARNING, logger='services.timezone_service'):
            if reader == 'service':
                intake = user_service.get_user_daily_intake(
                    user, date(2026, 7, 26)
                )
            else:
                intake = user.get_daily_intake(date(2026, 7, 26))

        assert intake['total_pouches'] == 1
        assert len(caplog.records) == 1
        assert "persisted timezone ''" in caplog.records[0].getMessage()
        assert caplog.records[0].request_id == get_request_id()
