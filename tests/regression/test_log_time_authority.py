"""Regression test: bounded log reads must follow log_time, not legacy log_date.

``Log.log_date`` is the deprecated legacy column; ``Log.log_time`` (UTC
datetime) is the authoritative event timestamp. A persisted log whose legacy
``log_date`` deliberately disagrees with ``log_time`` must be included in or
excluded from a bounded date-range read according to ``log_time`` alone.
Fixed synthetic data, real fixtures, no mocked service behavior.
"""
import logging
from datetime import date, datetime, time, timedelta, timezone

from models import Log
from services.log_service import get_logs_by_date_range

from decimal import Decimal
from unittest.mock import patch

from models import Goal, Pouch, User, UserPreferences
from services.log_service import (
    assign_log_product,
    create_log_entry,
    get_average_daily_usage,
    get_daily_intake_for_user,
    get_historical_brand,
    log_effective_day,
    summarize_logs,
)
from services.timezone_service import get_current_user_day, resolve_timezone
from models.notification import NotificationQueue
from services.enhanced_insights_service import get_enhanced_insights
from services.notification_service import NotificationService
from services.request_context import bind_request_id

import routes.dashboard as dashboard_routes
import routes.logging as logging_routes
import routes.settings as settings_routes
from routes.goals import calculate_goal_progress
from routes.settings import cleanup_duplicate_logs, recalculate_goal_streaks

RANGE_START = date(2025, 3, 10)
RANGE_END = date(2025, 3, 11)


def test_bounded_range_read_follows_log_time_not_log_date(db_session, test_user):
    # test_user has timezone='UTC', so a log's effective local date is
    # log_time.date(). Both logs carry a legacy log_date that deliberately
    # disagrees with log_time.
    in_range = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 10, 8, 0),   # inside [RANGE_START, RANGE_END]
        log_date=date(2025, 3, 9),              # wrong: outside the range
    )
    out_of_range = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 12, 8, 0),   # outside [RANGE_START, RANGE_END]
        log_date=date(2025, 3, 10),             # wrong: inside the range
    )
    db_session.add_all([in_range, out_of_range])
    db_session.commit()

    results = get_logs_by_date_range(test_user.id, RANGE_START, RANGE_END)
    result_ids = {log.id for log in results}

    assert in_range.id in result_ids, (
        'log whose log_time falls inside the requested range must be included; '
        'its disagreeing legacy log_date must be ignored'
    )
    assert out_of_range.id not in result_ids, (
        'log whose log_time falls outside the requested range must be excluded; '
        'its disagreeing legacy log_date must be ignored'
    )


# ---------------------------------------------------------------------------
# Appended service-level contract tests. Every row carries a legacy log_date
# that deliberately disagrees with its authoritative UTC log_time.
# ---------------------------------------------------------------------------


def _create_user_with_timezone(db_session, email, timezone_name):
    """Persist a verified user in a specific timezone (mirrors test_user)."""
    user = User(email=email, email_verified=True, timezone=timezone_name)
    user.set_password('password123')
    db_session.add(user)
    db_session.commit()
    return user


def test_range_boundaries_are_exact_utc_half_open(db_session, test_user):
    # Contract: range membership is decided by the authoritative UTC log_time
    # within the half-open interval
    # [start_date 00:00:00, (end_date + 1 day) 00:00:00). test_user has
    # timezone='UTC', so user-local and UTC boundaries coincide here.
    at_start = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 10, 0, 0, 0),       # exact inclusive start
        log_date=date(2025, 3, 9),                     # wrong: before the range
    )
    just_before_end = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 11, 23, 59, 59, 999999),  # 1us before end
        log_date=date(2025, 3, 9),                     # wrong: before the range
    )
    at_exclusive_end = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 12, 0, 0, 0),       # exact exclusive end
        log_date=date(2025, 3, 10),                    # wrong: inside the range
    )
    db_session.add_all([at_start, just_before_end, at_exclusive_end])
    db_session.commit()

    results = get_logs_by_date_range(test_user.id, RANGE_START, RANGE_END)
    result_ids = {log.id for log in results}

    assert at_start.id in result_ids, (
        'a log at exactly RANGE_START 00:00:00 UTC lies inside the half-open '
        'range and must be included; its disagreeing legacy log_date must be '
        'ignored'
    )
    assert just_before_end.id in result_ids, (
        'a log one microsecond before the exclusive end (RANGE_END + 1 day '
        '00:00:00 UTC) must be included; its disagreeing legacy log_date must '
        'be ignored'
    )
    assert at_exclusive_end.id not in result_ids, (
        'a log at exactly the exclusive end (RANGE_END + 1 day 00:00:00 UTC) '
        'must be excluded even though its legacy log_date lies inside the range'
    )


def test_range_membership_uses_user_local_dates(db_session):
    # Asia/Riyadh is UTC+3: these authoritative UTC instants fall on different
    # user-local calendar days than their UTC dates (and legacy log_dates)
    # suggest. The public range function has no timezone argument, so the
    # contract is that it resolves the user by id and interprets
    # start_date/end_date as that user's local dates.
    riyadh_user = _create_user_with_timezone(
        db_session, 'riyadh-range@example.com', 'Asia/Riyadh'
    )
    crosses_into_local_day = Log(
        user_id=riyadh_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 9, 22, 30),  # UTC 03-09 == Riyadh 03-10 01:30
        log_date=date(2025, 3, 9),              # legacy UTC date: outside
    )
    crosses_out_of_local_day = Log(
        user_id=riyadh_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 10, 21, 30),  # UTC 03-10 == Riyadh 03-11 00:30
        log_date=date(2025, 3, 10),              # legacy UTC date: inside
    )
    db_session.add_all([crosses_into_local_day, crosses_out_of_local_day])
    db_session.commit()

    results = get_logs_by_date_range(
        riyadh_user.id, date(2025, 3, 10), date(2025, 3, 10)
    )
    result_ids = {log.id for log in results}

    assert crosses_into_local_day.id in result_ids, (
        'UTC 2025-03-09 22:30 is 2025-03-10 01:30 in Asia/Riyadh: the log '
        'belongs to the requested local day and must be included'
    )
    assert crosses_out_of_local_day.id not in result_ids, (
        'UTC 2025-03-10 21:30 is 2025-03-11 00:30 in Asia/Riyadh: the log '
        'belongs to the next local day and must be excluded even though its '
        'UTC date and legacy log_date lie inside the requested range'
    )


