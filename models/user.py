"""User model definition.
This module defines the User ORM model and any user-related helper methods.
"""
from datetime import datetime, date, timedelta
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
    verification_token = db.Column(db.String(100))

    # Password reset
    reset_token = db.Column(db.String(100))
    reset_token_expires = db.Column(db.DateTime)

    # Preferences
    preferred_brands = db.Column(db.Text)  # JSON string of preferred brands
    timezone = db.Column(db.String(50), default='UTC')
    units_preference = db.Column(db.String(20), default='mg')

    # Relationships
    logs = db.relationship('Log', backref='user', lazy='dynamic', cascade='all, delete-orphan')
    goals = db.relationship('Goal', backref='user', lazy='dynamic', cascade='all, delete-orphan')
    custom_pouches = db.relationship('Pouch', backref='creator', lazy='dynamic')

    def set_password(self, password):
        self.password_hash = bcrypt.generate_password_hash(password).decode('utf-8')

    def check_password(self, password):
        return bcrypt.check_password_hash(self.password_hash, password)

    def generate_verification_token(self):
        self.verification_token = secrets.token_urlsafe(32)
        return self.verification_token

    def generate_reset_token(self):
        self.reset_token = secrets.token_urlsafe(32)
        self.reset_token_expires = datetime.utcnow() + timedelta(hours=1)
        return self.reset_token

    def get_daily_intake(self, target_date=None):
        if target_date is None:
            target_date = date.today()
        daily_logs = self.logs.filter_by(log_date=target_date).all()
        total_mg = 0
        total_pouches = 0
        for log in daily_logs:
            if log.pouch:
                total_mg += log.quantity * log.pouch.nicotine_mg
            elif log.custom_nicotine_mg:
                total_mg += log.quantity * log.custom_nicotine_mg
            total_pouches += log.quantity
        return {
            'total_mg': total_mg,
            'total_pouches': total_pouches,
            'sessions': len(daily_logs)
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
            'units_preference': self.units_preference,
            'preferred_brands': self.preferred_brands,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

    def __repr__(self):
        return f'<User {self.email}>'
