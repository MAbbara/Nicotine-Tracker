"""Logging route and editorial Logbook contracts."""

from datetime import datetime, timedelta
from pathlib import Path

from bs4 import BeautifulSoup

from models import Log
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
