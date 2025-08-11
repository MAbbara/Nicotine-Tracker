"""
Unit tests for database models.
"""
import pytest
from datetime import datetime, timezone, timedelta, date
from models import User, Pouch, Log, Goal
from extensions import db

class TestUserModel:
    """Test cases for the User model."""

    def test_user_creation(self, db_session):
        """Test basic user creation and password hashing."""
        user = User(email='test@example.com', timezone='UTC')

        user.set_password('password123')
        db_session.add(user)
        db_session.commit()

        assert user.id is not None
        assert user.email == 'test@example.com'
        assert user.check_password('password123')
        assert not user.check_password('wrongpassword')
        assert user.email_verified is False
        assert user.timezone == 'UTC'

    def test_user_email_uniqueness(self, db_session):
        """Test that email addresses must be unique."""
        user1 = User(email='unique@example.com')
        user1.set_password('password123')
        db_session.add(user1)
        db_session.commit()

        user2 = User(email='unique@example.com')
        user2.set_password('password456')
        db_session.add(user2)
        
        with pytest.raises(Exception):
            db_session.commit()

    def test_user_to_dict(self, test_user):
        """Test the to_dict method of the User model."""
        user_dict = test_user.to_dict()
        assert user_dict['email'] == 'test@example.com'
        assert 'password_hash' not in user_dict

class TestPouchModel:
    """Test cases for the Pouch model."""

    def test_pouch_creation(self, db_session):
        """Test basic pouch creation."""
        pouch = Pouch(brand='Zyn', nicotine_mg=6)
        db_session.add(pouch)
        db_session.commit()

        assert pouch.id is not None
        assert pouch.brand == 'Zyn'
        assert pouch.nicotine_mg == 6
        assert pouch.is_default is True

    def test_pouch_representation(self, test_pouch):
        """Test the string representation of the Pouch model."""
        assert repr(test_pouch) == '<Pouch Test Brand - 4mg>'

class TestLogModel:
    """Test cases for the Log model."""

    def test_log_creation(self, db_session, test_user, test_pouch):
        """Test creating a new log entry."""
        log_time = datetime.utcnow()

        log = Log(
            user_id=test_user.id,
            pouch_id=test_pouch.id,
            quantity=2,
            log_time=log_time,
            notes='A test note.'
        )
        db_session.add(log)
        db_session.commit()

        assert log.id is not None
        assert log.user_id == test_user.id
        assert log.pouch_id == test_pouch.id
        assert log.quantity == 2
        assert log.notes == 'A test note.'
        assert log.log_time == log_time

    def test_log_nicotine_calculation(self, test_log):
        """Test the nicotine calculation methods."""
        assert test_log.get_nicotine_content() == 4
        assert test_log.get_total_nicotine() == 8

    def test_log_brand_name(self, test_log):
        """Test the brand name retrieval."""
        assert test_log.get_brand_name() == 'Test Brand'
        
    def test_log_to_dict(self, test_log):
        """Test the to_dict method of the Log model."""
        log_dict = test_log.to_dict()
        assert log_dict['id'] == test_log.id
        assert log_dict['quantity'] == 2
        assert log_dict['pouch']['brand'] == 'Test Brand'

class TestGoalModel:
    """Test cases for the Goal model."""

    def test_goal_creation(self, db_session, test_user):
        """Test creating a new goal."""
        start_date = date.today()
        end_date = start_date + timedelta(days=30)
        goal = Goal(
            user_id=test_user.id,
            goal_type='daily_pouches',
            target_value=10,
            start_date=start_date,
            end_date=end_date,
            is_active=True
        )
        db_session.add(goal)
        db_session.commit()

        assert goal.id is not None
        assert goal.user_id == test_user.id
        assert goal.goal_type == 'daily_pouches'
        assert goal.target_value == 10
        assert goal.is_active is True

    def test_goal_to_dict(self, test_goal):
        """Test the to_dict method of the Goal model."""
        goal_dict = test_goal.to_dict()
        assert goal_dict['id'] == test_goal.id
        assert goal_dict['goal_type'] == 'daily_pouches'
        assert goal_dict['target_value'] == 10
