"""Temporary `/api/quick_add` compatibility adapter contracts."""

from datetime import timezone

import pytest

from models import Log, Pouch, User
from routes import api as api_routes


def _assert_deprecation_headers(response):
    assert response.headers["Deprecation"] == "true"
    assert response.headers["Link"] == '</api/logs>; rel="successor-version"'


def test_quick_add_delegates_once_to_canonical_service_and_keeps_legacy_body(
    logged_in_client,
    db_session,
    test_user,
    test_pouch,
    monkeypatch,
):
    original = api_routes.LogService.create_idempotent
    calls = []

    def counted(cls, user_id, payload):
        calls.append((user_id, payload))
        return original(user_id, payload)

    def forbidden_legacy_writer(*args, **kwargs):
        raise AssertionError("legacy create_log_entry must not be called")

    monkeypatch.setattr(
        api_routes.LogService,
        "create_idempotent",
        classmethod(counted),
    )
    monkeypatch.setattr(
        api_routes,
        "create_log_entry",
        forbidden_legacy_writer,
    )

    response = logged_in_client.post(
        "/api/quick_add",
        json={"pouch_id": test_pouch.id, "quantity": 2},
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "success": True,
        "message": "Added 2 Test Brand (4mg)",
    }
    _assert_deprecation_headers(response)
    assert len(calls) == 1
    user_id, payload = calls[0]
    assert user_id == test_user.id
    assert payload.client_event_id is None
    assert payload.pouch_id == test_pouch.id
    assert payload.custom_product is None
    assert payload.quantity == 2
    assert payload.occurred_at_utc.tzinfo is not None
    assert payload.occurred_at_utc.utcoffset().total_seconds() == 0
    assert payload.occurred_at_local.tzinfo is not None
    assert payload.timezone == "UTC"
    assert payload.notes is None
    assert payload.craving_id is None
    logs = db_session.query(Log).filter_by(user_id=test_user.id).all()
    assert len(logs) == 1
    assert logs[0].product_brand_snapshot == "Test Brand"
    assert str(logs[0].nicotine_mg_snapshot) == "4.00"


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"pouch_id": 1},
        {"pouch_id": 1, "quantity": True},
        {"pouch_id": 1, "quantity": "1"},
        {"pouch_id": 1, "quantity": 0},
        {"pouch_id": 1, "quantity": 101},
    ],
)
def test_quick_add_validation_errors_advertise_deprecation(
    logged_in_client, payload
):
    response = logged_in_client.post("/api/quick_add", json=payload)

    assert response.status_code == 400
    assert response.get_json() == {
        "success": False,
        "message": "Missing pouch_id or quantity",
    }
    _assert_deprecation_headers(response)


def test_quick_add_rejects_contradictory_custom_fields_with_headers(
    logged_in_client, db_session, test_user, test_pouch
):
    response = logged_in_client.post(
        "/api/quick_add",
        json={
            "pouch_id": test_pouch.id,
            "quantity": 1,
            "custom_brand": "Contradiction",
            "custom_nicotine_mg": "9.00",
        },
    )

    assert response.status_code == 400
    assert response.get_json()["success"] is False
    _assert_deprecation_headers(response)
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_quick_add_hides_foreign_and_missing_pouches_with_same_response(
    logged_in_client, db_session, test_user
):
    other = User(
        email="quick-adapter-other@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other.set_password("password123")
    db_session.add(other)
    db_session.flush()
    foreign = Pouch(
        brand="Private adapter pouch",
        nicotine_mg="18.00",
        is_default=False,
        created_by=other.id,
    )
    db_session.add(foreign)
    db_session.commit()

    responses = [
        logged_in_client.post(
            "/api/quick_add",
            json={"pouch_id": pouch_id, "quantity": 1},
        )
        for pouch_id in (foreign.id, foreign.id + 1000)
    ]

    for response in responses:
        assert response.status_code == 404
        assert response.get_json() == {
            "success": False,
            "message": "Pouch not found",
        }
        _assert_deprecation_headers(response)
    assert responses[0].get_json() == responses[1].get_json()
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_quick_add_ignores_legacy_client_strength_and_uses_snapshot(
    logged_in_client, db_session, test_user, test_pouch
):
    response = logged_in_client.post(
        "/api/quick_add",
        json={
            "pouch_id": test_pouch.id,
            "quantity": 1,
            "nicotine_mg": "99.00",
        },
    )

    assert response.status_code == 200
    _assert_deprecation_headers(response)
    log = db_session.query(Log).filter_by(user_id=test_user.id).one()
    assert str(log.nicotine_mg_snapshot) == "4.00"


def test_quick_add_uses_persisted_iana_timezone_for_canonical_input(
    logged_in_client, db_session, test_user, test_pouch, monkeypatch
):
    test_user.timezone = "Asia/Riyadh"
    db_session.commit()
    original = api_routes.LogService.create_idempotent
    captured = []

    def capture(cls, user_id, payload):
        captured.append(payload)
        return original(user_id, payload)

    monkeypatch.setattr(
        api_routes.LogService,
        "create_idempotent",
        classmethod(capture),
    )

    response = logged_in_client.post(
        "/api/quick_add",
        json={"pouch_id": test_pouch.id, "quantity": 1},
    )

    assert response.status_code == 200
    assert len(captured) == 1
    assert captured[0].timezone == "Asia/Riyadh"
    assert captured[0].occurred_at_local.utcoffset().total_seconds() == 10800
    assert captured[0].occurred_at_utc.astimezone(timezone.utc) == (
        captured[0].occurred_at_utc
    )
