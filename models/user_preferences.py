"""User Preferences model definition.
Handles user notification and communication preferences.
"""
from datetime import datetime
from extensions import db

class UserPreferences(db.Model):
    __tablename__ = 'user_preferences'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False, unique=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow, nullable=False)
    
    # Notification channel preferences
    notification_channel = db.Column(db.String(20), default='email', nullable=False)  # 'none', 'email', 'discord', 'both'
    
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
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }
    
    def __repr__(self):
        return f'<UserPreferences {self.user_id}>'
