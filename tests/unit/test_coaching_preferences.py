"""Contracts for durable coaching and shell preferences."""

from datetime import time
from decimal import Decimal

import pytest

from extensions import db
from models import Pouch, User, UserPreferredPouch
from services.preference_service import PreferenceService


def _user(email):
    user = User(email=email, email_verified=True, timezone='UTC')
    user.set_password('password123')
    db.session.add(user)
    db.session.commit()
    return user


def _pouch(brand, owner=None, default=False):
    pouch = Pouch(
        brand=brand,
        nicotine_mg=Decimal('6.00'),
        is_default=default,
        created_by=owner.id if owner else None,
    )
    db.session.add(pouch)
    db.session.commit()
    return pouch


def test_preferences_have_normalized_lists_and_opaque_offline_identity(
        db_session, test_user):
    service = PreferenceService()
    preferences = service.get_or_create_preferences(test_user.id)

    service.update_coaching_context(
        test_user.id,
        difficult_times=['Morning', ' morning ', 'After meals'],
        common_triggers=['Stress', '', 'stress', 'Social'],
    )
    db.session.refresh(preferences)

    assert preferences.difficult_times == ['Morning', 'After meals']
    assert preferences.common_triggers == ['Stress', 'Social']
    assert preferences.offline_queue_enabled is True
    assert len(preferences.offline_queue_id) >= 32


def test_exact_preferred_pouches_are_ranked_and_tenant_scoped(
        db_session, test_user):
    other = _user('preference-other@example.com')
    catalog = _pouch('Catalog', default=True)
    owned = _pouch('Owned', owner=test_user)
    foreign = _pouch('Foreign', owner=other)
    service = PreferenceService()

    rows = service.replace_preferred_pouches(
        test_user.id, [owned.id, catalog.id]
    )

    assert [(row.pouch_id, row.rank) for row in rows] == [
        (owned.id, 0), (catalog.id, 1),
    ]
    with pytest.raises(ValueError, match='not available'):
        service.replace_preferred_pouches(test_user.id, [foreign.id])


def test_removing_preferred_pouch_compacts_ranks(db_session, test_user):
    first = _pouch('First', owner=test_user)
    second = _pouch('Second', owner=test_user)
    third = _pouch('Third', owner=test_user)
    service = PreferenceService()
    service.replace_preferred_pouches(
        test_user.id, [first.id, second.id, third.id]
    )

    service.remove_preferred_pouch(test_user.id, second.id)

    rows = UserPreferredPouch.query.filter_by(
        user_id=test_user.id
    ).order_by(UserPreferredPouch.rank).all()
    assert [(row.pouch_id, row.rank) for row in rows] == [
        (first.id, 0), (third.id, 1),
    ]


def test_theme_accepts_only_light_dark_or_system(db_session, test_user):
    service = PreferenceService()
    assert service.set_theme(test_user.id, 'dark').theme == 'dark'
    assert service.set_theme(test_user.id, 'system').theme == 'system'
    with pytest.raises(ValueError, match='theme'):
        service.set_theme(test_user.id, 'auto')


def test_day_boundary_applies_immediately_without_active_plan(
        db_session, test_user):
    service = PreferenceService()

    preferences = service.update_day_boundary(
        test_user.id, 'America/New_York', '04:30'
    )

    assert test_user.timezone == 'America/New_York'
    assert preferences.daily_reset_time == time(4, 30)
    assert preferences.pending_timezone is None
    assert preferences.pending_daily_reset_time is None
    assert preferences.boundary_change_effective_at_utc is None
    assert preferences.boundary_change_target_local_date is None
