"""
API endpoint tests for the Nicotine Tracker application.
"""
import pytest
import json
from datetime import datetime, timezone
from app import db
from models import User, Pouch, Log, Goal

class TestApiEndpoints:
    """Test suite for API endpoints."""

    @pytest.fixture(autouse=True)
    def logged_in_client(self, client, test_user):
        """Log in the test user for all tests in this class."""
        with client.session_transaction() as sess:
            sess['user_id'] = test_user.id
            sess['user_email'] = test_user.email
            sess['user_timezone'] = test_user.timezone
        return client

    def test_update_timezone_api(self, logged_in_client, test_user):
        """Test the /api/update-timezone endpoint."""
        new_timezone = 'America/New_York'
        response = logged_in_client.post('/api/update-timezone', 
                                         data=json.dumps({'timezone': new_timezone}), 
                                         content_type='application/json')
        
        assert response.status_code == 200
        json_data = response.get_json()
        assert json_data['success'] is True
        assert json_data['timezone'] == new_timezone

        db.session.refresh(test_user)
        assert test_user.timezone == new_timezone

    def test_quick_add_api(self, logged_in_client, test_user, test_pouch):
        """Test the /api/quick_add endpoint."""
        response = logged_in_client.post('/api/quick_add',
                                         data=json.dumps({'pouch_id': test_pouch.id, 'quantity': 1}),
                                         content_type='application/json')

        assert response.status_code == 200
        json_data = response.get_json()
        assert json_data['success'] is True
        assert 'Added 1 Test Brand (4mg)' in json_data['message']

        # Verify a log was created
        log = Log.query.filter_by(user_id=test_user.id).order_by(Log.id.desc()).first()
        assert log is not None
        assert log.pouch_id == test_pouch.id
        assert log.quantity == 1

    def test_get_pouches_api(self, logged_in_client):
        """Test the /api/pouches endpoint."""
        response = logged_in_client.get('/api/pouches')
        assert response.status_code == 200
        json_data = response.get_json()
        assert json_data['success'] is True
        assert isinstance(json_data['pouches'], list)
        assert len(json_data['pouches']) > 0

    def test_get_brands_api(self, logged_in_client):
        """Test the /api/brands endpoint."""
        response = logged_in_client.get('/api/brands')
        assert response.status_code == 200
        json_data = response.get_json()
        assert json_data['success'] is True
        assert isinstance(json_data['brands'], list)
        assert 'Test Brand' in json_data['brands']

    def test_get_strengths_api(self, logged_in_client, test_pouch):
        """Test the /api/strengths/<brand> endpoint."""
        response = logged_in_client.get(f'/api/strengths/{test_pouch.brand}')
        assert response.status_code == 200
        json_data = response.get_json()
        assert json_data['success'] is True
        assert isinstance(json_data['strengths'], list)
        assert test_pouch.nicotine_mg in json_data['strengths']
