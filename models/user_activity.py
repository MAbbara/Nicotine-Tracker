"""User Activity model definition.
Minimal audit trail for essential security events only.
"""
from datetime import datetime
from extensions import db

class UserActivity(db.Model):
    __tablename__ = 'user_activity'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    activity_type = db.Column(db.String(50), nullable=False)  # login, password_change, account_delete
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    
    # Only track critical security events - no personal data
    status = db.Column(db.String(20), default='success', nullable=False)  # success, failed
    extra_data = db.Column(db.JSON, nullable=True)  # Additional context data when needed
    
    # Relationships
    user = db.relationship('User', backref=db.backref('activities', lazy='dynamic', cascade='all, delete-orphan'))
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'activity_type': self.activity_type,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'status': self.status,
            'extra_data': self.extra_data
        }
    
    def __repr__(self):
        return f'<UserActivity {self.user_id} - {self.activity_type} - {self.created_at}>'
