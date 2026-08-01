"""Task 5 final service fixes: tenant-scoped pouches, single timezone
resolution, half-open rolling windows excluding future events, and
weekend-only insight safety.

RED-GREEN-REFACTOR: every test here fails against the pre-fix services.
"""
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch

import pytest

from extensions import db
from models import Craving, Log, Pouch, User
from services import log_service
from services.log_service import add_bulk_logs, add_log_entry, assign_log_product
from services.craving_service import (
    get_comprehensive_craving_analytics,
    get_craving_patterns_by_time_of_day,
    get_trigger_analysis,
    get_user_cravings,
)
from services.enhanced_insights_service import get_enhanced_insights


def _make_user(email, timezone='UTC'):
    user = User(email=email, email_verified=True, timezone=timezone)
    user.set_password('password123')
    db.session.add(user)
    db.session.commit()
    return user


def _make_pouch(brand, nicotine_mg, is_default=False, created_by=None):
    pouch = Pouch(
        brand=brand,
        nicotine_mg=Decimal(str(nicotine_mg)),
        is_default=is_default,
        created_by=created_by,
    )
    db.session.add(pouch)
    db.session.commit()
    return pouch


# --- Fix 1: tenant-scoped pouch assignment ---------------------------------


def test_assign_log_product_rejects_other_users_custom_pouch(db_session, test_user):
    stranger = _make_user('stranger@example.com')
    foreign = _make_pouch('Foreign Brand', 6, is_default=False, created_by=stranger.id)

    log = Log(user_id=test_user.id, quantity=1, log_time=datetime(2025, 3, 10, 8, 0))
    with pytest.raises(ValueError):
        assign_log_product(log, pouch_id=foreign.id)


def test_assign_log_product_allows_default_pouch_for_any_user(db_session, test_user):
    default_pouch = _make_pouch('Catalog Brand', 4, is_default=True, created_by=None)

    log = Log(user_id=test_user.id, quantity=1, log_time=datetime(2025, 3, 10, 8, 0))
    assign_log_product(log, pouch_id=default_pouch.id)

    assert log.pouch_id == default_pouch.id
    assert log.product_brand_snapshot == 'Catalog Brand'


def test_assign_log_product_allows_own_custom_pouch(db_session, test_user):
    own = _make_pouch('Mine', 8, is_default=False, created_by=test_user.id)

    log = Log(user_id=test_user.id, quantity=1, log_time=datetime(2025, 3, 10, 8, 0))
    assign_log_product(log, pouch_id=own.id)

    assert log.pouch_id == own.id


def test_add_bulk_logs_does_not_match_other_users_custom_pouch(db_session, test_user):
    stranger = _make_user('bulk-stranger@example.com')
    foreign = _make_pouch('Shared Name', 6, is_default=False, created_by=stranger.id)

    created = add_bulk_logs(
        user_id=test_user.id,
        entries=[{'time': time(9, 0), 'quantity': 1, 'brand': 'Shared Name', 'nicotine_mg': '6'}],
        log_date=date(2025, 3, 10),
        user_timezone='UTC',
    )

    assert created == 1
    log = Log.query.filter_by(user_id=test_user.id).one()
    assert log.pouch_id != foreign.id
    # Unmatched within the tenant scope: preserved as a custom product.
    assert log.custom_brand == 'Shared Name'


def test_add_bulk_logs_matches_default_pouch(db_session, test_user):
    default_pouch = _make_pouch('Bulk Catalog', 3, is_default=True, created_by=None)

    add_bulk_logs(
        user_id=test_user.id,
        entries=[{'time': time(9, 0), 'quantity': 1, 'brand': 'Bulk Catalog', 'nicotine_mg': '3'}],
        log_date=date(2025, 3, 10),
        user_timezone='UTC',
    )

    log = Log.query.filter_by(user_id=test_user.id).one()
    assert log.pouch_id == default_pouch.id


# --- Fix 2: one timezone resolution per operation --------------------------


def test_add_log_entry_resolves_timezone_once(db_session, test_user):
    with patch('services.log_service.resolve_timezone',
               wraps=log_service.resolve_timezone) as spy:
        add_log_entry(
            user_id=test_user.id,
            log_date=date(2025, 3, 10),
            log_time=time(9, 30),
            quantity=1,
            user_timezone='America/New_York',
        )
    assert spy.call_count == 1


