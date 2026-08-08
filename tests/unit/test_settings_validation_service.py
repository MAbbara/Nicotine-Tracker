from datetime import time

import pytest

from services.settings_validation_service import (
    SettingsValidationError,
    parse_notification_settings,
)


VALID_WEBHOOK = (
    "https://discord.com/api/webhooks/123456789012345678/"
    "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789"
)


def valid_notification_payload(**overrides):
    payload = {
        "notification_channel": ["email", "discord"],
        "goal_notifications": "on",
        "daily_reminders": "on",
        "weekly_reports": "on",
        "discord_webhook": VALID_WEBHOOK,
        "reminder_time": "08:15",
        "quiet_hours_start": "22:00",
        "quiet_hours_end": "06:30",
    }
    payload.update(overrides)
    return payload


@pytest.mark.parametrize("channels", [
    ["email", "email"], ["sms"], ["email", "sms"],
])
def test_notification_channels_are_unique_and_known(channels):
    with pytest.raises(SettingsValidationError) as caught:
        parse_notification_settings(valid_notification_payload(
            notification_channel=channels,
        ))
    assert "notification_channel" in caught.value.field_errors


@pytest.mark.parametrize(("overrides", "field"), [
    ({"discord_webhook": ""}, "discord_webhook"),
    ({"daily_reminders": "on", "reminder_time": ""}, "reminder_time"),
    ({"quiet_hours_start": "22:00", "quiet_hours_end": ""}, "quiet_hours_end"),
    ({"quiet_hours_start": "22:00", "quiet_hours_end": "22:00"}, "quiet_hours_end"),
    ({"notification_channel": ["discord"], "discord_webhook": "", "weekly_reports": "on"}, "discord_webhook"),
    ({"notification_channel": [], "weekly_reports": "on"}, "notification_channel"),
])
def test_notification_dependencies_are_rejected_together(overrides, field):
    with pytest.raises(SettingsValidationError) as caught:
        parse_notification_settings(valid_notification_payload(**overrides))
    assert field in caught.value.field_errors


def test_disabling_discord_clears_webhook_and_normalizes_times():
    parsed = parse_notification_settings(valid_notification_payload(
        notification_channel=["email"],
        discord_webhook=VALID_WEBHOOK,
    ))
    assert parsed.notification_channel == ("email",)
    assert parsed.discord_webhook is None
    assert parsed.reminder_time == time(8, 15)
    assert parsed.quiet_hours_start == time(22, 0)
    assert parsed.quiet_hours_end == time(6, 30)
