"""Final backend abuse, credential-delivery, and validation contracts."""

from datetime import datetime

import pytest
from bs4 import BeautifulSoup

from config import Config
from extensions import db
from models import User, UserPreferences
from models.notification import NotificationQueue
from services.notification_service import NotificationService
from services.password_reset_service import PasswordResetService
from services.settings_validation_service import (
    SettingsValidationError,
    parse_preference_settings,
)


EXPECTED_LIMIT_DEFAULTS = {
    "RATELIMIT_ANONYMOUS_DEFAULT": "120 per minute",
    "RATELIMIT_AUTHENTICATED_DEFAULT_USER": "300 per minute",
    "RATELIMIT_AUTHENTICATED_DEFAULT_IP": "600 per minute",
    "RATELIMIT_LOGIN_ACCOUNT": "5 per minute;30 per hour",
    "RATELIMIT_LOGIN_IP": "20 per minute",
    "RATELIMIT_REGISTRATION_IP": "3 per hour",
    "RATELIMIT_REGISTRATION_EMAIL": "3 per day",
    "RATELIMIT_FORGOT_PASSWORD_ACCOUNT": "3 per hour",
    "RATELIMIT_FORGOT_PASSWORD_IP": "10 per hour",
    "RATELIMIT_RESET_TOKEN": "5 per 15 minutes",
    "RATELIMIT_RESET_IP": "20 per hour",
    "RATELIMIT_VERIFICATION_USER": "1 per 5 minutes;3 per hour",
    "RATELIMIT_VERIFICATION_IP": "10 per hour",
    "RATELIMIT_CURRENT_PASSWORD_USER": "5 per 15 minutes",
    "RATELIMIT_CURRENT_PASSWORD_IP": "5 per 15 minutes",
    "RATELIMIT_AUTHENTICATED_WRITE_USER": "120 per minute",
    "RATELIMIT_AUTHENTICATED_WRITE_IP": "60 per minute",
    "RATELIMIT_CANONICAL_WRITE": "60 per minute",
    "RATELIMIT_QUICK_ADD": "20 per minute",
    "RATELIMIT_BULK_ADD": "2 per minute;20 per hour",
    "RATELIMIT_DISCORD_TEST": "3 per minute;10 per hour",
    "RATELIMIT_WEEKLY_REPORT": "1 per 15 minutes;4 per day",
    "RATELIMIT_PLAN_PREVIEW": "10 per minute;60 per hour",
    "RATELIMIT_PLAN_MUTATION": "6 per minute;30 per hour",
    "RATELIMIT_EXPORT": "2 per minute;10 per hour",
    "RATELIMIT_DESTRUCTIVE": "1 per minute;6 per hour",
}


def test_approved_rate_limit_defaults_are_literal_and_multi_window():
    assert {
        name: getattr(Config, name, None)
        for name in EXPECTED_LIMIT_DEFAULTS
    } == EXPECTED_LIMIT_DEFAULTS


def test_registration_enforces_normalized_address_and_ip_independently(app):
    app.config.update(
        RATELIMIT_REGISTRATION_EMAIL="2 per day",
        RATELIMIT_REGISTRATION_IP="2 per hour",
    )
    first_ip = app.test_client()
    responses = [
        first_ip.post(
            "/auth/register",
            data={"email": email, "password": "short", "confirm_password": "short"},
            environ_base={"REMOTE_ADDR": "192.0.2.10"},
        )
        for email in ("one@example.com", "two@example.com", "three@example.com")
    ]
    assert [response.status_code for response in responses] == [200, 200, 429]

    normalized = []
    for index, email in enumerate((
        " Rate.Address@EXAMPLE.com ", "Rate.Address@example.COM", "rate.address@example.com"
    ), start=20):
        normalized.append(app.test_client().post(
            "/auth/register",
            data={"email": email, "password": "short", "confirm_password": "short"},
            environ_base={"REMOTE_ADDR": f"192.0.2.{index}"},
        ))
    assert [response.status_code for response in normalized] == [200, 200, 429]


