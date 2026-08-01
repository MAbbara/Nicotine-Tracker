"""Regression tests for immutable product history.

Every production/service write path must populate the immutable product
snapshots; catalog edits and deletes must never rewrite logged history;
fractional strengths keep full decimal precision; unknown historical data
stays NULL (never zero). All data is fixed and synthetic.
"""
from collections import Counter
from datetime import date, datetime
from decimal import Decimal

import pytest

from app import db
from models import Log, Pouch, UserPreferences
from services import log_service
from services.log_service import assign_log_product, parse_nicotine_strength

FRACTION = Decimal('1.50')
LOG_DATE = date(2025, 1, 5)


@pytest.mark.parametrize(('raw', 'expected'), (
    ('1', Decimal('1.00')),
    ('1.5', Decimal('1.50')),
    ('1.23', Decimal('1.23')),
    ('999999.99', Decimal('999999.99')),
))
def test_parse_nicotine_strength_accepts_decimal_contract(raw, expected):
    assert parse_nicotine_strength(raw) == expected


@pytest.mark.parametrize('raw', (
    '1.230', '1.234',
    'NaN', 'Infinity', '-Infinity',
    '0', '-0.01',
    '1000000',
))
def test_parse_nicotine_strength_rejects_invalid_decimal_contract(raw):
    with pytest.raises(ValueError):
        parse_nicotine_strength(raw)


def test_fractional_pouch_and_custom_log_preserve_decimal(db_session, test_user):
    pouch = Pouch(brand='Frac Brand', nicotine_mg=Decimal('1.5'),
                  is_default=False, created_by=test_user.id)
    db_session.add(pouch)
    db_session.commit()
    db_session.refresh(pouch)
    assert pouch.nicotine_mg == FRACTION

    log = log_service.add_log_entry(
        user_id=test_user.id, log_date=LOG_DATE, log_time=None, quantity=2,
        pouch_id=pouch.id, user_timezone='UTC')
    db_session.refresh(log)
    assert log.product_brand_snapshot == 'Frac Brand'
    assert log.nicotine_mg_snapshot == FRACTION
    assert log.get_nicotine_content() == FRACTION
    assert log.get_total_nicotine() == Decimal('3.00')

    custom = log_service.add_log_entry(
        user_id=test_user.id, log_date=LOG_DATE, log_time=None, quantity=1,
        custom_brand='  Frac Custom  ', custom_nicotine_mg='1.5',
        user_timezone='UTC')
    db_session.refresh(custom)
    assert custom.custom_brand == 'Frac Custom'
    assert custom.custom_nicotine_mg == FRACTION
    assert custom.product_brand_snapshot == 'Frac Custom'
    assert custom.nicotine_mg_snapshot == FRACTION


def test_catalog_accepts_fractional_strength(logged_in_client, db_session, test_user):
    response = logged_in_client.post('/catalog/add', data={
        'brand': 'Frac Cat', 'nicotine_mg': '1.5',
    }, follow_redirects=True)
    assert response.status_code == 200
    pouch = Pouch.query.filter_by(brand='Frac Cat', created_by=test_user.id).first()
    assert pouch is not None, 'fractional pouch was not created'
    assert pouch.nicotine_mg == FRACTION


def test_catalog_api_pouches_preserves_numeric_and_display_contract(
        logged_in_client, db_session, test_user, test_pouch):
    db_session.add(UserPreferences(user_id=test_user.id, preferred_brands=[]))
    db_session.commit()

    response = logged_in_client.get('/catalog/api/pouches')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True
    pouch = next(item for item in payload['pouches'] if item['id'] == test_pouch.id)
    assert isinstance(pouch['nicotine_mg'], (int, float))
    assert pouch['nicotine_mg'] == 4.0
    assert pouch['display_name'] == 'Test Brand (4mg) [Custom]'


def test_editing_pouch_does_not_change_history(logged_in_client, db_session, test_user):
    pouch = Pouch(brand='Edit Brand', nicotine_mg=Decimal('4'),
                  is_default=False, created_by=test_user.id)
    db_session.add(pouch)
    db_session.commit()
    log = log_service.add_log_entry(
        user_id=test_user.id, log_date=LOG_DATE, log_time=None, quantity=2,
        pouch_id=pouch.id, user_timezone='UTC')

    response = logged_in_client.post(f'/catalog/edit/{pouch.id}', data={
        'brand': 'Renamed', 'nicotine_mg': '9',
    }, follow_redirects=True)
    assert response.status_code == 200

    db_session.expire_all()
    historical = db_session.get(Log, log.id)
    assert historical.get_brand_name() == 'Edit Brand'
    assert historical.get_nicotine_content() == Decimal('4.00')
    assert historical.get_total_nicotine() == Decimal('8.00')


