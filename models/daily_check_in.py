"""Optional daily reflection attached to a user day."""

from datetime import datetime

from extensions import db


class DailyCheckIn(db.Model):
    __tablename__ = 'daily_check_in'
    __table_args__ = (
        db.UniqueConstraint(
            'user_id', 'local_date', name='uq_daily_check_in_user_local_date'
        ),
        db.CheckConstraint(
            'mood IS NULL OR (mood >= 1 AND mood <= 5)',
            name='ck_daily_check_in_mood_range',
        ),
        db.CheckConstraint(
            'confidence IS NULL OR (confidence >= 1 AND confidence <= 5)',
            name='ck_daily_check_in_confidence_range',
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'), nullable=False
    )
    plan_id = db.Column(
        db.Integer,
        db.ForeignKey('reduction_plan.id', ondelete='SET NULL'),
        nullable=True,
    )
    local_date = db.Column(db.Date, nullable=False)
    mood = db.Column(db.Integer, nullable=True)
    confidence = db.Column(db.Integer, nullable=True)
    reflection = db.Column(db.Text, nullable=True)
    context = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, nullable=False, default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    user = db.relationship(
        'User', backref=db.backref('daily_check_ins', cascade='all, delete-orphan')
    )
    plan = db.relationship('ReductionPlan', backref='daily_check_ins')
