"""Authenticated daily check-in API contracts."""

from datetime import datetime, timezone

from extensions import db
from models import DailyCheckIn
from services.check_in_service import CheckInPersistenceError, CheckInService
from services.today_service import TodayService


def _assert_error(response, status, code):
    assert response.status_code == status
    body = response.get_json()
    assert set(body) == {"error"}
    assert body["error"]["code"] == code
    assert set(body["error"]) == {
        "code", "message", "field_errors", "retryable",
    }
    return body["error"]


def test_check_in_requires_authentication(client):
    response = client.post("/api/check-ins", json={"mood": 3})
    error = _assert_error(response, 401, "authentication_required")
    assert error["retryable"] is False


def test_unknown_authority_fields_are_rejected_without_a_write(
    logged_in_client, test_user
):
    response = logged_in_client.post("/api/check-ins", json={
        "mood": 3,
        "user_id": test_user.id,
        "plan_id": 1,
        "local_date": "2001-01-01",
    })

    error = _assert_error(response, 422, "validation_error")
    assert set(error["field_errors"]) == {"user_id", "plan_id", "local_date"}
    assert DailyCheckIn.query.count() == 0


def test_invalid_rating_and_oversized_text_make_no_write(
    logged_in_client, test_user
):
    response = logged_in_client.post("/api/check-ins", json={
        "mood": True,
        "reflection": "x" * 2001,
    })

    error = _assert_error(response, 422, "validation_error")
    assert set(error["field_errors"]) == {"mood", "reflection"}
    assert DailyCheckIn.query.filter_by(user_id=test_user.id).count() == 0


def test_create_then_update_returns_exact_canonical_shape_and_one_timeline_item(
    logged_in_client, test_user
):
    first = logged_in_client.post("/api/check-ins", json={
        "mood": 3,
        "confidence": 4,
        "reflection": "  The afternoon was easier.  ",
        "context": "   ",
    })
    second = logged_in_client.post("/api/check-ins", json={
        "mood": None,
        "confidence": 5,
        "reflection": None,
        "context": "A walk helped.",
    })

    assert first.status_code == second.status_code == 200
    first_body = first.get_json()
    second_body = second.get_json()
    assert set(first_body) == {"check_in", "today", "warnings"}
    assert first_body["warnings"] == second_body["warnings"] == []
    assert set(second_body["check_in"]) == {
        "id", "local_date", "mood", "confidence", "reflection", "context",
    }
    assert second_body["check_in"] == {
        "id": first_body["check_in"]["id"],
        "local_date": second_body["today"]["local_date"],
        "mood": None,
        "confidence": 5,
        "reflection": None,
        "context": "A walk helped.",
    }
    check_in_items = [
        item for item in second_body["today"]["timeline"]
        if item["type"] == "check_in"
    ]
    assert len(check_in_items) == 1
    assert check_in_items[0]["data"] == second_body["check_in"]
    assert DailyCheckIn.query.filter_by(user_id=test_user.id).count() == 1


def test_completely_empty_submission_is_valid(logged_in_client, test_user):
    response = logged_in_client.post("/api/check-ins", json={})

    assert response.status_code == 200
    body = response.get_json()
    assert isinstance(body["check_in"]["id"], int)
    assert body["check_in"]["local_date"] == body["today"]["local_date"]
    assert body["check_in"] == {
        "id": body["check_in"]["id"],
        "local_date": body["today"]["local_date"],
        "mood": None,
        "confidence": None,
        "reflection": None,
        "context": None,
    }
    assert DailyCheckIn.query.filter_by(user_id=test_user.id).count() == 1


def test_committed_check_in_survives_today_refresh_failure_with_warning(
    logged_in_client, test_user, monkeypatch
):
    def unavailable(*_args, **_kwargs):
        raise RuntimeError("synthetic Today refresh failure")

    monkeypatch.setattr(TodayService, "get_summary", unavailable)
    response = logged_in_client.post("/api/check-ins", json={
        "mood": 4,
        "reflection": "Saved before refresh",
    })

    assert response.status_code == 200
    assert response.get_json() == {
        "check_in": {
            "id": response.get_json()["check_in"]["id"],
            "local_date": response.get_json()["check_in"]["local_date"],
            "mood": 4,
            "confidence": None,
            "reflection": "Saved before refresh",
            "context": None,
        },
        "today": None,
        "warnings": [{
            "code": "today_refresh_unavailable",
            "retryable": True,
        }],
    }
    saved = DailyCheckIn.query.filter_by(user_id=test_user.id).one()
    assert saved.reflection == "Saved before refresh"


def test_precommit_service_failure_uses_generic_error_without_route_rollback(
    logged_in_client, monkeypatch
):
    rollback_calls = 0

    def fail_before_commit(cls, user_id, payload, now=None):
        raise CheckInPersistenceError("synthetic")

    def unexpected_route_rollback():
        nonlocal rollback_calls
        rollback_calls += 1

    monkeypatch.setattr(
        CheckInService,
        "upsert_for_today",
        classmethod(fail_before_commit),
    )
    monkeypatch.setattr(db.session, "rollback", unexpected_route_rollback)
    response = logged_in_client.post("/api/check-ins", json={"mood": 3})

    _assert_error(response, 500, "internal_error")
    assert rollback_calls == 0
