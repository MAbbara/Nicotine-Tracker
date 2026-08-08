"""Account and security settings contracts."""

from pathlib import Path

from bs4 import BeautifulSoup
from datetime import datetime
import pytest

from models import Craving, Goal, Log, Pouch, User
from models.email_verification import EmailVerification
from models.notification import NotificationQueue
from services.email_verification_service import EmailVerificationService
from extensions import db


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_account_uses_ordered_independent_security_forms(logged_in_client):
    response = logged_in_client.get("/settings/account")
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, "html.parser")

    assert soup.select_one("main h1").get_text(" ", strip=True) == "Account"
    assert [heading.get_text(" ", strip=True) for heading in soup.select(".account-section h2")] == [
        "Email", "Password", "Account access", "Delete account",
    ]
    forms = {
        form.select_one('input[name="action"]')["value"]: form
        for form in soup.select('form[action="/settings/account"][method="POST"]')
    }
    assert {"update_email", "change_password", "delete_account"} <= forms.keys()
    assert all(form.select_one('input[name="csrf_token"]') for form in forms.values())

    assert forms["update_email"].select_one('input[name="new_email"][type="email"][required]')
    assert forms["update_email"].select_one('input[name="password"][type="password"][required]')
    assert forms["change_password"].select_one('input[name="current_password"][type="password"][required]')
    assert forms["change_password"].select_one('input[name="new_password"][minlength="8"][maxlength="128"][required]')
    assert forms["change_password"].select_one('input[name="confirm_password"][type="password"][required]')
    assert forms["delete_account"].select_one('input[name="password"][type="password"][required]')
    assert forms["delete_account"].select_one('input[name="confirmation"][required]')

    danger_buttons = soup.select("button.c-button--danger")
    assert len(danger_buttons) == 1
    assert danger_buttons[0] in forms["delete_account"].descendants
    assert not soup.select("form:not(:has(input[value='delete_account'])) .c-button--danger")
    deletion_copy = forms["delete_account"].get_text(" ", strip=True).casefold()
    assert "permanent" in deletion_copy
    assert "cannot be recovered" in deletion_copy
    assert "delete my account" in deletion_copy


def test_account_validation_keeps_user_and_feedback(logged_in_client, test_user):
    original_email = test_user.email
    response = logged_in_client.post("/settings/account", data={
        "action": "update_email",
        "new_email": "changed@example.com",
        "password": "wrong-password",
    })
    assert response.status_code == 422
    assert b"Current password is incorrect." in response.data
    assert test_user.email == original_email
    soup = BeautifulSoup(response.data, "html.parser")
    password = soup.select_one('#password[aria-invalid="true"]')
    assert password is not None
    assert "password-error" in password.get("aria-describedby", "")
    assert soup.select_one("#password-error").get_text(" ", strip=True) == (
        "Current password is incorrect."
    )
    assert soup.select_one('#new_email')['value'] == 'changed@example.com'
    assert soup.select_one('#password').get('value', '') == ''


def test_account_email_change_rolls_back_when_revoke_fails(
        logged_in_client, db_session, test_user, monkeypatch):
    original_email = test_user.email
    original = EmailVerification(
        user_id=test_user.id, token='old-address-token',
        expires_at=datetime(2035, 1, 1), is_verified=False,
    )
    db_session.add(original)
    db_session.commit()

    def fail_revoke(*_args, **_kwargs):
        raise RuntimeError('forced revoke failure')
    monkeypatch.setattr(
        'services.email_verification_service.EmailVerificationService.revoke_user_tokens',
        fail_revoke,
    )
    response = logged_in_client.post('/settings/account', data={
        'action': 'update_email', 'new_email': 'new@example.com',
        'password': 'password123',
    })

    assert response.status_code == 422
    db_session.refresh(test_user)
    db_session.refresh(original)
    assert test_user.email == original_email
    assert original.is_verified is False
    assert NotificationQueue.query.filter_by(
        user_id=test_user.id, category='email_verification'
    ).count() == 0


