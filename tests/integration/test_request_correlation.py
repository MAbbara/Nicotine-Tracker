"""Integration tests for request correlation and safe error context.

Task 3 of the stabilization plan: every response carries an X-Request-ID,
valid inbound IDs are preserved, invalid ones are replaced, application log
records share the same ID, concurrent requests never leak IDs into each
other, and the 500 handler never exposes internals to browsers or API
clients.
"""
import logging
import threading
import uuid
from uuid import UUID

import pytest
from flask import current_app, g

from app import db
from models import User
from services.request_context import REQUEST_ID_HEADER, get_request_id

SENSITIVE_MARKER = "password=hunter2"
SENSITIVE_PATH = "/secret/sensitive/path"
DB_CANARY_EMAIL = "canary-rollback@example.com"
DB_RECOVERY_EMAIL = "session-recovered@example.com"


def _make_user(email):
    user = User(email=email, email_verified=True)
    user.set_password("password123")
    return user


def _register_test_routes(app):
    """Register synthetic routes used only by these tests."""
    if getattr(app, "_request_correlation_routes", False):
        return

    @app.get("/__test__/warning")
    def _test_warning():
        current_app.logger.warning("synthetic warning for correlation test")
        return {"ok": True}

    @app.get("/__test__/boom")
    def _test_boom():
        raise RuntimeError(
            f"synthetic failure with {SENSITIVE_MARKER} at {SENSITIVE_PATH}"
        )

    @app.get("/__test__/db_boom")
    def _test_db_boom():
        db.session.add(_make_user(DB_CANARY_EMAIL))
        db.session.flush()  # succeeds, row pending in the transaction
        db.session.add(_make_user(DB_CANARY_EMAIL))
        db.session.flush()  # IntegrityError: UNIQUE constraint failed

    app._request_correlation_routes = True


@pytest.fixture
def client(app):
    _register_test_routes(app)
    return app.test_client()


def test_response_has_request_id(client):
    response = client.get("/")
    request_id = response.headers[REQUEST_ID_HEADER]
    assert UUID(request_id).version == 4


def test_valid_inbound_request_id_preserved(client):
    inbound = str(uuid.uuid4())
    response = client.get("/", headers={REQUEST_ID_HEADER: inbound})
    assert response.headers[REQUEST_ID_HEADER] == inbound


def test_invalid_inbound_request_id_replaced(client):
    response = client.get("/", headers={REQUEST_ID_HEADER: "not-a-uuid"})
    replaced = response.headers[REQUEST_ID_HEADER]
    assert replaced != "not-a-uuid"
    assert UUID(replaced).version == 4


def test_response_and_log_share_request_id(client, caplog):
    with caplog.at_level(logging.INFO):
        response = client.get("/__test__/warning")
    request_id = response.headers[REQUEST_ID_HEADER]
    assert UUID(request_id).version == 4
    assert any(
        getattr(record, "request_id", None) == request_id
        for record in caplog.records
    )


def test_exception_logged_with_request_id_and_safe_json_error(app, client, caplog):
    app.config["PROPAGATE_EXCEPTIONS"] = False
    with caplog.at_level(logging.INFO):
        response = client.get("/__test__/boom", headers={"Accept": "application/json"})

    assert response.status_code == 500
    request_id = response.headers[REQUEST_ID_HEADER]
    assert UUID(request_id).version == 4

    body = response.get_json()
    assert body["success"] is False
    assert body["request_id"] == request_id

    raw = response.get_data(as_text=True)
    for leaked in ("Traceback", "RuntimeError", SENSITIVE_MARKER, SENSITIVE_PATH, "SELECT"):
        assert leaked not in raw

    error_records = [
        record
        for record in caplog.records
        if getattr(record, "request_id", None) == request_id
        and record.levelno >= logging.ERROR
    ]
    assert error_records, "no error log record carried the response request id"
    assert any(record.exc_info for record in error_records)


def test_exception_page_shows_generic_recovery_guidance(app, client):
    app.config["PROPAGATE_EXCEPTIONS"] = False
    response = client.get("/__test__/boom")  # default accept: HTML

    assert response.status_code == 500
    assert UUID(response.headers[REQUEST_ID_HEADER]).version == 4
    raw = response.get_data(as_text=True)
    assert "went wrong" in raw.lower()
    for leaked in ("Traceback", "RuntimeError", SENSITIVE_MARKER, SENSITIVE_PATH):
        assert leaked not in raw


