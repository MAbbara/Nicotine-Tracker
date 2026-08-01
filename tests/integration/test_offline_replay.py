"""Privacy and account contracts for the browser-only offline queue."""

from bs4 import BeautifulSoup
import pytest

from extensions import db
from models import UserPreferences
from services.preference_service import PreferenceService


def _assert_error_envelope(response, status, code="validation_error"):
    assert response.status_code == status
    assert response.get_json() == {
        "error": {
            "code": code,
            "message": (
                "Log in to continue."
                if code == "authentication_required"
                else "Check the highlighted fields and try again."
            ),
            "field_errors": response.get_json()["error"]["field_errors"],
            "retryable": False,
        }
    }


def test_authenticated_shell_exposes_only_offline_enabled_and_opaque_identity(
    logged_in_client, test_user, app
):
    with app.app_context():
        preferences = PreferenceService().get_or_create_preferences(test_user.id)
        preferences.offline_queue_enabled = True
        preferences.offline_queue_id = "opaque-browser-queue-token-1234567890"
        db.session.commit()
        raw_preference_id = preferences.id

    response = logged_in_client.get("/today/")
    assert response.status_code == 200
    document = BeautifulSoup(response.data, "html.parser")
    enabled = document.select_one('meta[name="offline-queue-enabled"]')
    identity = document.select_one('meta[name="offline-queue-id"]')

    assert enabled is not None
    assert enabled.get("content") == "true"
    assert identity is not None
    assert identity.get("content") == "opaque-browser-queue-token-1234567890"
    assert identity.get("content") not in {
        str(test_user.id),
        str(raw_preference_id),
    }
    assert document.select_one('meta[name="user-id"]') is None
    assert document.select_one('meta[name="preference-id"]') is None


def test_signed_out_pages_emit_no_usable_offline_queue_identity(client):
    response = client.get("/auth/login")
    assert response.status_code == 200
    document = BeautifulSoup(response.data, "html.parser")
    assert document.select_one('meta[name="offline-queue-id"]') is None
    assert document.select_one('meta[name="offline-queue-enabled"]') is None


def test_offline_queue_setting_requires_authentication(client):
    response = client.patch(
        "/settings/privacy/offline-queue",
        json={"enabled": False},
    )
    _assert_error_envelope(response, 401, "authentication_required")


@pytest.mark.parametrize(
    "payload,field",
    [
        (None, "body"),
        ([], "body"),
        ({}, "enabled"),
        ({"enabled": True, "extra": 1}, "body"),
        ({"enabled": 1}, "enabled"),
        ({"enabled": "false"}, "enabled"),
        ({"enabled": None}, "enabled"),
    ],
)
def test_offline_queue_setting_rejects_non_exact_boolean_json(
    logged_in_client, payload, field
):
    response = logged_in_client.patch(
        "/settings/privacy/offline-queue",
        json=payload,
    )
    _assert_error_envelope(response, 422)
    assert field in response.get_json()["error"]["field_errors"]


def test_disabling_and_reenabling_preserves_the_opaque_queue_identity(
    logged_in_client, test_user, app
):
    with app.app_context():
        preferences = PreferenceService().get_or_create_preferences(test_user.id)
        original_identity = preferences.offline_queue_id

    disabled = logged_in_client.patch(
        "/settings/privacy/offline-queue",
        json={"enabled": False},
    )
    assert disabled.status_code == 200
    assert disabled.get_json() == {
        "offline_queue": {"enabled": False, "id": original_identity}
    }

    enabled = logged_in_client.patch(
        "/settings/privacy/offline-queue",
        json={"enabled": True},
    )
    assert enabled.status_code == 200
    assert enabled.get_json() == {
        "offline_queue": {"enabled": True, "id": original_identity}
    }

    with app.app_context():
        persisted = UserPreferences.query.filter_by(user_id=test_user.id).one()
        assert persisted.offline_queue_enabled is True
        assert persisted.offline_queue_id == original_identity


def test_logout_and_successful_account_deletion_clear_browser_storage(
    logged_in_client, test_user
):
    logout = logged_in_client.get("/auth/logout", follow_redirects=False)
    assert logout.status_code == 302
    assert "storage" in logout.headers["Clear-Site-Data"]

    login = logged_in_client.post(
        "/auth/login",
        data={"email": test_user.email, "password": "password123"},
        follow_redirects=False,
    )
    assert login.status_code == 302
    deletion = logged_in_client.post(
        "/settings/account",
        data={
            "action": "delete_account",
            "password": "password123",
            "confirmation": "delete my account",
        },
        follow_redirects=False,
    )
    assert deletion.status_code == 302
    assert "storage" in deletion.headers["Clear-Site-Data"]
