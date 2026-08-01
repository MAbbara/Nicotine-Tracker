"""User Preferences model definition.
Handles user notification and communication preferences.
"""
from datetime import datetime
import secrets
from extensions import db

class UserPreferences(db.Model):
    __tablename__ = 'user_preferences'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Notification channel preferences
    notification_channel = db.Column(db.JSON, nullable=False, default=lambda: ['email'])  # e.g., ['email', 'discord']

    
    # Specific notification type preferences

    goal_notifications = db.Column(db.Boolean, default=True, nullable=False)
    daily_reminders = db.Column(db.Boolean, default=False, nullable=False)
    weekly_reports = db.Column(db.Boolean, default=False, nullable=False)
    achievement_notifications = db.Column(db.Boolean, default=True, nullable=False)
    
    # Communication preferences
    discord_webhook = db.Column(db.Text, nullable=True)
    slack_webhook = db.Column(db.Text, nullable=True)
    
    # Notification timing preferences
    reminder_time = db.Column(db.Time, nullable=True)  # Daily reminder time
    quiet_hours_start = db.Column(db.Time, nullable=True)  # No notifications start
    quiet_hours_end = db.Column(db.Time, nullable=True)  # No notifications end
    
    # Frequency preferences
    notification_frequency = db.Column(db.String(20), default='immediate', nullable=False)  # immediate, daily, weekly
    
    # Daily reset time preference (defaults to midnight)
    daily_reset_time = db.Column(db.Time, nullable=True)  # Time when daily statistics reset
    
    # General preferences
    units_preference = db.Column(db.String(20), default='mg', nullable=False)  # 'mg' or 'percentage'
    preferred_brands = db.Column(db.JSON, nullable=True)

    # Coaching context and offline identity.
    difficult_times = db.Column(db.JSON, nullable=False, default=list)
    common_triggers = db.Column(db.JSON, nullable=False, default=list)
    offline_queue_enabled = db.Column(db.Boolean, nullable=False, default=True)
    offline_queue_id = db.Column(
        db.String(64), nullable=False, unique=True,
        default=lambda: secrets.token_urlsafe(32),
    )

    # Reserved for plan-aware boundary scheduling in Phase 2. Phase 1 applies
    # validated changes immediately and leaves these fields null.
    pending_timezone = db.Column(db.String(50), nullable=True)
    pending_daily_reset_time = db.Column(db.Time, nullable=True)
    boundary_change_effective_at_utc = db.Column(db.DateTime, nullable=True)
    boundary_change_target_local_date = db.Column(db.Date, nullable=True)
    
    # Relationships

    user = db.relationship('User', backref=db.backref('preferences', uselist=False, cascade='all, delete-orphan'))
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'notification_channel': self.notification_channel,
            'goal_notifications': self.goal_notifications,
            'daily_reminders': self.daily_reminders,
            'weekly_reports': self.weekly_reports,
            'achievement_notifications': self.achievement_notifications,
            'discord_webhook': self.discord_webhook,
            'slack_webhook': self.slack_webhook,
            'reminder_time': self.reminder_time.isoformat() if self.reminder_time else None,
            'quiet_hours_start': self.quiet_hours_start.isoformat() if self.quiet_hours_start else None,
            'quiet_hours_end': self.quiet_hours_end.isoformat() if self.quiet_hours_end else None,
            'notification_frequency': self.notification_frequency,
            'daily_reset_time': self.daily_reset_time.isoformat() if self.daily_reset_time else None,
            'units_preference': self.units_preference,
            'preferred_brands': self.preferred_brands,
            'difficult_times': self.difficult_times or [],
            'common_triggers': self.common_triggers or [],
            'offline_queue_enabled': self.offline_queue_enabled,
            'offline_queue_id': self.offline_queue_id,
            'pending_timezone': self.pending_timezone,
            'pending_daily_reset_time': self.pending_daily_reset_time.isoformat() if self.pending_daily_reset_time else None,
            'boundary_change_effective_at_utc': self.boundary_change_effective_at_utc.isoformat() if self.boundary_change_effective_at_utc else None,
            'boundary_change_target_local_date': self.boundary_change_target_local_date.isoformat() if self.boundary_change_target_local_date else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

    
    def __repr__(self):
        return f'<UserPreferences {self.user_id}>'
