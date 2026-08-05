"""Canonical and temporary quick-add adapter contracts."""

from datetime import datetime, time, timezone

import pytest

from models import Log, Pouch, User, UserPreferences
from routes import api as api_routes
from services.log_service import assign_log_product


EVENT_ID = '018f3f5c-68af-7e4d-bf5d-0123456789ab'


def _logbook_payload(pouch_id, **overrides):
    payload = {
        'pouch_id': pouch_id,
        'quantity': 1,
        'client_event_id': EVENT_ID,
        'view': {'page': 1, 'q': '', 'from_date': '', 'to_date': ''},
    }
    payload.update(overrides)
    return payload


def _assert_deprecation_headers(response):
    assert response.headers["Deprecation"] == "true"
    assert response.headers["Link"] == '</api/logs>; rel="successor-version"'


def test_logbook_fragment_matches_full_page_history(logged_in_client, test_log):
    page = logged_in_client.get('/log/view?q=Test')
    fragment = logged_in_client.get('/log/view?q=Test&fragment=history')
    fragment_html = fragment.get_data(as_text=True)

    assert fragment.status_code == 200
    assert 'data-logbook-history' in fragment_html
    assert '<h1>Logbook</h1>' not in fragment_html
    assert fragment_html in page.get_data(as_text=True)


def test_logbook_quick_add_is_idempotent_and_returns_authoritative_history(
    logged_in_client, db_session, test_user, test_pouch
):
    payload = _logbook_payload(test_pouch.id)

    first = logged_in_client.post('/log/api/quick_add', json=payload)
    replay = logged_in_client.post('/log/api/quick_add', json=payload)

    assert first.status_code == 201
    assert replay.status_code == 200
    first_body = first.get_json()
    replay_body = replay.get_json()
    assert first_body['success'] is True
    assert first_body['message'] == 'Log saved.'
    assert first_body['created'] is True
    assert replay_body['created'] is False
    assert replay_body['new_log_id'] == first_body['new_log_id']
    assert first_body['fragment_version'] == 'logbook-history-v1'
    assert first_body['visible'] is True
    assert f'data-log-id="{first_body["new_log_id"]}"' in first_body['history_html']
    _assert_deprecation_headers(first)
    _assert_deprecation_headers(replay)
    assert db_session.query(Log).filter_by(
        user_id=test_user.id,
        client_event_id=EVENT_ID,
    ).count() == 1


@pytest.mark.parametrize(
    ('payload', 'status', 'code'),
    [
        ({}, 400, 'invalid_request'),
        (_logbook_payload(1, quantity='1'), 400, 'invalid_request'),
        (_logbook_payload(1, client_event_id=None), 422, 'validation_error'),
        (_logbook_payload(1, client_event_id='not-a-uuid'), 422, 'validation_error'),
    ],
)
def test_logbook_quick_add_rejects_invalid_requests_with_stable_envelopes(
    logged_in_client, payload, status, code
):
    response = logged_in_client.post('/log/api/quick_add', json=payload)

    assert response.status_code == status
    error = response.get_json()['error']
    assert error['code'] == code
    assert isinstance(error['message'], str) and error['message']
    assert isinstance(error['field_errors'], dict)
    assert error['retryable'] is False


def test_logbook_quick_add_hides_foreign_and_missing_pouches(
    logged_in_client, db_session, test_user
):
    other = User(
        email='logbook-quick-other@example.com',
        email_verified=True,
        timezone='UTC',
    )
    other.set_password('password123')
    db_session.add(other)
    db_session.flush()
    foreign = Pouch(
        brand='Private quick product',
        nicotine_mg='18.00',
        is_default=False,
        created_by=other.id,
    )
    db_session.add(foreign)
    db_session.commit()

    responses = [
        logged_in_client.post(
            '/log/api/quick_add',
            json=_logbook_payload(pouch_id, client_event_id=event_id),
        )
        for pouch_id, event_id in (
            (foreign.id, '118f3f5c-68af-7e4d-bf5d-0123456789ab'),
            (foreign.id + 1000, '218f3f5c-68af-7e4d-bf5d-0123456789ab'),
        )
    ]

    for response in responses:
        assert response.status_code == 404
        assert response.get_json()['error'] == {
            'code': 'not_found',
            'message': 'That resource does not exist.',
            'field_errors': {},
            'retryable': False,
        }
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_logbook_quick_add_preserves_filter_and_page_authority(
    app, logged_in_client, db_session, test_user, test_pouch
):
    app.config['LOGS_PER_PAGE'] = 1
    older = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2026, 1, 1, 9, 0),
        notes='older page marker',
    )
    assign_log_product(older, pouch_id=test_pouch.id)
    db_session.add(older)
    db_session.commit()
    payload = _logbook_payload(
        test_pouch.id,
        view={'page': 2, 'q': '', 'from_date': '', 'to_date': ''},
    )

    response = logged_in_client.post('/log/api/quick_add', json=payload)

    assert response.status_code == 201
    body = response.get_json()
    assert body['visible'] is False
    assert body['message'] == 'Log saved. It is outside the current view.'
    assert f'data-log-id="{body["new_log_id"]}"' not in body['history_html']
    assert 'older page marker' in body['history_html']
    assert 'Page 2 of 2' in body['history_html']


def test_logbook_quick_add_uses_effective_day_and_escapes_html_brand(
    logged_in_client, db_session, test_user, monkeypatch
):
    import routes.logging as logging_routes

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            fixed = cls(2026, 1, 10, 0, 30, tzinfo=timezone.utc)
            return fixed.astimezone(tz) if tz else fixed.replace(tzinfo=None)

    test_user.timezone = 'Asia/Riyadh'
    db_session.add(UserPreferences(
        user_id=test_user.id,
        daily_reset_time=time(4, 0),
    ))
    pouch = Pouch(
        brand='<img src=x onerror=alert(1)>',
        nicotine_mg='6.00',
        is_default=False,
        created_by=test_user.id,
    )
    db_session.add(pouch)
    db_session.commit()
    monkeypatch.setattr(logging_routes, 'datetime', FrozenDateTime)

    response = logged_in_client.post(
        '/log/api/quick_add',
        json=_logbook_payload(pouch.id),
    )

    assert response.status_code == 201
    history_html = response.get_json()['history_html']
    assert 'Friday, January 9' in history_html
    assert '<img src=x onerror=alert(1)>' not in history_html
    assert '&lt;img src=x onerror=alert(1)&gt;' in history_html


def test_deprecated_today_quick_add_returns_literal_brand_free_feedback(
    logged_in_client, db_session, test_user
):
    pouch = Pouch(
        brand='<img src=x onerror=alert(1)>',
        nicotine_mg='6.00',
        is_default=False,
        created_by=test_user.id,
    )
    db_session.add(pouch)
    db_session.commit()

    response = logged_in_client.post('/log/api/quick_add', json={
        'pouch_id': pouch.id,
        'quantity': 1,
    })

    assert response.status_code == 200
    assert response.get_json()['message'] == 'Log saved.'
    assert pouch.brand not in response.get_data(as_text=True)


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
