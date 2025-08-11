import pytest
from app import create_app, db
from models import User, Pouch, Log
from flask import url_for

@pytest.fixture
def app():
    app = create_app()
    app.config.update({
        "TESTING": True,
        "SQLALCHEMY_DATABASE_URI": "sqlite:///:memory:",
        "WTF_CSRF_ENABLED": False,
    })

    with app.app_context():
        db.create_all()
        # Seed default pouches
        from models import init_default_pouches
        init_default_pouches()
        yield app
        db.session.remove()
        db.drop_all()

@pytest.fixture
def client(app):
    return app.test_client()

def test_register_login_logout(client):
    # Register
    response = client.post('/auth/register', data={
        'email': 'testuser@example.com',
        'password': 'password123',
        'confirm_password': 'password123',
        'terms': 'on'
    }, follow_redirects=True)
    assert b'Registration successful' in response.data or b'Please check your email' in response.data

    # Login
    response = client.post('/auth/login', data={
        'email': 'testuser@example.com',
        'password': 'password123'
    }, follow_redirects=True)
    assert b'Dashboard' in response.data or b'Nicotine Tracker' in response.data

    # Logout
    client.get('/auth/logout', follow_redirects=True)
    # After logout, accessing a protected route should redirect to login
    response = client.get('/dashboard/', follow_redirects=True)
    assert b'Sign in' in response.data or b'Login' in response.data

def test_add_log_entry(client, app):
    # Register a user to ensure it exists for this test
    client.post('/auth/register', data={
        'email': 'testuser@example.com',
        'password': 'password123',
        'confirm_password': 'password123',
        'terms': 'on'
    }, follow_redirects=True)

    with app.app_context():
        user = User.query.filter_by(email='testuser@example.com').first()
        assert user is not None

    # Login first

    client.post('/auth/login', data={
        'email': 'testuser@example.com',
        'password': 'password123'
    }, follow_redirects=True)

    # Add log entry
    response = client.post('/log/add', data={
        'log_date': '2025-07-31',
        'pouch_id': 1,
        'quantity': 2
    }, follow_redirects=True)
    assert b'Log entry added successfully' in response.data or b'Successfully added' in response.data

def test_dashboard_access(client):
    # Access dashboard without login should redirect
    response = client.get('/dashboard/', follow_redirects=True)
    assert b'Sign in' in response.data or b'Login' in response.data

def test_catalog_access(client):
    # Access catalog without login should redirect
    response = client.get('/catalog/', follow_redirects=True)
    assert b'Sign in' in response.data or b'Login' in response.data
