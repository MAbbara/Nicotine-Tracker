"""Compatibility Dashboard route, content, and analytics contracts."""

from datetime import datetime, time, timedelta, timezone
from pathlib import Path
import re

from bs4 import BeautifulSoup
from sqlalchemy import event

from models import Log, User
import routes.dashboard as dashboard_routes
from services import log_service


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BANNED_PALETTE = (
    'bg-indigo-', 'text-indigo-', 'border-indigo-', 'ring-indigo-',
    'outline-indigo-', 'bg-purple-', 'text-purple-', 'bg-violet-',
    'bg-fuchsia-', 'bg-blue-', 'text-blue-', 'border-blue-',
)


def _document(response):
    assert response.status_code == 200
    return BeautifulSoup(response.data, 'html.parser')


def _add_log(db_session, user, pouch, *, logged_at, quantity, notes=''):
    log = Log(
        user_id=user.id,
        quantity=quantity,
        log_time=logged_at,
        notes=notes,
    )
    if pouch is None:
        log_service.assign_log_product(
            log,
            custom_brand='Other user product',
            custom_nicotine_mg='12.00',
        )
    else:
        log_service.assign_log_product(log, pouch_id=pouch.id)
    db_session.add(log)
    return log


def test_dashboard_is_a_single_compatibility_summary_with_one_eligible_trend(
        logged_in_client, db_session, test_user, test_pouch, test_log):
    yesterday = datetime.now(timezone.utc) - timedelta(days=1)
    _add_log(
        db_session, test_user, test_pouch,
        logged_at=yesterday,
        quantity=3,
        notes='Owned dashboard trend',
    )
    db_session.commit()

    document = _document(logged_in_client.get('/dashboard/'))
    text = document.get_text(' ', strip=True)

    assert len(document.select('main h1')) == 1
    assert document.select_one('main h1').get_text(' ', strip=True) == 'Dashboard'
    assert 'compatibility' in text.casefold()
    assert len(document.select('[data-dashboard-today]')) == 1
    assert document.select_one('[data-dashboard-today] h2').get_text(' ', strip=True) == 'Today at a glance'
    assert document.select_one('[data-dashboard-today] [data-today-pouches]').get_text(strip=True) == '2'
    assert document.select_one('[data-dashboard-today] [data-today-mg]').get_text(strip=True) == '8.0'
    assert document.select_one('[data-dashboard-today] [data-today-sessions]').get_text(strip=True) == '1'

    destinations = {
        link.get_text(' ', strip=True): link.get('href')
        for link in document.select('[data-dashboard-destinations] a')
    }
    assert destinations == {
        'Go to Today': '/today/',
        'Open Insights': '/insights/',
        'Review Journey': '/journey/',
    }

    figures = document.select('figure[data-dashboard-trend]')
    assert len(figures) == 1
    assert len(document.select('.analytics-chart')) == 1
    assert figures[0].select_one('#dashboard-trend-chart[role="img"][aria-labelledby="dashboard-trend-title"]')
    table = figures[0].select_one('table')
    assert table.select_one('caption').get_text(' ', strip=True) == 'Recent daily intake data'
    assert [
        cell.get_text(strip=True)
        for row in table.select('tbody tr')
        for cell in row.select('th, td')
    ].count('3') >= 1
    assert document.select_one('#initial-dashboard-analytics[type="application/json"]')
    assert document.select_one('script[src$="/static/js/dashboard-charts.js"]')
    assert document.select_one('script[src$="/static/js/apexcharts.min.js"]')

    assert not document.select('[data-analytics-disclosure-trigger], [data-analytics-disclosure-menu]')
    assert not document.select('#addLogModal, [data-hs-overlay], [data-dashboard-table="hourly"]')
    assert 'Add Log Entry' not in text
    assert 'Quick Log' not in text
    assert 'Your Goals' not in text
    assert 'Recent Logs' not in text


def test_empty_dashboard_teaches_next_steps_without_an_empty_chart_frame(
        logged_in_client):
    document = _document(logged_in_client.get('/dashboard/'))
    text = document.get_text(' ', strip=True)

    assert len(document.select('[data-dashboard-today]')) == 1
    assert document.select_one('[data-dashboard-empty]')
    assert 'Start with Today' in text
    assert not document.select('figure[data-dashboard-trend], .analytics-chart')
    assert not document.select('#initial-dashboard-analytics')
    sources = [script.get('src', '') for script in document.select('script[src]')]
    assert not any('apexcharts' in source or 'dashboard-charts' in source for source in sources)


