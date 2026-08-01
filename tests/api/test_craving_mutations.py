"""Canonical craving mutation API contracts."""

from datetime import datetime, timedelta, timezone
import logging

from models import Craving, Log, User
from services.craving_service import CravingService
from services.today_service import TodayService


def _create_payload(**changes):
    instant = datetime.now(timezone.utc).replace(microsecond=0)
    payload = {
        "client_event_id": "318f3f5c-68af-7e4d-bf5d-0123456789ab",
        "intensity": 7,
        "trigger": "  Work   PRESSURE ",
        "occurred_at_local": instant.isoformat(),
        "timezone": "UTC",
    }
    payload.update(changes)
    return payload


def _assert_error_envelope(response, status, code, retryable=False):
    assert response.status_code == status
    body = response.get_json()
    assert body == {
        "error": {
            "code": code,
            "message": body["error"]["message"],
            "field_errors": body["error"]["field_errors"],
            "retryable": retryable,
        }
    }
    return body["error"]


def test_post_cravings_creates_unresolved_canonical_event_and_refreshes_today(
    logged_in_client,
    db_session,
    test_user,
):
    """Removing the canonical route must leave Today unable to create cravings."""
    payload = _create_payload()

    response = logged_in_client.post("/api/cravings", json=payload)

    assert response.status_code == 201
    body = response.get_json()
    assert set(body) == {"craving", "today", "created", "warnings"}
    assert body["created"] is True
    assert body["warnings"] == []
    assert body["craving"] == {
        "id": body["craving"]["id"],
        "client_event_id": payload["client_event_id"],
        "occurred_at_utc": payload["occurred_at_local"],
        "occurred_at_local": payload["occurred_at_local"],
        "intensity": 7,
        "trigger": "work pressure",
        "outcome": None,
        "linked_log_id": None,
        "duration_minutes": None,
        "physical_symptoms": [],
        "situation_context": None,
        "outcome_notes": None,
        "mood_before": None,
        "mood_after": None,
        "stress_level": None,
        "notes": None,
    }
    assert "user_id" not in body["craving"]
    assert body["today"]["timeline"][0]["data"] == body["craving"]
    stored = db_session.query(Craving).filter_by(user_id=test_user.id).one()
    assert stored.outcome is None


def test_patch_cravings_resolves_owned_event_and_refreshes_today(
    logged_in_client,
    db_session,
    test_user,
):
    """Removing the canonical patch route must leave events unresolved."""
    craving = Craving(
        user_id=test_user.id,
        client_event_id="418f3f5c-68af-7e4d-bf5d-0123456789ab",
        craving_time=datetime.now(timezone.utc).replace(
            microsecond=0, tzinfo=None
        ),
        intensity=8,
        trigger="stress",
    )
    db_session.add(craving)
    db_session.commit()

    response = logged_in_client.patch(
        f"/api/cravings/{craving.id}",
        json={
            "outcome": "used_alternative",
            "duration_minutes": 3,
            "physical_symptoms": [" Jaw   tense ", "jaw tense"],
            "notes": "  took a short walk  ",
        },
    )

    assert response.status_code == 200
    body = response.get_json()
    assert set(body) == {"craving", "today", "warnings"}
    assert body["warnings"] == []
    assert body["craving"]["outcome"] == "used_alternative"
    assert body["craving"]["duration_minutes"] == 3
    assert body["craving"]["physical_symptoms"] == ["Jaw tense"]
    assert body["craving"]["notes"] == "took a short walk"
    assert body["today"]["timeline"][0]["data"] == body["craving"]


