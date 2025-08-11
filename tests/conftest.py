"""
Pytest configuration and shared fixtures for the test suite.
"""
import pytest
from datetime import datetime, timezone, timedelta
from app import create_app, db
from models import User, Pouch, Log, Goal
from services import user_service, log_service, goal_service

import os
import tempfile
import json
import multiprocessing
import time


@pytest.fixture(scope='function')
def app():
    """Create application for testing."""
    app = create_app('testing')
    app.config.update({
        'SECRET_KEY': 'test-secret-key',
        'MAIL_SUPPRESS_SEND': True,
    })
    
    with app.app_context():
        db.create_all()
        yield app
        db.drop_all()

@pytest.fixture(scope='function')
def client(app):
    """Create test client."""
    return app.test_client()

@pytest.fixture(scope='function')
def runner(app):
    """Create test CLI runner."""
    return app.test_cli_runner()

@pytest.fixture
def db_session(app):
    """Create database session."""
    with app.app_context():
        yield db.session

@pytest.fixture
def test_user(db_session):
    """Create test user."""
    user = User(
        email='test@example.com',
        email_verified=True
    )
    user.set_password("password123")
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def test_pouch(db_session):
    """Create test pouch."""
    pouch = Pouch(
        brand='Test Brand',
        nicotine_mg=4,
    )
    db_session.add(pouch)
    db_session.commit()
    return pouch


@pytest.fixture
def test_log(db_session, test_user, test_pouch):
    """Create test log entry."""
    log = Log(
        user_id=test_user.id,
        pouch_id=test_pouch.id,
        quantity=2,
        log_time=datetime.now(timezone.utc),
        notes='Test log entry'
    )
    db_session.add(log)
    db_session.commit()
    return log

@pytest.fixture
def test_goal(db_session, test_user):
    """Create test goal."""
    goal = Goal(
        user_id=test_user.id,
        goal_type='daily_pouches',
        target_value=10,
        start_date=datetime.now(timezone.utc).date(),
        end_date=(datetime.now(timezone.utc).date() + timedelta(days=30)),
        is_active=True
    )
    db_session.add(goal)
    db_session.commit()
    return goal


@pytest.fixture
def auth_headers(test_user, client):
    """Get authentication headers for API tests."""
    # Simulate login and get token
    return {'Authorization': 'Bearer test-token'}

@pytest.fixture
def temp_file():
    """Create temporary file for testing."""
    fd, path = tempfile.mkstemp()
    yield path
    os.close(fd)
    os.unlink(path)

@pytest.fixture
def sample_log_data():
    """Sample log data for testing."""
    return {
        'pouch_id': 1,
        'quantity': 2,
        'log_time': datetime.now(timezone.utc).isoformat(),
        'notes': 'Test log entry'
    }

@pytest.fixture
def sample_user_data():
    """Sample user data for testing."""
    return {
        'email': 'newuser@example.com',
        'password': 'securepassword123',
        'confirm_password': 'securepassword123'
    }


def run_app(db_path, port=5000):
    """
    Helper function to create and run the Flask app in a separate process.
    """
    app = create_app('testing')
    app.config.update({
        "SQLALCHEMY_DATABASE_URI": f"sqlite:///{db_path}",
        "TESTING": True,
        'SERVER_NAME': f'localhost:{port}',
        'SECRET_KEY': 'test-secret-key',
        'MAIL_SUPPRESS_SEND': True,
    })

    with app.app_context():
        db.create_all()
        # Create a test user for login-required pages
        user = User(email='test@example.com', email_verified=True)
        user.set_password('password123')
        db.session.add(user)
        db.session.commit()
    
    app.run(port=port)


@pytest.fixture(scope="class")
def live_server():
    """
    Fixture that starts a live server for the application, with a test user.
    """
    # Use a temporary file for the database
    db_fd, db_path = tempfile.mkstemp()
    port = 5000

    # Run the server in a separate process
    server = multiprocessing.Process(target=run_app, args=(db_path, port))
    server.start()

    # Wait for the server to be ready
    time.sleep(2)

    yield f"http://localhost:{port}"

    # Clean up the server and database
    server.terminate()
    server.join()
    os.close(db_fd)
    os.unlink(db_path)
