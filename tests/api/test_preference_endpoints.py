"""Authenticated API contracts for shell preferences and destinations."""

from bs4 import BeautifulSoup
import pytest

from models import UserPreferences, UserSettings
from extensions import db
from services.preference_service import PreferenceService


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


def test_day_boundary_service_first_write_has_one_outer_commit(
        db_session, test_user, monkeypatch):
    UserPreferences.query.filter_by(user_id=test_user.id).delete()
    db_session.commit()
    real_commit = db.session.commit
    commits = []

    def counted_commit():
        commits.append(True)
        return real_commit()

    monkeypatch.setattr(db.session, 'commit', counted_commit)
    PreferenceService().update_day_boundary(
        test_user.id, 'Europe/London', '03:15',
    )

    assert len(commits) == 1
    assert UserPreferences.query.filter_by(user_id=test_user.id).count() == 1


def test_day_boundary_commit_failure_rolls_back_first_write_and_session_is_usable(
        db_session, test_user, monkeypatch):
    UserPreferences.query.filter_by(user_id=test_user.id).delete()
    test_user.timezone = 'UTC'
    db_session.commit()

    def fail_commit():
        raise RuntimeError('forced boundary commit failure')

    monkeypatch.setattr(db.session, 'commit', fail_commit)
    with pytest.raises(RuntimeError, match='forced boundary commit failure'):
        PreferenceService().update_day_boundary(
            test_user.id, 'Europe/London', '03:15',
        )

    assert UserPreferences.query.filter_by(user_id=test_user.id).count() == 0
    assert db_session.get(type(test_user), test_user.id).timezone == 'UTC'


@pytest.mark.parametrize('payload', [
    {'timezone': 'utc', 'daily_reset_time': '03:15'},
    {'timezone': 'Europe/London', 'daily_reset_time': '3:15'},
    {'timezone': 'Europe/London'},
])
def test_day_boundary_api_invalid_first_write_leaves_no_preferences(
        logged_in_client, db_session, test_user, payload):
    UserPreferences.query.filter_by(user_id=test_user.id).delete()
    test_user.timezone = 'UTC'
    db_session.commit()

    response = logged_in_client.patch(
        '/api/preferences/day-boundary', json=payload,
    )

    assert response.status_code == 422
    assert UserPreferences.query.filter_by(user_id=test_user.id).count() == 0
    db_session.refresh(test_user)
    assert test_user.timezone == 'UTC'


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