def test_legacy_post_adapts_through_canonical_services_and_is_deprecated(
    logged_in_client,
    db_session,
    test_user,
):
    """A second legacy writer would omit canonical identity and normalization."""
    response = logged_in_client.post(
        "/cravings/api/cravings",
        json={
            "intensity": "8",
            "trigger": "  Work   PRESSURE ",
            "duration_minutes": "3",
            "physical_symptoms": [" Jaw   tense ", "jaw tense"],
            "situation_context": "  After work  ",
            "outcome": "used_alternative",
            "outcome_notes": "  walked outside  ",
            "mood_before": "3",
            "mood_after": "5",
            "stress_level": "7",
            "notes": "  useful context  ",
        },
    )

    assert response.status_code == 201
    assert response.headers["Deprecation"] == "true"
    assert response.headers["Sunset"]
    assert response.headers["Link"] == '</api/cravings>; rel="successor-version"'
    body = response.get_json()
    assert body["intensity"] == 8
    assert body["trigger"] == "work pressure"
    assert body["outcome"] == "used_alternative"
    stored = db_session.query(Craving).filter_by(user_id=test_user.id).one()
    assert stored.client_event_id is not None
    assert stored.get_physical_symptoms_list() == ["Jaw tense"]
    assert stored.notes == "useful context"


def test_legacy_post_validates_all_details_before_creating_unresolved_row(
    logged_in_client,
    db_session,
    test_user,
):
    """Mutating before patch validation would leave a partial craving behind."""
    response = logged_in_client.post(
        "/cravings/api/cravings",
        json={
            "intensity": "8",
            "trigger": "stress",
            "notes": "x" * 2001,
            "outcome": "",
            "physical_symptoms": [],
        },
    )

    assert response.status_code == 400
    assert response.get_json() == {
        "error": "Enter up to 2,000 characters, or null."
    }
    assert db_session.query(Craving).filter_by(user_id=test_user.id).count() == 0


def test_canonical_craving_mutations_require_authentication(client):
    post = client.post("/api/cravings", json=_create_payload())
    patch = client.patch("/api/cravings/1", json={"outcome": "resisted"})

    _assert_error_envelope(post, 401, "authentication_required")
    _assert_error_envelope(patch, 401, "authentication_required")


def test_post_cravings_exact_replay_returns_200_and_one_row(
    logged_in_client,
    db_session,
    test_user,
):
    payload = _create_payload(
        client_event_id="518f3f5c-68af-7e4d-bf5d-0123456789ab"
    )

    first = logged_in_client.post("/api/cravings", json=payload)
    replay = logged_in_client.post(
        "/api/cravings",
        json={**payload, "intensity": 1, "trigger": "different"},
    )

    assert (first.status_code, replay.status_code) == (201, 200)
    assert first.get_json()["created"] is True
    assert replay.get_json()["created"] is False
    assert replay.get_json()["craving"] == first.get_json()["craving"]
    assert db_session.query(Craving).filter_by(
        user_id=test_user.id,
        client_event_id=payload["client_event_id"],
    ).count() == 1


def test_post_cravings_returns_validation_and_time_error_envelopes(
    logged_in_client,
):
    invalid_shape = logged_in_client.post(
        "/api/cravings",
        json={"intensity": True, "extra": "no"},
    )
    mismatch = datetime.now(timezone.utc).replace(microsecond=0).astimezone(
        timezone(timedelta(hours=1))
    )
    invalid_time = logged_in_client.post(
        "/api/cravings",
        json=_create_payload(
            client_event_id="618f3f5c-68af-7e4d-bf5d-0123456789ab",
            occurred_at_local=mismatch.isoformat(),
            timezone="UTC",
        ),
    )

    validation = _assert_error_envelope(
        invalid_shape, 422, "validation_error"
    )
    assert validation["field_errors"] == {
        "client_event_id": ["This field is required."],
        "extra": ["This field is not supported."],
        "occurred_at_local": ["This field is required."],
        "timezone": ["This field is required."],
        "trigger": ["This field is required."],
    }
    time_error = _assert_error_envelope(
        invalid_time, 422, "invalid_local_time"
    )
    assert time_error["field_errors"] == {
        "occurred_at_local": [
            "Check that this time and offset match the timezone."
        ]
    }


