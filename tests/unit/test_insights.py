import pytest
from app import create_app
from extensions import db
from models import User, Log
from datetime import datetime, timedelta

@pytest.fixture
def app_context():
    app = create_app('testing')
    with app.app_context():
        db.create_all()
        yield app
        db.session.remove()
        db.drop_all()

def test_get_all_insights(app_context):
    with app_context.test_request_context():
        # Create a user
        user = User(email='test@test.com', timezone='UTC')
        user.set_password('password')
        db.session.add(user)
        db.session.commit()

        # Create logs
        now = datetime.utcnow()
        log1 = Log(user_id=user.id, log_time=now - timedelta(hours=1), quantity=1)
        log2 = Log(user_id=user.id, log_time=now, quantity=2)
        db.session.add_all([log1, log2])
        db.session.commit()

        from services.insights_service import get_all_insights
        insights = get_all_insights(user.id)

        assert insights is not None
        assert 'consumption_by_time_of_day' in insights
        assert 'consumption_by_day_of_week' in insights
        assert 'average_time_between_pouches' in insights
