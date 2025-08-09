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