def test_patch_cravings_hides_foreign_and_missing_ids(
    logged_in_client,
    db_session,
    test_user,
):
    other = User(
        email="api-foreign-craving-patch@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other.set_password("password123")
    db_session.add(other)
    db_session.flush()
    foreign = Craving(
        user_id=other.id,
        craving_time=datetime.now(timezone.utc).replace(tzinfo=None),
        intensity=6,
    )
    db_session.add(foreign)
    db_session.commit()

    responses = [
        logged_in_client.patch(
            f"/api/cravings/{craving_id}",
            json={"notes": "private"},
        )
        for craving_id in (foreign.id, foreign.id + 1000)
    ]

    for response in responses:
        _assert_error_envelope(response, 404, "not_found")
    db_session.refresh(foreign)
    assert foreign.notes is None


def test_patch_cravings_returns_neutral_outcome_conflict_without_partial_details(
    logged_in_client,
    db_session,
    test_user,
):
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime.now(timezone.utc).replace(tzinfo=None),
        intensity=7,
        outcome="resisted",
        notes="winner",
    )
    db_session.add(craving)
    db_session.commit()

    response = logged_in_client.patch(
        f"/api/cravings/{craving.id}",
        json={"outcome": "used_nicotine", "notes": "loser"},
    )

    error = _assert_error_envelope(
        response, 409, "craving_outcome_conflict"
    )
    assert "resisted" not in error["message"]
    db_session.refresh(craving)
    assert craving.outcome == "resisted"
    assert craving.notes == "winner"


def test_committed_create_survives_today_refresh_failure(
    logged_in_client,
    db_session,
    test_user,
    monkeypatch,
):
    def fail_today(*args, **kwargs):
        raise RuntimeError("private today failure")

    monkeypatch.setattr(TodayService, "get_summary", fail_today)
    payload = _create_payload(
        client_event_id="718f3f5c-68af-7e4d-bf5d-0123456789ab"
    )

    response = logged_in_client.post("/api/cravings", json=payload)

    assert response.status_code == 201
    assert response.get_json()["today"] is None
    assert response.get_json()["warnings"] == [{
        "code": "today_refresh_unavailable",
        "retryable": True,
    }]
    assert db_session.query(Craving).filter_by(
        user_id=test_user.id,
        client_event_id=payload["client_event_id"],
    ).count() == 1


def test_precommit_create_failure_rolls_back_and_logs_request_id_only(
    logged_in_client,
    db_session,
    test_user,
    monkeypatch,
    caplog,
):
    request_id = "918f3f5c-68af-7e4d-bf5d-0123456789ab"

    def fail_before_commit(cls, user_id, payload):
        db_session.add(Craving(
            user_id=user_id,
            craving_time=payload.occurred_at_utc.replace(tzinfo=None),
            intensity=payload.intensity,
        ))
        db_session.flush()
        raise RuntimeError("private database detail")

    monkeypatch.setattr(
        CravingService,
        "create_idempotent",
        classmethod(fail_before_commit),
    )

    with caplog.at_level(logging.ERROR, logger="routes.api"):
        response = logged_in_client.post(
            "/api/cravings",
            json=_create_payload(
                client_event_id="818f3f5c-68af-7e4d-bf5d-0123456789ab"
            ),
            headers={"X-Request-ID": request_id},
        )

    _assert_error_envelope(
        response, 500, "internal_error", retryable=True
    )
    assert db_session.query(Craving).filter_by(user_id=test_user.id).count() == 0
    records = [record for record in caplog.records if record.name == "routes.api"]
    assert len(records) == 1
    assert request_id in records[0].getMessage()
    assert "private database detail" not in records[0].getMessage()


def test_craving_mutations_enforce_csrf(logged_in_client):
    logged_in_client.application.config["WTF_CSRF_ENABLED"] = True
    try:
        post = logged_in_client.post("/api/cravings", json=_create_payload())
        patch = logged_in_client.patch(
            "/api/cravings/1", json={"outcome": "resisted"}
        )
    finally:
        logged_in_client.application.config["WTF_CSRF_ENABLED"] = False

    _assert_error_envelope(post, 400, "csrf_failed")
    _assert_error_envelope(patch, 400, "csrf_failed")


def test_patch_validation_uses_shared_envelope(logged_in_client):
    empty = logged_in_client.patch("/api/cravings/1", json={})
    unknown = logged_in_client.patch(
        "/api/cravings/1", json={"intensity": 9}
    )
    invalid_outcome = logged_in_client.patch(
        "/api/cravings/1", json={"outcome": ""}
    )

    assert _assert_error_envelope(
        empty, 422, "validation_error"
    )["field_errors"] == {
        "body": ["Send one nonempty JSON object."]
    }
    assert _assert_error_envelope(
        unknown, 422, "validation_error"
    )["field_errors"] == {
        "intensity": ["This field is not supported."]
    }
    assert _assert_error_envelope(
        invalid_outcome, 422, "validation_error"
    )["field_errors"] == {
        "outcome": [
            "Choose resisted, used nicotine, or used alternative."
        ]
    }


