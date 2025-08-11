"""
Unit tests for service layer components.
"""
import pytest
from datetime import datetime, timezone, timedelta, date
from unittest.mock import Mock, patch
from models import User, Pouch, Log, Goal
from services import user_service, log_service, goal_service, timezone_service

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

    def test_get_logs_by_date_range(self, db_session, test_user):
        """Test getting logs within a specific date range."""
        log1 = log_service.create_log_entry(user_id=test_user.id, pouch_id=1, quantity=1, log_time=datetime.utcnow() - timedelta(days=2))
        log2 = log_service.create_log_entry(user_id=test_user.id, pouch_id=1, quantity=1, log_time=datetime.utcnow())
        
        start_date = date.today() - timedelta(days=1)
        end_date = date.today()

        logs = log_service.get_logs_by_date_range(test_user.id, start_date, end_date)

        
        assert len(logs) == 1
        assert logs[0].id == log2.id

    def test_get_average_daily_usage(self, db_session, test_user):
        """Test calculating average daily usage."""
        # Create logs over a few days
        log_service.create_log_entry(user_id=test_user.id, pouch_id=1, quantity=5, log_time=datetime.utcnow() - timedelta(days=2))
        log_service.create_log_entry(user_id=test_user.id, pouch_id=1, quantity=3, log_time=datetime.utcnow() - timedelta(days=1))
        log_service.create_log_entry(user_id=test_user.id, pouch_id=1, quantity=4, log_time=datetime.utcnow())
        
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
        
        # Check that the boundaries are correct in UTC
        assert start_utc.isoformat() == "2024-01-01T05:00:00+00:00"
        assert end_utc.isoformat() == "2024-01-02T04:59:59.999999+00:00"
