"""Pouch model definition.
Defines the Pouch ORM model representing nicotine pouch products.
"""
from datetime import datetime
from decimal import Decimal
from extensions import db

class Pouch(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    brand = db.Column(db.String(80), nullable=False)
    nicotine_mg = db.Column(db.Numeric(8, 2), nullable=False)
    is_default = db.Column(db.Boolean, default=True)
    created_by = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # Relationships. passive_deletes lets the database enforce
    # log.pouch_id ON DELETE SET NULL instead of ORM-side nullification.
    logs = db.relationship('Log', backref='pouch', lazy='dynamic', passive_deletes=True)

    def nicotine_mg_display(self) -> str:
        """Human display form: 6.00 -> '6', 1.50 -> '1.5'."""
        if self.nicotine_mg is None:
            return ''
        return format(Decimal(str(self.nicotine_mg)).normalize(), 'f')

    def to_dict(self) -> dict:
        return {
            'id': self.id,
            'brand': self.brand,
            'nicotine_mg': float(self.nicotine_mg) if self.nicotine_mg is not None else None,
            'is_default': self.is_default,
            'created_by': self.created_by,
            'created_at': self.created_at.isoformat() if self.created_at else None,
        }

    def __repr__(self) -> str:
        return f'<Pouch {self.brand} - {self.nicotine_mg_display()}mg>'
