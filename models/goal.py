"""Goal model definition.
Defines the Goal ORM model used to track user-defined consumption targets.
"""
from datetime import datetime, date
from extensions import db

class Goal(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    # Goal settings
    goal_type = db.Column(db.String(20), default='daily_pouches')
    target_value = db.Column(db.Integer, nullable=False)
    current_streak = db.Column(db.Integer, default=0)
    best_streak = db.Column(db.Integer, default=0)

    # Goal period
    start_date = db.Column(db.Date, default=date.today)
    end_date = db.Column(db.Date)
    is_active = db.Column(db.Boolean, default=True)

    # Notifications
    enable_notifications = db.Column(db.Boolean, default=True)
    notification_threshold = db.Column(db.Float, default=0.8)

    def check_goal_progress(self, target_date: date = None) -> bool:
        if target_date is None:
            target_date = date.today()
        intake = self.user.get_daily_intake(target_date)
        if self.goal_type == 'daily_pouches':
            return intake['total_pouches'] <= self.target_value
        elif self.goal_type == 'daily_mg':
            return intake['total_mg'] <= self.target_value
        return False

    def update_streak(self, target_date: date = None) -> None:
        if self.check_goal_progress(target_date):
            self.current_streak += 1
            if self.current_streak > self.best_streak:
                self.best_streak = self.current_streak
        else:
            self.current_streak = 0

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'user_id': self.user_id,
            'goal_type': self.goal_type,
            'target_value': self.target_value,
            'current_streak': self.current_streak,
            'best_streak': self.best_streak,
            'start_date': self.start_date.isoformat() if self.start_date else None,
            'end_date': self.end_date.isoformat() if self.end_date else None,
            'is_active': self.is_active,
            'enable_notifications': self.enable_notifications,
            'notification_threshold': self.notification_threshold,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None,
        }

    def __repr__(self) -> str:
        return f'<Goal {self.user_id} - {self.goal_type}: {self.target_value}>'
