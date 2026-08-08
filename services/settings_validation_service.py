"""Typed, side-effect-free Settings form normalization."""
from dataclasses import dataclass
from datetime import time
from decimal import Decimal, InvalidOperation
import re

from email_validator import EmailNotValidError, validate_email

from services.discord_webhook_service import DiscordWebhookError, parse_discord_webhook
from services.timezone_service import validate_timezone


PASSWORD_MIN = 8
PASSWORD_MAX = 128
EMAIL_MAX = 120
BRAND_MAX = 80
TIME_RE = re.compile(r"(?:[01][0-9]|2[0-3]):[0-5][0-9]", re.ASCII)


def normalize_account_email(value):
    raw_email = str(value).strip()
    email = validate_email(raw_email, check_deliverability=False).normalized
    if len(email) > EMAIL_MAX:
        raise EmailNotValidError('Address is too long.')
    return email


class SettingsValidationError(ValueError):
    def __init__(self, field_errors):
        self.field_errors = field_errors
        super().__init__("Check the highlighted fields and try again.")


def _values(payload, key):
    if hasattr(payload, "getlist"):
        return payload.getlist(key)
    value = payload.get(key, [])
    return list(value) if isinstance(value, (list, tuple)) else ([value] if value else [])


def _checked(payload, key):
    return payload.get(key) in {"on", "true", True, "1", 1}


def _time(value, field, errors, *, required=False):
    value = value if isinstance(value, str) else ""
    if not value:
        if required:
            errors[field] = "Choose a time."
        return None
    if TIME_RE.fullmatch(value) is None:
        errors[field] = "Choose a valid time."
        return None
    hour, minute = value.split(":")
    return time(int(hour), int(minute))


@dataclass(frozen=True)
class NotificationSettingsInput:
    notification_channel: tuple[str, ...]
    goal_notifications: bool
    achievement_notifications: bool
    daily_reminders: bool
    weekly_reports: bool
    discord_webhook: str | None
    reminder_time: time | None
    quiet_hours_start: time | None
    quiet_hours_end: time | None


def parse_notification_settings(payload) -> NotificationSettingsInput:
    errors = {}
    channels = _values(payload, "notification_channel")
    if len(channels) != len(set(channels)) or any(c not in {"email", "discord"} for c in channels):
        errors["notification_channel"] = "Choose each available channel at most once."
    daily = _checked(payload, "daily_reminders")
    weekly = _checked(payload, "weekly_reports")
    reminder = _time(payload.get("reminder_time", ""), "reminder_time", errors, required=daily)
    quiet_start = _time(payload.get("quiet_hours_start", ""), "quiet_hours_start", errors)
    quiet_end = _time(payload.get("quiet_hours_end", ""), "quiet_hours_end", errors)
    if (quiet_start is None) != (quiet_end is None):
        errors["quiet_hours_end" if quiet_start else "quiet_hours_start"] = "Set both quiet-hour times or clear both."
    elif quiet_start is not None and quiet_start == quiet_end:
        errors["quiet_hours_end"] = "Quiet hours must start and end at different times."
    webhook = None
    if "discord" in channels:
        try:
            webhook = parse_discord_webhook(payload.get("discord_webhook", "")).url
        except DiscordWebhookError:
            errors["discord_webhook"] = "Enter a valid Discord webhook URL."
    if weekly and not channels:
        errors["notification_channel"] = "Choose a usable channel for weekly reports."
    if errors:
        raise SettingsValidationError(errors)
    return NotificationSettingsInput(
        notification_channel=tuple(channels),
        goal_notifications=_checked(payload, "goal_notifications"),
        achievement_notifications=_checked(payload, "achievement_notifications"),
        daily_reminders=daily,
        weekly_reports=weekly,
        discord_webhook=webhook,
        reminder_time=reminder,
        quiet_hours_start=quiet_start,
        quiet_hours_end=quiet_end,
    )


@dataclass(frozen=True)
class PreferenceSettingsInput:
    units_preference: str
    timezone: str
    daily_reset_time: time
    preferred_brands: tuple[str, ...]


def parse_preference_settings(payload, *, available_brands):
    errors = {}
    units = str(payload.get("units_preference", "")).strip()
    timezone = payload.get("timezone", "")
    reset = _time(payload.get("daily_reset_time", ""), "daily_reset_time", errors, required=True)
    brands = _values(payload, "preferred_brands")
    owned = set(available_brands)
    if units not in {"mg", "percentage"}:
        errors["units_preference"] = "Choose a valid units preference."
    if not validate_timezone(timezone):
        errors["timezone"] = "Choose a valid time zone."
    if len(brands) != len(set(brands)) or any(not isinstance(b, str) or not b or len(b) > BRAND_MAX or b not in owned for b in brands):
        errors["preferred_brands"] = "Choose available products only."
    if errors:
        raise SettingsValidationError(errors)
    return PreferenceSettingsInput(units, timezone, reset, tuple(brands))


@dataclass(frozen=True)
class ProfileInput:
    age: int | None
    gender: str | None
    weight: Decimal | None


def parse_profile(payload):
    errors = {}
    age_raw = str(payload.get("age", "")).strip()
    weight_raw = str(payload.get("weight", "")).strip()
    gender = str(payload.get("gender", "")).strip() or None
    age = None
    weight = None
    if age_raw:
        try:
            age = int(age_raw)
            if not 18 <= age <= 120:
                raise ValueError
        except ValueError:
            errors["age"] = "Enter a whole-number age from 18 to 120."
    if weight_raw:
        try:
            weight = Decimal(weight_raw)
            if not weight.is_finite() or not Decimal("30") <= weight <= Decimal("500"):
                raise InvalidOperation
        except (InvalidOperation, ValueError):
            errors["weight"] = "Enter a finite weight from 30 to 500 kg."
    if gender not in {None, "male", "female", "other", "prefer_not_to_say"}:
        errors["gender"] = "Choose a valid gender option."
    if errors:
        raise SettingsValidationError(errors)
    return ProfileInput(age, gender, weight)


@dataclass(frozen=True)
class AccountMutationInput:
    action: str
    values: dict


def parse_account_mutation(payload):
    errors = {}
    actions = _values(payload, "action")
    known = {"update_email", "change_password", "resend_verification", "delete_account"}
    if len(actions) != 1 or actions[0] not in known:
        raise SettingsValidationError({"action": "Choose exactly one account action."})
    action = actions[0]
    values = {}
    if action == "update_email":
        raw_email = str(payload.get("new_email", "")).strip()
        try:
            email = normalize_account_email(raw_email)
        except EmailNotValidError:
            email = raw_email
            errors["new_email"] = "Enter a valid email address."
        values = {"new_email": email, "password": str(payload.get("password", ""))}
    elif action == "change_password":
        current = str(payload.get("current_password", ""))
        new = str(payload.get("new_password", ""))
        confirm = str(payload.get("confirm_password", ""))
        if not current:
            errors["current_password"] = "Enter your current password."
        if not PASSWORD_MIN <= len(new) <= PASSWORD_MAX:
            errors["new_password"] = f"Use {PASSWORD_MIN} to {PASSWORD_MAX} characters."
        if new != confirm:
            errors["confirm_password"] = "New passwords do not match."
        values = {"current_password": current, "new_password": new, "confirm_password": confirm}
    elif action == "delete_account":
        values = {"password": str(payload.get("password", "")), "confirmation": str(payload.get("confirmation", ""))}
    if errors:
        raise SettingsValidationError(errors)
    return AccountMutationInput(action, values)
