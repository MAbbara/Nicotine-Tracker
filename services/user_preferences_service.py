"""User Preferences Service.
Handles user notification and communication preferences management.
"""
from datetime import datetime
from flask import current_app
from extensions import db
from models.user_preferences import UserPreferences
from models.user import User
from services.settings_validation_service import (
    NotificationSettingsInput,
    SettingsValidationError,
    parse_notification_settings,
)

class UserPreferencesService:
    
    def get_or_create_preferences(self, user_id, *, commit=True):
        """Get user preferences or create default ones"""
        try:
            preferences = UserPreferences.query.filter_by(user_id=user_id).first()
            
            if not preferences:
                preferences = self.create_default_preferences(user_id, commit=commit)
            
            return preferences
            
        except Exception as e:
            current_app.logger.error(f'Error getting user preferences: {e}')
            return None
    
    def create_default_preferences(self, user_id, *, commit=True):
        """Create default preferences for a new user"""
        try:
            preferences = UserPreferences(
                user_id=user_id,
                goal_notifications=True,
                daily_reminders=False,
                weekly_reports=False,
                achievement_notifications=True,
                notification_frequency='immediate'
            )

            
            db.session.add(preferences)
            if commit:
                db.session.commit()
            else:
                db.session.flush()
            
            current_app.logger.info(f'Created default preferences for user {user_id}')
            return preferences
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error creating default preferences: {e}')
            raise
    
    def update_preferences(self, user_id, *, commit=True, **kwargs):
        """Reject legacy raw mutation; callers must use a typed apply method."""
        notification_fields = {
            'notification_channel', 'goal_notifications', 'daily_reminders',
            'weekly_reports', 'achievement_notifications', 'discord_webhook',
            'reminder_time', 'quiet_hours_start', 'quiet_hours_end',
        }
        if notification_fields.intersection(kwargs):
            return False, "Use validated notification settings"
        return False, "Unsupported preference field"

    def apply_notification_settings(self, user_id, submitted, *, commit=True):
        """Persist only the validated notification settings as one unit."""
        if not isinstance(submitted, NotificationSettingsInput):
            raise TypeError('submitted must be validated notification settings')
        try:
            preferences = self.get_or_create_preferences(user_id, commit=False)
            if preferences is None:
                raise RuntimeError('Could not get user preferences')
            preferences.notification_channel = list(submitted.notification_channel)
            preferences.goal_notifications = submitted.goal_notifications
            preferences.achievement_notifications = submitted.achievement_notifications
            preferences.daily_reminders = submitted.daily_reminders
            preferences.weekly_reports = submitted.weekly_reports
            preferences.discord_webhook = submitted.discord_webhook
            preferences.reminder_time = submitted.reminder_time
            preferences.quiet_hours_start = submitted.quiet_hours_start
            preferences.quiet_hours_end = submitted.quiet_hours_end
            preferences.updated_at = datetime.utcnow()
            if commit:
                db.session.commit()
            else:
                db.session.flush()
            return preferences
        except Exception:
            db.session.rollback()
            raise
    
    def get_notification_settings(self, user_id):
        """Get notification settings for a user"""
        try:
            preferences = self.get_or_create_preferences(user_id)
            
            if not preferences:
                return None
            
            return {
                'notification_channel': preferences.notification_channel,
                'goal_notifications': preferences.goal_notifications,

                'daily_reminders': preferences.daily_reminders,
                'weekly_reports': preferences.weekly_reports,
                'achievement_notifications': preferences.achievement_notifications,
                'notification_frequency': preferences.notification_frequency,
                'reminder_time': preferences.reminder_time.strftime('%H:%M') if preferences.reminder_time else None,
                'quiet_hours_start': preferences.quiet_hours_start.strftime('%H:%M') if preferences.quiet_hours_start else None,
                'quiet_hours_end': preferences.quiet_hours_end.strftime('%H:%M') if preferences.quiet_hours_end else None,
                'daily_reset_time': preferences.daily_reset_time.strftime('%H:%M') if preferences.daily_reset_time else None
            }
            
        except Exception as e:
            current_app.logger.error(f'Error getting notification settings: {e}')
            return None
    
    def get_webhook_settings(self, user_id):
        """Get webhook settings for a user"""
        try:
            preferences = self.get_or_create_preferences(user_id)
            
            if not preferences:
                return None
            
            return {
                'discord_webhook': preferences.discord_webhook,
                'slack_webhook': preferences.slack_webhook
            }
            
        except Exception as e:
            current_app.logger.error(f'Error getting webhook settings: {e}')
            return None
    
    def should_send_notification(self, user_id, category, channel_type):
        """Check if a notification should be sent based on user preferences and channel."""
        try:
            preferences = self.get_or_create_preferences(user_id)
            
            if not preferences:
                return False

            # 1. Check if the channel is enabled for the user in their preferences list
            if channel_type not in preferences.notification_channel:
                return False

            # 2. Check if the specific notification category is enabled
            category_mapping = {
                'goal_reminder': preferences.goal_notifications,

                'daily_reminder': preferences.daily_reminders,
                'weekly_report': preferences.weekly_reports,
                'achievement': preferences.achievement_notifications
            }
            
            # For categories not in the map (like email verification), assume they are always allowed if channel is on.
            return category_mapping.get(category, True)
            
        except Exception as e:
            current_app.logger.error(f'Error checking notification permission: {e}')
            return False


    
    def is_quiet_hours(self, user_id):
        """Check if current time is within user's quiet hours"""
        try:
            preferences = self.get_or_create_preferences(user_id)
            
            if not preferences or not preferences.quiet_hours_start or not preferences.quiet_hours_end:
                return False
            
            now = datetime.now().time()
            start = preferences.quiet_hours_start
            end = preferences.quiet_hours_end
            
            # Handle quiet hours that span midnight
            if start <= end:
                return start <= now <= end
            else:
                return now >= start or now <= end
            
        except Exception as e:
            current_app.logger.error(f'Error checking quiet hours: {e}')
            return False
    
    def migrate_session_preferences(self, user_id, session_preferences):
        """Migrate preferences from session to database (for existing users)"""
        try:
            if not session_preferences:
                return True, "No session preferences to migrate"

            existing = UserPreferences.query.filter_by(user_id=user_id).first()
            channels = list(
                existing.notification_channel if existing is not None else ['email']
            )
            if 'email_notifications' in session_preferences:
                channels = [channel for channel in channels if channel != 'email']
                if session_preferences['email_notifications']:
                    channels.insert(0, 'email')
            webhook = session_preferences.get(
                'discord_webhook',
                existing.discord_webhook if existing is not None else '',
            )
            if 'discord_webhook' in session_preferences:
                channels = [channel for channel in channels if channel != 'discord']
                if webhook:
                    channels.append('discord')
            payload = {
                'notification_channel': channels,
                'goal_notifications': session_preferences.get(
                    'goal_notifications',
                    existing.goal_notifications if existing is not None else True,
                ),
                'achievement_notifications': (
                    existing.achievement_notifications if existing is not None else True
                ),
                'daily_reminders': session_preferences.get(
                    'daily_reminders',
                    existing.daily_reminders if existing is not None else False,
                ),
                'weekly_reports': (
                    existing.weekly_reports if existing is not None else False
                ),
                'discord_webhook': webhook or '',
                'reminder_time': (
                    existing.reminder_time.strftime('%H:%M')
                    if existing is not None and existing.reminder_time else ''
                ),
                'quiet_hours_start': (
                    existing.quiet_hours_start.strftime('%H:%M')
                    if existing is not None and existing.quiet_hours_start else ''
                ),
                'quiet_hours_end': (
                    existing.quiet_hours_end.strftime('%H:%M')
                    if existing is not None and existing.quiet_hours_end else ''
                ),
            }
            submitted = parse_notification_settings(payload)
            self.apply_notification_settings(user_id, submitted)
            current_app.logger.info(
                'Migrated validated notification settings for user %s', user_id
            )
            return True, "Migrated validated notification settings"

        except SettingsValidationError:
            db.session.rollback()
            return False, "Invalid legacy notification settings"
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(
                'Error migrating preferences (%s).', type(e).__name__
            )
            return False, "Error migrating preferences"