def test_average_daily_usage_groups_by_user_local_date(db_session):
    # Two authoritative UTC instants on two different UTC dates but a single
    # Asia/Riyadh local day (2025-03-10). Grouping must follow the user's
    # effective local date derived from log_time, not the UTC date or the
    # legacy log_date, so the average spans exactly one day.
    riyadh_user = _create_user_with_timezone(
        db_session, 'riyadh-average@example.com', 'Asia/Riyadh'
    )
    previous_utc_date = Log(
        user_id=riyadh_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 9, 22, 0),   # UTC 03-09 == Riyadh 03-10 01:00
        log_date=date(2025, 3, 9),
    )
    same_local_day = Log(
        user_id=riyadh_user.id,
        quantity=2,
        log_time=datetime(2025, 3, 10, 10, 0),  # UTC 03-10 == Riyadh 03-10 13:00
        log_date=date(2025, 3, 10),
    )
    db_session.add_all([previous_utc_date, same_local_day])
    db_session.commit()

    assert get_average_daily_usage(riyadh_user.id) == 3.0, (
        'both logs fall on one Asia/Riyadh local day (2025-03-10): the '
        'average must be 3 pouches / 1 day = 3.0, not grouped by UTC date '
        'or legacy log_date'
    )


def test_daily_intake_snapshot_authority_and_unknown_semantics(db_session, test_user):
    # Fixed historical date: end_date is never "today", so the current-day
    # reset adjustment cannot interfere.
    day = date(2025, 3, 10)
    pouch = Pouch(
        brand='Snapshot Brand',
        nicotine_mg=Decimal('6.00'),
        is_default=False,
        created_by=test_user.id,
    )
    db_session.add(pouch)
    db_session.commit()

    snapshotted = create_log_entry(
        user_id=test_user.id,
        pouch_id=pouch.id,
        quantity=1,
        log_time=datetime(2025, 3, 10, 8, 0),
    )
    assert snapshotted.nicotine_mg_snapshot == Decimal('6.00'), (
        'setup premise: the canonical snapshot write must capture the pouch '
        'strength at log creation'
    )

    # Catalog edits and deletion must not rewrite logged history.
    pouch.nicotine_mg = Decimal('12.00')
    db_session.commit()
    db_session.delete(pouch)
    db_session.commit()

    live_pouch = Pouch(
        brand='Live Brand',
        nicotine_mg=Decimal('9.00'),
        is_default=False,
        created_by=test_user.id,
    )
    db_session.add(live_pouch)
    db_session.commit()

    # Legacy row predating snapshots: unknown strength (NULL snapshot) must be
    # excluded from intake, never back-filled from the live pouch.
    unknown_strength = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2025, 3, 10, 9, 0),
        log_date=day,
        pouch_id=live_pouch.id,
        product_brand_snapshot=None,
        nicotine_mg_snapshot=None,
    )
    # A stored Decimal('0.00') is a known zero, not an unknown: it contributes
    # zero and must not fall through to the referenced pouch's live strength.
    known_zero = Log(
        user_id=test_user.id,
        quantity=2,
        log_time=datetime(2025, 3, 10, 10, 0),
        log_date=day,
        pouch_id=live_pouch.id,
        product_brand_snapshot='Legacy Zero',
        nicotine_mg_snapshot=Decimal('0.00'),
    )
    db_session.add_all([unknown_strength, known_zero])
    db_session.commit()

    result = get_daily_intake_for_user(test_user.id, day, day)

    assert set(result) == {day}
    assert result[day] == 6.0, (
        'only the immutable snapshot (6.00mg x 1) may count: pouch edits and '
        'deletion must not rewrite it, a NULL-snapshot row must be excluded '
        'instead of falling back to the live pouch, and a known 0.00 '
        'snapshot contributes zero rather than the live pouch strength'
    )


# ---------------------------------------------------------------------------
# Appended settings/goals contract tests (Task 5). Every row carries a legacy
# log_date that deliberately disagrees with its authoritative UTC log_time,
# and product identity lives in the immutable snapshots, never in the mutable
# pouch reference. Each test pins one settings/goals read that must follow
# log_time / the immutable snapshot instead of legacy log_date / the live
# pouch.
# ---------------------------------------------------------------------------


def _exported_product(entry):
    """Product payload of one export entry, whichever branch emitted it."""
    return entry.get('pouch') or entry.get('custom_pouch') or {}


def _snapshot_duplicate_rows(db_session, test_user):
    """Three logs: two share log_time and immutable snapshot identity (so they
    are duplicates) but carry different legacy log_dates and distinct mutable
    pouch references; the third shares only the legacy date/product with a
    different log_time and must survive any correct dedup."""
    pouch_a = Pouch(
        brand='Dup Brand', nicotine_mg=Decimal('6.00'),
        is_default=False, created_by=test_user.id,
    )
    pouch_b = Pouch(
        brand='Dup Brand', nicotine_mg=Decimal('6.00'),
        is_default=False, created_by=test_user.id,
    )
    db_session.add_all([pouch_a, pouch_b])
    db_session.commit()

    shared_time = datetime(2025, 3, 10, 8, 0)
    # Canonical snapshot writes; only the legacy log_date is edited afterwards.
    first = create_log_entry(test_user.id, pouch_a.id, 1, shared_time)
    second = create_log_entry(test_user.id, pouch_b.id, 1, shared_time)
    second.log_date = date(2025, 3, 11)     # legacy date disagrees with log_time
    keeper = create_log_entry(test_user.id, pouch_a.id, 1, datetime(2025, 3, 12, 8, 0))
    keeper.log_date = date(2025, 3, 10)     # same legacy date/product as first
    db_session.commit()
    return first, second, keeper


def test_settings_export_follows_log_time_and_snapshot_identity(
        logged_in_client, db_session, test_user):
    # Export requires user preferences; the UTC test_user gets the defaults.
    db_session.add(UserPreferences(user_id=test_user.id, preferred_brands=[]))
    pouch = Pouch(
        brand='Export Brand', nicotine_mg=Decimal('6.00'),
        is_default=False, created_by=test_user.id,
    )
    db_session.add(pouch)
    db_session.commit()

    log = create_log_entry(
        user_id=test_user.id, pouch_id=pouch.id, quantity=1,
        log_time=datetime(2025, 3, 10, 8, 0),
    )
    log.log_date = date(2025, 3, 9)  # legacy date disagrees with log_time
    db_session.commit()
    assert log.product_brand_snapshot == 'Export Brand'
    assert log.nicotine_mg_snapshot == Decimal('6.00')

    # Catalog rename, strength change, and deletion must not rewrite history.
    pouch.brand = 'Renamed Brand'
    pouch.nicotine_mg = Decimal('12.00')
    db_session.commit()
    db_session.delete(pouch)
    db_session.commit()

    response = logged_in_client.post('/settings/data', data={'action': 'export_data'})
    assert response.status_code == 200
    payload = response.get_json()
    assert len(payload['logs']) == 1
    entry = payload['logs'][0]

    assert entry['date'] == '2025-03-10', (
        'exported date must be derived from the authoritative log_time, not '
        f"the disagreeing legacy log_date; got {entry['date']!r}"
    )
    assert entry['time'].endswith('08:00:00'), (
        'exported time must be derived from the authoritative log_time; got '
        f"{entry['time']!r}"
    )
    product = _exported_product(entry)
    assert product.get('brand') == 'Export Brand', (
        'exported brand must come from the immutable product_brand_snapshot, '
        'not the renamed/deleted pouch; got '
        f"{product.get('brand')!r}"
    )
    assert product.get('nicotine_mg') is not None \
        and float(product['nicotine_mg']) == 6.0, (
        'exported strength must come from the immutable nicotine_mg_snapshot '
        '(6.00), not the mutated/deleted pouch; got '
        f"{product.get('nicotine_mg')!r}"
    )


