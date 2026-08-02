"""Logging route and editorial Logbook contracts."""

from datetime import date, datetime, time, timedelta
from pathlib import Path

from bs4 import BeautifulSoup

from models import Log, User, UserPreferences
from services.log_service import assign_log_product


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LOGGING_TEMPLATES = (
    'view_logs.html', '_add_log_modal.html', 'add_log.html',
    'edit_log.html', 'bulk_add.html',
)
BANNED_PALETTE = (
    'bg-indigo-', 'text-indigo-', 'border-indigo-', 'ring-indigo-',
    'outline-indigo-', 'bg-purple-', 'text-purple-', 'bg-violet-',
    'bg-fuchsia-', 'bg-blue-', 'text-blue-',
)


def test_logbook_renders_editorial_rows_filters_and_one_add_action(
        logged_in_client, test_log):
    response = logged_in_client.get('/log/view')
    document = BeautifulSoup(response.data, 'html.parser')

    assert response.status_code == 200
    assert document.select_one('main h1').get_text(' ', strip=True) == 'Logbook'
    assert len(document.select('main h1')) == 1
    assert document.select_one('form.logbook-filters[method="get"]')
    assert document.select_one('input[name="q"]')
    assert document.select_one('input[name="from_date"][type="date"]')
    assert document.select_one('input[name="to_date"][type="date"]')
    assert len(document.select('[data-logbook-add-action]')) == 1
    assert len(document.select('.logbook-page [data-hs-overlay="#addLogModal"]')) == 3
    row = document.select_one('article.logbook-row')
    assert row is not None
    assert row.select_one('time[datetime]')
    assert row.select_one('time[datetime]')['datetime'].endswith('Z')
    assert 'Test Brand' in row.get_text(' ', strip=True)
    assert 'Test log entry' in row.get_text(' ', strip=True)
    assert document.select_one('.horizontal-scroll-region') is None
    assert document.select_one('table') is None


def test_logbook_filter_is_user_scoped_and_keeps_local_date_bounds(
        logged_in_client, db_session, test_user, test_pouch):
    older = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2026, 1, 5, 9, 0),
        notes='morning marker',
    )
    newer = Log(
        user_id=test_user.id,
        quantity=2,
        log_time=datetime(2026, 1, 8, 17, 30),
        notes='evening marker',
    )
    for log in (older, newer):
        assign_log_product(log, pouch_id=test_pouch.id)
    db_session.add_all([older, newer])
    db_session.commit()

    response = logged_in_client.get(
        '/log/view?q=evening&from_date=2026-01-08&to_date=2026-01-08'
    )
    document = BeautifulSoup(response.data, 'html.parser')
    rows = document.select('article.logbook-row')

    assert response.status_code == 200
    assert len(rows) == 1
    assert 'evening marker' in rows[0].get_text(' ', strip=True)
    assert 'morning marker' not in response.get_data(as_text=True)
    assert document.select_one('input[name="q"]')['value'] == 'evening'
    assert document.select_one('input[name="from_date"]')['value'] == '2026-01-08'
    assert document.select_one('input[name="to_date"]')['value'] == '2026-01-08'


def test_logbook_date_filter_uses_effective_day_boundary_and_stays_user_scoped(
        logged_in_client, db_session, test_user, test_pouch):
    test_user.timezone = 'Asia/Riyadh'
    db_session.add(UserPreferences(
        user_id=test_user.id,
        daily_reset_time=time(4, 0),
    ))
    other = User(
        email='other-logbook@example.com',
        email_verified=True,
        timezone='Asia/Riyadh',
    )
    other.set_password('password123')
    db_session.add(other)
    db_session.flush()

    # 23:30 UTC is 02:30 on January 10 in Riyadh, before the 04:00 reset,
    # and therefore belongs to the effective January 9 user day.
    owned = Log(
        user_id=test_user.id,
        quantity=1,
        log_time=datetime(2026, 1, 9, 23, 30),
        notes='owned reset-boundary marker',
    )
    foreign = Log(
        user_id=other.id,
        quantity=1,
        log_time=datetime(2026, 1, 9, 23, 30),
        notes='foreign reset-boundary marker',
        product_brand_snapshot='Foreign product',
        nicotine_mg_snapshot=4,
    )
    assign_log_product(owned, pouch_id=test_pouch.id)
    db_session.add_all([owned, foreign])
    db_session.commit()

    response = logged_in_client.get(
        '/log/view?from_date=2026-01-09&to_date=2026-01-09'
    )
    document = BeautifulSoup(response.data, 'html.parser')
    text = document.get_text(' ', strip=True)

    assert response.status_code == 200
    assert len(document.select('article.logbook-row')) == 1
    assert 'owned reset-boundary marker' in text
    assert 'foreign reset-boundary marker' not in text
    assert 'Friday, January 9' in text


def test_logbook_daily_total_is_complete_when_pagination_splits_one_day(
        app, logged_in_client, db_session, test_user, test_pouch):
    app.config['LOGS_PER_PAGE'] = 2
    for minute in range(3):
        log = Log(
            user_id=test_user.id,
            quantity=1,
            log_time=datetime(2026, 1, 10, 9, minute),
            notes=f'page split {minute}',
        )
        assign_log_product(log, pouch_id=test_pouch.id)
        db_session.add(log)
    db_session.commit()

    for page in (1, 2):
        response = logged_in_client.get(f'/log/view?page={page}')
        document = BeautifulSoup(response.data, 'html.parser')
        heading = document.select_one('.logbook-day__heading')
        assert response.status_code == 200
        assert heading is not None
        assert '3 pouches' in heading.get_text(' ', strip=True)


