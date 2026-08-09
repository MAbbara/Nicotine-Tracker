"""Portable atomic notification claim and crash-recovery contracts."""

from datetime import datetime, timedelta
import os
import threading

import pytest
from app import create_app
from config import TestingConfig
from extensions import db
from models import User
from models.notification import NotificationHistory, NotificationQueue
from services.notification_service import NotificationService


def _pending(db_session, test_user, *, category="daily_reminder"):
    row = NotificationQueue(
        user_id=test_user.id,
        notification_type="email",
        category=category,
        subject="Reminder",
        message="Body",
        recipient=test_user.email,
        scheduled_for=datetime(2030, 1, 1, 8, 0),
    )
    db_session.add(row)
    db_session.commit()
    return row


def test_atomic_claim_allows_only_one_worker_owner(
        app, db_session, test_user):
    row = _pending(db_session, test_user)
    now = datetime(2030, 1, 1, 9, 0)

    first = NotificationService()._claim_notifications(
        owner="worker-a", now_utc=now, limit=10,
    )
    second = NotificationService()._claim_notifications(
        owner="worker-b", now_utc=now, limit=10,
    )

    assert first == [row.id]
    assert second == []
    db_session.refresh(row)
    assert row.status == "processing"
    assert row.claim_owner == "worker-a"
    assert row.claimed_at == now
    assert row.delivery_started_at is None


def test_stale_claim_before_transport_is_recovered_once(
        app, db_session, test_user):
    row = _pending(db_session, test_user)
    service = NotificationService()
    service._claim_notifications(
        owner="crashed-before", now_utc=datetime(2030, 1, 1, 9, 0), limit=1,
    )

    recovered = service._claim_notifications(
        owner="recovery", now_utc=datetime(2030, 1, 1, 9, 6), limit=1,
    )
    assert recovered == [row.id]
    db_session.refresh(row)
    assert row.claim_owner == "recovery"


def test_stale_claim_after_transport_start_is_never_redelivered(
        app, db_session, test_user, monkeypatch):
    row = _pending(db_session, test_user)
    service = NotificationService()
    service._claim_notifications(
        owner="crashed-after", now_utc=datetime(2030, 1, 1, 9, 0), limit=1,
    )
    assert service._mark_delivery_started(
        row.id, "crashed-after", datetime(2030, 1, 1, 9, 0, 1)
    )
    sends = []
    monkeypatch.setitem(service.send_handlers, "email", lambda notification: sends.append(notification.id) or True)

    processed = service.process_notification_queue(
        now_utc=datetime(2030, 1, 1, 9, 6), owner="recovery",
    )

    assert processed == 0
    assert sends == []
    db_session.refresh(row)
    assert row.status == "failed"
    assert row.error_message == "delivery outcome unknown after worker lease expired"
    assert row.attempts == 1


def test_legacy_processing_row_without_lease_is_quarantined_not_claimed(
        app, db_session, test_user, monkeypatch):
    row = _pending(db_session, test_user, category='password_reset')
    row.notification_type = 'discord'
    row.status = 'processing'
    row.claim_owner = None
    row.claimed_at = None
    row.delivery_started_at = None
    row.recipient = 'https://discord.com/api/webhooks/123/raw-reset-token'
    row.message = 'https://local/reset/raw-reset-token'
    db_session.commit()
    sends = []
    service = NotificationService()
    monkeypatch.setitem(
        service.send_handlers, 'discord',
        lambda notification: sends.append(notification.id) or True,
    )

    assert service.process_notification_queue(
        now_utc=datetime(2030, 1, 1, 9, 0), owner='worker-a',
    ) == 0

    db_session.refresh(row)
    assert sends == []
    assert row.status == 'failed'
    assert row.recipient == '[scrubbed-after-delivery-start]'
    assert 'raw-reset-token' not in (row.error_message or '')
    history = NotificationHistory.query.filter_by(
        original_queue_id=row.id
    ).one()
    assert history.delivery_status == 'failed'
    assert 'raw-reset-token' not in history.recipient


