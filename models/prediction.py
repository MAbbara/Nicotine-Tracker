"""
Prediction Model
"""
from extensions import db
from datetime import datetime

class Prediction(db.Model):
    __tablename__ = 'prediction'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    
    # Prediction details
    prediction_type = db.Column(db.String(50)) # e.g., 'craving_risk', 'next_usage'
    predicted_value = db.Column(db.Float)
    predicted_at = db.Column(db.DateTime)
    
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'prediction_type': self.prediction_type,
            'predicted_value': self.predicted_value,
            'predicted_at': self.predicted_at.isoformat(),
            'created_at': self.created_at.isoformat()
        }
