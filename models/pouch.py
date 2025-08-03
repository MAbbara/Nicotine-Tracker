"""Pouch model definition.
Defines the Pouch ORM model representing nicotine pouch products.
"""
from datetime import datetime
from extensions import db

class Pouch(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    brand = db.Column(db.String(80), nullable=False)
    nicotine_mg = db.Column(db.Integer, nullable=False)
    is_default = db.Column(db.Boolean, default=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships
    logs = db.relationship('Log', backref='pouch', lazy='dynamic')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'brand': self.brand,
            'nicotine_mg': self.nicotine_mg,
            'is_default': self.is_default,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f'<Pouch {self.brand} - {self.nicotine_mg}mg>'
