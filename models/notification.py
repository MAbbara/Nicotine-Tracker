"""Notification models definition.
Handles notification queue and history with minimal data collection.
"""
from datetime import datetime
from extensions import db

class NotificationQueue(db.Model):
    __tablename__ = 'notification_queue'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    notification_type = db.Column(db.String(50), nullable=False)  # email, discord, slack
    category = db.Column(db.String(50), nullable=False)  # goal_reminder, daily_reminder, achievement
    subject = db.Column(db.String(255), nullable=True)
    message = db.Column(db.Text, nullable=False)
    recipient = db.Column(db.String(255), nullable=False)  # email address, webhook URL
    
    # Scheduling
    scheduled_for = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    
    # Processing status
    status = db.Column(db.String(20), default='pending', nullable=False)  # pending, processing, sent, failed
    attempts = db.Column(db.Integer, default=0, nullable=False)
    max_attempts = db.Column(db.Integer, default=3, nullable=False)
    last_attempt_at = db.Column(db.DateTime, nullable=True)
    error_message = db.Column(db.Text, nullable=True)
    
    # Priority and extra data
    priority = db.Column(db.Integer, default=5, nullable=False)  # 1-10, 1 being highest priority
    extra_data = db.Column(db.JSON, nullable=True)  # Additional data for the notification
    
    # Relationships
    user = db.relationship('User', backref=db.backref('queued_notifications', lazy='dynamic', cascade='all, delete-orphan'))
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'notification_type': self.notification_type,
            'category': self.category,
            'subject': self.subject,
            'message': self.message,
            'recipient': self.recipient,
            'scheduled_for': self.scheduled_for.isoformat() if self.scheduled_for else None,
            'created_at': self.created_at.isoformat() if self.created_at else None,
            'status': self.status,
            'attempts': self.attempts,
            'max_attempts': self.max_attempts,
            'last_attempt_at': self.last_attempt_at.isoformat() if self.last_attempt_at else None,
            'error_message': self.error_message,
            'priority': self.priority,
            'extra_data': self.extra_data
        }
    
    def __repr__(self):
        return f'<NotificationQueue {self.id} - {self.notification_type} - {self.status}>'


class NotificationHistory(db.Model):
    __tablename__ = 'notification_history'
    
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('user.id'), nullable=False)
    notification_type = db.Column(db.String(50), nullable=False)
    category = db.Column(db.String(50), nullable=False)
    subject = db.Column(db.String(255), nullable=True)
    recipient = db.Column(db.String(255), nullable=False)
    
    # Delivery information - no personal tracking
    sent_at = db.Column(db.DateTime, default=datetime.utcnow, nullable=False)
    delivery_status = db.Column(db.String(20), nullable=False)  # sent, delivered, failed, bounced
    attempts_made = db.Column(db.Integer, default=1, nullable=False)
    
    # Reference to original queue item
    original_queue_id = db.Column(db.Integer, nullable=True)
    
    # Relationships
    user = db.relationship('User', backref=db.backref('notification_history', lazy='dynamic', cascade='all, delete-orphan'))
    
    def to_dict(self):
        return {
            'id': self.id,
            'user_id': self.user_id,
            'notification_type': self.notification_type,
            'category': self.category,
            'subject': self.subject,
            'recipient': self.recipient,
            'sent_at': self.sent_at.isoformat() if self.sent_at else None,
            'delivery_status': self.delivery_status,
            'attempts_made': self.attempts_made,
            'original_queue_id': self.original_queue_id
        }
    
    def __repr__(self):
        return f'<NotificationHistory {self.id} - {self.notification_type} - {self.delivery_status}>'
