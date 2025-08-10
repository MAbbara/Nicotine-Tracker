"""
Property-based tests for key functionalities using Hypothesis.
"""
import pytest
from hypothesis import given, strategies as st, settings
from datetime import datetime, date, time, timedelta

from app import db
from models import User, Pouch, Log, Goal
from services import user_service, log_service, goal_service
from services.timezone_service import convert_user_time_to_utc

# Increase deadline for database-intensive tests
settings.register_profile("db", deadline=timedelta(milliseconds=1000))
settings.load_profile("db")

# Custom strategy for generating valid passwords
password_strategy = st.text(
    alphabet=st.characters(min_codepoint=33, max_codepoint=126), 
    min_size=8, 
    max_size=64
)

# Custom strategy for generating valid dates
date_strategy = st.dates(
    min_value=date(2020, 1, 1), 
    max_value=date(2030, 12, 31)
)

# Custom strategy for generating valid times
time_strategy = st.times()

class TestPropertyBased:
    """A collection of property-based tests."""

    @given(email=st.emails(), password=password_strategy)
    def test_user_creation_property(self, app, email, password):
        """
        Test that user creation is robust and handles a wide variety of
        valid emails and passwords.
        """
        with app.app_context():
            # Clean up any user with the same email from a previous run
            User.query.filter_by(email=email).delete()
            db.session.commit()

            user = user_service.create_user(email=email, password=password)
            
            assert user is not None
            assert user.email == email
            assert user.check_password(password)

    @given(
        quantity=st.integers(min_value=1, max_value=100),
        notes=st.text(max_size=200),
        log_date=date_strategy,
        log_time=time_strategy
    )
    def test_log_creation_property(self, app, test_user, test_pouch, quantity, notes, log_date, log_time):
        """
        Test that log creation is robust across a range of valid inputs.
        """
        with app.app_context():
            log = log_service.add_log_entry(
                user_id=test_user.id,
                pouch_id=test_pouch.id,
                quantity=quantity,
                notes=notes,
                log_date=log_date,
                log_time=log_time,
                user_timezone='UTC'  # Use UTC for simplicity in testing
            )
            
            assert log.quantity == quantity
            assert log.notes == notes
            assert log.user_id == test_user.id
            
            # Verify the datetime was stored correctly
            expected_datetime = datetime.combine(log_date, log_time)
            assert log.log_time.year == expected_datetime.year
            assert log.log_time.month == expected_datetime.month
            assert log.log_time.day == expected_datetime.day
            assert log.log_time.hour == expected_datetime.hour
            assert log.log_time.minute == expected_datetime.minute

    @given(
        goal_type=st.sampled_from(['daily_pouches', 'daily_mg']),
        target_value=st.integers(min_value=1, max_value=100)
    )
    def test_goal_creation_property(self, app, test_user, goal_type, target_value):
        """
        Test that goal creation works for different goal types and target values.
        """
        with app.app_context():
            # Ensure no conflicting goal exists
            Goal.query.filter_by(user_id=test_user.id, goal_type=goal_type, is_active=True).delete()
            db.session.commit()

            goal = goal_service.create_goal(
                user_id=test_user.id,
                goal_type=goal_type,
                target_value=target_value
            )
            
            assert goal is not None
            assert goal.goal_type == goal_type
            assert goal.target_value == target_value
            assert goal.is_active is True
            assert goal.user_id == test_user.id