def test_cleanup_duplicate_logs_follows_log_time_and_snapshot_identity(
        db_session, test_user):
    first, second, keeper = _snapshot_duplicate_rows(db_session, test_user)

    removed = cleanup_duplicate_logs(test_user)

    remaining_ids = {log.id for log in Log.query.filter_by(user_id=test_user.id)}
    assert removed == 1, (
        'two rows sharing log_time and immutable snapshot identity are '
        'duplicates despite disagreeing legacy log_date values and distinct '
        'mutable pouch_id references; exactly one must be removed, got '
        f'{removed}'
    )
    assert len(remaining_ids) == 2, (
        f'exactly two rows must remain after dedup, got {len(remaining_ids)}'
    )
    assert keeper.id in remaining_ids, (
        'a row with the same legacy log_date and product but a different '
        'log_time is not a duplicate and must remain'
    )
    assert len({first.id, second.id} & remaining_ids) == 1, (
        'exactly one of the two log_time/snapshot duplicates must survive'
    )


def test_settings_data_preview_counts_duplicates_by_log_time(
        logged_in_client, db_session, test_user):
    _snapshot_duplicate_rows(db_session, test_user)

    captured = {}

    def fake_render(template_name, **context):
        captured.update(context)
        return ''

    with patch.object(settings_routes, 'render_template', side_effect=fake_render):
        response = logged_in_client.get('/settings/data')

    assert response.status_code == 200
    potential = captured['data_stats']['potential_duplicates']
    assert potential == 1, (
        'the settings preview must report one duplicate group for the two '
        'rows sharing log_time and snapshot identity despite their '
        f'disagreeing legacy log_date values; got {potential}'
    )


def test_delete_old_logs_cutoff_follows_log_time(
        logged_in_client, db_session, test_user):
    now = datetime.utcnow()
    old_time_recent_legacy = Log(
        user_id=test_user.id, quantity=1,
        log_time=now - timedelta(days=40),      # older than the 30-day window
        log_date=now.date(),                    # legacy date: recent
    )
    recent_time_old_legacy = Log(
        user_id=test_user.id, quantity=1,
        log_time=now - timedelta(days=5),       # inside the 30-day window
        log_date=(now - timedelta(days=40)).date(),  # legacy date: stale
    )
    db_session.add_all([old_time_recent_legacy, recent_time_old_legacy])
    db_session.commit()

    response = logged_in_client.post(
        '/settings/data',
        data={
            'action': 'delete_old_logs',
            'days_to_keep': '30',
            'confirm_delete_logs': 'DELETE LOGS',
        },
    )
    assert response.status_code == 302

    remaining_ids = {log.id for log in Log.query.filter_by(user_id=test_user.id)}
    assert old_time_recent_legacy.id not in remaining_ids, (
        'a log whose authoritative log_time is older than the retention '
        'window must be deleted even when its legacy log_date is recent'
    )
    assert recent_time_old_legacy.id in remaining_ids, (
        'a log whose authoritative log_time lies inside the retention window '
        'must be kept even when its legacy log_date is older than the cutoff'
    )


def test_weekly_reduction_goal_follows_log_time_weeks(db_session, test_user):
    # Fixed Wednesday target_date. The half-open local week is
    # [Mon 2025-03-10 00:00, Mon 2025-03-17 00:00) and the previous week is
    # [Mon 2025-03-03 00:00, Mon 2025-03-10 00:00). test_user is UTC, so local
    # and UTC boundaries coincide.
    target_date = date(2025, 3, 12)
    goal = Goal(
        user_id=test_user.id, goal_type='weekly_reduction', target_value=25,
        start_date=date(2025, 3, 1), is_active=True,
    )
    previous_week = Log(
        user_id=test_user.id, quantity=8,
        log_time=datetime(2025, 3, 5, 10, 0),   # previous week by log_time
        log_date=date(2025, 3, 11),             # legacy: current week
    )
    current_week = Log(
        user_id=test_user.id, quantity=5,
        log_time=datetime(2025, 3, 11, 9, 0),   # current week by log_time
        log_date=date(2025, 3, 5),              # legacy: previous week
    )
    week_start_boundary = Log(
        user_id=test_user.id, quantity=1,
        log_time=datetime(2025, 3, 10, 0, 0),   # exact half-open current-week start
        log_date=date(2025, 3, 9),              # legacy: previous week
    )
    db_session.add_all([goal, previous_week, current_week, week_start_boundary])
    db_session.commit()

    progress = calculate_goal_progress(test_user, goal, target_date)

    # Hand-derived by log_time: previous week 8 pouches, current week 6
    # pouches -> (8 - 6) / 8 * 100 = 25.0% reduction against a 25% target.
    assert progress['current'] == 25.0, (
        'weekly reduction must bucket quantities by authoritative log_time '
        'weeks, not the reversed legacy log_date values; got '
        f"{progress['current']!r}"
    )
    assert progress['achieved'] is True, (
        'a 25.0% reduction meets the 25% target; the reversed legacy '
        f"log_date values must not flip the result; got {progress['achieved']!r}"
    )
    assert progress['percentage'] == 100.0, (
        f"25.0% of progress against a 25% target is 100.0; got {progress['percentage']!r}"
    )