def test_editing_notes_without_changing_rendered_time_preserves_timestamp(
        logged_in_client, db_session, test_log):
    original_timestamp = test_log.log_time
    response = logged_in_client.post(f'/log/edit/{test_log.id}', data={
        'log_date': test_log.get_user_date('UTC').isoformat(),
        'log_time': test_log.get_user_time('UTC').strftime('%H:%M'),
        'quantity': str(test_log.quantity),
        'notes': 'notes only update',
    })

    db_session.refresh(test_log)
    assert response.status_code == 302
    assert test_log.log_time == original_timestamp
    assert test_log.notes == 'notes only update'


def test_bulk_blank_date_uses_account_local_today(
        logged_in_client, monkeypatch, test_user):
    import routes.logging as logging_routes

    test_user.timezone = 'Asia/Tokyo'
    fixed_local = datetime(2026, 1, 11, 0, 30)
    monkeypatch.setattr(
        logging_routes,
        'get_current_user_time',
        lambda timezone_name: (fixed_local, date(2026, 1, 11), time(0, 30)),
    )
    captured = {}

    def capture_bulk(*, user_id, entries, log_date, user_timezone):
        captured.update({
            'user_id': user_id,
            'entries': entries,
            'log_date': log_date,
            'user_timezone': user_timezone,
        })
        return len(entries)

    monkeypatch.setattr(logging_routes, 'add_bulk_logs', capture_bulk)

    get_response = logged_in_client.get('/log/bulk')
    get_document = BeautifulSoup(get_response.data, 'html.parser')
    post_response = logged_in_client.post('/log/bulk', data={
        'log_date': '',
        'bulk_text': '1 pouch at 09:00',
    })

    assert get_response.status_code == 200
    assert get_document.select_one('input[name="log_date"]')['value'] == '2026-01-11'
    assert post_response.status_code == 302
    assert captured['log_date'] == date(2026, 1, 11)
    assert captured['user_timezone'] == 'Asia/Tokyo'


def test_global_javascript_never_overwrites_logging_time_fields():
    source = (PROJECT_ROOT / 'static' / 'js' / 'main.js').read_text()
    assert "getElementById('log_time')" not in source
    assert 'Set current time as default' not in source


def test_add_modal_and_logging_forms_preserve_submission_contracts(
        logged_in_client, test_log):
    view = BeautifulSoup(logged_in_client.get('/log/view').data, 'html.parser')
    modal = view.select_one('#addLogModal form.logging-form')
    assert modal is not None
    assert modal.get('action') == '/log/add'
    assert modal.select_one('input[name="csrf_token"]')
    assert modal.select_one('input[name="log_date"][required]')
    assert modal.select_one('input[name="log_time"]')
    assert modal.select_one('select[name="pouch_id"][required] option[value="custom"]')
    assert modal.select_one('input[name="custom_brand"]')
    strength = modal.select_one('input[name="custom_nicotine_mg"]')
    assert strength and strength.get('min') == '0.01' and strength.get('step') == '0.01'
    quantity = modal.select_one('input[name="quantity"][required]')
    assert quantity.get('min') == '1' and quantity.get('max') == '50'
    assert modal.select_one('textarea[name="notes"]')
    assert modal.select_one('input[name="user_timezone"]')

    edit = BeautifulSoup(
        logged_in_client.get(f'/log/edit/{test_log.id}').data,
        'html.parser',
    )
    edit_form = edit.select_one('form.logging-form')
    assert edit_form.select_one('input[name="csrf_token"]')
    assert edit_form.select_one('input[name="log_date"][required]')
    assert edit_form.select_one('input[name="log_time"]')
    assert edit_form.select_one('input[name="quantity"][min="1"][max="50"][required]')
    assert edit_form.select_one('textarea[name="notes"]')

    bulk = BeautifulSoup(logged_in_client.get('/log/bulk').data, 'html.parser')
    bulk_form = bulk.select_one('form.logging-form')
    assert bulk_form.select_one('input[name="csrf_token"]')
    assert bulk_form.select_one('input[name="log_date"][type="date"]')
    assert bulk_form.select_one('textarea[name="bulk_text"][required]')


def test_saved_and_custom_products_can_be_added_through_the_unified_form(
        logged_in_client, test_user, test_pouch):
    saved_response = logged_in_client.post('/log/add', data={
        'log_date': '2026-01-10',
        'log_time': '09:15',
        'pouch_id': str(test_pouch.id),
        'quantity': '2',
        'notes': 'saved product',
        'user_timezone': 'UTC',
    })
    custom_response = logged_in_client.post('/log/add', data={
        'log_date': '2026-01-10',
        'log_time': '10:30',
        'pouch_id': 'custom',
        'custom_brand': 'Calm Mint',
        'custom_nicotine_mg': '3.50',
        'quantity': '1',
        'notes': 'custom product',
        'user_timezone': 'UTC',
    })

    assert saved_response.status_code == 302
    assert custom_response.status_code == 302
    logs = Log.query.filter_by(user_id=test_user.id).order_by(Log.log_time).all()
    assert len(logs) == 2
    assert logs[0].get_brand_name() == 'Test Brand'
    assert logs[0].quantity == 2
    assert logs[1].get_brand_name() == 'Calm Mint'
    assert float(logs[1].get_nicotine_content()) == 3.5


def test_logging_templates_use_shared_primitives_and_retire_legacy_palette():
    for name in LOGGING_TEMPLATES:
        source = (
            PROJECT_ROOT / 'templates' / 'logging' / name
        ).read_text().casefold()
        assert 'logging-form' in source, name
        for token in BANNED_PALETTE:
            assert token not in source, f'{name}: {token}'
