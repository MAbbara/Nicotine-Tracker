import pytest
from bs4 import BeautifulSoup


def test_manifest_is_root_scoped_standalone_json(client):
    response = client.get('/manifest.webmanifest')

    assert response.status_code == 200
    assert response.mimetype == 'application/manifest+json'

    manifest = response.get_json()
    assert manifest['id'] == '/'
    assert manifest['name'] == 'Nicotine Tracker'
    assert manifest['short_name'] == 'Nicotine Tracker'
    assert manifest['start_url'] == '/'
    assert manifest['scope'] == '/'
    assert manifest['display'] == 'standalone'
    assert manifest['theme_color'] == '#F5F1E7'
    assert manifest['background_color'] == '#F5F1E7'

    icons = {icon['sizes']: icon for icon in manifest['icons']}
    assert icons['192x192']['src'] == '/static/icons/pwa/icon-192.png'
    assert icons['512x512']['src'] == '/static/icons/pwa/icon-512.png'
    assert icons['512x512']['purpose'] == 'any maskable'


@pytest.mark.parametrize('path', [
    '/static/icons/pwa/icon-180.png',
    '/static/icons/pwa/icon-192.png',
    '/static/icons/pwa/icon-512.png',
])
def test_declared_pwa_icons_are_available(client, path):
    response = client.get(path)

    assert response.status_code == 200
    assert response.mimetype == 'image/png'


def test_public_auth_and_authenticated_pages_link_the_manifest(
    app, logged_in_client,
):
    public_client = app.test_client()
    for response in (
        public_client.get('/'),
        public_client.get('/auth/login'),
        logged_in_client.get('/today/'),
    ):
        assert response.status_code == 200
        soup = BeautifulSoup(response.data, 'html.parser')
        assert soup.find('link', rel='manifest', href='/manifest.webmanifest')


def test_manifest_scope_covers_primary_navigation(logged_in_client):
    response = logged_in_client.get('/today/')
    soup = BeautifulSoup(response.data, 'html.parser')

    hrefs = [link.get('href', '') for link in soup.select('[data-primary-navigation] a')]
    assert hrefs
    assert all(href.startswith('/') for href in hrefs)
    assert all(not href.startswith('//') for href in hrefs)


def test_offline_shell_is_public_and_contains_no_account_data(client):
    response = client.get('/offline')
    assert response.status_code == 200
    assert b'Today, offline' in response.data
    assert b'csrf-token' not in response.data


def test_offline_context_requires_authentication(client):
    assert client.get('/api/offline-context').status_code == 401


def test_offline_context_is_minimal_and_scoped(logged_in_client, test_user, test_pouch, db_session):
    from models import UserPreferences
    db_session.add(UserPreferences(user_id=test_user.id, offline_queue_enabled=True))
    db_session.commit()
    response = logged_in_client.get('/api/offline-context')
    assert response.status_code == 200
    data = response.get_json()
    assert set(data) == {'offline_queue_id', 'pouches'}
    assert data['offline_queue_id']
    assert response.headers['X-Offline-Queue-ID'] == data['offline_queue_id']
    assert 'no-store' in response.headers['Cache-Control']
    for pouch in data['pouches']:
        assert set(pouch) == {'id', 'brand', 'nicotine_mg'}


def test_offline_replay_rejects_another_account_scope(logged_in_client):
    response = logged_in_client.post('/api/logs', json={}, headers={
        'X-Offline-Queue-ID': 'another-account',
    })
    assert response.status_code == 403


def test_logout_revokes_offline_context(logged_in_client):
    response = logged_in_client.get('/auth/logout')
    assert response.headers['X-Offline-Queue-ID'] == 'disabled'


def test_disabled_offline_context_contains_no_products(logged_in_client, test_user, db_session):
    from models import UserPreferences
    db_session.add(UserPreferences(user_id=test_user.id, offline_queue_enabled=False))
    db_session.commit()
    response = logged_in_client.get('/api/offline-context')
    assert response.get_json() == {'offline_queue_id': None, 'pouches': []}
    assert response.headers['X-Offline-Queue-ID'] == 'disabled'
