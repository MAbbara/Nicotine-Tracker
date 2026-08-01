"""Append-only reduction-plan lifecycle event."""

from datetime import datetime

from extensions import db


class PlanStatusEvent(db.Model):
    __tablename__ = 'plan_status_event'
    __table_args__ = (
        db.CheckConstraint(
            "status IN ('active', 'paused', 'completed', 'archived')",
            name='ck_plan_status_event_status',
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    plan_id = db.Column(
        db.Integer,
        db.ForeignKey('reduction_plan.id', ondelete='CASCADE'),
        nullable=False,
    )
    status = db.Column(db.String(16), nullable=False)
    effective_at_utc = db.Column(db.DateTime, nullable=False)
    local_date = db.Column(db.Date, nullable=False)
    reason = db.Column(db.String(255), nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    plan = db.relationship(
        'ReductionPlan',
        backref=db.backref(
            'status_events', cascade='all, delete-orphan',
            order_by='PlanStatusEvent.effective_at_utc',
        ),
    )