def test_global_defaults_enforce_anonymous_and_authenticated_dimensions(
        app, db_session, test_user):
    app.config.update(
        RATELIMIT_ANONYMOUS_DEFAULT='1 per minute',
        RATELIMIT_AUTHENTICATED_DEFAULT_USER='100 per minute',
        RATELIMIT_AUTHENTICATED_DEFAULT_IP='1 per minute',
    )
    anonymous = app.test_client()
    assert anonymous.get(
        '/auth/login', environ_base={'REMOTE_ADDR': '192.0.2.70'}
    ).status_code == 200
    assert anonymous.get(
        '/auth/login', environ_base={'REMOTE_ADDR': '192.0.2.70'}
    ).status_code == 429

    second = User(email='default-second@example.com', timezone='UTC')
    second.set_password('password123')
    db_session.add(second)
    db_session.commit()
    responses = []
    for user_id in (test_user.id, second.id):
        client = app.test_client()
        with client.session_transaction() as stored:
            stored['user_id'] = user_id
        responses.append(client.get(
            '/today/',
            environ_base={'REMOTE_ADDR': '198.51.100.70'},
        ))
    assert [response.status_code for response in responses] == [200, 429]


def test_authenticated_writes_enforce_user_and_trusted_ip_dimensions(
        app, db_session, test_user):
    second = User(email="second-write@example.com", timezone="UTC")
    second.set_password("password123")
    db_session.add(second)
    db_session.commit()
    app.config.update(
        RATELIMIT_AUTHENTICATED_WRITE_USER="100 per minute",
        RATELIMIT_AUTHENTICATED_WRITE_IP="1 per minute",
    )

    responses = []
    for user_id in (test_user.id, second.id):
        client = app.test_client()
        with client.session_transaction() as stored:
            stored["user_id"] = user_id
        responses.append(client.post(
            "/api/check-ins", json={},
            environ_base={"REMOTE_ADDR": "198.51.100.22"},
        ))
    assert responses[0].status_code != 429
    assert responses[1].status_code == 429


def test_html_429_preserves_only_allowlisted_nonsecret_form_values(app):
    app.config.update(
        RATELIMIT_LOGIN_ACCOUNT="1 per minute",
        RATELIMIT_LOGIN_IP="100 per minute",
    )
    client = app.test_client()
    payload = {
        "email": " Retained@example.com ",
        "password": "do-not-echo-password",
        "remember_me": "on",
        "discord_webhook": "https://discord.com/api/webhooks/123/secret-token",
        "token": "raw-reset-token",
    }
    assert client.post("/auth/login", data=payload).status_code != 429
    response = client.post("/auth/login", data=payload)
    body = response.get_data(as_text=True)
    assert response.status_code == 429
    assert "Retained@example.com" in body
    assert "Remember me" in body
    assert "do-not-echo-password" not in body
    assert "secret-token" not in body
    assert "raw-reset-token" not in body


def test_settings_html_429_preserves_safe_action_state_without_password(
        app, logged_in_client):
    app.config.update(
        RATELIMIT_CURRENT_PASSWORD_USER='1 per minute',
        RATELIMIT_CURRENT_PASSWORD_IP='100 per minute',
    )
    payload = {
        'action': 'update_email', 'new_email': 'Retained.Settings@example.com',
        'password': 'never-render-this-password',
    }
    assert logged_in_client.post('/settings/account', data=payload).status_code != 429
    response = logged_in_client.post('/settings/account', data=payload)
    body = response.get_data(as_text=True)
    assert response.status_code == 429
    assert 'Retained.Settings@example.com' in body
    assert 'Account action' in body
    assert 'never-render-this-password' not in body


def test_password_reset_queue_is_email_only_and_bypasses_preferences_and_quiet_hours(
        app, db_session, test_user, monkeypatch):
    preferences = UserPreferences(
        user_id=test_user.id,
        notification_channel=["discord"],
        discord_webhook=(
            "https://discord.com/api/webhooks/123456789/"
            "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789"
        ),
        quiet_hours_start=datetime.utcnow().time().replace(second=0, microsecond=0),
        quiet_hours_end=(datetime.utcnow().replace(microsecond=0)).time(),
    )
    db_session.add(preferences)
    db_session.commit()
    service = NotificationService()
    monkeypatch.setattr(
        service.preferences_service,
        "is_quiet_hours", lambda *_args, **_kwargs: True,
    )
    monkeypatch.setattr(
        service.preferences_service,
        "get_or_create_preferences",
        lambda *_args, **_kwargs: pytest.fail(
            'credential delivery consulted quiet-hours scheduling'
        ),
    )

    queued = service.queue_notification(
        test_user.id, "password_reset", "Reset", "secret reset URL",
        extra_data={"reset_url": "https://local/reset/raw-token"},
    )
    assert queued is True
    row = NotificationQueue.query.filter_by(
        user_id=test_user.id, category="password_reset"
    ).one()
    assert row.notification_type == "email"
    assert row.recipient == test_user.email
    assert row.scheduled_for <= datetime.utcnow()
    assert NotificationQueue.query.filter_by(
        user_id=test_user.id, category="password_reset",
        notification_type="discord",
    ).count() == 0


