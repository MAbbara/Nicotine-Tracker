"""
Regression tests to ensure previously fixed bugs do not re-emerge.
"""
import pytest
from app import db
from models import User, Log, Pouch

class TestRegressionSuite:
    """A collection of regression tests."""

    @pytest.fixture(autouse=True)
    def logged_in_client(self, client, test_user):
        """Fixture to log in the test user for all tests in this class."""
        with client.session_transaction() as sess:
            sess['user_id'] = test_user.id
            sess['user_email'] = test_user.email
        return client

    def test_profile_update_does_not_clear_timezone(self, logged_in_client, test_user, db_session):
        """
        Regression Test: Ensures that updating a user's profile information
        does not accidentally reset their timezone to the default.
        """
        # Step 1: Set a non-default timezone
        test_user.timezone = 'America/New_York'
        db_session.commit()
        
        # Step 2: Update another profile field (e.g., age)
        logged_in_client.post('/settings', data={
            'age': '30',
            'gender': 'Male',
            'weight': '150'
        }, follow_redirects=True)
        
        # Step 3: Verify that the timezone has not been reset
        db_session.refresh(test_user)
        assert test_user.timezone == 'America/New_York'
        assert test_user.age == 30

    def test_deleting_pouch_with_logs(self, logged_in_client, test_user, test_pouch, db_session):
        """
        Regression Test: Ensures that deleting a pouch that has associated logs
        does not delete the logs themselves. Instead, it should warn the user.
        """
        # Step 1: Create a log entry with the test pouch
        log = Log(user_id=test_user.id, pouch_id=test_pouch.id, quantity=1, log_time=db.func.now())
        db_session.add(log)
        db_session.commit()
        log_id = log.id

        # Step 2: Attempt to delete the pouch
        response = logged_in_client.post(f'/catalog/delete/{test_pouch.id}', follow_redirects=True)

        # Step 3: Verify that the pouch was NOT deleted and a warning was shown
        assert response.status_code == 200
        assert b'Cannot delete this pouch as it is used in' in response.data
        
        pouch_exists = Pouch.query.get(test_pouch.id)
        assert pouch_exists is not None

        # Step 4: Verify the log entry still exists
        log_exists = Log.query.get(log_id)
        assert log_exists is not None
        assert log_exists.pouch_id == test_pouch.id
