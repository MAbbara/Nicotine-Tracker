"""Email Verification model definition.
Handles secure email verification tokens with minimal data collection.
"""
from datetime import datetime, timedelta
import secrets
from extensions import db

class EmailVerification(db.Model):
    __tablename__ = 'email_verifications'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    token = db.Column(db.String(100), unique=True, nullable=False, index=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    expires_at = db.Column(db.DateTime, nullable=False)
    verified_at = db.Column(db.DateTime, nullable=True)
    is_verified = db.Column(db.Boolean, default=False, nullable=False)
    
    # Relationships
    user = db.relationship('User', backref=db.backref('email_verifications', lazy='dynamic', cascade='all, delete-orphan'))
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'expires_at': self.expires_at.isoformat() if self.expires_at else None,
            'verified_at': self.verified_at.isoformat() if self.verified_at else None,
            'is_verified': self.is_verified
        }
    
    def __repr__(self):
        return f'<EmailVerification {self.user_id} - {self.created_at}>'
