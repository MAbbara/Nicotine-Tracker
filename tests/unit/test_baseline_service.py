"""Transparent baseline suggestion contracts."""

from datetime import date, datetime, time, timedelta
from decimal import Decimal

import pytest

from extensions import db
from models import Log
from services.baseline_service import BaselineService, BaselineSuggestion


def _log(user_id, day, quantity, strength, hour=12):
    log = Log(
        user_id=user_id,
        log_time=datetime.combine(day, time(hour, 0)),
        log_date=day,
        quantity=quantity,
        product_brand_snapshot='Baseline product' if strength is not None else None,
        nicotine_mg_snapshot=strength,
    )
    db.session.add(log)
    return log


def test_baseline_result_contract_is_immutable_and_explicit():
    result = BaselineSuggestion(
        available=False,
        pouches_per_day=None,
        nicotine_mg_per_day=None,
        median_mg_per_pouch=None,
        logged_days_used=0,
        window_start=date(2026, 7, 13),
        window_end=date(2026, 7, 26),
        reason='insufficient_data',
    )
    assert result.remaining_logged_days_needed == 4
    assert result.explanation == 'Log 4 more complete days, or enter a baseline manually.'


def test_zero_and_three_logged_days_are_insufficient(db_session, test_user):
    as_of = date(2026, 7, 27)
    empty = BaselineService.suggest(test_user.id, as_of_local_date=as_of)
    assert empty.window_start == date(2026, 7, 13)
    assert empty.window_end == date(2026, 7, 26)
    assert empty.logged_days_used == 0
    assert empty.reason == 'insufficient_data'

    for offset in range(1, 4):
        _log(test_user.id, as_of - timedelta(days=offset), 4, Decimal('6.00'))
    db.session.commit()
    result = BaselineService.suggest(test_user.id, as_of_local_date=as_of)
    assert result.available is False
    assert result.logged_days_used == 3
    assert result.pouches_per_day is None
    assert result.nicotine_mg_per_day is None
    assert result.remaining_logged_days_needed == 1


def test_four_days_use_daily_medians_and_direct_weighted_strength(
        db_session, test_user):
    as_of = date(2026, 7, 27)
    quantities = [2, 4, 6, 8]
    strengths = [Decimal('3'), Decimal('4'), Decimal('5'), Decimal('6')]
    for index, (quantity, strength) in enumerate(zip(quantities, strengths), 1):
        _log(test_user.id, as_of - timedelta(days=index), quantity, strength)
    db.session.commit()

    result = BaselineService.suggest(test_user.id, as_of_local_date=as_of)

    assert result.available is True
    assert result.pouches_per_day == Decimal('5.00')
    assert result.nicotine_mg_per_day == Decimal('23.00')
    assert result.median_mg_per_pouch == Decimal('5.00')
    assert result.median_mg_per_pouch != (
        result.nicotine_mg_per_day / result.pouches_per_day
    )
    assert result.explanation == (
        'Based on 4 logged days from 2026-07-13 to 2026-07-26.'
    )


def test_unknown_strength_retains_only_pouch_median(db_session, test_user):
    as_of = date(2026, 7, 27)
    for index in range(1, 5):
        _log(
            test_user.id,
            as_of - timedelta(days=index),
            index + 1,
            None if index == 2 else Decimal('6.00'),
        )
    db.session.commit()

    result = BaselineService.suggest(test_user.id, as_of_local_date=as_of)

    assert result.available is False
    assert result.pouches_per_day == Decimal('3.50')
    assert result.nicotine_mg_per_day is None
    assert result.median_mg_per_pouch is None
    assert result.reason == 'unknown_strength'


def test_current_incomplete_day_is_excluded(db_session, test_user):
    as_of = date(2026, 7, 27)
    for index in range(1, 5):
        _log(test_user.id, as_of - timedelta(days=index), 4, Decimal('6.00'))
    _log(test_user.id, as_of, 100, Decimal('50.00'))
    db.session.commit()

    result = BaselineService.suggest(test_user.id, as_of_local_date=as_of)
    assert result.pouches_per_day == Decimal('4.00')
    assert result.nicotine_mg_per_day == Decimal('24.00')