def test_settings_statistics_windows_follow_log_time(
        logged_in_client, db_session, test_user):
    now = datetime.utcnow()
    today = now.date()

    def make_log(days_old, legacy_days_old, quantity, strength):
        return Log(
            user_id=test_user.id, quantity=quantity,
            log_time=now - timedelta(days=days_old),
            log_date=today - timedelta(days=legacy_days_old),
            product_brand_snapshot='Stats Brand' if strength is not None else None,
            nicotine_mg_snapshot=strength,
        )

    recent_week = make_log(3, 40, 2, Decimal('6.00'))    # last week by log_time
    recent_week_unknown = make_log(1, 40, 1, None)       # unknown NULL snapshot
    recent_month = make_log(20, 60, 3, Decimal('4.00'))  # last month, not week
    stale = make_log(45, 0, 7, Decimal('2.00'))          # outside month; legacy today
    db_session.add_all([recent_week, recent_week_unknown, recent_month, stale])
    db_session.commit()

    captured = {}

    def fake_render(template_name, **context):
        captured.update(context)
        return ''

    with patch.object(settings_routes, 'render_template', side_effect=fake_render):
        response = logged_in_client.get('/settings/statistics')

    assert response.status_code == 200
    stats = captured['stats']
    assert stats['week_logs'] == 2, (
        'week_logs must count rows whose log_time falls in the last 7 days '
        f"(the two recent rows), not legacy log_date windows; got {stats['week_logs']!r}"
    )
    assert stats['week_pouches'] == 3, (
        'week_pouches must sum quantities by log_time windows (2 + 1), not '
        f"legacy log_date windows; got {stats['week_pouches']!r}"
    )
    assert stats['month_logs'] == 3, (
        'month_logs must count rows whose log_time falls in the last 30 days '
        f"(all but the stale row), not legacy log_date windows; got {stats['month_logs']!r}"
    )
    assert stats['month_pouches'] == 6, (
        'month_pouches must sum quantities by log_time windows (2 + 1 + 3), '
        f"not legacy log_date windows; got {stats['month_pouches']!r}"
    )
    # Premise: known snapshot strengths count toward mg totals; the unknown
    # NULL-snapshot row is excluded (never zero, never back-filled). The
    # current context exposes no explicit unknown-count key, so none is
    # asserted.
    assert stats['total_nicotine'] == 38, (
        'total_nicotine must sum known snapshot strengths only: '
        f"2x6.00 + 3x4.00 + 7x2.00 = 38; got {stats['total_nicotine']!r}"
    )


# ---------------------------------------------------------------------------
# Appended dashboard/logging contract tests (Task 5). These exercise the real
# routes with real database rows; render_template is patched only to observe
# the computed context, never to mock a query or service. Where the legacy
# log_date is the contract under test it deliberately disagrees with the
# authoritative UTC log_time; where the snapshot is the contract, product
# identity lives only in the immutable snapshots, never in the mutable pouch
# reference. An explicit unknown-strength count is asserted under the key
# ``unknown_strength_count`` wherever an aggregate excludes NULL strengths.
# ---------------------------------------------------------------------------


def _rendered_context(module, client, url):
    """GET ``url`` with ``module.render_template`` patched to capture the real
    computed context (observation only; queries and services run for real)."""
    captured = {}

    def fake_render(template_name, **context):
        captured.update(context)
        return ''

    with patch.object(module, 'render_template', side_effect=fake_render):
        response = client.get(url)
    assert response.status_code == 200
    return captured


def test_dashboard_recent_list_follows_log_time_authority(
        logged_in_client, db_session, test_user):
    # The dashboard recent list must select and order by the authoritative
    # log_time within the rolling 7-day window (ties broken stably by
    # created_at/id), never by the legacy log_date. get_sorted_pouches
    # requires preferences, so the UTC test_user gets the defaults.
    db_session.add(UserPreferences(user_id=test_user.id, preferred_brands=[]))
    now = datetime.utcnow()
    today = now.date()
    stale_legacy = today - timedelta(days=30)

    recent_authoritative = Log(
        user_id=test_user.id, quantity=1,
        log_time=now - timedelta(hours=2),   # inside the 7-day window
        log_date=stale_legacy,               # legacy: outside the window
    )
    stale_authoritative = Log(
        user_id=test_user.id, quantity=1,
        log_time=now - timedelta(days=30),   # outside the 7-day window
        log_date=today,                      # legacy: inside the window
    )
    recent_yesterday = Log(
        user_id=test_user.id, quantity=1,
        log_time=now - timedelta(days=1),
        log_date=stale_legacy,
    )
    # A log_time tie broken only by creation order: tie_second was created
    # later (later created_at, higher id) and must sort ahead of tie_first.
    tie_time = now - timedelta(hours=4)
    tie_first = Log(
        user_id=test_user.id, quantity=1,
        log_time=tie_time, log_date=stale_legacy,
        created_at=now - timedelta(minutes=10),
    )
    tie_second = Log(
        user_id=test_user.id, quantity=1,
        log_time=tie_time, log_date=stale_legacy,
        created_at=now - timedelta(minutes=5),
    )
    db_session.add_all([
        recent_authoritative, stale_authoritative, recent_yesterday,
        tie_first, tie_second,
    ])
    db_session.commit()

    captured = _rendered_context(dashboard_routes, logged_in_client, '/dashboard/')

    recent_ids = [log.id for log in captured['recent_logs']]
    assert recent_authoritative.id in recent_ids, (
        'a log whose authoritative log_time falls inside the rolling 7-day '
        'window must appear in the recent list even though its legacy '
        f'log_date is 30 days stale; recent ids were {recent_ids}'
    )
    assert stale_authoritative.id not in recent_ids, (
        'a log whose authoritative log_time is 30 days old must not appear '
        'in the recent list even though its legacy log_date is today; '
        f'recent ids were {recent_ids}'
    )
    expected_order = [
        recent_authoritative.id,   # newest log_time first
        tie_second.id,             # log_time tie: later created_at/id first
        tie_first.id,
        recent_yesterday.id,
    ]
    assert recent_ids == expected_order, (
        'the recent list must be ordered by descending authoritative '
        'log_time with stable created_at/id tie-breaking, not by legacy '
        f'log_date; expected {expected_order}, got {recent_ids}'
    )


