"""
Snapshot tests for API responses and rendered HTML to detect unintended changes.
"""
import pytest
import json
import re


class TestSnapshots:
    """A collection of snapshot tests for API and UI."""

    @pytest.fixture
    def logged_in_client(self, client, test_user):

        """Fixture to log in the test user for all tests in this class."""
        with client.session_transaction() as sess:
            sess['user_id'] = test_user.id
            sess['user_email'] = test_user.email
        return client

    def test_api_pouches_snapshot(self, logged_in_client, snapshot):
        """Snapshot test for the /api/pouches JSON response."""
        response = logged_in_client.get('/catalog/api/pouches')
        
        assert response.status_code == 200
        json_data = response.get_json()
        
        # The snapshot will be created on the first run.
        # Subsequent runs will compare the response to the stored snapshot.
        snapshot.assert_match(json.dumps(json_data, indent=4), 'pouches_api_snapshot.json')

    def test_login_page_snapshot(self, client, snapshot):
        """Snapshot test for the login page HTML."""
        response = client.get('/auth/login')
        
        assert response.status_code == 200
        # Replace dynamic parts like CSRF tokens before snapshotting
        html_content = response.data.decode('utf-8')
        # In a real scenario, you would replace CSRF tokens here if they exist
        # html_content = re.sub(r'csrf_token" value="[^"]+"', 'csrf_token" value="mock_csrf_token"', html_content)
        
        snapshot.assert_match(html_content, 'login_page_snapshot.html')

    def test_dashboard_page_snapshot(self, logged_in_client, snapshot):
        """Snapshot test for the dashboard page HTML for a logged-in user."""
        response = logged_in_client.get('/dashboard/')
        
        assert response.status_code == 200
        html_content = response.data.decode('utf-8')
        # Replace dynamic time value in quick add form
        html_content = re.sub(r'name="log_time" value="\d{2}:\d{2}"', 'name="log_time" value="[TIME]"', html_content)
        
        snapshot.assert_match(html_content, 'dashboard_page_snapshot.html')
