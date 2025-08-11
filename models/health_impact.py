"""
Health Impact Model
"""
from extensions import db
from datetime import datetime

class HealthImpact(db.Model):
    __tablename__ = 'health_impact'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    
    # Physical Health
    blood_pressure = db.Column(db.String(20))
    heart_rate = db.Column(db.Integer)
    gum_health = db.Column(db.String(50))
    
    # Mental Health
    anxiety_level = db.Column(db.Integer)
    focus_level = db.Column(db.Integer)
    mood = db.Column(db.String(50))
    
    # Notes
    notes = db.Column(db.Text)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'blood_pressure': self.blood_pressure,
            'heart_rate': self.heart_rate,
            'gum_health': self.gum_health,
            'anxiety_level': self.anxiety_level,
            'focus_level': self.focus_level,
            'mood': self.mood,
            'notes': self.notes,
            'created_at': self.created_at.isoformat()
        }
