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
    
    # Enhanced data collection fields
    duration_minutes = db.Column(db.Integer)  # How long the craving lasted
    physical_symptoms = db.Column(db.Text)  # JSON string of symptoms
    situation_context = db.Column(db.Text)  # Where, with whom, doing what
    outcome = db.Column(db.String(50))  # 'resisted', 'used_nicotine', 'used_alternative'
    outcome_notes = db.Column(db.Text)  # How they feel after, what they did instead
    mood_before = db.Column(db.Integer)  # 1-10 mood scale before craving
    mood_after = db.Column(db.Integer)  # 1-10 mood scale after craving/resolution
    stress_level = db.Column(db.Integer)  # 1-10 stress scale

    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'craving_time': self.craving_time.isoformat(),
            'intensity': self.intensity,
            'trigger': self.trigger,
            'notes': self.notes,
            'duration_minutes': self.duration_minutes,
            'physical_symptoms': self.physical_symptoms,
            'situation_context': self.situation_context,
            'outcome': self.outcome,
            'outcome_notes': self.outcome_notes,
            'mood_before': self.mood_before,
            'mood_after': self.mood_after,
            'stress_level': self.stress_level
        }

    def get_physical_symptoms_list(self):
        """Parse physical symptoms from JSON string"""
        if not self.physical_symptoms:
            return []
        try:
            import json
            return json.loads(self.physical_symptoms)
        except (json.JSONDecodeError, TypeError):
            return []

    def set_physical_symptoms_list(self, symptoms_list):
        """Set physical symptoms as JSON string"""
        if symptoms_list:
            import json
            self.physical_symptoms = json.dumps(symptoms_list)
        else:
            self.physical_symptoms = None

    def __repr__(self):
        return f'<Craving {self.user_id} - {self.craving_time} - Intensity: {self.intensity}>'