def test_dashboard_totals_follow_snapshots_and_count_unknown_strength(
        logged_in_client, db_session, test_user):
    # Dashboard intake totals must be snapshot-based: pouch edits and
    # deletion must not rewrite history, a NULL snapshot stays unknown
    # (excluded from mg, never back-filled from the live pouch), and a known
    # Decimal('0.00') contributes zero rather than the live pouch strength.
    db_session.add(UserPreferences(user_id=test_user.id, preferred_brands=[]))
    # Keep every event inside both the active user-day window and the elapsed
    # rolling-history window. A fixed midday timestamp becomes a future event
    # when this test runs before noon UTC, so divide the elapsed day into four
    # parts and use the first three boundaries (test_user is UTC).
    current_day = get_current_user_day(test_user.timezone, None)
    day_start = datetime.combine(current_day, time.min)
    elapsed_quarter = (datetime.utcnow() - day_start) / 4
    first_event_time = day_start + elapsed_quarter

    pouch = Pouch(
        brand='Dashboard Brand', nicotine_mg=Decimal('6.00'),
        is_default=False, created_by=test_user.id,
    )
    db_session.add(pouch)
    db_session.commit()

    snapshotted = create_log_entry(
        user_id=test_user.id, pouch_id=pouch.id, quantity=1,
        log_time=first_event_time,
    )
    assert snapshotted.product_brand_snapshot == 'Dashboard Brand'
    assert snapshotted.nicotine_mg_snapshot == Decimal('6.00')

    # Catalog rename, strength change, and deletion must not rewrite history.
    pouch.brand = 'Renamed Brand'
    pouch.nicotine_mg = Decimal('12.00')
    db_session.commit()
    db_session.delete(pouch)
    db_session.commit()

    live_pouch = Pouch(
        brand='Live Brand', nicotine_mg=Decimal('9.00'),
        is_default=False, created_by=test_user.id,
    )
    db_session.add(live_pouch)
    db_session.commit()

    # Legacy row predating snapshots: unknown strength must be excluded from
    # mg totals, never back-filled from the live pouch it references.
    unknown_strength = Log(
        user_id=test_user.id, quantity=1,
        log_time=first_event_time + elapsed_quarter, log_date=current_day,
        pouch_id=live_pouch.id,
        product_brand_snapshot=None, nicotine_mg_snapshot=None,
    )
    # A stored Decimal('0.00') is a known zero, not an unknown: it contributes
    # zero and must not fall through to the referenced pouch's live strength.
    known_zero = Log(
        user_id=test_user.id, quantity=2,
        log_time=first_event_time + (2 * elapsed_quarter),
        log_date=current_day,
        pouch_id=live_pouch.id,
        product_brand_snapshot='Legacy Zero',
        nicotine_mg_snapshot=Decimal('0.00'),
    )
    db_session.add_all([unknown_strength, known_zero])
    db_session.commit()

    captured = _rendered_context(dashboard_routes, logged_in_client, '/dashboard/')

    today_intake = captured['today_intake']
    assert today_intake['total_pouches'] == 4, (
        'premise: all four pouches count toward the pouch total regardless '
        f"of strength knowledge; got {today_intake['total_pouches']!r}"
    )
    assert today_intake['total_mg'] == 6.0, (
        'only the immutable snapshot (6.00mg x 1) may count: the pouch '
        'rename/strength-change/deletion must not rewrite it, the '
        'NULL-snapshot row must be excluded instead of falling back to the '
        'live 9.00mg pouch, and the known 0.00 snapshot contributes zero '
        f"rather than 2 x 9.00; got {today_intake['total_mg']!r}"
    )
    assert today_intake.get('unknown_strength_count') == 1, (
        'the computed dashboard context must expose an explicit count of '
        'unknown-strength events (NULL snapshots) excluded from the mg '
        f"total; got {today_intake.get('unknown_strength_count')!r}"
    )
    recent_by_id = {log.id: log for log in captured['recent_logs']}
    historical = recent_by_id[snapshotted.id]
    assert historical.get_brand_name() == 'Dashboard Brand', (
        'the recent row rendered by the dashboard must keep the historical '
        'brand from the immutable product_brand_snapshot, not the renamed '
        f"or deleted pouch; got {historical.get_brand_name()!r}"
    )


def test_hourly_distribution_uses_local_hours_and_log_time_membership(
        client, db_session):
    # Asia/Riyadh is UTC+3: an authoritative 21:30 UTC instant is 00:30 local
    # on the next day, so its quantity belongs to local hour 0, never UTC
    # hour 21; window membership must follow log_time, not the legacy date.
    riyadh_user = _create_user_with_timezone(
        db_session, 'riyadh-hourly@example.com', 'Asia/Riyadh'
    )
    db_session.add(UserPreferences(user_id=riyadh_user.id, preferred_brands=[]))
    db_session.commit()

    utc_today = datetime.utcnow().date()
    rollover = Log(
        user_id=riyadh_user.id, quantity=3,
        # Yesterday 21:30 UTC == today 00:30 in Asia/Riyadh, always inside a
        # bounded two-day window ending on the current Riyadh day.
        log_time=datetime.combine(utc_today - timedelta(days=1), time(21, 30)),
        log_date=utc_today - timedelta(days=40),   # legacy: far outside
    )
    db_session.add(rollover)
    db_session.commit()

    response = client.post('/auth/login', data={
        'email': 'riyadh-hourly@example.com',
        'password': 'password123',
    })
    assert response.status_code in (301, 302), (
        f'setup login failed with status {response.status_code}'
    )

    response = client.get('/dashboard/api/hourly_distribution?days=2')
    assert response.status_code == 200
    payload = response.get_json()
    assert payload['success'] is True, (
        f'the hourly distribution endpoint must answer successfully; got {payload!r}'
    )
    pouches_by_hour = {
        entry['hour']: entry['pouches'] for entry in payload['data']
    }

    assert pouches_by_hour['00:00'] == 3, (
        'the authoritative instant is 00:30 in Asia/Riyadh on a day inside '
        'the bounded window: the quantity must appear in local hour 0 '
        '(membership by log_time, grouping by local hour), not be dropped '
        'by the disagreeing legacy log_date; distribution was '
        f'{pouches_by_hour!r}'
    )
    assert pouches_by_hour['21:00'] == 0, (
        'hour 21 is the UTC hour of the authoritative instant; grouping by '
        f'UTC hour instead of the user-local hour is wrong; distribution was '
        f'{pouches_by_hour!r}'
    )


