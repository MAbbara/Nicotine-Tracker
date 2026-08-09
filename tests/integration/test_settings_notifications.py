"""Reminder settings structure, native fields, and persistence contracts."""

from datetime import time
from pathlib import Path
from types import SimpleNamespace

from bs4 import BeautifulSoup
import pytest

from models import UserPreferences
from services.user_preferences_service import UserPreferencesService
from extensions import db

VALID_WEBHOOK = (
    "https://discord.com/api/webhooks/123456789012345678/"
    "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789"
)


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _seed_preferences(db_session, test_user):
    preferences = UserPreferences(
        user_id=test_user.id,
        notification_channel=["email", "discord"],
        goal_notifications=True,
        achievement_notifications=False,
        daily_reminders=True,
        weekly_reports=True,
        discord_webhook=VALID_WEBHOOK,
        reminder_time=time(8, 15),
        quiet_hours_start=time(22, 0),
        quiet_hours_end=time(6, 30),
        notification_frequency="daily",
    )
    db_session.add(preferences)
    db_session.commit()
    return preferences


def test_reminders_uses_editorial_sections_native_fields_and_live_statuses(
        logged_in_client, db_session, test_user):
    _seed_preferences(db_session, test_user)
    response = logged_in_client.get("/settings/notifications")
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, "html.parser")

    assert soup.select_one("main h1").get_text(" ", strip=True) == "Reminders"
    assert [heading.get_text(" ", strip=True) for heading in soup.select(
        ".reminders-section h2"
    )] == [
        "Delivery channel", "What to send", "Timing and quiet hours",
        "Test and preview",
    ]

    form = soup.select_one('form[action="/settings/notifications"][method="POST"]')
    assert form is not None
    assert form.select_one('input[name="csrf_token"][type="hidden"]')
    channels = form.select('input[type="checkbox"][name="notification_channel"]')
    assert {control.get("value") for control in channels} == {"email", "discord"}
    assert all(control.has_attr("checked") for control in channels)
    assert not form.select_one('input[name="achievement_notifications"]').has_attr("checked")
    assert form.select_one('input[name="daily_reminders"][checked]')
    assert form.select_one('input[name="weekly_reports"][checked]')
    assert form.select_one('input[name="discord_webhook"][type="url"]')["value"] == VALID_WEBHOOK
    assert form.select_one('input[name="reminder_time"][type="time"]')["value"] == "08:15"
    assert form.select_one('input[name="quiet_hours_start"][type="time"]')["value"] == "22:00"
    assert form.select_one('input[name="quiet_hours_end"][type="time"]')["value"] == "06:30"
    assert not form.select_one('select[name="notification_frequency"]')

    discord_button = soup.select_one('button#test-discord-webhook[type="button"]')
    weekly_button = soup.select_one('button#trigger-weekly-report[type="button"]')
    assert discord_button.get_text(" ", strip=True) == "Test Discord connection"
    assert weekly_button.get_text(" ", strip=True) == "Send weekly report"
    for status_id in ("discord-test-status", "weekly-report-status"):
        status = soup.select_one(f"#{status_id}[role='status'][aria-live='polite']")
        assert status is not None
    assert form.select_one(
        '.settings-save-row button.c-button.c-button--primary[type="submit"]'
    ).get_text(" ", strip=True) == "Save reminders"

    module = soup.select_one(
        'script[type="module"][src="/static/js/settings/notifications.js"]'
    )
    assert module is not None
    assert not soup.find_all("script", string=lambda text: text and "fetch(" in text)


def test_reminders_post_persists_every_server_field(
        logged_in_client, db_session, test_user):
    response = logged_in_client.post("/settings/notifications", data={
        "notification_channel": ["email", "discord"],
        "goal_notifications": "on",
        "achievement_notifications": "on",
        "daily_reminders": "on",
        "weekly_reports": "on",
        "discord_webhook": VALID_WEBHOOK,
        "reminder_time": "09:10",
        "quiet_hours_start": "21:30",
        "quiet_hours_end": "06:15",
    })
    assert response.status_code == 302
    assert response.headers["Location"].endswith("/settings/notifications")

    preferences = UserPreferences.query.filter_by(user_id=test_user.id).one()
    assert preferences.notification_channel == ["email", "discord"]
    assert preferences.goal_notifications is True
    assert preferences.achievement_notifications is True
    assert preferences.daily_reminders is True
    assert preferences.weekly_reports is True
    assert preferences.discord_webhook == VALID_WEBHOOK
    assert preferences.reminder_time == time(9, 10)
    assert preferences.quiet_hours_start == time(21, 30)
    assert preferences.quiet_hours_end == time(6, 15)
    assert preferences.notification_frequency == "immediate"

    persisted = BeautifulSoup(
        logged_in_client.get("/settings/notifications").data,
        "html.parser",
    )
    assert persisted.select_one('input[name="weekly_reports"][checked]')
    assert not persisted.select_one('select[name="notification_frequency"]')


def test_reminder_validation_is_atomic_and_retains_safe_values(
        logged_in_client, db_session, test_user):
    preferences = _seed_preferences(db_session, test_user)
    before = preferences.to_dict()
    response = logged_in_client.post('/settings/notifications', data={
        'notification_channel': ['email', 'discord'],
        'goal_notifications': 'on',
        'daily_reminders': 'on',
        'weekly_reports': 'on',
        'discord_webhook': 'http://169.254.169.254/api/webhooks/1/secret',
        'reminder_time': '',
        'quiet_hours_start': '22:00',
        'quiet_hours_end': '22:00',
    })
    assert response.status_code == 422
    db_session.refresh(preferences)
    assert preferences.to_dict() == before
    soup = BeautifulSoup(response.data, 'html.parser')
    assert soup.select_one('#discord_webhook[aria-invalid="true"]')
    assert soup.select_one('#reminder_time[aria-invalid="true"]')
    assert soup.select_one('#quiet_hours_end[aria-invalid="true"]')
    assert soup.select_one('#discord_webhook')['value'].startswith('http://169.254')


