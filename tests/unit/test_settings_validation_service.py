from datetime import time

import pytest

from services.settings_validation_service import (
    SettingsValidationError,
    parse_account_mutation,
    parse_notification_settings,
    parse_preference_settings,
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


@pytest.mark.parametrize('value', [
    '+1:30', '1:30', '01:3', '01:30 ', ' 01:30', '٠١:٣٠', '１２:３０',
])
def test_settings_times_require_exact_ascii_hh_mm(value):
    with pytest.raises(SettingsValidationError) as caught:
        parse_notification_settings(valid_notification_payload(
            reminder_time=value,
        ))
    assert caught.value.field_errors == {
        'reminder_time': 'Choose a valid time.',
    }


@pytest.mark.parametrize('zone', ['asia/riyadh', 'Asia/RIYADH', 'UTC ', 'utc'])
def test_preference_timezone_requires_exact_canonical_membership(zone):
    with pytest.raises(SettingsValidationError) as caught:
        parse_preference_settings({
            'units_preference': 'mg', 'timezone': zone,
            'daily_reset_time': '00:00', 'preferred_brands': [],
        }, available_brands=[])
    assert caught.value.field_errors['timezone'] == 'Choose a valid time zone.'


@pytest.mark.parametrize('email', [
    'name..dots@example.com', 'name@example..com', 'name@-example.com',
    'name@example', 'name @example.com', '@example.com',
])
def test_account_email_uses_canonical_email_validator(email):
    with pytest.raises(SettingsValidationError) as caught:
        parse_account_mutation({
            'action': 'update_email', 'new_email': email, 'password': 'secret',
        })
    assert caught.value.field_errors == {
        'new_email': 'Enter a valid email address.',
    }


def test_account_email_returns_normalized_address():
    parsed = parse_account_mutation({
        'action': 'update_email',
        'new_email': '  User@EXAMPLE.COM  ',
        'password': 'secret',
    })
    assert parsed.values['new_email'] == 'User@example.com'