def test_log_history_orders_and_groups_by_authoritative_local_time(
        client, db_session):
    # Log history must order by descending authoritative log_time and group
    # daily totals by the effective user-local day derived from log_time,
    # never by the legacy log_date order or the legacy-date fallback.
    riyadh_user = _create_user_with_timezone(
        db_session, 'riyadh-history@example.com', 'Asia/Riyadh'
    )
    db_session.add(UserPreferences(user_id=riyadh_user.id, preferred_brands=[]))
    db_session.commit()

    def named_custom_log(brand, strength, quantity, log_time, log_date):
        """Canonical custom-product write: brand/strength mirrored into the
        immutable snapshots; only the legacy log_date is wrong."""
        log = Log(
            user_id=riyadh_user.id, quantity=quantity,
            log_time=log_time, log_date=log_date,
        )
        assign_log_product(log, custom_brand=brand, custom_nicotine_mg=strength)
        db_session.add(log)
        return log

    # log_time order (bravo > unknown > alpha) conflicts with legacy log_date
    # order (unknown > alpha > bravo). Alpha also rolls over a Riyadh local
    # date boundary: UTC 2025-03-09 22:30 is local 2025-03-10 01:30.
    alpha = named_custom_log(
        'Rollover Alpha', '6.00', 1,
        log_time=datetime(2025, 3, 9, 22, 30),   # Riyadh 2025-03-10 01:30
        log_date=date(2025, 3, 11),              # legacy: newer than bravo
    )
    bravo = named_custom_log(
        'Rollover Bravo', '4.00', 2,
        log_time=datetime(2025, 3, 10, 10, 0),   # Riyadh 2025-03-10 13:00
        log_date=date(2025, 3, 9),               # legacy: oldest
    )
    unknown_strength = Log(
        user_id=riyadh_user.id, quantity=1,
        log_time=datetime(2025, 3, 10, 7, 0),    # Riyadh 2025-03-10 10:00
        log_date=date(2025, 3, 12),              # legacy: newest
        pouch_id=None, custom_brand=None, custom_nicotine_mg=None,
        product_brand_snapshot=None, nicotine_mg_snapshot=None,
    )
    db_session.add(unknown_strength)
    db_session.commit()

    response = client.post('/auth/login', data={
        'email': 'riyadh-history@example.com',
        'password': 'password123',
    })
    assert response.status_code in (301, 302), (
        f'setup login failed with status {response.status_code}'
    )

    captured = _rendered_context(logging_routes, client, '/log/view')

    ordered_ids = [log.id for log in captured['logs'].items]
    assert ordered_ids == [bravo.id, unknown_strength.id, alpha.id], (
        'history must be ordered by descending authoritative log_time, not '
        'by the conflicting legacy log_date order; expected '
        f'{[bravo.id, unknown_strength.id, alpha.id]}, got {ordered_ids}'
    )

    # All three rows share one effective Riyadh local day (2025-03-10)
    # despite three distinct legacy log_date values.
    daily_totals = captured['daily_totals']
    local_day = date(2025, 3, 10)
    assert set(daily_totals) == {local_day}, (
        'daily grouping must follow the effective user-local day derived '
        f'from log_time, never the legacy log_date fallback; got keys '
        f'{sorted(daily_totals)!r}'
    )
    assert daily_totals[local_day]['pouches'] == 4, (
        'premise: all four pouches count toward the daily pouch total; got '
        f"{daily_totals[local_day]['pouches']!r}"
    )
    assert daily_totals[local_day]['mg'] == Decimal('14.00'), (
        'daily mg must sum the immutable snapshots only (1 x 6.00 + 2 x '
        '4.00 = 14.00); the NULL-snapshot row must be excluded, never '
        f"back-filled; got {daily_totals[local_day]['mg']!r}"
    )
    assert daily_totals[local_day].get('unknown_strength_count') == 1, (
        'each daily aggregate must expose an explicit count of '
        'unknown-strength events (NULL snapshots) excluded from the mg '
        f"total; got {daily_totals[local_day].get('unknown_strength_count')!r}"
    )


# ---------------------------------------------------------------------------
# Appended insights/notifications contract tests (Task 5). Product identity
# and strength live in the immutable snapshots, never in the mutable pouch
# reference; a NULL snapshot is an unknown-strength event (counted, excluded
# from mg), while a stored Decimal('0.00') is a known zero. Weekly report
# windows are the authoritative half-open log_time interval of the prior
# user-local week under a frozen Monday clock; only
# services.notification_service.tz_service.get_current_user_time is patched.
# ---------------------------------------------------------------------------


# Frozen report clock: Monday 2026-07-27 12:00 UTC, so the prior local week
# is [2026-07-20, 2026-07-26] with an exclusive UTC end of 2026-07-27 00:00.
FROZEN_REPORT_CLOCK = (
    datetime(2026, 7, 27, 12, 0, tzinfo=timezone.utc),
    date(2026, 7, 27),
    time(12, 0),
)


def _queue_single_weekly_report(user):
    """Queue the real weekly report under the frozen Monday clock and return
    the single persisted NotificationQueue row for that user/category."""
    with patch(
        'services.notification_service.tz_service.get_current_user_time',
        return_value=FROZEN_REPORT_CLOCK,
    ):
        queued = NotificationService().queue_weekly_report(user)
    assert queued is True, (
        'setup premise: queuing the weekly report must succeed for a user '
        'with the email channel and weekly_reports enabled'
    )
    return NotificationQueue.query.filter_by(
        user_id=user.id, category='weekly_report'
    ).one()


def test_enhanced_insights_preserve_catalog_snapshots_after_delete(
        db_session, test_user):
    # Insights must read the immutable snapshots written at log time: later
    # catalog edits and deletion must not rewrite logged history.
    pouch = Pouch(
        brand='Historical Brand', nicotine_mg=Decimal('6.00'),
        is_default=False, created_by=test_user.id,
    )
    db_session.add(pouch)
    db_session.flush()

    recent = datetime.utcnow() - timedelta(hours=2)
    log = Log(
        user_id=test_user.id, quantity=2,
        log_time=recent, log_date=recent.date(),
    )
    assign_log_product(log, pouch_id=pouch.id)
    db_session.add(log)
    db_session.commit()
    assert log.product_brand_snapshot == 'Historical Brand'
    assert log.nicotine_mg_snapshot == Decimal('6.00')

    # Catalog rename, strength change, and deletion must not rewrite history.
    pouch.brand = 'Mutated Brand'
    pouch.nicotine_mg = Decimal('12.00')
    db_session.commit()
    db_session.delete(pouch)
    db_session.commit()

    insights = get_enhanced_insights(test_user.id, days=30)

    assert insights['total_pouches'] == 2, (
        f"both pouches must count toward the total; got {insights['total_pouches']!r}"
    )
    assert insights['total_nicotine'] == 12.0, (
        'total nicotine must come from the immutable snapshot (6.00mg x 2 = '
        '12.0), not the mutated or deleted pouch; got '
        f"{insights['total_nicotine']!r}"
    )
    assert insights['brand_analysis'] == {'Historical Brand': 2}, (
        'brand analysis must be exactly the historical snapshot brand, with '
        'no trace of the mutated brand; got '
        f"{insights['brand_analysis']!r}"
    )


def test_enhanced_insights_distinguish_unknown_from_known_zero(
        db_session, test_user):
    # A NULL snapshot is an unknown-strength event (counted, excluded from
    # mg); a stored Decimal('0.00') is a known zero, not an unknown.
    now = datetime.utcnow()

    known_custom = Log(
        user_id=test_user.id, quantity=1,
        log_time=now - timedelta(hours=3),
        log_date=(now - timedelta(hours=3)).date(),
    )
    assign_log_product(known_custom, custom_brand='Custom Six', custom_nicotine_mg='6.00')

    unknown_strength = Log(
        user_id=test_user.id, quantity=1,
        log_time=now - timedelta(hours=2),
        log_date=(now - timedelta(hours=2)).date(),
        pouch_id=None, custom_brand=None, custom_nicotine_mg=None,
        product_brand_snapshot=None, nicotine_mg_snapshot=None,
    )
    known_zero = Log(
        user_id=test_user.id, quantity=2,
        log_time=now - timedelta(hours=1),
        log_date=(now - timedelta(hours=1)).date(),
        product_brand_snapshot='Known Zero',
        nicotine_mg_snapshot=Decimal('0.00'),
    )
    db_session.add_all([known_custom, unknown_strength, known_zero])
    db_session.commit()

    insights = get_enhanced_insights(test_user.id, days=30)

    assert insights['total_pouches'] == 4, (
        f"all four pouches count toward the total; got {insights['total_pouches']!r}"
    )
    assert insights['total_nicotine'] == 6.0, (
        'only known strengths count: 1 x 6.00 snapshot plus the known 0.00 '
        'snapshot (zero, not unknown); the NULL-snapshot row must be '
        f"excluded; got {insights['total_nicotine']!r}"
    )
    assert insights.get('unknown_strength_count') == 1, (
        'insights must expose an explicit unknown-strength event count: '
        'exactly the one NULL-snapshot row; the known 0.00 snapshot is '
        f"known; got {insights.get('unknown_strength_count')!r}"
    )


