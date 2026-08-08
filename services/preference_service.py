"""Validated persistence for coaching, shell, and day-boundary preferences."""

from datetime import datetime, time, timedelta, timezone
import re

from sqlalchemy import select

from extensions import db
from models import Pouch, User, UserPreferences, UserPreferredPouch, UserSettings
from services.timezone_service import (
    get_timezone_object,
    get_user_day_window,
    resolve_timezone,
    to_naive_utc,
)
from services.settings_validation_service import PreferenceSettingsInput


VALID_THEMES = {'light', 'dark', 'system'}
_RESET_TIME_PATTERN = re.compile(r'(?:[01][0-9]|2[0-3]):[0-5][0-9]', re.ASCII)


def _normalized_strings(values):
    result = []
    seen = set()
    for raw in values or []:
        value = ' '.join(str(raw).split())
        key = value.casefold()
        if not value or key in seen:
            continue
        if len(value) > 80:
            raise ValueError('preference labels must be 80 characters or fewer')
        seen.add(key)
        result.append(value)
    return result


class PreferenceService:
    def get_or_create_preferences(self, user_id, *, commit=True):
        preferences = UserPreferences.query.filter_by(user_id=user_id).first()
        if preferences is None:
            preferences = UserPreferences(user_id=user_id)
            db.session.add(preferences)
            if commit:
                db.session.commit()
            else:
                db.session.flush()
        return preferences

    def get_or_create_settings(self, user_id):
        settings = UserSettings.query.filter_by(user_id=user_id).first()
        if settings is None:
            settings = UserSettings(user_id=user_id, theme='system')
            db.session.add(settings)
            db.session.commit()
        return settings

    def update_coaching_context(self, user_id, difficult_times, common_triggers):
        preferences = self.get_or_create_preferences(user_id)
        preferences.difficult_times = _normalized_strings(difficult_times)
        preferences.common_triggers = _normalized_strings(common_triggers)
        db.session.commit()
        return preferences

    def replace_preferred_pouches(self, user_id, pouch_ids):
        pouch_ids = [int(pouch_id) for pouch_id in pouch_ids]
        if len(pouch_ids) != len(set(pouch_ids)):
            raise ValueError('preferred pouches must be unique')
        pouches = Pouch.query.filter(Pouch.id.in_(pouch_ids)).all() if pouch_ids else []
        by_id = {pouch.id: pouch for pouch in pouches}
        for pouch_id in pouch_ids:
            pouch = by_id.get(pouch_id)
            if pouch is None or not (pouch.is_default or pouch.created_by == user_id):
                raise ValueError(f'pouch {pouch_id} is not available to this user')

        UserPreferredPouch.query.filter_by(user_id=user_id).delete()
        rows = [
            UserPreferredPouch(user_id=user_id, pouch_id=pouch_id, rank=rank)
            for rank, pouch_id in enumerate(pouch_ids)
        ]
        db.session.add_all(rows)
        db.session.commit()
        return rows

    def remove_preferred_pouch(self, user_id, pouch_id):
        UserPreferredPouch.query.filter_by(
            user_id=user_id, pouch_id=pouch_id
        ).delete()
        rows = UserPreferredPouch.query.filter_by(user_id=user_id).order_by(
            UserPreferredPouch.rank, UserPreferredPouch.id
        ).all()
        for rank, row in enumerate(rows):
            row.rank = rank
        db.session.commit()
        return rows

    def set_theme(self, user_id, theme):
        if theme not in VALID_THEMES:
            raise ValueError('theme must be light, dark, or system')
        settings = self.get_or_create_settings(user_id)
        settings.theme = theme
        settings.chart_theme = theme
        db.session.commit()
        return settings

    def set_offline_queue_enabled(self, user_id, enabled):
        if not isinstance(enabled, bool):
            raise ValueError('enabled must be a boolean')
        preferences = self.get_or_create_preferences(user_id)
        preferences.offline_queue_enabled = enabled
        db.session.commit()
        return preferences

    def update_day_boundary(self, user_id, timezone_name, reset_time_text, *, commit=True):
        try:
            get_timezone_object(timezone_name)
            if (
                not isinstance(reset_time_text, str)
                or _RESET_TIME_PATTERN.fullmatch(reset_time_text) is None
            ):
                raise ValueError('daily_reset_time must use HH:MM')
            reset_time = datetime.strptime(reset_time_text, '%H:%M').time()
        except (TypeError, ValueError):
            db.session.rollback()
            raise ValueError('daily_reset_time must use HH:MM') from None
        try:
            user = db.session.get(User, user_id)
            if user is None:
                raise ValueError('user not found')
            preferences = self.get_or_create_preferences(user_id, commit=False)
            user.timezone = timezone_name
            preferences.daily_reset_time = reset_time
            preferences.pending_timezone = None
            preferences.pending_daily_reset_time = None
            preferences.boundary_change_effective_at_utc = None
            preferences.boundary_change_target_local_date = None
            if commit:
                db.session.commit()
            else:
                db.session.flush()
            return preferences
        except Exception:
            db.session.rollback()
            raise

    def apply_preference_settings(self, user_id, submitted, *, commit=True):
        """Apply a validated Settings preference form in one transaction."""
        if not isinstance(submitted, PreferenceSettingsInput):
            raise TypeError('submitted must be validated preference settings')
        try:
            user = db.session.get(User, user_id)
            if user is None:
                raise ValueError('user not found')
            preferences = self.get_or_create_preferences(user_id, commit=False)
            user.timezone = submitted.timezone
            preferences.daily_reset_time = submitted.daily_reset_time
            preferences.units_preference = submitted.units_preference
            preferences.preferred_brands = list(submitted.preferred_brands)
            preferences.pending_timezone = None
            preferences.pending_daily_reset_time = None
            preferences.boundary_change_effective_at_utc = None
            preferences.boundary_change_target_local_date = None
            if commit:
                db.session.commit()
            else:
                db.session.flush()
            return preferences
        except Exception:
            db.session.rollback()
            raise

    def schedule_day_boundary_change(
        self, user_id, timezone_name, reset_time_text, now=None
    ) -> UserPreferences:
        """Schedule a validated clock change after the applied day ends."""
        try:
            get_timezone_object(timezone_name)
            if (
                not isinstance(reset_time_text, str)
                or _RESET_TIME_PATTERN.fullmatch(reset_time_text) is None
            ):
                raise ValueError('daily_reset_time must use HH:MM')
            reset_time = datetime.strptime(reset_time_text, '%H:%M').time()

            user = db.session.execute(
                select(User).where(User.id == user_id).with_for_update()
            ).scalar_one_or_none()
            if user is None:
                raise ValueError('user not found')
            preferences = db.session.execute(
                select(UserPreferences).where(
                    UserPreferences.user_id == user_id
                ).with_for_update()
            ).scalar_one_or_none()
            if preferences is None:
                preferences = UserPreferences(user_id=user_id)
                db.session.add(preferences)

            instant = now or datetime.now(timezone.utc)
            if instant.tzinfo is None:
                instant = instant.replace(tzinfo=timezone.utc)
            else:
                instant = instant.astimezone(timezone.utc)

            applied_timezone = resolve_timezone(user.timezone)
            applied_reset = preferences.daily_reset_time or time.min
            candidate_date = instant.astimezone(applied_timezone).date()
            current_window = get_user_day_window(
                applied_timezone.zone, candidate_date, applied_reset
            )
            if instant < current_window.start_utc:
                candidate_date -= timedelta(days=1)
                current_window = get_user_day_window(
                    applied_timezone.zone, candidate_date, applied_reset
                )
            old_day_end_utc = current_window.end_utc

            requested_timezone = get_timezone_object(timezone_name)
            target_date = old_day_end_utc.astimezone(
                requested_timezone
            ).date()
            requested_window = get_user_day_window(
                requested_timezone.zone, target_date, reset_time
            )
            while requested_window.start_utc < old_day_end_utc:
                target_date += timedelta(days=1)
                requested_window = get_user_day_window(
                    requested_timezone.zone, target_date, reset_time
                )

            preferences.pending_timezone = timezone_name
            preferences.pending_daily_reset_time = reset_time
            preferences.boundary_change_effective_at_utc = to_naive_utc(
                requested_window.start_utc
            )
            preferences.boundary_change_target_local_date = target_date
            db.session.commit()
            return preferences
        except Exception:
            db.session.rollback()
            raise