def test_worker_that_loses_lease_during_transport_cannot_finalize(
        app, db_session, test_user, monkeypatch):
    row = _pending(db_session, test_user)
    service = NotificationService()
    recovery = NotificationService()
    sends = []

    def held_transport(notification):
        sends.append(notification.id)
        assert recovery._claim_notifications(
            owner='recovery', now_utc=datetime(2030, 1, 1, 9, 6), limit=1,
        ) == []
        return True

    monkeypatch.setitem(service.send_handlers, 'email', held_transport)

    assert service.process_notification_queue(
        now_utc=datetime(2030, 1, 1, 9, 0), owner='expired-owner',
    ) == 1

    db_session.expire_all()
    terminal = db.session.get(NotificationQueue, row.id)
    assert sends == [row.id]
    assert terminal.status == 'failed'
    assert terminal.error_message == (
        'delivery outcome unknown after worker lease expired'
    )
    histories = NotificationHistory.query.filter_by(
        original_queue_id=row.id
    ).all()
    assert len(histories) == 1
    assert histories[0].delivery_status == 'failed'


def test_legacy_credential_discord_row_is_quarantined_without_transport(
        app, db_session, test_user, monkeypatch, caplog):
    row = _pending(db_session, test_user, category='password_reset')
    row.notification_type = 'discord'
    row.recipient = 'https://discord.com/api/webhooks/123/raw-reset-token'
    row.message = 'https://local/reset/raw-reset-token'
    db_session.commit()
    sends = []
    service = NotificationService()
    monkeypatch.setitem(
        service.send_handlers, 'discord',
        lambda notification: sends.append(notification.id) or True,
    )

    assert service.process_notification_queue(
        now_utc=datetime(2030, 1, 1, 9, 0), owner='worker-a',
    ) == 1

    assert sends == []
    assert db.session.get(NotificationQueue, row.id) is None
    history = NotificationHistory.query.filter_by(
        original_queue_id=row.id
    ).one()
    assert history.delivery_status == 'failed'
    assert history.notification_type == 'discord'
    assert history.recipient == '[scrubbed-after-delivery-start]'
    assert 'raw-reset-token' not in caplog.text


def test_two_workers_cannot_send_the_same_claimed_row(
        app, db_session, test_user, monkeypatch):
    row = _pending(db_session, test_user)
    sends = []
    first = NotificationService()
    second = NotificationService()
    monkeypatch.setitem(first.send_handlers, "email", lambda notification: sends.append(("a", notification.id)) or True)
    monkeypatch.setitem(second.send_handlers, "email", lambda notification: sends.append(("b", notification.id)) or True)

    assert first.process_notification_queue(
        now_utc=datetime(2030, 1, 1, 9, 0), owner="worker-a",
    ) == 1
    assert second.process_notification_queue(
        now_utc=datetime(2030, 1, 1, 9, 0), owner="worker-b",
    ) == 0
    assert sends == [("a", row.id)]


def test_transport_failure_is_at_most_once_and_never_automatically_retried(
        app, db_session, test_user, monkeypatch):
    row = _pending(db_session, test_user)
    row_id = row.id
    sends = []
    service = NotificationService()
    monkeypatch.setitem(
        service.send_handlers, 'email',
        lambda notification: sends.append(notification.id) or False,
    )

    assert service.process_notification_queue(
        now_utc=datetime(2030, 1, 1, 9, 0), owner='worker-a',
    ) == 1
    assert service.process_notification_queue(
        now_utc=datetime(2030, 1, 2, 9, 0), owner='worker-b',
    ) == 0
    assert sends == [row_id]
    assert db.session.get(NotificationQueue, row_id) is None


def test_concurrent_sqlite_workers_obtain_one_exclusive_claim(
        tmp_path, monkeypatch):
    database = tmp_path / "notification-claims.db"
    monkeypatch.setattr(
        TestingConfig, "SQLALCHEMY_DATABASE_URI", f"sqlite:///{database}"
    )
    claim_app = create_app("testing")
    with claim_app.app_context():
        db.create_all()
        user = User(email="claim-race@example.com", timezone="UTC")
        user.set_password("password123")
        db.session.add(user)
        db.session.flush()
        row = NotificationQueue(
            user_id=user.id, notification_type="email",
            category="daily_reminder", subject="Reminder", message="Body",
            recipient=user.email, scheduled_for=datetime(2030, 1, 1, 8, 0),
        )
        db.session.add(row)
        db.session.commit()
        row_id = row.id

    barrier = threading.Barrier(2)
    claims = {}

    def compete(owner):
        with claim_app.app_context():
            barrier.wait()
            claims[owner] = NotificationService()._claim_notifications(
                owner=owner, now_utc=datetime(2030, 1, 1, 9, 0), limit=1,
            )

    threads = [
        threading.Thread(target=compete, args=(owner,))
        for owner in ("worker-a", "worker-b")
    ]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=5)
        assert not thread.is_alive()

    assert sorted(claims.values(), key=len) == [[], [row_id]]
    with claim_app.app_context():
        claimed = db.session.get(NotificationQueue, row_id)
        assert claimed.status == "processing"
        assert claimed.claim_owner in {"worker-a", "worker-b"}
        db.session.remove()


