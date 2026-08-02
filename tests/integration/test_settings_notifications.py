"""Reminder settings structure, native fields, and persistence contracts."""

from datetime import time
from pathlib import Path

from bs4 import BeautifulSoup

from models import UserPreferences


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _seed_preferences(db_session, test_user):
    preferences = UserPreferences(
        user_id=test_user.id,
        notification_channel=["email", "discord"],
        goal_notifications=True,
        achievement_notifications=False,
        daily_reminders=True,
        weekly_reports=True,
        discord_webhook="https://discord.com/api/webhooks/example/token",
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
    assert form.select_one('input[name="discord_webhook"][type="url"]')["value"].endswith(
        "/example/token"
    )
    assert form.select_one('input[name="reminder_time"][type="time"]')["value"] == "08:15"
    assert form.select_one('input[name="quiet_hours_start"][type="time"]')["value"] == "22:00"
    assert form.select_one('input[name="quiet_hours_end"][type="time"]')["value"] == "06:30"
    assert form.select_one(
        'select[name="notification_frequency"] option[value="daily"][selected]'
    )

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
        "discord_webhook": "https://discord.com/api/webhooks/example/token",
        "reminder_time": "09:10",
        "quiet_hours_start": "21:30",
        "quiet_hours_end": "06:15",
        "notification_frequency": "weekly",
    })
    assert response.status_code == 302
    assert response.headers["Location"].endswith("/settings/notifications")

    preferences = UserPreferences.query.filter_by(user_id=test_user.id).one()
    assert preferences.notification_channel == ["email", "discord"]
    assert preferences.goal_notifications is True
    assert preferences.achievement_notifications is True
    assert preferences.daily_reminders is True
    assert preferences.weekly_reports is True
    assert preferences.discord_webhook.endswith("/example/token")
    assert preferences.reminder_time == time(9, 10)
    assert preferences.quiet_hours_start == time(21, 30)
    assert preferences.quiet_hours_end == time(6, 15)
    assert preferences.notification_frequency == "weekly"

    persisted = BeautifulSoup(
        logged_in_client.get("/settings/notifications").data,
        "html.parser",
    )
    assert persisted.select_one('input[name="weekly_reports"][checked]')
    assert persisted.select_one(
        'select[name="notification_frequency"] option[value="weekly"][selected]'
    )


def test_reminders_template_retires_inline_actions_and_legacy_palette():
    source = (PROJECT_ROOT / "templates/settings/notifications.html").read_text().casefold()
    for token in (
        "<script>", "data-hs-", "bg-indigo-", "text-indigo-", "ring-indigo-",
        "bg-violet-", "bg-purple-", "bg-blue-", "bg-gray-", "dark:bg-gray-",
        "shadow rounded-lg",
    ):
        assert token not in source