def test_revoke_commit_false_propagates_flush_failure(
        app, db_session, test_user, monkeypatch):
    token = EmailVerification(
        user_id=test_user.id, token='flush-failure-token',
        expires_at=datetime(2035, 1, 1), is_verified=False,
    )
    db_session.add(token)
    db_session.commit()
    monkeypatch.setattr(
        db.session, 'flush',
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            RuntimeError('forced flush failure')
        ),
    )
    with app.app_context(), pytest.raises(RuntimeError, match='forced flush failure'):
        EmailVerificationService().revoke_user_tokens(
            test_user.id, commit=False,
        )


def test_account_email_change_commits_token_replacement_queue_and_session(
        logged_in_client, db_session, test_user):
    old = EmailVerification(
        user_id=test_user.id, token='old-address-success-token',
        expires_at=datetime(2035, 1, 1), is_verified=False,
    )
    db_session.add(old)
    db_session.commit()

    response = logged_in_client.post('/settings/account', data={
        'action': 'update_email', 'new_email': 'User@Example.NET',
        'password': 'password123',
    })
    assert response.status_code == 302
    db_session.refresh(test_user)
    db_session.refresh(old)
    assert test_user.email == 'User@example.net'
    assert test_user.email_verified is False
    assert old.is_verified is True
    active = EmailVerification.query.filter_by(
        user_id=test_user.id, is_verified=False,
    ).one()
    assert active.id != old.id
    queued = NotificationQueue.query.filter_by(
        user_id=test_user.id, category='email_verification',
    ).one()
    assert queued.notification_type == 'email'
    assert queued.recipient == 'User@example.net'
    with logged_in_client.session_transaction() as session_data:
        assert session_data['user_email'] == 'User@example.net'

    old_link = logged_in_client.get(
        f'/auth/verify_email/{old.token}', follow_redirects=False,
    )
    assert old_link.status_code == 302
    db_session.refresh(test_user)
    assert test_user.email_verified is False


def test_account_email_change_rolls_back_token_and_address_when_enqueue_fails(
        logged_in_client, db_session, test_user, monkeypatch):
    original_email = test_user.email
    before_tokens = EmailVerification.query.filter_by(user_id=test_user.id).count()
    monkeypatch.setattr(
        'services.notification_service.NotificationService.queue_notification',
        lambda *_args, **_kwargs: False,
    )

    response = logged_in_client.post('/settings/account', data={
        'action': 'update_email', 'new_email': 'new@example.com',
        'password': 'password123',
    })

    assert response.status_code == 422
    db_session.refresh(test_user)
    assert test_user.email == original_email
    assert EmailVerification.query.filter_by(user_id=test_user.id).count() == before_tokens
    with logged_in_client.session_transaction() as session_data:
        assert session_data['user_email'] == original_email


def test_account_rejects_multiple_actions_and_oversized_password_atomically(
        logged_in_client, test_user):
    original_email = test_user.email
    original_hash = test_user.password_hash
    response = logged_in_client.post('/settings/account', data={
        'action': ['update_email', 'change_password'],
        'new_email': 'changed@example.com',
        'password': 'password123',
        'current_password': 'password123',
        'new_password': 'x' * 129,
        'confirm_password': 'x' * 129,
    })
    assert response.status_code == 422
    assert b'Choose exactly one account action.' in response.data
    assert test_user.email == original_email
    assert test_user.password_hash == original_hash


@pytest.mark.parametrize('new_password', ['1234567', 'x' * 129])
def test_account_password_policy_rejects_out_of_bounds_without_write(
        logged_in_client, test_user, new_password):
    original_hash = test_user.password_hash
    response = logged_in_client.post('/settings/account', data={
        'action': 'change_password', 'current_password': 'password123',
        'new_password': new_password, 'confirm_password': new_password,
    })
    assert response.status_code == 422
    assert test_user.password_hash == original_hash
    soup = BeautifulSoup(response.data, 'html.parser')
    assert soup.select_one('#new_email')['value'] == test_user.email


def test_account_email_rejects_schema_oversize_without_write(
        logged_in_client, test_user):
    original = test_user.email
    local = 'x' * 109
    response = logged_in_client.post('/settings/account', data={
        'action': 'update_email', 'new_email': f'{local}@example.com',
        'password': 'password123',
    })
    assert response.status_code == 422
    assert test_user.email == original