def test_add_bulk_logs_resolves_timezone_once_for_many_entries(db_session, test_user):
    entries = [
        {'time': time(8, 0), 'quantity': 1},
        {'time': time(12, 0), 'quantity': 2},
        {'time': time(18, 0), 'quantity': 1},
    ]
    with patch('services.log_service.resolve_timezone',
               wraps=log_service.resolve_timezone) as spy:
        created = add_bulk_logs(
            user_id=test_user.id,
            entries=entries,
            log_date=date(2025, 3, 10),
            user_timezone='America/New_York',
        )
    assert created == 3
    assert spy.call_count == 1


# --- Fix 3: enhanced insights exclude future logs, weekend-only safe -------


def test_enhanced_insights_excludes_future_logs(db_session, test_user):
    future = Log(
        user_id=test_user.id,
        quantity=5,
        log_time=datetime.utcnow() + timedelta(days=1),
    )
    db.session.add(future)
    db.session.commit()

    insights = get_enhanced_insights(test_user.id, days=30)
    assert insights['total_pouches'] == 0


def test_enhanced_insights_weekend_only_data_does_not_divide_by_zero(db_session, test_user):
    now = datetime.utcnow()
    weekend_day = now.date() - timedelta(days=1)
    while weekend_day.weekday() < 5:
        weekend_day -= timedelta(days=1)
    # Both events are recent weekend data; no weekday baseline exists.
    for hour in (10, 15):
        db.session.add(Log(
            user_id=test_user.id,
            quantity=3,
            log_time=datetime.combine(weekend_day, time(hour, 0)),
        ))
    db.session.commit()

    insights = get_enhanced_insights(test_user.id, days=30)
    assert insights['total_pouches'] == 6
    # No ZeroDivisionError and no nonsense weekend comparison insight.
    for insight in insights['ai_insights']:
        assert insight['title'] != 'Weekend Pattern'


# --- Fix 4: craving rolling analytics exclude future events ----------------


def _add_craving(user_id, craving_time, intensity=5, trigger='stress', outcome='resisted'):
    craving = Craving(
        user_id=user_id,
        intensity=intensity,
        trigger=trigger,
        outcome=outcome,
        craving_time=craving_time,
    )
    db.session.add(craving)
    db.session.commit()
    return craving


def test_craving_time_of_day_excludes_future_events(db_session, test_user):
    _add_craving(test_user.id, datetime.utcnow() - timedelta(hours=2))
    _add_craving(test_user.id, datetime.utcnow() + timedelta(days=1), intensity=9)

    patterns = get_craving_patterns_by_time_of_day(test_user.id, days=30)
    assert sum(patterns.values()) == 1


def test_craving_trigger_analysis_excludes_future_events(db_session, test_user):
    _add_craving(test_user.id, datetime.utcnow() - timedelta(hours=2), trigger='past')
    _add_craving(test_user.id, datetime.utcnow() + timedelta(days=1), trigger='future')

    analysis = get_trigger_analysis(test_user.id, days=30)
    assert 'past' in analysis
    assert 'future' not in analysis


def test_get_user_cravings_excludes_future_events(db_session, test_user):
    _add_craving(test_user.id, datetime.utcnow() - timedelta(hours=2))
    _add_craving(test_user.id, datetime.utcnow() + timedelta(days=1))

    cravings = get_user_cravings(test_user.id, days=30)
    assert len(cravings) == 1


def test_comprehensive_craving_analytics_excludes_future_events(db_session, test_user):
    _add_craving(test_user.id, datetime.utcnow() - timedelta(hours=2), trigger='past')
    _add_craving(test_user.id, datetime.utcnow() + timedelta(days=1), trigger='future', intensity=9)

    analytics = get_comprehensive_craving_analytics(test_user.id, days=30)
    assert sum(analytics['time_patterns'].values()) == 1
    assert sum(analytics['day_patterns'].values()) == 1
    assert 'future' not in analytics['trigger_analysis']
    assert analytics['consumption_correlation']['total_cravings'] == 1
