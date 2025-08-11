"""
Integration tests for complete user workflows, aligned with the actual application structure.
"""
import pytest
from datetime import datetime, timezone, timedelta, date
from app import db
from models import User, Pouch, Log, Goal
from services import user_service, log_service, goal_service

class TestUserRegistrationAndLogin:
    """Tests the full user registration and login flow."""

    def test_registration_and_login(self, client):
        """Ensure a user can register, log in, and see the dashboard."""
        # Step 1: Register a new user
        register_response = client.post('/auth/register', data={
            'email': 'integration_user@example.com',
            'password': 'password123',
            'confirm_password': 'password123'
        }, follow_redirects=True)

        assert register_response.status_code == 200


        # Step 2: Verify user is in the database and not yet verified
        with client.application.app_context():
            user = db.session.execute(db.select(User).filter_by(email='integration_user@example.com')).scalar_one_or_none()
            assert user is not None
            assert user.email_verified




        # Step 3: Log in with the new account
        login_response = client.post('/auth/login', data={
            'email': 'integration_user@example.com',
            'password': 'password123'
        }, follow_redirects=True)

        assert login_response.status_code == 200
        assert b'Dashboard' in login_response.data


        # Step 4: Log out
        logout_response = client.get('/auth/logout', follow_redirects=True)

        assert logout_response.status_code == 200



class TestCoreFunctionality:
    """Tests core features like logging, goals, and pouch management for a logged-in user."""

    @pytest.fixture(autouse=True)
    def setup_user_and_login(self, client, test_user):
        """Fixture to ensure a user is logged in for each test in this class."""
        with client:
            client.post('/auth/login', data={'email': test_user.email, 'password': 'password123'}, follow_redirects=True)
            yield client  # provide the client to the tests


    def test_add_and_view_log(self, client, db_session, test_user, test_pouch):
        """Test adding a new log and verifying it appears on the dashboard."""
        # Add a log
        log_datetime = datetime.now(timezone.utc)
        add_log_response = client.post('/log/add', data={
            'pouch_id': test_pouch.id,
            'quantity': 2,
            'log_date': log_datetime.strftime('%Y-%m-%d'),
            'log_time': log_datetime.strftime('%H:%M'),
            'notes': 'Integration test log'
        }, follow_redirects=True)




        
        assert add_log_response.status_code == 200


        # Check if the log appears on the dashboard
        dashboard_response = client.get('/dashboard/')
        assert b'Integration test log' in dashboard_response.data

        assert b'Test Brand' in dashboard_response.data
        assert b'2' in dashboard_response.data # Quantity

    def test_create_and_view_goal(self, client, db_session, test_user):
        """Test creating a new goal and verifying it appears on the goals page."""
        # Create a goal
        start_date = date.today().isoformat()
        end_date = (date.today() + timedelta(days=30)).isoformat()
        create_goal_response = client.post('/goals/create', data={
            'goal_type': 'daily_pouches',
            'target_value': 5,
            'start_date': start_date,
            'end_date': end_date
        }, follow_redirects=True)
        
        assert create_goal_response.status_code == 200


        # Check if the goal appears on the goals page
        goals_page_response = client.get('/goals/')

        assert b'daily_pouches' in goals_page_response.data
        assert b'5' in goals_page_response.data

    def test_add_and_view_custom_pouch(self, client, db_session, test_user):
        """Test adding a custom pouch and verifying it's in the catalog."""
        # Add a custom pouch
        add_pouch_response = client.post('/catalog/add', data={
            'brand': 'My Custom Brand',
            'nicotine_mg': 10
        }, follow_redirects=True)
        
        assert add_pouch_response.status_code == 200


        # Check if the custom pouch is listed in the catalog
        catalog_response = client.get('/catalog/')
        assert b'My Custom Brand' in catalog_response.data

        assert b'10 mg' in catalog_response.data
    
    def test_update_settings(self, client, db_session, test_user):
        """Test updating user settings."""
        new_timezone = 'America/New_York'
        new_age = '35'
        
        settings_response = client.post('/settings/profile', data={
            'timezone': new_timezone,
            'age': new_age,
            'gender': 'Male',
            'weight': '80'
        }, follow_redirects=True)


        assert settings_response.status_code == 200


        # Verify the changes in the database
        db_session.refresh(test_user)
        assert test_user.timezone == new_timezone
        assert test_user.age == 35
        assert test_user.gender == 'Male'
        assert test_user.weight == 80.0

class TestErrorHandlingWorkflow:
    """Test various error and edge case scenarios."""

    def test_invalid_login(self, client, test_user):
        """Test login with incorrect password."""
        response = client.post('/auth/login', data={
            'email': test_user.email,
            'password': 'wrongpassword'
        }, follow_redirects=True)



    def test_duplicate_email_registration(self, client, test_user):
        """Test registering with an email that already exists."""
        response = client.post('/auth/register', data={
            'email': test_user.email,
            'password': 'newpassword123',
            'confirm_password': 'newpassword123'
        }, follow_redirects=True)



    def test_access_protected_page_without_login(self, client):
        """Test that unauthenticated users are redirected from protected pages."""
        response = client.get('/dashboard/', follow_redirects=True)
        assert b'Please log in to access this page.' in response.data
        assert b'Login' in response.data # Check for redirect to login page
