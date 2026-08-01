"""add reduction plan domain and event idempotency

Revision ID: 8a2d1c4e6f90
Revises: 5f8c9b2a4e01
Create Date: 2026-07-27 19:30:00.000000

Downgrade is operationally safe only while the new plan/check-in/draft tables
are unused. It removes the additive domain and its idempotency/link columns;
it never changes legacy Goal rows or existing log/craving content.
"""

from datetime import datetime
import hashlib

from alembic import op
import sqlalchemy as sa


revision = '8a2d1c4e6f90'
down_revision = '5f8c9b2a4e01'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'reduction_plan',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('mode', sa.String(length=24), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('start_date', sa.Date(), nullable=True),
        sa.Column('target_date', sa.Date(), nullable=True),
        sa.Column('baseline_pouches', sa.Numeric(6, 2), nullable=True),
        sa.Column('baseline_mg', sa.Numeric(8, 2), nullable=True),
        sa.Column('baseline_mg_per_pouch', sa.Numeric(8, 2), nullable=True),
        sa.Column('baseline_source', sa.String(length=20), nullable=True),
        sa.Column('pace', sa.String(length=16), nullable=True),
        sa.Column('end_target_pouches', sa.Integer(), nullable=True),
        sa.Column('active_revision_id', sa.Integer(), nullable=True),
        sa.Column('active_slot', sa.Integer(), nullable=True),
        sa.Column('migration_fingerprint', sa.String(length=64), nullable=True),
        sa.Column('legacy_goal_ids', sa.JSON(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "mode IN ('reduce', 'quit_by_date', 'observe')",
            name='ck_reduction_plan_mode',
        ),
        sa.CheckConstraint(
            "status IN ('draft', 'active', 'paused', 'completed', 'archived')",
            name='ck_reduction_plan_status',
        ),
        sa.CheckConstraint(
            "(status = 'active' AND active_slot IS NOT NULL AND active_slot = 1) OR "
            "(status <> 'active' AND active_slot IS NULL)",
            name='ck_reduction_plan_active_slot_status',
        ),
        sa.CheckConstraint(
            "baseline_source IS NULL OR baseline_source IN "
            "('manual', 'recent_logs', 'observe', 'legacy_goal')",
            name='ck_reduction_plan_baseline_source',
        ),
        sa.CheckConstraint(
            "pace IS NULL OR pace IN ('gentle', 'steady', 'focused')",
            name='ck_reduction_plan_pace',
        ),
        sa.CheckConstraint(
            'baseline_pouches IS NULL OR baseline_pouches >= 0',
            name='ck_reduction_plan_baseline_pouches_nonnegative',
        ),
        sa.CheckConstraint(
            'baseline_mg IS NULL OR baseline_mg >= 0',
            name='ck_reduction_plan_baseline_mg_nonnegative',
        ),
        sa.CheckConstraint(
            'baseline_mg_per_pouch IS NULL OR baseline_mg_per_pouch >= 0',
            name='ck_reduction_plan_baseline_strength_nonnegative',
        ),
        sa.CheckConstraint(
            'end_target_pouches IS NULL OR end_target_pouches >= 0',
            name='ck_reduction_plan_end_target_nonnegative',
        ),
        sa.CheckConstraint(
            "NOT (status = 'active' AND mode IN ('reduce', 'quit_by_date')) OR "
            '(start_date IS NOT NULL AND baseline_source IS NOT NULL AND '
            'baseline_pouches IS NOT NULL AND baseline_pouches > 0 AND '
            'baseline_mg IS NOT NULL AND baseline_mg > 0 AND '
            'baseline_mg_per_pouch IS NOT NULL AND baseline_mg_per_pouch > 0 AND '
            'pace IS NOT NULL AND end_target_pouches IS NOT NULL)',
            name='ck_reduction_plan_targeted_activation_complete',
        ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('migration_fingerprint'),
        sa.UniqueConstraint(
            'user_id', 'active_slot', name='uq_reduction_plan_user_active_slot'
        ),
    )
    op.create_index(
        'ix_reduction_plan_status', 'reduction_plan', ['status'], unique=False
    )
    op.create_index(
        'ix_reduction_plan_user_id', 'reduction_plan', ['user_id'], unique=False
    )

    op.create_table(
        'plan_revision',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('plan_id', sa.Integer(), nullable=False),
        sa.Column('effective_date', sa.Date(), nullable=False),
        sa.Column('pace', sa.String(length=16), nullable=True),
        sa.Column('target_date', sa.Date(), nullable=True),
        sa.Column('end_target_pouches', sa.Integer(), nullable=True),
        sa.Column('generation_inputs', sa.JSON(), nullable=False),
        sa.Column('preview_digest', sa.String(length=64), nullable=False),
        sa.Column('reason', sa.String(length=32), nullable=False),
        sa.Column('note', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "pace IS NULL OR pace IN ('gentle', 'steady', 'focused')",
            name='ck_plan_revision_pace',
        ),
        sa.CheckConstraint(
            "reason IN ('initial', 'user_edit', 'difficulty_adjustment', "
            "'resume', 'boundary_change', 'other')",
            name='ck_plan_revision_reason',
        ),
        sa.CheckConstraint(
            'end_target_pouches IS NULL OR end_target_pouches >= 0',
            name='ck_plan_revision_end_target_nonnegative',
        ),
        sa.ForeignKeyConstraint(
            ['plan_id'], ['reduction_plan.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('plan_id', 'id', name='uq_plan_revision_plan_id_id'),
    )

    with op.batch_alter_table('reduction_plan') as batch:
        batch.create_foreign_key(
            'fk_reduction_plan_active_revision',
            'plan_revision',
            ['id', 'active_revision_id'],
            ['plan_id', 'id'],
        )

    op.create_table(
        'plan_day',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('plan_id', sa.Integer(), nullable=False),
        sa.Column('revision_id', sa.Integer(), nullable=False),
        sa.Column('local_date', sa.Date(), nullable=False),
        sa.Column('target_pouches', sa.Integer(), nullable=True),
        sa.Column('nicotine_ceiling_mg', sa.Numeric(8, 2), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            '(target_pouches IS NULL AND nicotine_ceiling_mg IS NULL) OR '
            '(target_pouches IS NOT NULL AND target_pouches >= 0 AND '
            'nicotine_ceiling_mg IS NOT NULL AND nicotine_ceiling_mg >= 0)',
            name='ck_plan_day_target_pair',
        ),
        sa.ForeignKeyConstraint(
            ['plan_id', 'revision_id'],
            ['plan_revision.plan_id', 'plan_revision.id'],
            name='fk_plan_day_plan_revision',
            ondelete='CASCADE',
        ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'plan_id', 'local_date', name='uq_plan_day_plan_local_date'
        ),
    )

    op.create_table(
        'plan_status_event',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('plan_id', sa.Integer(), nullable=False),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('effective_at_utc', sa.DateTime(), nullable=False),
        sa.Column('local_date', sa.Date(), nullable=False),
        sa.Column('reason', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "status IN ('active', 'paused', 'completed', 'archived')",
            name='ck_plan_status_event_status',
        ),
        sa.ForeignKeyConstraint(
            ['plan_id'], ['reduction_plan.id'], ondelete='CASCADE'
        ),
        sa.PrimaryKeyConstraint('id'),
    )

    op.create_table(
        'daily_check_in',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('plan_id', sa.Integer(), nullable=True),
        sa.Column('local_date', sa.Date(), nullable=False),
        sa.Column('mood', sa.Integer(), nullable=True),
        sa.Column('confidence', sa.Integer(), nullable=True),
        sa.Column('reflection', sa.Text(), nullable=True),
        sa.Column('context', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            'mood IS NULL OR (mood >= 1 AND mood <= 5)',
            name='ck_daily_check_in_mood_range',
        ),
        sa.CheckConstraint(
            'confidence IS NULL OR (confidence >= 1 AND confidence <= 5)',
            name='ck_daily_check_in_confidence_range',
        ),
        sa.ForeignKeyConstraint(
            ['plan_id'], ['reduction_plan.id'], ondelete='SET NULL'
        ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'user_id', 'local_date', name='uq_daily_check_in_user_local_date'
        ),
    )

    op.create_table(
        'onboarding_draft',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('current_step', sa.String(length=20), nullable=False),
        sa.Column('structured_payload', sa.JSON(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('updated_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "current_step IN ('intention', 'baseline', 'pace', 'support', 'review')",
            name='ck_onboarding_draft_current_step',
        ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )

    with op.batch_alter_table('log') as batch:
        batch.add_column(sa.Column('client_event_id', sa.String(64), nullable=True))
        batch.create_unique_constraint(
            'uq_log_user_client_event_id', ['user_id', 'client_event_id']
        )

    with op.batch_alter_table('craving') as batch:
        batch.add_column(sa.Column('client_event_id', sa.String(64), nullable=True))
        batch.add_column(sa.Column('linked_log_id', sa.Integer(), nullable=True))
        batch.create_unique_constraint(
            'uq_craving_user_client_event_id', ['user_id', 'client_event_id']
        )
        batch.create_foreign_key(
            'fk_craving_linked_log', 'log', ['linked_log_id'], ['id'],
            ondelete='SET NULL',
        )

    _backfill_legacy_goal_drafts(op.get_bind())


def _backfill_legacy_goal_drafts(conn):
    goal = sa.table(
        'goal',
        sa.column('id', sa.Integer()),
        sa.column('user_id', sa.Integer()),
        sa.column('goal_type', sa.String()),
        sa.column('target_value', sa.Integer()),
        sa.column('start_date', sa.Date()),
        sa.column('end_date', sa.Date()),
        sa.column('is_active', sa.Boolean()),
    )
    plan = sa.table(
        'reduction_plan',
        sa.column('user_id', sa.Integer()),
        sa.column('mode', sa.String()),
        sa.column('status', sa.String()),
        sa.column('start_date', sa.Date()),
        sa.column('target_date', sa.Date()),
        sa.column('baseline_pouches', sa.Numeric(6, 2)),
        sa.column('baseline_mg', sa.Numeric(8, 2)),
        sa.column('baseline_mg_per_pouch', sa.Numeric(8, 2)),
        sa.column('baseline_source', sa.String()),
        sa.column('pace', sa.String()),
        sa.column('end_target_pouches', sa.Integer()),
        sa.column('active_revision_id', sa.Integer()),
        sa.column('active_slot', sa.Integer()),
        sa.column('migration_fingerprint', sa.String()),
        sa.column('legacy_goal_ids', sa.JSON()),
        sa.column('created_at', sa.DateTime()),
        sa.column('updated_at', sa.DateTime()),
    )
    goals = conn.execute(
        sa.select(goal).where(goal.c.is_active.is_(True))
    ).mappings().all()
    pouch_goals = [row for row in goals if row['goal_type'] == 'daily_pouches']
    mg_goals = [row for row in goals if row['goal_type'] == 'daily_mg']
    now = datetime.utcnow()
    for pouch_goal in pouch_goals:
        matches = [
            row for row in mg_goals
            if row['user_id'] == pouch_goal['user_id']
            and row['start_date'] == pouch_goal['start_date']
            and row['end_date'] == pouch_goal['end_date']
        ]
        source_ids = [pouch_goal['id']]
        if len(matches) == 1:
            source_ids.append(matches[0]['id'])
        source_ids = sorted(source_ids)
        fingerprint_input = (
            f"legacy-goals:{pouch_goal['user_id']}:"
            + ','.join(str(value) for value in source_ids)
        )
        conn.execute(plan.insert().values(
            user_id=pouch_goal['user_id'],
            mode='reduce',
            status='draft',
            start_date=None,
            target_date=None,
            baseline_pouches=None,
            baseline_mg=None,
            baseline_mg_per_pouch=None,
            baseline_source='legacy_goal',
            pace=None,
            end_target_pouches=pouch_goal['target_value'],
            active_revision_id=None,
            active_slot=None,
            migration_fingerprint=hashlib.sha256(
                fingerprint_input.encode('utf-8')
            ).hexdigest(),
            legacy_goal_ids=source_ids,
            created_at=now,
            updated_at=now,
        ))


def downgrade():
    with op.batch_alter_table('craving') as batch:
        batch.drop_constraint('fk_craving_linked_log', type_='foreignkey')
        batch.drop_constraint('uq_craving_user_client_event_id', type_='unique')
        batch.drop_column('linked_log_id')
        batch.drop_column('client_event_id')

    with op.batch_alter_table('log') as batch:
        batch.drop_constraint('uq_log_user_client_event_id', type_='unique')
        batch.drop_column('client_event_id')

    op.drop_table('onboarding_draft')
    op.drop_table('daily_check_in')
    op.drop_table('plan_status_event')
    op.drop_table('plan_day')
    with op.batch_alter_table('reduction_plan') as batch:
        batch.drop_constraint('fk_reduction_plan_active_revision', type_='foreignkey')
    op.drop_table('plan_revision')
    op.drop_index('ix_reduction_plan_user_id', table_name='reduction_plan')
    op.drop_index('ix_reduction_plan_status', table_name='reduction_plan')
    op.drop_table('reduction_plan')