def _verified_claim_mysql_engine(pytestconfig):
    """Use the release gate's single fail-hard MySQL authority."""
    selected = (
        pytestconfig.getoption('--db') == 'mysql'
        or bool(os.environ.get('TEST_MYSQL_URL'))
    )
    if not selected:
        pytest.skip(
            'MySQL claim concurrency requires --db=mysql or TEST_MYSQL_URL'
        )
    from tests.migrations import harness
    return harness.create_verified_mysql_engine()


def test_mysql_claim_gate_rejects_sqlite_url(monkeypatch):
    from tests.migrations import harness
    monkeypatch.setenv('TEST_MYSQL_URL', 'sqlite:///:memory:')

    with pytest.raises(RuntimeError, match=r'mysql\+pymysql dialect'):
        harness.create_verified_mysql_engine()


def test_mysql_claim_gate_propagates_mariadb_refusal(monkeypatch):
    from tests.migrations import harness

    class SelectedMySQL:
        @staticmethod
        def getoption(_name):
            return 'mysql'

    monkeypatch.setattr(
        harness, 'create_verified_mysql_engine',
        lambda: (_ for _ in ()).throw(
            RuntimeError('MariaDB is not supported by this gate')
        ),
    )
    with pytest.raises(RuntimeError, match='MariaDB is not supported'):
        _verified_claim_mysql_engine(SelectedMySQL())


def test_concurrent_mysql_workers_claim_and_finalize_once(
        pytestconfig, monkeypatch):
    from tests.migrations import harness
    preflight_engine = _verified_claim_mysql_engine(pytestconfig)
    database_url = preflight_engine.url.render_as_string(hide_password=False)
    monkeypatch.setattr(
        TestingConfig, 'SQLALCHEMY_DATABASE_URI', database_url
    )
    claim_app = create_app('testing')
    app_engine = None
    try:
        with claim_app.app_context():
            app_engine = db.engine
            db.create_all()
            user = User(email='mysql-claim@example.com', timezone='UTC')
            user.set_password('password123')
            db.session.add(user)
            db.session.flush()
            row = NotificationQueue(
                user_id=user.id, notification_type='email',
                category='daily_reminder', subject='Reminder', message='Body',
                recipient=user.email,
                scheduled_for=datetime(2030, 1, 1, 8, 0),
            )
            db.session.add(row)
            db.session.commit()
            row_id = row.id

        barrier = threading.Barrier(2)
        lock = threading.Lock()
        sends = []
        results = []

        def record_send(notification):
            with lock:
                sends.append(notification.id)
            return True

        def compete(owner):
            with claim_app.app_context():
                service = NotificationService()
                service.send_handlers['email'] = record_send
                barrier.wait()
                result = service.process_notification_queue(
                    now_utc=datetime(2030, 1, 1, 9, 0), owner=owner,
                )
                with lock:
                    results.append(result)
                db.session.remove()

        threads = [
            threading.Thread(target=compete, args=(owner,))
            for owner in ('mysql-worker-a', 'mysql-worker-b')
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=15)
            assert not thread.is_alive()

        assert sorted(results) == [0, 1]
        assert sends == [row_id]
        with claim_app.app_context():
            assert db.session.get(NotificationQueue, row_id) is None
            histories = NotificationHistory.query.filter_by(
                original_queue_id=row_id
            ).all()
            assert len(histories) == 1
            assert histories[0].delivery_status == 'sent'
    finally:
        with claim_app.app_context():
            db.session.remove()
        try:
            if app_engine is not None:
                harness.cleanup_mysql_engine(app_engine)
                with preflight_engine.connect() as connection:
                    harness.assert_mysql_schema_empty(connection)
        finally:
            preflight_engine.dispose()