def test_dashboard_analytics_endpoints_remain_authenticated_owned_and_compatible(
        app, logged_in_client, db_session, test_user, test_pouch, monkeypatch):
    frozen_utc = datetime(2026, 8, 1, 22, 30, tzinfo=timezone.utc)

    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            if tz is None:
                return frozen_utc.replace(tzinfo=None)
            return frozen_utc.astimezone(tz)

    monkeypatch.setattr(dashboard_routes, 'datetime', FrozenDateTime)
    assert (frozen_utc + timedelta(hours=3)).date() != frozen_utc.date()
    account_today = frozen_utc.date()

    other = User(email='dashboard-other@example.com', email_verified=True, timezone='UTC')
    other.set_password('not-used-here')
    db_session.add(other)
    db_session.flush()

    start = account_today - timedelta(days=2)
    end = start + timedelta(days=1)
    _add_log(
        db_session, test_user, test_pouch,
        logged_at=datetime.combine(start, time(9, 0), timezone.utc),
        quantity=4,
    )
    _add_log(
        db_session, other, None,
        logged_at=datetime.combine(start, time(9, 0), timezone.utc),
        quantity=99,
    )
    db_session.commit()

    anonymous = app.test_client()
    for path in (
            '/dashboard/',
            '/dashboard/api/daily_intake_chart',
            '/dashboard/api/hourly_distribution',
            '/dashboard/api/weekly_averages'):
        response = anonymous.get(path)
        assert response.status_code == 302
        assert '/auth/login' in response.headers['Location']

    query = f'start_date={start.isoformat()}&end_date={end.isoformat()}'
    daily = logged_in_client.get(f'/dashboard/api/daily_intake_chart?{query}')
    hourly = logged_in_client.get(f'/dashboard/api/hourly_distribution?{query}')
    weekly = logged_in_client.get('/dashboard/api/weekly_averages?weeks=2')

    assert daily.status_code == hourly.status_code == weekly.status_code == 200
    assert daily.get_json()['success'] is True
    assert daily.get_json()['data'] == [
        {
            'date': start.isoformat(),
            'pouches': 4,
            'mg': 16.0,
            'unknown_strength_count': 0,
        },
        {
            'date': end.isoformat(),
            'pouches': 0,
            'mg': 0.0,
            'unknown_strength_count': 0,
        },
    ]
    assert hourly.get_json()['success'] is True
    assert hourly.get_json()['data'][9] == {'hour': '09:00', 'pouches': 4}
    assert sum(item['pouches'] for item in hourly.get_json()['data']) == 4
    assert weekly.get_json()['success'] is True
    weekly_data = weekly.get_json()['data']
    assert weekly_data == [
        {
            'week_start': (account_today - timedelta(days=13)).isoformat(),
            'week_end': (account_today - timedelta(days=7)).isoformat(),
            'avg_pouches': 0,
            'avg_mg': 0,
            'total_pouches': 0,
            'total_mg': 0,
            'unknown_strength_count': 0,
        },
        {
            'week_start': (account_today - timedelta(days=6)).isoformat(),
            'week_end': account_today.isoformat(),
            'avg_pouches': 0.6,
            'avg_mg': 2.3,
            'total_pouches': 4,
            'total_mg': 16.0,
            'unknown_strength_count': 0,
        },
    ]
    assert sum(week['total_pouches'] for week in weekly_data) == 4
    assert 99 not in [week['total_pouches'] for week in weekly_data]


def test_dashboard_custom_date_range_validation_contract_is_retained(
        logged_in_client):
    for endpoint in ('daily_intake_chart', 'hourly_distribution'):
        missing = logged_in_client.get(
            f'/dashboard/api/{endpoint}?start_date=2026-01-01'
        )
        reversed_range = logged_in_client.get(
            f'/dashboard/api/{endpoint}?start_date=2026-01-03&end_date=2026-01-01'
        )

        assert missing.status_code == 400
        assert missing.get_json()['error'] == 'Choose both a start and end date.'
        assert reversed_range.status_code == 400
        assert reversed_range.get_json() == {
            'success': False,
            'error': 'Start date must be on or before end date.',
        }


def test_dashboard_index_builds_summary_and_trend_from_one_log_select(
        logged_in_client, db_session, test_user, test_pouch):
    for offset in range(30):
        _add_log(
            db_session,
            test_user,
            test_pouch,
            logged_at=datetime.now(timezone.utc) - timedelta(days=offset),
            quantity=1,
        )
    db_session.commit()
    engine = db_session.get_bind()
    statements = []

    def capture(_connection, _cursor, statement, _parameters, _context, _many):
        if statement.lstrip().upper().startswith('SELECT'):
            statements.append(' '.join(statement.casefold().split()))

    event.listen(engine, 'before_cursor_execute', capture)
    try:
        response = logged_in_client.get('/dashboard/')
    finally:
        event.remove(engine, 'before_cursor_execute', capture)

    log_selects = [
        statement for statement in statements
        if re.search(r'\bfrom\s+"?log"?\b', statement)
    ]
    assert response.status_code == 200
    assert len(log_selects) == 1, (
        f'expected one 30-day log SELECT, observed {len(log_selects)}'
    )


def test_dashboard_unknown_strength_copy_counts_log_entries(
        logged_in_client, db_session, test_user):
    db_session.add(Log(
        user_id=test_user.id,
        quantity=4,
        log_time=datetime.now(timezone.utc),
        product_brand_snapshot='Strength missing',
    ))
    db_session.commit()

    document = _document(logged_in_client.get('/dashboard/'))
    note = document.select_one('.dashboard-today__note')

    assert note is not None
    assert note.get_text(' ', strip=True) == (
        '1 log entry has no saved strength, so today’s nicotine total is incomplete.'
    )


def test_dashboard_template_retires_legacy_palette_grid_and_controllers():
    source = (
        PROJECT_ROOT / 'templates' / 'dashboard' / 'dashboard.html'
    ).read_text().casefold()

    for token in BANNED_PALETTE:
        assert token not in source, token
    assert 'grid-cols-4' not in source
    assert '_add_log_modal' not in source
    assert 'data-hs-overlay' not in source
    assert 'apply_custom_range' not in source
    assert 'hourlychart' not in source
    assert 'dark:' not in source
