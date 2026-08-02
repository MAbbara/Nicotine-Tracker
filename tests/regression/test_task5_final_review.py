"""Regression coverage for Task 5's final cross-slice review findings."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from unittest.mock import patch

import pytest

from models import Craving, Goal, Log, Pouch, User, UserPreferences
from routes import dashboard as dashboard_routes
from routes import goals as goals_routes
from routes import settings as settings_routes
from routes.goals import calculate_goal_progress
from routes.settings import cleanup_duplicate_logs, recalculate_goal_streaks
from services.enhanced_insights_service import get_enhanced_insights
from services.log_service import assign_log_product
from services.timezone_service import resolve_timezone


def _user(db_session, email, timezone_name='UTC'):
    user = User(email=email, email_verified=True, timezone=timezone_name)
    user.set_password('password123')
    db_session.add(user)
    db_session.commit()
    return user


def _snapshot_log(user_id, when, quantity=1, notes=None, strength='6.00'):
    log = Log(
        user_id=user_id,
        log_time=when,
        log_date=when.date(),
        quantity=quantity,
        notes=notes,
    )
    assign_log_product(
        log,
        custom_brand='Review Brand',
        custom_nicotine_mg=strength,
    )
    return log


def test_duplicate_cleanup_requires_quantity_and_normalized_notes(
        db_session, test_user):
    shared = datetime(2026, 7, 20, 9, 0)
    original = _snapshot_log(test_user.id, shared, quantity=1, notes=' morning ')
    whitespace_duplicate = _snapshot_log(
        test_user.id, shared, quantity=1, notes='morning'
    )
    different_quantity = _snapshot_log(
        test_user.id, shared, quantity=2, notes='morning'
    )
    different_notes = _snapshot_log(
        test_user.id, shared, quantity=1, notes='after lunch'
    )
    db_session.add_all([
        original, whitespace_duplicate, different_quantity, different_notes,
    ])
    db_session.commit()

    removed = cleanup_duplicate_logs(test_user)

    remaining = Log.query.filter_by(user_id=test_user.id).order_by(Log.id).all()
    assert removed == 1
    assert [log.id for log in remaining] == [
        original.id, different_quantity.id, different_notes.id,
    ]


def test_daily_mg_goal_is_incomplete_when_strength_is_unknown(
        db_session, test_user):
    target_day = date(2026, 7, 20)
    goal = Goal(
        user_id=test_user.id,
        goal_type='daily_mg',
        target_value=10,
        start_date=target_day,
        is_active=True,
    )
    unknown = Log(
        user_id=test_user.id,
        log_time=datetime(2026, 7, 20, 12, 0),
        log_date=target_day,
        quantity=1,
        nicotine_mg_snapshot=None,
        custom_nicotine_mg=None,
    )
    db_session.add_all([goal, unknown])
    db_session.commit()

    progress = calculate_goal_progress(test_user, goal, target_day)

    assert progress['current'] == 0
    assert progress['unknown_strength_count'] == 1
    assert progress['achieved'] is None
    assert progress['available'] is False


def test_enhanced_insights_exclude_future_logs(db_session, test_user):
    now = datetime.utcnow()
    past = _snapshot_log(test_user.id, now - timedelta(hours=1), quantity=2)
    future = _snapshot_log(test_user.id, now + timedelta(days=1), quantity=9)
    db_session.add_all([past, future])
    db_session.commit()

    insights = get_enhanced_insights(test_user.id, days=30)

    assert insights['total_pouches'] == 2
    assert insights['total_nicotine'] == 12.0


def test_weekend_only_insights_do_not_divide_by_zero(db_session, test_user):
    # 2026-07-26 is a Sunday and is within the rolling window for this task.
    weekend = _snapshot_log(
        test_user.id, datetime(2026, 7, 26, 12, 0), quantity=2
    )
    db_session.add(weekend)
    db_session.commit()

    insights = get_enhanced_insights(test_user.id, days=30)

    assert insights['total_pouches'] == 2
    assert isinstance(insights['ai_insights'], list)


def test_canonical_pouch_assignment_rejects_another_users_custom_pouch(
        db_session, test_user):
    other = _user(db_session, 'other-pouch-owner@example.com')
    secret = Pouch(
        brand='Other Secret', nicotine_mg=Decimal('12.00'),
        is_default=False, created_by=other.id,
    )
    db_session.add(secret)
    db_session.commit()

    log = Log(user_id=test_user.id, quantity=1, log_time=datetime.utcnow())
    with pytest.raises(ValueError, match='not available'):
        assign_log_product(log, pouch_id=secret.id)


def test_quick_add_hides_another_users_custom_pouch(
        logged_in_client, db_session, test_user):
    other = _user(db_session, 'other-quick-add-owner@example.com')
    secret = Pouch(
        brand='Private Product', nicotine_mg=Decimal('18.00'),
        is_default=False, created_by=other.id,
    )
    db_session.add(secret)
    db_session.commit()

    response = logged_in_client.post(
        '/log/api/quick_add', json={'pouch_id': secret.id, 'quantity': 1}
    )

    payload = response.get_json()
    assert payload['success'] is False
    assert payload['error'] == 'Pouch not found'
    assert 'Private Product' not in response.get_data(as_text=True)
    assert Log.query.filter_by(user_id=test_user.id).count() == 0


def test_settings_brand_choices_are_default_or_owned_only(
        logged_in_client, db_session, test_user):
    other = _user(db_session, 'other-preference-owner@example.com')
    db_session.add_all([
        Pouch(
            brand='Default Visible', nicotine_mg=Decimal('4.00'),
            is_default=True,
        ),
        Pouch(
            brand='Owned Visible', nicotine_mg=Decimal('6.00'),
            is_default=False, created_by=test_user.id,
        ),
        Pouch(
            brand='Other Hidden', nicotine_mg=Decimal('8.00'),
            is_default=False, created_by=other.id,
        ),
    ])
    db_session.commit()
    captured = {}

    def fake_render(_template, **context):
        captured.update(context)
        return ''

    with patch.object(settings_routes, 'render_template', side_effect=fake_render):
        response = logged_in_client.get('/settings/preferences')

    assert response.status_code == 200
    assert captured['available_brands'] == ['Default Visible', 'Owned Visible']


def test_retention_cutoff_is_reset_aware_and_keeps_complete_user_days(
        db_session):
    user = _user(db_session, 'retention-window@example.com', 'America/New_York')
    db_session.add(UserPreferences(
        user_id=user.id, daily_reset_time=time(4, 0)
    ))
    db_session.commit()
    now = datetime(2026, 7, 27, 6, 0, tzinfo=timezone.utc)  # 02:00 EDT

    cutoff = settings_routes._retention_cutoff_utc(user, 30, now)

    # Before the 04:00 reset the active effective day is July 26. Keeping 30
    # inclusive days starts June 27 at 04:00 EDT (08:00 UTC).
    assert cutoff == datetime(2026, 6, 27, 8, 0)


def test_recalculate_streaks_uses_canonical_goal_progress(
        db_session, test_user):
    today = datetime.utcnow().date()
    goal = Goal(
        user_id=test_user.id,
        goal_type='weekly_reduction',
        target_value=10,
        start_date=today,
        is_active=True,
    )
    db_session.add(goal)
    db_session.commit()
    canonical = {
        'achieved': True, 'current': 20, 'target': 10, 'percentage': 200,
    }

    with patch.object(
        Goal, 'check_goal_progress', side_effect=AssertionError('unsafe path')
    ), patch.object(
        goals_routes, 'calculate_goal_progress', return_value=canonical
    ) as calculate:
        updated = recalculate_goal_streaks(test_user)

    assert updated == 1
    assert calculate.called
    assert goal.current_streak == 1
    assert goal.best_streak == 1


def test_current_goal_day_respects_non_midnight_reset(db_session):
    user = _user(db_session, 'goal-effective-day@example.com', 'UTC')
    db_session.add(UserPreferences(
        user_id=user.id, daily_reset_time=time(4, 0)
    ))
    db_session.commit()
    resolved = resolve_timezone(user.timezone)

    effective_day = goals_routes._current_effective_day(
        user,
        resolved,
        datetime(2026, 7, 27, 2, 0, tzinfo=timezone.utc),
    )

    assert effective_day == date(2026, 7, 26)


def test_export_preserves_authoritative_utc_timestamp(
        logged_in_client, db_session, test_user):
    db_session.add(UserPreferences(user_id=test_user.id, preferred_brands=[]))
    log = _snapshot_log(
        test_user.id, datetime(2026, 11, 1, 5, 30), quantity=1
    )
    db_session.add(log)
    db_session.commit()

    response = logged_in_client.post(
        '/settings/data', data={'action': 'export_data'}
    )

    entry = response.get_json()['logs'][0]
    assert entry['log_datetime_utc'] == '2026-11-01T05:30:00+00:00'


def test_statistics_expose_unknown_strength_counts(
        logged_in_client, db_session, test_user):
    now = datetime.utcnow()
    db_session.add(Log(
        user_id=test_user.id,
        log_time=now - timedelta(hours=1),
        log_date=now.date(),
        quantity=1,
        nicotine_mg_snapshot=None,
        custom_nicotine_mg=None,
    ))
    db_session.commit()
    captured = {}

    def fake_render(_template, **context):
        captured.update(context)
        return ''

    with patch.object(settings_routes, 'render_template', side_effect=fake_render):
        response = logged_in_client.get('/settings/statistics')

    assert response.status_code == 200
    stats = captured['stats']
    assert stats['unknown_strength_count'] == 1
    assert stats['week_unknown_strength_count'] == 1
    assert stats['month_unknown_strength_count'] == 1


def test_dashboard_daily_range_is_clamped(
        logged_in_client, test_user):
    empty = {
        'total_pouches': 0,
        'total_mg': 0.0,
        'sessions': 0,
        'unknown_strength_count': 0,
    }
    with patch.object(dashboard_routes, '_day_summary', return_value=empty):
        response = logged_in_client.get(
            '/dashboard/api/daily_intake_chart?days=999'
        )

    assert response.status_code == 200
    assert len(response.get_json()['data']) == 365


def test_dashboard_zero_day_range_defaults_to_one_day(
        logged_in_client, test_user):
    empty = {
        'total_pouches': 0,
        'total_mg': 0.0,
        'sessions': 0,
        'unknown_strength_count': 0,
    }
    with patch.object(dashboard_routes, '_day_summary', return_value=empty):
        response = logged_in_client.get(
            '/dashboard/api/daily_intake_chart?days=0'
        )

    assert response.status_code == 200
    assert len(response.get_json()['data']) == 1
