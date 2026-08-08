"""Scheduled goal evaluation uses shared reset-aware evidence semantics."""

from datetime import datetime, time, timedelta, timezone
import threading

import pytest
from sqlalchemy import event
from sqlalchemy.orm import Session
from models import (
    DailyCheckIn, Goal, Log, NotificationQueue, User, UserPreferences,
)
from services.background_tasks import BackgroundTaskProcessor
import services.background_tasks as background_tasks
from services.notification_service import NotificationService
from extensions import db


class _FrozenScheduledDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        instant = cls(2030, 1, 14, 12, 0, tzinfo=timezone.utc)
        return instant if tz is None else instant.astimezone(tz)

    @classmethod
    def utcnow(cls):
        return cls(2030, 1, 14, 12, 0)


def _notifications_enabled(db_session, user, *, reset=time.min):
    preferences = UserPreferences(
        user_id=user.id,
        notification_channel=['email'],
        goal_notifications=True,
        daily_reset_time=reset,
    )
    db_session.add(preferences)
    return preferences


def test_scheduled_daily_threshold_uses_one_reset_aware_captured_instant(
        app, db_session, test_user, monkeypatch):
    test_user.timezone = 'America/Los_Angeles'
    _notifications_enabled(db_session, test_user, reset=time(4))
    goal = Goal(
        user_id=test_user.id,
        goal_type='daily_pouches',
        target_value=10,
        start_date=datetime(2030, 1, 13).date(),
        is_active=True,
        enable_notifications=True,
        notification_threshold=.8,
    )
    # 2030-01-14 10:30 UTC is 02:30 in Los Angeles and therefore still the
    # reset-aware account day 2030-01-13.
    log = Log(
        user_id=test_user.id,
        quantity=8,
        log_time=datetime(2030, 1, 14, 1, 0),
        nicotine_mg_snapshot=4,
        product_brand_snapshot='Reset-aware day',
    )
    db_session.add_all([goal, log])
    db_session.commit()

    class BeforeResetDateTime(_FrozenScheduledDateTime):
        @classmethod
        def now(cls, tz=None):
            instant = cls(2030, 1, 14, 10, 30, tzinfo=timezone.utc)
            return instant if tz is None else instant.astimezone(tz)

        @classmethod
        def utcnow(cls):
            return cls(2030, 1, 14, 10, 30)

    monkeypatch.setattr(background_tasks, 'datetime', BeforeResetDateTime)

    BackgroundTaskProcessor(app).check_goal_thresholds()

    queued = NotificationQueue.query.filter_by(
        user_id=test_user.id, category='goal_reminder'
    ).one()
    assert queued.extra_data['goal_type'] == 'daily_pouches'
    assert queued.extra_data['current'] == 8
    assert queued.extra_data['target'] == 10
    assert 'today is at 80%' in queued.message.casefold()


def test_scheduled_weekly_threshold_uses_latest_completed_week_and_constructive_copy(
        app, db_session, test_user, monkeypatch):
    _notifications_enabled(db_session, test_user)
    baseline_monday = datetime(2030, 1, 1).date()
    comparison_monday = datetime(2030, 1, 7).date()
    goal = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=20,
        start_date=baseline_monday,
        is_active=True,
        enable_notifications=True,
        notification_threshold=.8,
    )
    db_session.add_all([
        goal,
        Log(
            user_id=test_user.id,
            quantity=10,
            log_time=datetime.combine(baseline_monday, time(12)),
            nicotine_mg_snapshot=4,
            product_brand_snapshot='Baseline',
        ),
        Log(
            user_id=test_user.id,
            quantity=2,
            log_time=datetime.combine(comparison_monday, time(12)),
            nicotine_mg_snapshot=4,
            product_brand_snapshot='Comparison',
        ),
    ])
    db_session.commit()
    monkeypatch.setattr(background_tasks, 'datetime', _FrozenScheduledDateTime)

    BackgroundTaskProcessor(app).check_goal_thresholds()

    queued = NotificationQueue.query.filter_by(
        user_id=test_user.id, category='goal_reminder'
    ).one()
    assert queued.extra_data['goal_type'] == 'weekly_reduction'
    assert queued.extra_data['current'] == 80
    assert 'latest completed week' in queued.message.casefold()
    assert 'exceeded' not in queued.message.casefold()
    assert 'stay mindful' not in queued.message.casefold()


def test_scheduled_weekly_threshold_skips_silent_comparison_week(
        app, db_session, test_user, monkeypatch):
    _notifications_enabled(db_session, test_user)
    baseline_monday = datetime(2030, 1, 1).date()
    goal = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=20,
        start_date=baseline_monday,
        is_active=True,
        enable_notifications=True,
        notification_threshold=.8,
    )
    db_session.add_all([
        goal,
        Log(
            user_id=test_user.id,
            quantity=10,
            log_time=datetime.combine(baseline_monday, time(12)),
            nicotine_mg_snapshot=4,
            product_brand_snapshot='Baseline',
        ),
    ])
    db_session.commit()
    monkeypatch.setattr(background_tasks, 'datetime', _FrozenScheduledDateTime)

    BackgroundTaskProcessor(app).check_goal_thresholds()

    assert NotificationQueue.query.filter_by(
        user_id=test_user.id, category='goal_reminder'
    ).count() == 0