def test_password_and_deletion_errors_are_field_adjacent(logged_in_client):
    password_response = logged_in_client.post("/settings/account", data={
        "action": "change_password",
        "current_password": "wrong-password",
        "new_password": "replacement-password",
        "confirm_password": "replacement-password",
    })
    password_soup = BeautifulSoup(password_response.data, "html.parser")
    assert password_soup.select_one('#current_password[aria-invalid="true"]')
    assert password_soup.select_one("#current_password-error").get_text(
        " ", strip=True
    ) == "Current password is incorrect."

    delete_response = logged_in_client.post("/settings/account", data={
        "action": "delete_account",
        "password": "wrong-password",
        "confirmation": "delete my account",
    })
    delete_soup = BeautifulSoup(delete_response.data, "html.parser")
    assert delete_soup.select_one('#delete_password[aria-invalid="true"]')
    assert delete_soup.select_one("#delete_password-error").get_text(
        " ", strip=True
    ) == "Password is incorrect."


def test_account_deletion_removes_exact_owned_rows_without_orphaned_pouch(
        logged_in_client, db_session, test_user, test_pouch, test_log,
        test_goal):
    unrelated = User(email='unrelated-craving@example.com')
    unrelated.set_password('unrelated-password')
    db_session.add(unrelated)
    db_session.flush()
    unrelated_craving = Craving(
        user_id=unrelated.id,
        craving_time=datetime(2026, 8, 3, 9, 15),
        intensity=4,
        trigger='unrelated fixture trigger',
        notes='unrelated fixture craving must survive',
    )
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime.utcnow(),
        intensity=6,
        notes='account deletion ownership proof',
    )
    db_session.add_all([craving, unrelated_craving])
    db_session.commit()
    unrelated_before = {
        'id': unrelated_craving.id,
        'user_id': unrelated_craving.user_id,
        'craving_time': unrelated_craving.craving_time,
        'intensity': unrelated_craving.intensity,
        'trigger': unrelated_craving.trigger,
        'notes': unrelated_craving.notes,
    }
    owned_ids = {
        'user': test_user.id,
        'pouch': test_pouch.id,
        'log': test_log.id,
        'goal': test_goal.id,
        'craving': craving.id,
    }

    response = logged_in_client.post('/settings/account', data={
        'action': 'delete_account',
        'password': 'password123',
        'confirmation': 'delete my account',
    }, follow_redirects=False)

    assert response.status_code == 302
    assert response.headers['Location'].endswith('/')
    assert 'Clear-Site-Data' not in response.headers
    landing = logged_in_client.get(response.headers['Location'])
    assert landing.status_code == 200
    assert landing.get_data(as_text=True).count('Your account has been deleted.') == 1
    assert landing.headers['Clear-Site-Data'] == '"cache", "cookies", "storage"'
    reload_response = logged_in_client.get('/')
    assert 'Your account has been deleted.' not in reload_response.get_data(as_text=True)
    replay = logged_in_client.get('/?account_deleted=1')
    assert 'Your account has been deleted.' not in replay.get_data(as_text=True)
    assert User.query.filter_by(id=owned_ids['user']).count() == 0
    assert Log.query.filter_by(id=owned_ids['log']).count() == 0
    assert Goal.query.filter_by(id=owned_ids['goal']).count() == 0
    assert Craving.query.filter_by(id=owned_ids['craving']).count() == 0
    assert Pouch.query.filter_by(id=owned_ids['pouch']).count() == 0
    assert Pouch.query.filter(
        Pouch.id == owned_ids['pouch'], Pouch.created_by.is_(None)
    ).count() == 0
    surviving_unrelated = Craving.query.filter_by(id=unrelated_before['id']).one()
    assert {
        'id': surviving_unrelated.id,
        'user_id': surviving_unrelated.user_id,
        'craving_time': surviving_unrelated.craving_time,
        'intensity': surviving_unrelated.intensity,
        'trigger': surviving_unrelated.trigger,
        'notes': surviving_unrelated.notes,
    } == unrelated_before


def test_account_template_retires_legacy_cards_and_palette():
    source = (PROJECT_ROOT / "templates/settings/account.html").read_text()
    for token in (
        "bg-indigo-", "text-indigo-", "ring-indigo-", "bg-gray-", "dark:bg-gray-",
        "shadow rounded-lg",
    ):
        assert token not in source
