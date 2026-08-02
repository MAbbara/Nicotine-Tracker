"""Standalone Craving history page and legacy-adapter contracts."""

import json
from datetime import datetime
from pathlib import Path

from bs4 import BeautifulSoup

from models import Craving, User


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BANNED_PALETTE = (
    'bg-indigo-', 'text-indigo-', 'border-indigo-', 'ring-indigo-',
    'outline-indigo-', 'bg-purple-', 'text-purple-', 'bg-violet-',
    'bg-fuchsia-', 'bg-blue-', 'text-blue-',
)


def test_craving_history_page_has_editorial_fallback_structure_and_all_fields(
        logged_in_client):
    response = logged_in_client.get('/cravings/cravings')
    document = BeautifulSoup(response.data, 'html.parser')

    assert response.status_code == 200
    assert len(document.select('main h1')) == 1
    assert document.select_one('main h1').get_text(' ', strip=True) == 'Craving history'
    headings = [item.get_text(' ', strip=True) for item in document.select('main h2')]
    assert 'Record detailed craving' in headings
    assert 'Recent cravings' in headings
    assert document.select_one('a[href="/today/"]')

    form = document.select_one(
        'form.craving-entry-form[data-endpoint="/cravings/api/cravings"]'
    )
    assert form is not None
    expected_fields = {
        'intensity', 'trigger', 'mood_before', 'stress_level',
        'duration_minutes', 'physical_symptoms', 'situation_context',
        'outcome', 'mood_after', 'notes', 'outcome_notes',
    }
    assert expected_fields == {
        field.get('name') for field in form.select('[name]')
    }
    intensity = form.select_one('input[name="intensity"][required]')
    assert intensity.get('min') == '1' and intensity.get('max') == '10'
    duration = form.select_one('input[name="duration_minutes"]')
    assert duration.get('min') == '0' and duration.get('max') == '1440'
    assert form.select_one('[data-craving-form-status][role="status"]')
    assert document.select_one('#cravings-list[role="list"]')

    html = response.get_data(as_text=True)
    assert 'Cravings Analytics' not in html
    assert 'Resistance Rate' not in html
    assert 'apexcharts' not in html.casefold()
    template_source = (
        PROJECT_ROOT / 'templates' / 'cravings' / 'cravings.html'
    ).read_text()
    assert '<script>' not in template_source
    scripts = [script.get('src', '') for script in document.select('script[src]')]
    assert any('js/cravings/page.js' in source for source in scripts)


def test_craving_history_is_server_rendered_newest_first_and_user_scoped(
        logged_in_client, db_session, test_user):
    older = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 1, 10, 8, 0),
        intensity=4,
        trigger='older owned trigger',
        outcome='resisted',
    )
    newer = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 1, 10, 10, 0),
        intensity=8,
        trigger='newer owned trigger',
        notes='Useful context',
    )
    other = User(email='other-craving@example.com', email_verified=True)
    other.set_password('password123')
    db_session.add(other)
    db_session.flush()
    foreign = Craving(
        user_id=other.id,
        craving_time=datetime(2026, 1, 10, 11, 0),
        intensity=9,
        trigger='foreign trigger',
    )
    db_session.add_all([older, newer, foreign])
    db_session.commit()

    response = logged_in_client.get('/cravings/cravings')
    document = BeautifulSoup(response.data, 'html.parser')
    rows = document.select('article.craving-row')
    text = document.get_text(' ', strip=True)

    assert response.status_code == 200
    assert len(rows) == 2
    assert 'newer owned trigger' in rows[0].get_text(' ', strip=True).casefold()
    assert 'older owned trigger' in rows[1].get_text(' ', strip=True).casefold()
    assert 'foreign trigger' not in text.casefold()
    assert all(row.select_one('time[datetime$="Z"]') for row in rows)


def test_legacy_craving_adapter_accepts_minimal_and_complete_entries(
        logged_in_client, db_session, test_user):
    minimal = logged_in_client.post('/cravings/api/cravings', json={
        'intensity': 3,
    })
    complete = logged_in_client.post('/cravings/api/cravings', json={
        'intensity': 8,
        'trigger': 'stress',
        'mood_before': 4,
        'stress_level': 9,
        'duration_minutes': 12,
        'physical_symptoms': ['restlessness', 'irritability'],
        'situation_context': 'After a difficult meeting',
        'outcome': 'used_alternative',
        'mood_after': 6,
        'notes': 'The urge eased gradually',
        'outcome_notes': 'Walked outside and had water',
    })

    assert minimal.status_code == 201
    assert complete.status_code == 201
    assert minimal.headers['Deprecation'] == 'true'
    saved = Craving.query.filter_by(user_id=test_user.id).order_by(
        Craving.id
    ).all()
    assert len(saved) == 2
    assert saved[0].intensity == 3
    assert saved[0].trigger is None
    assert saved[1].intensity == 8
    assert saved[1].outcome == 'used_alternative'
    assert saved[1].duration_minutes == 12
    assert json.loads(saved[1].physical_symptoms) == [
        'restlessness', 'irritability'
    ]
    assert saved[1].outcome_notes == 'Walked outside and had water'


def test_craving_adapter_rejects_invalid_entry_without_persisting(
        logged_in_client, test_user):
    response = logged_in_client.post('/cravings/api/cravings', json={
        'intensity': 11,
        'notes': 'should not persist',
    })

    assert response.status_code == 400
    assert 'whole number from 1 to 10' in response.get_json()['error']
    assert Craving.query.filter_by(user_id=test_user.id).count() == 0


def test_cravings_template_and_script_retire_legacy_palette_and_inline_markup():
    template = (
        PROJECT_ROOT / 'templates' / 'cravings' / 'cravings.html'
    ).read_text().casefold()
    script = (
        PROJECT_ROOT / 'static' / 'js' / 'cravings' / 'page.js'
    ).read_text().casefold()

    for token in BANNED_PALETTE:
        assert token not in template, token
        assert token not in script, token
    assert 'innerhtml' not in script
    assert 'alert(' not in script
    assert '/cravings/api/analytics' not in script