def test_non_midnight_reset_groups_early_event_with_previous_day(
        db_session, test_user):
    from services.preference_service import PreferenceService

    preferences = PreferenceService().get_or_create_preferences(test_user.id)
    preferences.daily_reset_time = time(4, 0)
    for index in range(2, 5):
        _log(test_user.id, date(2026, 7, 27) - timedelta(days=index), 4,
             Decimal('6.00'), hour=12)
    # 02:00 on the as-of date is still part of the previous effective day.
    _log(test_user.id, date(2026, 7, 27), 4, Decimal('6.00'), hour=2)
    # 05:00 belongs to the current incomplete day and must be excluded.
    _log(test_user.id, date(2026, 7, 27), 100, Decimal('20.00'), hour=5)
    db.session.commit()

    result = BaselineService.suggest(
        test_user.id, as_of_local_date=date(2026, 7, 27)
    )
    assert result.logged_days_used == 4
    assert result.pouches_per_day == Decimal('4.00')


def test_all_fourteen_complete_logged_days_are_used(db_session, test_user):
    as_of = date(2026, 7, 27)
    for index in range(1, 15):
        _log(test_user.id, as_of - timedelta(days=index), 3, Decimal('1.50'))
    db.session.commit()

    result = BaselineService.suggest(test_user.id, as_of_local_date=as_of)
    assert result.logged_days_used == 14
    assert result.pouches_per_day == Decimal('3.00')
    assert result.nicotine_mg_per_day == Decimal('4.50')
    assert result.median_mg_per_pouch == Decimal('1.50')


def test_multiple_events_on_one_day_are_summed_before_daily_median(
        db_session, test_user):
    as_of = date(2026, 7, 27)
    first_day = as_of - timedelta(days=1)
    _log(test_user.id, first_day, 1, Decimal('1.00'), hour=10)
    _log(test_user.id, first_day, 2, Decimal('2.00'), hour=14)
    for index in range(2, 5):
        _log(test_user.id, as_of - timedelta(days=index), 3, Decimal('2.00'))
    db.session.commit()

    result = BaselineService.suggest(test_user.id, as_of_local_date=as_of)
    assert result.pouches_per_day == Decimal('3.00')
    assert result.nicotine_mg_per_day == Decimal('6.00')
    assert result.median_mg_per_pouch == Decimal('2.00')


def test_suggest_for_window_uses_exactly_the_requested_local_dates(
        db_session, test_user):
    window_start = date(2026, 7, 10)
    window_end = date(2026, 7, 16)
    for offset in range(4):
        _log(
            test_user.id,
            window_start + timedelta(days=offset),
            4,
            Decimal('6.00'),
        )
    _log(test_user.id, window_start - timedelta(days=1), 100, Decimal('50.00'))
    _log(test_user.id, window_end + timedelta(days=1), 100, Decimal('50.00'))
    db.session.commit()

    result = BaselineService.suggest_for_window(
        test_user.id, window_start, window_end
    )

    assert result.available is True
    assert result.window_start == window_start
    assert result.window_end == window_end
    assert result.logged_days_used == 4
    assert result.pouches_per_day == Decimal('4.00')
    assert result.nicotine_mg_per_day == Decimal('24.00')
    assert result.median_mg_per_pouch == Decimal('6.00')


def test_suggest_for_window_reports_window_bounded_insufficient_data(
        db_session, test_user):
    window_start = date(2026, 7, 10)
    window_end = date(2026, 7, 16)
    for offset in range(3):
        _log(
            test_user.id,
            window_start + timedelta(days=offset),
            4,
            Decimal('6.00'),
        )
    # Ten logged days immediately before the window must not rescue it.
    for offset in range(1, 11):
        _log(
            test_user.id,
            window_start - timedelta(days=offset),
            4,
            Decimal('6.00'),
        )
    db.session.commit()

    result = BaselineService.suggest_for_window(
        test_user.id, window_start, window_end
    )

    assert result.available is False
    assert result.reason == 'insufficient_data'
    assert result.logged_days_used == 3
    assert result.pouches_per_day is None
    assert result.nicotine_mg_per_day is None


def test_suggest_for_window_rejects_an_inverted_window(db_session, test_user):
    with pytest.raises(ValueError):
        BaselineService.suggest_for_window(
            test_user.id, date(2026, 7, 16), date(2026, 7, 10)
        )


def test_zero_quantity_unknown_strength_days_are_not_evidence(
        db_session, test_user):
    window_start = date(2026, 7, 13)
    window_end = date(2026, 7, 26)
    for offset in range(4):
        _log(
            test_user.id,
            window_start + timedelta(days=offset),
            0,
            None,
        )
    db.session.commit()

    result = BaselineService.suggest_for_window(
        test_user.id, window_start, window_end
    )

    assert result.available is False
    assert result.reason == 'insufficient_data'
    assert result.logged_days_used == 0
    assert result.pouches_per_day is None
    assert result.nicotine_mg_per_day is None
    assert result.median_mg_per_pouch is None
