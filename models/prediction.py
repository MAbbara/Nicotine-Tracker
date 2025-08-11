"""Prediction model definition.
Stores predictive analytics data and risk assessments.
"""
from datetime import datetime, date
from extensions import db

class CravingPrediction(db.Model):
    __tablename__ = 'craving_predictions'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    
    # Prediction details
    prediction_date = db.Column(db.Date, nullable=False)
    prediction_hour = db.Column(db.Integer)  # 0-23, hour of day for prediction
    risk_score = db.Column(db.Float, nullable=False)  # 0.0-1.0 probability of craving
    confidence_level = db.Column(db.Float)  # 0.0-1.0 confidence in prediction
    
    # Contributing factors (JSON string)
    risk_factors = db.Column(db.Text)  # JSON with factors contributing to risk
    
    # Actual outcome (filled in after the predicted time)
    actual_craving_occurred = db.Column(db.Boolean)
    actual_craving_intensity = db.Column(db.Integer)  # If craving occurred, what intensity
    prediction_accuracy = db.Column(db.Float)  # How accurate was the prediction
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'prediction_date': self.prediction_date.isoformat(),
            'prediction_hour': self.prediction_hour,
            'risk_score': self.risk_score,
            'confidence_level': self.confidence_level,
            'risk_factors': self.risk_factors,
            'actual_craving_occurred': self.actual_craving_occurred,
            'actual_craving_intensity': self.actual_craving_intensity,
            'prediction_accuracy': self.prediction_accuracy,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }

    def get_risk_factors(self):
        """Parse risk factors from JSON"""
        if not self.risk_factors:
            return {}
        try:
            import json
            return json.loads(self.risk_factors)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_risk_factors(self, factors_dict):
        """Set risk factors as JSON"""
        if factors_dict:
            import json
            self.risk_factors = json.dumps(factors_dict)
        else:
            self.risk_factors = None

    def get_risk_level(self):
        """Get human-readable risk level"""
        if self.risk_score >= 0.8:
            return 'Very High'
        elif self.risk_score >= 0.6:
            return 'High'
        elif self.risk_score >= 0.4:
            return 'Medium'
        elif self.risk_score >= 0.2:
            return 'Low'
        else:
            return 'Very Low'

    def __repr__(self):
        return f'<CravingPrediction {self.user_id} - {self.prediction_date} - Risk: {self.risk_score:.2f}>'


class UserPattern(db.Model):
    __tablename__ = 'user_patterns'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Pattern identification
    pattern_type = db.Column(db.String(50), nullable=False)  # 'hourly', 'daily', 'weekly', 'trigger', 'mood'
    pattern_name = db.Column(db.String(100))
    
    # Pattern data (JSON string)
    pattern_data = db.Column(db.Text)  # JSON with pattern details
    
    # Pattern strength and reliability
    confidence_score = db.Column(db.Float)  # 0.0-1.0 how reliable this pattern is
    sample_size = db.Column(db.Integer)  # Number of data points used to identify pattern
    last_occurrence = db.Column(db.DateTime)  # When this pattern was last observed
    
    # Pattern status
    is_active = db.Column(db.Boolean, default=True)
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'pattern_type': self.pattern_type,
            'pattern_name': self.pattern_name,
            'pattern_data': self.pattern_data,
            'confidence_score': self.confidence_score,
            'sample_size': self.sample_size,
            'last_occurrence': self.last_occurrence.isoformat() if self.last_occurrence else None,
            'is_active': self.is_active,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'updated_at': self.updated_at.isoformat() if self.updated_at else None
        }

    def get_pattern_data(self):
        """Parse pattern data from JSON"""
        if not self.pattern_data:
            return {}
        try:
            import json
            return json.loads(self.pattern_data)
        except (json.JSONDecodeError, TypeError):
            return {}

    def set_pattern_data(self, data_dict):
        """Set pattern data as JSON"""
        if data_dict:
            import json
            self.pattern_data = json.dumps(data_dict)
        else:
            self.pattern_data = None

    def __repr__(self):
        return f'<UserPattern {self.user_id} - {self.pattern_type} - {self.pattern_name}>'