def test_weekly_channel_error_is_associated_with_group_and_controls(
        logged_in_client):
    response = logged_in_client.post('/settings/notifications', data={
        'weekly_reports': 'on',
    })
    assert response.status_code == 422
    soup = BeautifulSoup(response.data, 'html.parser')
    error = soup.select_one('#notification_channel-error')
    assert error.get_text(' ', strip=True) == (
        'Choose a usable channel for weekly reports.'
    )
    group = soup.select_one('#notification-channel-group[aria-invalid="true"]')
    assert 'notification_channel-error' in group['aria-describedby'].split()
    for control in soup.select('input[name="notification_channel"]'):
        assert control['aria-invalid'] == 'true'
        assert 'notification_channel-error' in control['aria-describedby'].split()


@pytest.mark.parametrize(('status', 'success', 'message'), [
    (
        'pending', True,
        'Weekly report is queued for your enabled delivery channel.',
    ),
    ('sent', True, 'This weekly report was already sent.'),
    (
        'failed', False,
        'This weekly report was already processed and was not queued again.',
    ),
])
def test_manual_weekly_report_copy_reflects_durable_row_status(
        logged_in_client, db_session, test_user, monkeypatch,
        status, success, message):
    preferences = UserPreferences(
        user_id=test_user.id,
        notification_channel=['email'],
        weekly_reports=True,
    )
    db_session.add(preferences)
    db_session.commit()
    monkeypatch.setattr(
        'routes.settings.NotificationService.queue_weekly_report',
        lambda _service, _user: [SimpleNamespace(status=status)],
    )

    response = logged_in_client.post(
        '/settings/notifications/trigger-weekly', json={},
    )

    assert response.status_code == 200
    assert response.get_json() == {'success': success, 'message': message}


def test_generic_writer_rejects_retired_fields_before_creating_preferences(
        db_session, test_user):
    UserPreferences.query.filter_by(user_id=test_user.id).delete()
    db_session.commit()
    service = UserPreferencesService()
    assert service.update_preferences(
        test_user.id, notification_frequency='daily',
    ) == (False, 'Unsupported preference field')
    assert service.update_preferences(
        test_user.id, daily_reset_time='04:05',
    ) == (False, 'Unsupported preference field')
    assert UserPreferences.query.filter_by(user_id=test_user.id).count() == 0


def test_generic_writer_rejects_raw_notification_subset_without_first_write(
        db_session, test_user):
    UserPreferences.query.filter_by(user_id=test_user.id).delete()
    db_session.commit()

    result = UserPreferencesService().update_preferences(
        test_user.id,
        notification_channel=['discord'],
        weekly_reports=True,
        discord_webhook=None,
    )

    assert result == (False, 'Use validated notification settings')
    assert UserPreferences.query.filter_by(user_id=test_user.id).count() == 0


def test_legacy_session_migration_uses_complete_typed_notification_validation(
        db_session, test_user):
    UserPreferences.query.filter_by(user_id=test_user.id).delete()
    db_session.commit()

    result = UserPreferencesService().migrate_session_preferences(
        test_user.id,
        {'email_notifications': True, 'goal_notifications': False},
    )

    assert result == (True, 'Migrated validated notification settings')
    preferences = UserPreferences.query.filter_by(user_id=test_user.id).one()
    assert preferences.notification_channel == ['email']
    assert preferences.goal_notifications is False
    assert preferences.daily_reminders is False
    assert preferences.weekly_reports is False


def test_legacy_session_migration_rejects_invalid_discord_without_first_write(
        db_session, test_user):
    UserPreferences.query.filter_by(user_id=test_user.id).delete()
    db_session.commit()

    result = UserPreferencesService().migrate_session_preferences(
        test_user.id,
        {'email_notifications': False, 'discord_webhook': 'http://127.0.0.1/x'},
    )

    assert result == (False, 'Invalid legacy notification settings')
    assert UserPreferences.query.filter_by(user_id=test_user.id).count() == 0


def test_first_notification_write_uses_one_boundary_commit(
        logged_in_client, db_session, test_user, monkeypatch):
    UserPreferences.query.filter_by(user_id=test_user.id).delete()
    db_session.commit()
    real_commit = db.session.commit
    commits = []

    def counted_commit():
        commits.append(True)
        return real_commit()

    monkeypatch.setattr(db.session, 'commit', counted_commit)
    response = logged_in_client.post('/settings/notifications', data={
        'notification_channel': ['email'],
        'goal_notifications': 'on',
    })
    assert response.status_code == 302
    assert len(commits) == 1
    preferences = UserPreferences.query.filter_by(user_id=test_user.id).one()
    assert preferences.notification_channel == ['email']
    assert preferences.goal_notifications is True


def test_reminders_template_retires_inline_actions_and_legacy_palette():
    source = (PROJECT_ROOT / "templates/settings/notifications.html").read_text().casefold()
    for token in (
        "<script>", "data-hs-", "bg-indigo-", "text-indigo-", "ring-indigo-",
        "bg-violet-", "bg-purple-", "bg-blue-", "bg-gray-", "dark:bg-gray-",
        "shadow rounded-lg",
    ):
        assert token not in source