def test_deleting_owned_pouch_preserves_history(logged_in_client, db_session, test_user):
    pouch = Pouch(brand='Del Brand', nicotine_mg=Decimal('3'),
                  is_default=False, created_by=test_user.id)
    db_session.add(pouch)
    db_session.commit()
    log = log_service.add_log_entry(
        user_id=test_user.id, log_date=LOG_DATE, log_time=None, quantity=2,
        pouch_id=pouch.id, user_timezone='UTC')

    response = logged_in_client.post(f'/catalog/delete/{pouch.id}',
                                     follow_redirects=True)
    assert response.status_code == 200
    assert db_session.get(Pouch, pouch.id) is None, 'pouch was not deleted'

    db_session.expire_all()
    historical = db_session.get(Log, log.id)
    assert historical.pouch_id is None, 'FK did not ON DELETE SET NULL'
    assert historical.product_brand_snapshot == 'Del Brand'
    assert historical.nicotine_mg_snapshot == Decimal('3.00')
    assert historical.get_brand_name() == 'Del Brand'
    assert historical.get_total_nicotine() == Decimal('6.00')


def test_every_write_path_populates_snapshots(logged_in_client, db_session,
                                              test_user, test_pouch):
    # /api/quick_add — a client-supplied strength must never be trusted.
    response = logged_in_client.post('/api/quick_add', json={
        'pouch_id': test_pouch.id, 'quantity': 1, 'nicotine_mg': 99,
    })
    assert response.status_code == 200
    assert response.get_json()['success'] is True

    # /log/api/quick_add
    response = logged_in_client.post('/log/api/quick_add', json={
        'pouch_id': test_pouch.id, 'quantity': 1,
    })
    assert response.get_json()['success'] is True

    # form /log/add with a selected pouch
    response = logged_in_client.post('/log/add', data={
        'log_date': '2025-01-05', 'pouch_id': str(test_pouch.id), 'quantity': '2',
    }, follow_redirects=True)
    assert response.status_code == 200

    # form /log/add with a fractional custom product
    response = logged_in_client.post('/log/add', data={
        'log_date': '2025-01-05', 'pouch_id': 'custom',
        'custom_brand': 'Form Custom', 'custom_nicotine_mg': '1.5',
        'quantity': '1',
    }, follow_redirects=True)
    assert response.status_code == 200

    # /log/bulk
    response = logged_in_client.post('/log/bulk', data={
        'log_date': '2025-01-05', 'bulk_text': '2 BulkBrand 6mg at 10:00',
    }, follow_redirects=True)
    assert response.status_code == 200

    # service helpers
    log_service.add_log_entry(
        user_id=test_user.id, log_date=LOG_DATE, log_time=None, quantity=1,
        pouch_id=test_pouch.id, user_timezone='UTC')
    log_service.add_bulk_logs(
        user_id=test_user.id,
        entries=[{'quantity': 1, 'brand': 'SvcBulk', 'nicotine_mg': 7}],
        log_date=LOG_DATE, user_timezone='UTC')
    log_service.create_log_entry(
        user_id=test_user.id, pouch_id=test_pouch.id, quantity=1,
        log_time=datetime(2025, 1, 5, 12, 0))

    db_session.expire_all()
    snapshots = Counter(
        (log.product_brand_snapshot, log.nicotine_mg_snapshot)
        for log in Log.query.filter_by(user_id=test_user.id).all()
    )
    expected = Counter({
        ('Test Brand', Decimal('4.00')): 5,   # the five pouch write paths
        ('Form Custom', FRACTION): 1,
        ('BulkBrand', Decimal('6.00')): 1,
        ('SvcBulk', Decimal('7.00')): 1,
    })
    assert snapshots == expected, (
        f'snapshot mismatch: {dict(snapshots)} vs {dict(expected)}; '
        'the client-supplied strength must not appear'
    )


def test_unknown_historical_data_remains_null(db_session, test_user):
    log = Log(user_id=test_user.id, quantity=1,
              log_time=datetime(2025, 1, 5, 12, 0), notes='legacy unknown')
    db_session.add(log)
    db_session.commit()
    db_session.refresh(log)

    assert log.pouch_id is None
    assert log.product_brand_snapshot is None
    assert log.nicotine_mg_snapshot is None
    assert log.get_nicotine_content() is None
    assert log.get_total_nicotine() is None
    assert log.get_brand_name() is None
    assert log.to_dict()['brand_name'] is None


