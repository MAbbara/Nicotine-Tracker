"""User model definition.
This module defines the User ORM model and any user-related helper methods.
"""
from datetime import datetime, date, time, timedelta
from decimal import Decimal
import secrets

from extensions import db, bcrypt

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index=True)
    password_hash = db.Column(db.String(128), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Profile information
    age = db.Column(db.Integer)
    gender = db.Column(db.String(20))
    weight = db.Column(db.Float)

    # Email verification
    email_verified = db.Column(db.Boolean, default=False)

    # Preferences
    timezone = db.Column(db.String(50), default='UTC')


    # Relationships
    logs = db.relationship('Log', backref='user', lazy='dynamic', cascade='all, delete-orphan')
    goals = db.relationship('Goal', backref='user', lazy='dynamic', cascade='all, delete-orphan')
    custom_pouches = db.relationship('Pouch', backref='creator', lazy='dynamic')

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

    def get_daily_intake(self, target_date=None, use_timezone=True):
        """
        Calculate total pouches and nicotine for a given day.

        Uses the canonical half-open user-day window: reads filter
        ``Log.log_time >= start_utc`` and ``Log.log_time < end_utc`` with
        database-naive UTC bounds, honoring the user's daily reset time.
        An event at exactly ``end_utc`` belongs to the next user day; the
        deprecated ``Log.log_date`` column is never read.
        """
        # Local import to avoid circular dependencies
        from models.log import Log
        from services.timezone_service import (
            get_current_user_day,
            get_user_day_window,
            resolve_timezone,
            to_naive_utc,
        )

        if use_timezone:
            # This model field is persisted legacy data; resolve it explicitly
            # before invoking the strict canonical window constructor.
            timezone_name = resolve_timezone(self.timezone).zone
            reset_time = time.min
            if self.preferences and self.preferences.daily_reset_time:
                reset_time = self.preferences.daily_reset_time
        else:
            timezone_name = 'UTC'
            reset_time = time.min

        if target_date is None:
            target_date = get_current_user_day(timezone_name, reset_time)

        window = get_user_day_window(timezone_name, target_date, reset_time)
        logs_query = self.logs.filter(
            Log.log_time >= to_naive_utc(window.start_utc),
            Log.log_time < to_naive_utc(window.end_utc)
        )

        total_pouches = 0
        total_mg = Decimal('0')

        for log in logs_query:
            total_pouches += log.quantity
            log_total = log.get_total_nicotine()
            if log_total is not None:
                # Unknown historical nicotine is skipped, never treated as
                # zero and never allowed to raise on +=.
                total_mg += log_total

        return {
            'total_pouches': total_pouches,
            'total_mg': float(total_mg)
        }

    def to_dict(self):

        return {
            'id': self.id,
            'email': self.email,
            'age': self.age,
            'gender': self.gender,
            'weight': self.weight,
            'email_verified': self.email_verified,
            'timezone': self.timezone,
            'created_at': self.created_at.isoformat() if self.created_at else None

        }

    def __repr__(self):
        return f'<User {self.email}>'
