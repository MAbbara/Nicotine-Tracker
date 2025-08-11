import pytest
from app import create_app
from extensions import db
from models import User, Craving
from datetime import datetime

@pytest.fixture
def app_context():
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()

def test_add_craving(app_context):
    with app_context.test_client() as client:
        with app_context.test_request_context():
            # Create a user
            user = User(email='test@test.com', timezone='UTC')
            user.set_password('password')
            db.session.add(user)
            db.session.commit()
            user_id = user.id

        # Manually log in the user by setting the session for the test client
        with client.session_transaction() as sess:
            sess['user_id'] = user_id

        response = client.post('/cravings/api/cravings', json={
            'intensity': 8,
            'trigger': 'stress',
            'notes': 'A stressful day at work'
        })
        
        assert response.status_code == 201
        data = response.get_json()
        assert data['intensity'] == 8
        assert data['trigger'] == 'stress'
