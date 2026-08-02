"""Real independent-connection coverage for the legacy Goal active invariant."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Lock

import pytest

import config as app_config
from app import create_app
from extensions import db
from models import Goal, User
import routes.goals as goals_routes


@pytest.fixture
def file_backed_goal_app(tmp_path):
    database_path = tmp_path / 'goal-activation.sqlite3'
    database_uri = f'sqlite:///{database_path}'
    original_uri = app_config.TestingConfig.SQLALCHEMY_DATABASE_URI
    app_config.TestingConfig.SQLALCHEMY_DATABASE_URI = database_uri
    try:
        application = create_app('testing')
    finally:
        app_config.TestingConfig.SQLALCHEMY_DATABASE_URI = original_uri
    application.config.update({
        'TESTING': True,
        'SECRET_KEY': 'goal-concurrency-secret',
        'MAIL_SUPPRESS_SEND': True,
        'WTF_CSRF_ENABLED': False,
    })
    with application.app_context():
        db.create_all()
        user = User(
            email='goal-race@example.com',
            email_verified=True,
            timezone='UTC',
        )
        user.set_password('password123')
        db.session.add(user)
        db.session.commit()
        user_id = user.id
    try:
        yield application, user_id
    finally:
        with application.app_context():
            db.session.remove()
            db.drop_all()
            db.engine.dispose()


def _logged_in_client(application):
    client = application.test_client()
    response = client.post('/auth/login', data={
        'email': 'goal-race@example.com',
        'password': 'password123',
    })
    assert response.status_code == 302
    return client


def test_two_independent_goal_creates_leave_one_active_and_one_constructive_conflict(
        file_backed_goal_app, monkeypatch):
    application, user_id = file_backed_goal_app
    clients = [_logged_in_client(application), _logged_in_client(application)]
    barrier = Barrier(2)
    connection_ids = set()
    connection_lock = Lock()
    real_create = goals_routes.create_goal_service

    def synchronized_create(**kwargs):
        driver_connection = db.session.connection().connection.driver_connection
        with connection_lock:
            connection_ids.add(id(driver_connection))
        barrier.wait(timeout=5)
        return real_create(**kwargs)

    monkeypatch.setattr(
        goals_routes, 'create_goal_service', synchronized_create
    )

    def create(client, target):
        return client.post(
            '/goals/create',
            data={
                'goal_type': 'daily_pouches',
                'target_value': str(target),
                'notification_threshold': '80',
            },
            follow_redirects=True,
        )

    with ThreadPoolExecutor(max_workers=2) as executor:
        responses = list(executor.map(create, clients, (7, 8)))

    assert connection_ids and len(connection_ids) == 2
    assert [response.status_code for response in responses] == [200, 200]
    response_text = [
        response.get_data(as_text=True).casefold() for response in responses
    ]
    assert sum('goal created successfully' in text for text in response_text) == 1
    assert sum(
        'already have an active daily pouches goal' in text
        for text in response_text
    ) == 1
    assert not any(
        'an error occurred while creating the goal' in text
        for text in response_text
    )
    with application.app_context():
        active = Goal.query.filter_by(
            user_id=user_id,
            goal_type='daily_pouches',
            is_active=True,
        ).all()
        assert len(active) == 1
        assert active[0].target_value in {7, 8}