def test_patch_rejects_list_and_object_outcomes_with_field_scoped_422(
    logged_in_client,
):
    """Unhashable JSON outcomes must never escape parsing as a server error."""
    responses = [
        logged_in_client.patch(
            "/api/cravings/1", json={"outcome": outcome}
        )
        for outcome in ([], {"value": "resisted"})
    ]

    for response in responses:
        error = _assert_error_envelope(
            response, 422, "validation_error"
        )
        assert error["field_errors"] == {
            "outcome": [
                "Choose resisted, used nicotine, or used alternative."
            ]
        }


def test_create_replay_still_validates_complete_current_request(
    logged_in_client,
    db_session,
    test_user,
):
    event_id = "a18f4f5c-68af-7e4d-bf5d-0123456789ab"
    first = logged_in_client.post(
        "/api/cravings",
        json=_create_payload(client_event_id=event_id),
    )
    stale = datetime.now(timezone.utc).replace(microsecond=0) - timedelta(days=31)

    replay = logged_in_client.post(
        "/api/cravings",
        json=_create_payload(
            client_event_id=event_id,
            occurred_at_local=stale.isoformat(),
        ),
    )

    assert first.status_code == 201
    _assert_error_envelope(replay, 422, "invalid_local_time")
    assert db_session.query(Craving).filter_by(
        user_id=test_user.id,
        client_event_id=event_id,
    ).count() == 1


def test_committed_patch_survives_today_refresh_failure(
    logged_in_client,
    db_session,
    test_user,
    monkeypatch,
):
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime.now(timezone.utc).replace(tzinfo=None),
        intensity=6,
    )
    db_session.add(craving)
    db_session.commit()

    def fail_today(*args, **kwargs):
        raise RuntimeError("private today failure")

    monkeypatch.setattr(TodayService, "get_summary", fail_today)

    response = logged_in_client.patch(
        f"/api/cravings/{craving.id}",
        json={"outcome": "resisted", "notes": "kept moving"},
    )

    assert response.status_code == 200
    assert response.get_json()["today"] is None
    assert response.get_json()["warnings"] == [{
        "code": "today_refresh_unavailable",
        "retryable": True,
    }]
    db_session.refresh(craving)
    assert craving.outcome == "resisted"
    assert craving.notes == "kept moving"


def test_used_nicotine_craving_links_through_task3_log_api_without_duplicates(
    logged_in_client,
    db_session,
    test_user,
    test_pouch,
):
    craving_create = logged_in_client.post(
        "/api/cravings",
        json=_create_payload(
            client_event_id="b18f4f5c-68af-7e4d-bf5d-0123456789ab"
        ),
    )
    craving_id = craving_create.get_json()["craving"]["id"]
    resolved = logged_in_client.patch(
        f"/api/cravings/{craving_id}",
        json={"outcome": "used_nicotine"},
    )
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    log_payload = {
        "client_event_id": "c18f4f5c-68af-7e4d-bf5d-0123456789ab",
        "pouch_id": test_pouch.id,
        "custom_product": None,
        "quantity": 1,
        "occurred_at_local": occurred.isoformat(),
        "timezone": "UTC",
        "notes": None,
        "craving_id": craving_id,
    }

    created_log = logged_in_client.post("/api/logs", json=log_payload)
    replay = logged_in_client.post("/api/logs", json=log_payload)

    assert resolved.status_code == 200
    assert created_log.status_code == 201
    assert replay.status_code == 200
    assert replay.get_json()["log"] == created_log.get_json()["log"]
    assert created_log.get_json()["log"]["linked_craving_id"] == craving_id
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 1
    db_session.expire_all()
    craving = db_session.get(Craving, craving_id)
    assert craving.outcome == "used_nicotine"
    assert craving.linked_log_id == created_log.get_json()["log"]["id"]
