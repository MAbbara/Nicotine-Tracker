"""Reduction plan identity and lifecycle state."""

from datetime import datetime

from extensions import db


class ReductionPlan(db.Model):
    __tablename__ = 'reduction_plan'
    __table_args__ = (
        db.CheckConstraint(
            "mode IN ('reduce', 'quit_by_date', 'observe')",
            name='ck_reduction_plan_mode',
        ),
        db.CheckConstraint(
            "status IN ('draft', 'active', 'paused', 'completed', 'archived')",
            name='ck_reduction_plan_status',
        ),
        db.CheckConstraint(
            "(status = 'active' AND active_slot IS NOT NULL AND active_slot = 1) OR "
            "(status <> 'active' AND active_slot IS NULL)",
            name='ck_reduction_plan_active_slot_status',
        ),
        db.UniqueConstraint(
            'user_id', 'active_slot', name='uq_reduction_plan_user_active_slot'
        ),
        db.CheckConstraint(
            "baseline_source IS NULL OR baseline_source IN "
            "('manual', 'recent_logs', 'observe', 'legacy_goal')",
            name='ck_reduction_plan_baseline_source',
        ),
        db.CheckConstraint(
            "pace IS NULL OR pace IN ('gentle', 'steady', 'focused')",
            name='ck_reduction_plan_pace',
        ),
        db.CheckConstraint(
            'baseline_pouches IS NULL OR baseline_pouches >= 0',
            name='ck_reduction_plan_baseline_pouches_nonnegative',
        ),
        db.CheckConstraint(
            'baseline_mg IS NULL OR baseline_mg >= 0',
            name='ck_reduction_plan_baseline_mg_nonnegative',
        ),
        db.CheckConstraint(
            'baseline_mg_per_pouch IS NULL OR baseline_mg_per_pouch >= 0',
            name='ck_reduction_plan_baseline_strength_nonnegative',
        ),
        db.CheckConstraint(
            'end_target_pouches IS NULL OR end_target_pouches >= 0',
            name='ck_reduction_plan_end_target_nonnegative',
        ),
        db.CheckConstraint(
            'end_target_mg IS NULL OR '
            '(end_target_mg >= 0 AND end_target_mg <= 999999.99)',
            name='ck_reduction_plan_end_target_mg_nonnegative',
        ),
        db.CheckConstraint(
            "NOT (status = 'active' AND mode IN ('reduce', 'quit_by_date')) OR "
            '(start_date IS NOT NULL AND baseline_source IS NOT NULL AND '
            'baseline_mg IS NOT NULL AND baseline_mg > 0 AND '
            'pace IS NOT NULL AND end_target_mg IS NOT NULL)',
            name='ck_reduction_plan_targeted_activation_complete',
        ),
        db.ForeignKeyConstraint(
            ['id', 'active_revision_id'],
            ['plan_revision.plan_id', 'plan_revision.id'],
            name='fk_reduction_plan_active_revision',
            use_alter=True,
        ),
    )

    id = db.Column(db.Integer, primary_key=True, autoincrement='ignore_fk')
    user_id = db.Column(
        db.Integer, db.ForeignKey('user.id', ondelete='CASCADE'),
        nullable=False, index=True,
    )
    mode = db.Column(db.String(24), nullable=False)
    status = db.Column(db.String(16), nullable=False, default='draft', index=True)
    start_date = db.Column(db.Date, nullable=True)
    target_date = db.Column(db.Date, nullable=True)
    baseline_pouches = db.Column(db.Numeric(6, 2), nullable=True)
    baseline_mg = db.Column(db.Numeric(8, 2), nullable=True)
    baseline_mg_per_pouch = db.Column(db.Numeric(8, 2), nullable=True)
    baseline_source = db.Column(db.String(20), nullable=True)
    pace = db.Column(db.String(16), nullable=True)
    end_target_pouches = db.Column(db.Integer, nullable=True)
    end_target_mg = db.Column(db.Numeric(8, 2), nullable=True)
    active_revision_id = db.Column(db.Integer, nullable=True)
    active_slot = db.Column(db.Integer, nullable=True)
    migration_fingerprint = db.Column(db.String(64), nullable=True, unique=True)
    legacy_goal_ids = db.Column(db.JSON, nullable=True)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(
        db.DateTime, nullable=False, default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    user = db.relationship(
        'User', backref=db.backref('reduction_plans', cascade='all, delete-orphan')
    )
    active_revision = db.relationship(
        'PlanRevision',
        primaryjoin=(
            'and_(ReductionPlan.id == PlanRevision.plan_id, '
            'ReductionPlan.active_revision_id == PlanRevision.id)'
        ),
        foreign_keys=[active_revision_id],
        viewonly=True,
        uselist=False,
    )
