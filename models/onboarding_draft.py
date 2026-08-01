"""Structured, resumable plan-onboarding progress."""

from datetime import datetime

from extensions import db


class OnboardingDraft(db.Model):
    __tablename__ = 'onboarding_draft'
    __table_args__ = (
        db.CheckConstraint(
            "current_step IN ('intention', 'baseline', 'pace', 'support', 'review')",
            name='ck_onboarding_draft_current_step',
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(
        db.Integer,
        db.ForeignKey('user.id', ondelete='CASCADE'),
        nullable=False,
        unique=True,
    )
    current_step = db.Column(db.String(20), nullable=False, default='intention')
    structured_payload = db.Column(db.JSON, nullable=False, default=dict)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, nullable=False, default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    user = db.relationship(
        'User', backref=db.backref('onboarding_draft', uselist=False,
                                   cascade='all, delete-orphan')
    )