def test_weekly_report_uses_authoritative_half_open_log_time_window(
        db_session, test_user):
    # The weekly report window must be the half-open authoritative log_time
    # interval of the prior user-local week: [2026-07-20 00:00 UTC,
    # 2026-07-27 00:00 UTC) under the frozen Monday clock (test_user is UTC).
    # Both rows carry a legacy log_date that deliberately disagrees.
    db_session.add(UserPreferences(
        user_id=test_user.id,
        notification_channel=['email'],
        weekly_reports=True,
    ))

    in_week = Log(
        user_id=test_user.id, quantity=2,
        log_time=datetime(2026, 7, 22, 10, 0),   # inside prior week by log_time
        log_date=date(2026, 7, 29),              # legacy: outside the week
    )
    assign_log_product(in_week, custom_brand='In Week Custom', custom_nicotine_mg='4.00')
    at_exclusive_end = Log(
        user_id=test_user.id, quantity=9,
        log_time=datetime(2026, 7, 27, 0, 0),    # exact exclusive end: outside
        log_date=date(2026, 7, 22),              # legacy: inside the week
    )
    assign_log_product(at_exclusive_end, custom_brand='Boundary Custom', custom_nicotine_mg='7.00')
    db_session.add_all([in_week, at_exclusive_end])
    db_session.commit()

    row = _queue_single_weekly_report(test_user)
    payload = row.extra_data

    assert payload['total_logs'] == 1, (
        'only the log_time-in-window row may be counted; the row at the '
        'exact exclusive end must be excluded despite its legacy log_date '
        f"lying inside the week; got {payload['total_logs']!r}"
    )
    assert payload['total_pouches'] == 2, (
        f"2 pouches from the in-window row; got {payload['total_pouches']!r}"
    )
    assert payload['total_nicotine'] == 8.0, (
        f"2 x 4.00mg from the in-window snapshot; got {payload['total_nicotine']!r}"
    )
    assert payload['week_start'] == '2026-07-20', (
        f"prior week starts Monday 2026-07-20; got {payload['week_start']!r}"
    )
    assert payload['week_end'] == '2026-07-26', (
        f"prior week ends Sunday 2026-07-26; got {payload['week_end']!r}"
    )


def test_weekly_report_uses_snapshots_and_counts_unknown_events(
        db_session, test_user):
    # Report nicotine must come from the immutable snapshots only: the
    # NULL-snapshot legacy row is unknown (counted, excluded from mg) even
    # though its referenced pouch is live, and the known 0.00 snapshot
    # contributes zero rather than the live pouch strength.
    db_session.add(UserPreferences(
        user_id=test_user.id,
        notification_channel=['email'],
        weekly_reports=True,
    ))
    live_pouch = Pouch(
        brand='Live Report Brand', nicotine_mg=Decimal('9.00'),
        is_default=False, created_by=test_user.id,
    )
    db_session.add(live_pouch)
    db_session.flush()

    known_custom = Log(
        user_id=test_user.id, quantity=1,
        log_time=datetime(2026, 7, 21, 9, 0), log_date=date(2026, 7, 21),
    )
    assign_log_product(known_custom, custom_brand='Report Custom Six', custom_nicotine_mg='6.00')
    # Deliberately hand-built snapshot-semantic rows: no assign_log_product.
    legacy_unknown = Log(
        user_id=test_user.id, quantity=2,
        log_time=datetime(2026, 7, 22, 9, 0), log_date=date(2026, 7, 22),
        pouch_id=live_pouch.id, custom_brand=None, custom_nicotine_mg=None,
        product_brand_snapshot=None, nicotine_mg_snapshot=None,
    )
    known_zero = Log(
        user_id=test_user.id, quantity=3,
        log_time=datetime(2026, 7, 23, 9, 0), log_date=date(2026, 7, 23),
        pouch_id=live_pouch.id,
        product_brand_snapshot='Known Zero',
        nicotine_mg_snapshot=Decimal('0.00'),
    )
    db_session.add_all([known_custom, legacy_unknown, known_zero])
    db_session.commit()

    row = _queue_single_weekly_report(test_user)
    payload = row.extra_data

    for key in (
        'week_start', 'week_end', 'total_logs', 'total_pouches',
        'total_nicotine', 'daily_average_pouches', 'daily_average_mg',
        'goals_count', 'goals_on_track', 'active_streaks',
    ):
        assert key in payload, (
            f'the weekly report payload must preserve the {key!r} key; '
            f'payload keys were {sorted(payload)!r}'
        )

    assert payload['total_logs'] == 3, (
        f"all three in-window rows are report events; got {payload['total_logs']!r}"
    )
    assert payload['total_pouches'] == 6, (
        f"1 + 2 + 3 pouches regardless of strength knowledge; got {payload['total_pouches']!r}"
    )
    assert payload['total_nicotine'] == 6.0, (
        'only known snapshots count: 1 x 6.00 plus the known 0.00 snapshot; '
        'the NULL-snapshot row must be excluded, never back-filled from the '
        f"live 9.00mg pouch; got {payload['total_nicotine']!r}"
    )
    assert payload.get('unknown_strength_count') == 1, (
        'the payload must expose an explicit unknown-strength event count: '
        'exactly the one NULL-snapshot row despite its live pouch; the zero '
        f"snapshot is known; got {payload.get('unknown_strength_count')!r}"
    )