def test_scheduled_weekly_reports_share_one_captured_utc_instant(
        app, db_session, test_user, monkeypatch):
    _notifications_enabled(db_session, test_user)
    test_user.preferences.weekly_reports = True
    second = User(
        email='second-report@example.com',
        email_verified=True,
        timezone='Asia/Riyadh',
    )
    second.set_password('password123')
    db_session.add(second)
    db_session.flush()
    second_preferences = _notifications_enabled(db_session, second)
    second_preferences.weekly_reports = True
    db_session.commit()
    monkeypatch.setattr(background_tasks, 'datetime', _FrozenScheduledDateTime)
    processor = BackgroundTaskProcessor(app)
    captured = []

    def record(user, now_utc=None):
        captured.append((user.id, now_utc))
        return True

    monkeypatch.setattr(processor, '_send_weekly_report', record)

    processor.send_weekly_reports()

    assert {user_id for user_id, _instant in captured} == {
        test_user.id, second.id
    }
    assert {instant for _user_id, instant in captured} == {
        datetime(2030, 1, 14, 12, 0, tzinfo=timezone.utc)
    }


def test_weekly_report_replay_returns_same_rows_per_channel_and_period(
        app, db_session, test_user):
    preferences = _notifications_enabled(db_session, test_user)
    preferences.weekly_reports = True
    preferences.notification_channel = ['email', 'discord']
    preferences.discord_webhook = (
        'https://discord.com/api/webhooks/example/test-token'
    )
    db_session.commit()
    instant = datetime(2030, 1, 14, 12, 0, tzinfo=timezone.utc)
    service = NotificationService()

    first = service.queue_weekly_report(test_user, now_utc=instant)
    replay = service.queue_weekly_report(test_user, now_utc=instant)

    assert [row.id for row in replay] == [row.id for row in first]
    assert {row.notification_type for row in first} == {'email', 'discord'}
    assert {row.report_period_start.isoformat() for row in first} == {
        '2030-01-07'
    }
    assert len({row.idempotency_key for row in first}) == 2
    assert NotificationQueue.query.filter_by(
        user_id=test_user.id, category='weekly_report'
    ).count() == 2


def test_manual_and_scheduled_weekly_report_attempts_converge(
        app, db_session, test_user):
    preferences = _notifications_enabled(db_session, test_user)
    preferences.weekly_reports = True
    db_session.commit()
    instant = datetime(2030, 1, 14, 12, 0, tzinfo=timezone.utc)
    service = NotificationService()
    processor = BackgroundTaskProcessor(app)
    processor.notification_service = service

    manual = service.queue_weekly_report(test_user, now_utc=instant)
    scheduled = processor._send_weekly_report(test_user, now_utc=instant)

    assert scheduled
    rows = NotificationQueue.query.filter_by(
        user_id=test_user.id, category='weekly_report'
    ).all()
    assert [row.id for row in rows] == [row.id for row in manual]


def test_concurrent_weekly_report_sessions_return_one_stable_channel_row(
        app, db_session, test_user):
    if db.engine.dialect.name != 'mysql':
        pytest.skip('MySQL unique-conflict mapping is exercised by --db=mysql')
    preferences = _notifications_enabled(db_session, test_user)
    preferences.weekly_reports = True
    db_session.commit()
    user_id = test_user.id
    instant = datetime(2030, 1, 14, 12, 0, tzinfo=timezone.utc)
    ready_to_flush = threading.Barrier(2)
    results = []
    errors = []

    def synchronize_weekly_flush(session, _flush_context, _instances):
        if any(
            isinstance(row, NotificationQueue)
            and row.category == 'weekly_report'
            for row in session.new
        ):
            ready_to_flush.wait(timeout=10)

    def attempt():
        try:
            with app.app_context():
                user = db.session.get(User, user_id)
                rows = NotificationService().queue_weekly_report(
                    user, now_utc=instant
                )
                results.append([row.id for row in rows] if rows else rows)
                db.session.remove()
        except Exception as exc:  # asserted empty below
            errors.append(exc)

    event.listen(Session, 'before_flush', synchronize_weekly_flush)
    try:
        workers = [threading.Thread(target=attempt) for _ in range(2)]
        for worker in workers:
            worker.start()
        for worker in workers:
            worker.join(timeout=20)
        assert all(not worker.is_alive() for worker in workers)
    finally:
        event.remove(Session, 'before_flush', synchronize_weekly_flush)

    assert errors == []
    assert results[0] == results[1]
    assert len(results[0]) == 1
    db.session.rollback()
    assert NotificationQueue.query.filter_by(
        user_id=user_id, category='weekly_report'
    ).count() == 1
