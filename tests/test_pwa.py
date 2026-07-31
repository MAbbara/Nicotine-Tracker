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