def test_authoritative_legacy_zero_pouch_preserves_known_zero(db_session, test_user):
    pouch = Pouch(
        brand='SYNTH-Legacy Zero', nicotine_mg=Decimal('0.00'),
        is_default=False, created_by=test_user.id,
    )
    db_session.add(pouch)
    db_session.commit()

    log = Log(
        user_id=test_user.id, quantity=3,
        log_time=datetime(2025, 1, 5, 12, 0),
    )
    assign_log_product(log, pouch_id=pouch.id)
    db_session.add(log)
    db_session.commit()
    db_session.refresh(log)

    assert log.product_brand_snapshot == 'SYNTH-Legacy Zero'
    assert log.nicotine_mg_snapshot == Decimal('0.00')
    assert log.get_nicotine_content() == Decimal('0.00')
    assert log.get_total_nicotine() == Decimal('0.00')
    assert log.to_dict()['total_nicotine'] == 0.0


def test_helper_rejects_contradictory_input(db_session, test_user, test_pouch):
    log = Log(user_id=test_user.id, quantity=1,
              log_time=datetime(2025, 1, 5, 12, 0))
    with pytest.raises(ValueError):
        assign_log_product(log, pouch_id=test_pouch.id,
                           custom_brand='Conflict', custom_nicotine_mg=Decimal('1'))


def test_add_log_form_rejects_existing_pouch_with_custom_fields(
        logged_in_client, test_user, test_pouch):
    before = Log.query.filter_by(user_id=test_user.id).count()

    response = logged_in_client.post('/log/add', data={
        'log_date': '2025-01-05',
        'pouch_id': str(test_pouch.id),
        'quantity': '1',
        'custom_brand': 'SYNTH-Conflict',
        'custom_nicotine_mg': '9.00',
    })

    assert response.status_code == 302
    assert response.headers['Location'].endswith('/log/view?open_add_modal=1')
    assert Log.query.filter_by(user_id=test_user.id).count() == before


def test_primary_quick_add_rejects_existing_pouch_with_custom_fields(
        logged_in_client, test_user, test_pouch):
    before = Log.query.filter_by(user_id=test_user.id).count()

    response = logged_in_client.post('/api/quick_add', json={
        'pouch_id': test_pouch.id,
        'quantity': 1,
        'custom_brand': 'SYNTH-Conflict',
        'custom_nicotine_mg': '9.00',
    })

    assert response.status_code == 400
    assert response.get_json()['success'] is False
    assert Log.query.filter_by(user_id=test_user.id).count() == before


def test_logging_quick_add_rejects_existing_pouch_with_custom_fields(
        logged_in_client, test_user, test_pouch):
    before = Log.query.filter_by(user_id=test_user.id).count()

    response = logged_in_client.post('/log/api/quick_add', json={
        'pouch_id': test_pouch.id,
        'quantity': 1,
        'custom_brand': 'SYNTH-Conflict',
        'custom_nicotine_mg': '9.00',
    })

    assert response.status_code == 200
    assert response.get_json()['success'] is False
    assert Log.query.filter_by(user_id=test_user.id).count() == before


def test_unquantified_custom_uses_null_strength(db_session, test_user):
    log = Log(user_id=test_user.id, quantity=1,
              log_time=datetime(2025, 1, 5, 12, 0))
    assign_log_product(log, custom_brand='  Brand Only  ')
    assert log.custom_brand == 'Brand Only'
    assert log.product_brand_snapshot == 'Brand Only'
    assert log.custom_nicotine_mg is None
    assert log.nicotine_mg_snapshot is None, 'missing strength must never become zero'


def test_bulk_strength_only_preserves_resolvable_snapshot(db_session, test_user):
    count = log_service.add_bulk_logs(
        user_id=test_user.id,
        entries=[{'quantity': 2, 'nicotine_mg': '1.5'}],
        log_date=LOG_DATE,
        user_timezone='UTC',
    )
    assert count == 1

    log = Log.query.filter_by(user_id=test_user.id).one()
    assert log.custom_brand is None
    assert log.product_brand_snapshot is None
    assert log.custom_nicotine_mg == Decimal('1.50')
    assert log.nicotine_mg_snapshot == Decimal('1.50')
    assert log.get_total_nicotine() == Decimal('3.00')
