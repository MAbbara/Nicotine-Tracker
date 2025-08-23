"""User Preferences Service.
Handles user notification and communication preferences management.
"""
from datetime import datetime, time
from flask import current_app
from extensions import db
from models.user_preferences import UserPreferences
from models.user import User

class UserPreferencesService:
    
    def get_or_create_preferences(self, user_id):
        """Get user preferences or create default ones"""
        try:
            preferences = UserPreferences.query.filter_by(user_id=user_id).first()
            
            if not preferences:
                preferences = self.create_default_preferences(user_id)
            
            return preferences
            
        except Exception as e:
            current_app.logger.error(f'Error getting user preferences: {e}')
            return None
    
    def create_default_preferences(self, user_id):
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
            db.session.commit()
            
            current_app.logger.info(f'Created default preferences for user {user_id}')
            return preferences
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error creating default preferences: {e}')
            raise
    
    def update_preferences(self, user_id, **kwargs):
        """Update user preferences"""
        try:
            preferences = self.get_or_create_preferences(user_id)
            
            if not preferences:
                return False, "Could not get user preferences"
            
            # Update allowed fields
            allowed_fields = [
                'notification_channel', 'goal_notifications', 'daily_reminders',
                'weekly_reports', 'achievement_notifications', 'discord_webhook',
                'slack_webhook', 'reminder_time', 'quiet_hours_start',
                'quiet_hours_end', 'notification_frequency', 'daily_reset_time',
                'units_preference', 'preferred_brands'
            ]


            
            updated_fields = []
            for field, value in kwargs.items():
                if field in allowed_fields and hasattr(preferences, field):
                    # Handle time fields specially
                    if field in ['reminder_time', 'quiet_hours_start', 'quiet_hours_end', 'daily_reset_time']:
                        if isinstance(value, str) and value:
                            try:
                                # Parse time string (HH:MM format)
                                hour, minute = map(int, value.split(':'))
                                value = time(hour, minute)
                            except (ValueError, AttributeError):
                                current_app.logger.warning(f'Invalid time format for {field}: {value}')
                                continue
                        elif not value:
                            value = None
                    
                    setattr(preferences, field, value)
                    updated_fields.append(field)
            
            preferences.updated_at = datetime.utcnow()
            db.session.commit()
            
            current_app.logger.info(f'Updated preferences for user {user_id}: {updated_fields}')
            return True, f"Updated {len(updated_fields)} preference(s)"
            
        except Exception as e:
            db.session.rollback()
            current_app.logger.error(f'Error updating preferences: {e}')
            return False, "Error updating preferences"
    
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
            
            # Map session keys to database fields
            field_mapping = {
                'email_notifications': 'notification_channel',
                'goal_notifications': 'goal_notifications',
                'daily_reminders': 'daily_reminders',
                'discord_webhook': 'discord_webhook'
            }
            
            update_data = {}
            for session_key, db_field in field_mapping.items():
                if session_key in session_preferences:
                    value = session_preferences[session_key]
                    if session_key == 'email_notifications':
                        update_data[db_field] = ['email'] if value else []
                    else:
                        update_data[db_field] = value
            
            if update_data:

                success, message = self.update_preferences(user_id, **update_data)
                if success:
                    current_app.logger.info(f'Migrated session preferences for user {user_id}')
                return success, message

            
            return True, "No preferences to migrate"
            
        except Exception as e:
            current_app.logger.error(f'Error migrating session preferences: {e}')
            return False, "Error migrating preferences"
