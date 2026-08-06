"""Immutable revision metadata for a reduction plan."""

from datetime import datetime

from extensions import db


class PlanRevision(db.Model):
    __tablename__ = 'plan_revision'
    __table_args__ = (
        db.UniqueConstraint('plan_id', 'id', name='uq_plan_revision_plan_id_id'),
        db.CheckConstraint(
            "pace IS NULL OR pace IN ('gentle', 'steady', 'focused')",
            name='ck_plan_revision_pace',
        ),
        db.CheckConstraint(
            "reason IN ('initial', 'user_edit', 'difficulty_adjustment', "
            "'resume', 'boundary_change', 'other')",
            name='ck_plan_revision_reason',
        ),
        db.CheckConstraint(
            'end_target_pouches IS NULL OR end_target_pouches >= 0',
            name='ck_plan_revision_end_target_nonnegative',
        ),
        db.CheckConstraint(
            'end_target_mg IS NULL OR '
            '(end_target_mg >= 0 AND end_target_mg <= 999999.99)',
            name='ck_plan_revision_end_target_mg_nonnegative',
        ),
    )

    id = db.Column(db.Integer, primary_key=True)
    plan_id = db.Column(
        db.Integer,
        db.ForeignKey('reduction_plan.id', ondelete='CASCADE'),
        nullable=False,
    )
    effective_date = db.Column(db.Date, nullable=False)
    pace = db.Column(db.String(16), nullable=True)
    target_date = db.Column(db.Date, nullable=True)
    end_target_pouches = db.Column(db.Integer, nullable=True)
    end_target_mg = db.Column(db.Numeric(8, 2), nullable=True)
    generation_inputs = db.Column(db.JSON, nullable=False, default=dict)
    preview_digest = db.Column(db.String(64), nullable=False)
    reason = db.Column(db.String(32), nullable=False)
    note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    plan = db.relationship(
        'ReductionPlan',
        backref=db.backref(
            'revisions', cascade='all, delete-orphan',
            foreign_keys='PlanRevision.plan_id',
        ),
        foreign_keys=[plan_id],
    )