def test_concurrent_requests_never_share_ids(app, client):
    """Two requests inside their handlers simultaneously must keep their own IDs.

    The barrier makes both handlers run while the other is in flight, so any
    module-global storage of the request id would deterministically clobber
    one of the two responses.
    """
    barrier = threading.Barrier(2)

    @app.get("/__test__/echo")
    def _test_echo():
        barrier.wait(timeout=10)
        return {"request_id": g.request_id}

    inbound = {"a": str(uuid.uuid4()), "b": str(uuid.uuid4())}
    results, errors = {}, {}

    def hit(name):
        try:
            thread_client = app.test_client()
            response = thread_client.get(
                "/__test__/echo", headers={REQUEST_ID_HEADER: inbound[name]}
            )
            results[name] = (
                response.headers[REQUEST_ID_HEADER],
                response.get_json()["request_id"],
            )
        except Exception as exc:  # surface any threaded failure below
            errors[name] = exc

    threads = [threading.Thread(target=hit, args=(name,)) for name in ("a", "b")]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=20)

    assert not errors, f"threaded requests failed: {errors}"
    assert results["a"] == (inbound["a"], inbound["a"])
    assert results["b"] == (inbound["b"], inbound["b"])
    assert results["a"][0] != results["b"][0]


def test_custom_request_id_header_config(app):
    app.config["REQUEST_ID_HEADER"] = "X-Correlation-ID"
    custom_client = app.test_client()
    response = custom_client.get("/")
    assert "X-Correlation-ID" in response.headers
    assert UUID(response.headers["X-Correlation-ID"]).version == 4

    inbound = str(uuid.uuid4())
    preserved = custom_client.get("/", headers={"X-Correlation-ID": inbound})
    assert preserved.headers["X-Correlation-ID"] == inbound


def test_background_tasks_logger_records_carry_request_id(app, caplog):
    """The real named ``background_tasks`` logger must be stamped too.

    Logger-attached filters never run for records that are only *propagated*
    through a logger, so central stamping must happen at record creation.
    """
    from services.background_tasks import logger as background_logger

    with caplog.at_level(logging.INFO, logger=background_logger.name):
        with app.app_context():
            bound = get_request_id()
            background_logger.info("synthetic background log for correlation test")

    matching = [
        record
        for record in caplog.records
        if "synthetic background log" in record.getMessage()
    ]
    assert matching, "background log record was not captured"
    assert all(
        getattr(record, "request_id", None) == bound for record in matching
    )


def test_failed_flush_rolls_back_and_session_recovers(app, client):
    """A real failed flush must be rolled back observably.

    The teardown probe runs while the request's own session is still alive
    (Flask-SQLAlchemy only removes it on teardown_appcontext). Without the
    handler's ``db.session.rollback()`` the failed transaction would make the
    probe's first query raise PendingRollbackError.
    """
    app.config["PROPAGATE_EXCEPTIONS"] = False
    probe = {}

    @app.teardown_request
    def _probe_session_recovery(error):
        try:
            with db.session.no_autoflush:
                probe["canary_count"] = (
                    db.session.query(User).filter_by(email=DB_CANARY_EMAIL).count()
                )
            db.session.add(_make_user(DB_RECOVERY_EMAIL))
            db.session.commit()
            probe["recovered_count"] = (
                db.session.query(User).filter_by(email=DB_RECOVERY_EMAIL).count()
            )
        except Exception as exc:
            probe["error"] = f"{type(exc).__name__}: {exc}"

    response = client.get("/__test__/db_boom", headers={"Accept": "application/json"})

    # Generic, correlated 500 with the exact stable JSON shape and no SQL leak.
    assert response.status_code == 500
    request_id = response.headers[REQUEST_ID_HEADER]
    assert UUID(request_id).version == 4
    body = response.get_json()
    assert set(body) == {"success", "message", "request_id"}
    assert body["success"] is False
    assert body["request_id"] == request_id
    assert body["message"] == "Something went wrong on our end. Please try again later."
    raw = response.get_data(as_text=True)
    for leaked in ("Traceback", "IntegrityError", "UNIQUE", "INSERT", "sqlite3", DB_CANARY_EMAIL):
        assert leaked not in raw

    # Rollback evidence on the request's own session: the successful first
    # insert was undone, and the same session committed new work afterwards.
    assert "error" not in probe, probe.get("error")
    assert probe["canary_count"] == 0
    assert probe["recovered_count"] == 1