def test_direct_queue_rejects_non_email_credential_transport(
        app, db_session, test_user, monkeypatch):
    service = NotificationService()
    monkeypatch.setattr(
        service.preferences_service, 'get_webhook_settings',
        lambda _user_id: pytest.fail('credential transport consulted webhook'),
    )

    assert service._queue_single_notification(
        test_user.id, 'discord', 'password_reset', 'Reset',
        'https://local/reset/raw-token', recipient=(
            'https://discord.com/api/webhooks/123/raw-reset-token'
        ),
    ) is False
    assert NotificationQueue.query.filter_by(
        user_id=test_user.id, category='password_reset'
    ).count() == 0


def test_unavailable_reset_mail_logs_only_sanitized_marker(
        app, db_session, test_user, caplog):
    from routes.auth import send_reset_email

    app.config['MAIL_USERNAME'] = None
    token = PasswordResetService().create_reset_token(test_user.id)
    caplog.clear()
    send_reset_email(test_user, token)

    assert 'Password reset email unavailable' in caplog.text
    assert token.token not in caplog.text
    assert test_user.email not in caplog.text


def test_reset_queue_never_invokes_discord_transport(
        app, db_session, test_user, monkeypatch):
    service = NotificationService()
    discord_calls = []
    monkeypatch.setitem(
        service.send_handlers, 'discord',
        lambda notification: discord_calls.append(notification.id) or True,
    )
    monkeypatch.setitem(service.send_handlers, 'email', lambda _row: True)
    assert service.queue_notification(
        test_user.id, 'password_reset', 'Reset', 'reset body',
    )
    assert service.process_notification_queue() == 1
    assert discord_calls == []


def test_reset_transport_exception_log_never_contains_address_token_or_body(
        app, db_session, test_user, monkeypatch, caplog):
    sentinel_token = 'reset-token-must-never-be-logged'
    sentinel_body = 'reset-body-must-never-be-logged'
    row = NotificationQueue(
        user_id=test_user.id, notification_type='email',
        category='password_reset', subject='Reset', message=sentinel_body,
        recipient=test_user.email, scheduled_for=datetime.utcnow(),
        extra_data={'reset_url': f'https://local/reset/{sentinel_token}'},
    )
    db_session.add(row)
    db_session.commit()
    app.debug = False
    app.config.update(FLASK_ENV='production', MAIL_USERNAME='configured')
    monkeypatch.setattr(
        'services.notification_service.mail.send',
        lambda _message: (_ for _ in ()).throw(
            RuntimeError(f'{test_user.email}:{sentinel_token}:{sentinel_body}')
        ),
    )
    caplog.clear()

    assert NotificationService().send_email_notification(row) is False
    assert 'Email notification transport failed (RuntimeError).' in caplog.text
    assert test_user.email not in caplog.text
    assert sentinel_token not in caplog.text
    assert sentinel_body not in caplog.text


def test_same_normalized_email_update_is_atomic_noop(
        logged_in_client, db_session, test_user):
    test_user.email = "User@example.com"
    test_user.email_verified = True
    db_session.commit()
    with logged_in_client.session_transaction() as stored:
        session_email_before = stored["user_email"]
    before = {
        "email": test_user.email,
        "verified": test_user.email_verified,
        "queue": NotificationQueue.query.filter_by(user_id=test_user.id).count(),
    }
    response = logged_in_client.post("/settings/account", data={
        "action": "update_email",
        "new_email": " user@EXAMPLE.COM ",
        "password": "password123",
    })
    assert response.status_code == 422
    assert "Enter a different email address." in response.get_data(as_text=True)
    db_session.refresh(test_user)
    assert test_user.email == before["email"]
    assert test_user.email_verified is before["verified"]
    assert NotificationQueue.query.filter_by(user_id=test_user.id).count() == before["queue"]
    with logged_in_client.session_transaction() as stored:
        assert stored["user_email"] == session_email_before


def test_preferred_brand_count_is_named_bounded_and_atomic():
    available = [f"Brand {index}" for index in range(21)]
    with pytest.raises(SettingsValidationError) as caught:
        parse_preference_settings({
            "units_preference": "mg",
            "timezone": "UTC",
            "daily_reset_time": "00:00",
            "preferred_brands": available,
        }, available_brands=available)
    assert caught.value.field_errors == {
        "preferred_brands": "Choose no more than 20 preferred products."
    }
