"""Craving model definition.
Represents individual craving events.
"""
from datetime import datetime
from extensions import db

class Craving(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    craving_time = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    intensity = db.Column(db.Integer, nullable=False)  # e.g., on a scale of 1-10
    trigger = db.Column(db.String(100))  # e.g., "stress", "boredom", "social"
    notes = db.Column(db.Text)

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'craving_time': self.craving_time.isoformat(),
            'intensity': self.intensity,
            'trigger': self.trigger,
            'notes': self.notes
        }

    def __repr__(self):
        return f'<Craving {self.user_id} - {self.craving_time}>'