def test_weekly_report_blank_timezone_warns_once_with_request_id(
        db_session, caplog):
    # A blank persisted timezone is invalid legacy data: queuing must still
    # succeed (UTC fallback), but must emit exactly one 'Invalid persisted
    # timezone' warning carrying the bound request correlation ID, both in
    # the formatted message and as record.request_id.
    blank_user = _create_user_with_timezone(
        db_session, 'blank-tz-report@example.com', ''
    )
    db_session.add(UserPreferences(
        user_id=blank_user.id,
        notification_channel=['email'],
        weekly_reports=True,
    ))
    in_week = Log(
        user_id=blank_user.id, quantity=1,
        log_time=datetime(2026, 7, 22, 10, 0), log_date=date(2026, 7, 22),
    )
    assign_log_product(in_week, custom_brand='Blank TZ Custom', custom_nicotine_mg='6.00')
    db_session.add(in_week)
    db_session.commit()

    request_id = bind_request_id('123e4567-e89b-42d3-a456-426614174000')
    with caplog.at_level(logging.WARNING):
        with patch(
            'services.notification_service.tz_service.get_current_user_time',
            return_value=FROZEN_REPORT_CLOCK,
        ):
            queued = NotificationService().queue_weekly_report(blank_user)

    assert queued is True, (
        'queuing must succeed via the UTC fallback despite the blank '
        f'persisted timezone; got {queued!r}'
    )
    rows = NotificationQueue.query.filter_by(
        user_id=blank_user.id, category='weekly_report'
    ).all()
    assert len(rows) == 1, (
        f'exactly one weekly_report queue row must exist; got {len(rows)}'
    )

    warnings = [
        record for record in caplog.records
        if record.levelno == logging.WARNING
        and 'Invalid persisted timezone' in record.getMessage()
    ]
    assert len(warnings) == 1, (
        'exactly one Invalid persisted timezone warning must be emitted for '
        f'the blank timezone; got {len(warnings)}: '
        f'{[r.getMessage() for r in warnings]!r}'
    )
    record = warnings[0]
    assert request_id in record.getMessage(), (
        'the formatted warning must carry the request correlation ID; got '
        f'{record.getMessage()!r}'
    )
    assert getattr(record, 'request_id', None) == request_id, (
        'the warning record must expose the request correlation ID as '
        f'record.request_id; got {getattr(record, "request_id", None)!r}'
    )


# ---------------------------------------------------------------------------
# Fix-round service authority tests. These use in-memory rows so each failure
# isolates the helper contract rather than fixture persistence.
# ---------------------------------------------------------------------------


def test_log_effective_day_uses_canonical_spring_gap_reset():
    resolved_tz = resolve_timezone('America/New_York')
    log = Log(
        quantity=1,
        log_time=datetime(2024, 3, 10, 7, 15),  # 03:15 EDT, naive storage UTC
    )

    assert log_effective_day(log, resolved_tz, time(2, 30)) == date(2024, 3, 9), (
        'the nonexistent 02:30 EST reset canonically shifts to 03:30 EDT '
        '(07:30 UTC); 07:15 UTC is before that reset and belongs to March 9'
    )


def test_log_effective_day_uses_canonical_fall_back_reset():
    resolved_tz = resolve_timezone('America/New_York')
    log = Log(
        quantity=1,
        log_time=datetime(2024, 11, 3, 6, 15),  # second 01:15, EST
    )

    assert log_effective_day(log, resolved_tz, time(1, 30)) == date(2024, 11, 3), (
        'the ambiguous 01:30 reset canonically uses the earlier occurrence '
        '(05:30 UTC); 06:15 UTC is after that reset and belongs to November 3'
    )


def test_summarize_logs_accepts_generator_and_counts_events():
    known = Log(
        quantity=2,
        log_time=datetime(2025, 3, 10, 8, 0),
        nicotine_mg_snapshot=Decimal('6.00'),
    )
    unknown = Log(
        quantity=3,
        log_time=datetime(2025, 3, 10, 9, 0),
        nicotine_mg_snapshot=None,
        custom_nicotine_mg=None,
    )

    result = summarize_logs(log for log in (known, unknown))

    assert result['total_logs'] == 2
    assert result['total_pouches'] == 5
    assert result['total_mg'] == Decimal('12.00')
    assert result['unknown_strength_count'] == 1


def test_historical_brand_empty_snapshot_is_authoritative():
    log = Log(
        quantity=1,
        log_time=datetime(2025, 3, 10, 8, 0),
        product_brand_snapshot='',
        custom_brand='Mutable fallback',
    )

    assert get_historical_brand(log) == ''


def test_weekly_report_selects_latest_fully_completed_non_midnight_reset_week(
        db_session, test_user):
    db_session.add(UserPreferences(
        user_id=test_user.id,
        notification_channel=['email'],
        weekly_reports=True,
        daily_reset_time=time(12, 0),
    ))
    completed_week = Log(
        user_id=test_user.id,
        quantity=2,
        log_time=datetime(2026, 7, 15, 13, 0),
        log_date=date(2026, 7, 22),
    )
    assign_log_product(
        completed_week,
        custom_brand='Completed Week Custom',
        custom_nicotine_mg='4.00',
    )
    incomplete_week = Log(
        user_id=test_user.id,
        quantity=99,
        log_time=datetime(2026, 7, 22, 13, 0),
        log_date=date(2026, 7, 15),
    )
    assign_log_product(
        incomplete_week,
        custom_brand='Incomplete Week Custom',
        custom_nicotine_mg='9.00',
    )
    db_session.add_all([completed_week, incomplete_week])
    db_session.commit()

    before_reset_clock = (
        datetime(2026, 7, 27, 10, 0, tzinfo=timezone.utc),
        date(2026, 7, 27),
        time(10, 0),
    )
    with patch(
        'services.notification_service.tz_service.get_current_user_time',
        return_value=before_reset_clock,
    ):
        queued = NotificationService().queue_weekly_report(test_user)

    assert queued is True
    payload = NotificationQueue.query.filter_by(
        user_id=test_user.id, category='weekly_report'
    ).one().extra_data
    assert payload['week_start'] == '2026-07-13'
    assert payload['week_end'] == '2026-07-19'
    assert payload['total_logs'] == 1
    assert payload['total_pouches'] == 2
    assert payload['total_nicotine'] == 8.0


def test_weekly_report_blank_timezone_with_active_daily_goal_warns_once(
        db_session, caplog):
    blank_user = _create_user_with_timezone(
        db_session, 'blank-tz-goal-report@example.com', ''
    )
    db_session.add_all([
        UserPreferences(
            user_id=blank_user.id,
            notification_channel=['email'],
            weekly_reports=True,
        ),
        Goal(
            user_id=blank_user.id,
            goal_type='daily_pouches',
            target_value=5,
            start_date=date(2026, 7, 1),
            is_active=True,
        ),
    ])
    db_session.commit()

    request_id = bind_request_id('223e4567-e89b-42d3-a456-426614174001')
    with caplog.at_level(logging.WARNING):
        with patch(
            'services.notification_service.tz_service.get_current_user_time',
            return_value=FROZEN_REPORT_CLOCK,
        ):
            queued = NotificationService().queue_weekly_report(blank_user)

    assert queued is True
    rows = NotificationQueue.query.filter_by(
        user_id=blank_user.id, category='weekly_report'
    ).all()
    assert len(rows) == 1
    warnings = [
        record for record in caplog.records
        if record.levelno == logging.WARNING
        and 'Invalid persisted timezone' in record.getMessage()
    ]
    assert len(warnings) == 1, (
        'the report and active-goal calculation must share one resolved '
        f'timezone; got {len(warnings)} warnings: '
        f'{[record.getMessage() for record in warnings]!r}'
    )
    assert request_id in warnings[0].getMessage()
    assert getattr(warnings[0], 'request_id', None) == request_id
