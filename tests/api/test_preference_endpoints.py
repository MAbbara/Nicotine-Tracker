"""Authenticated API contracts for shell preferences and destinations."""

from bs4 import BeautifulSoup

from models import UserPreferences, UserSettings


def test_theme_endpoint_persists_valid_choice(
        logged_in_client, db_session, test_user):
    response = logged_in_client.patch(
        '/api/preferences/theme', json={'theme': 'dark'}
    )

    assert response.status_code == 200
    assert response.get_json() == {'success': True, 'theme': 'dark'}
    assert UserSettings.query.filter_by(user_id=test_user.id).one().theme == 'dark'


def test_theme_endpoint_rejects_legacy_auto(logged_in_client):
    response = logged_in_client.patch(
        '/api/preferences/theme', json={'theme': 'auto'}
    )
    assert response.status_code == 400
    assert response.get_json()['success'] is False


def test_day_boundary_endpoint_applies_validated_values(
        logged_in_client, db_session, test_user):
    response = logged_in_client.patch('/api/preferences/day-boundary', json={
        'timezone': 'Europe/London',
        'daily_reset_time': '03:15',
    })

    assert response.status_code == 200
    payload = response.get_json()
    assert payload['timezone'] == 'Europe/London'
    assert payload['daily_reset_time'] == '03:15'
    preferences = UserPreferences.query.filter_by(user_id=test_user.id).one()
    assert preferences.pending_timezone is None


def test_authenticated_shell_has_exactly_five_destinations_in_order(
        logged_in_client):
    response = logged_in_client.get('/today')
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, 'html.parser')
    primary = soup.find('nav', attrs={'aria-label': 'Primary'})
    links = primary.find_all('a')
    assert [link.get_text(' ', strip=True) for link in links] == [
        'Today', 'Logbook', 'Journey', 'Insights', 'You',
    ]
    assert [link['href'] for link in links] == [
        '/today/#main-content', '/log/view#main-content',
        '/journey/#main-content', '/insights/#main-content',
        '/you/#main-content',
    ]
    assert len(primary.find_all(attrs={'aria-current': 'page'})) == 1


def test_all_foundation_destinations_return_useful_pages(logged_in_client):
    for path, heading in (
        ('/today', 'Today'),
        ('/log/view', 'Logbook'),
        ('/journey/', 'Journey'),
        ('/insights/', 'Insights'),
        ('/you', 'You'),
    ):
        response = logged_in_client.get(path)
        assert response.status_code == 200, path
        soup = BeautifulSoup(response.data, 'html.parser')
        assert heading in soup.find('main').get_text(' ', strip=True)
