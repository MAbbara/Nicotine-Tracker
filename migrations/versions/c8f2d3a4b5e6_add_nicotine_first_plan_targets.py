"""add nicotine-first plan targets

Revision ID: c8f2d3a4b5e6
Revises: d4f1a6b8c902
Create Date: 2026-08-06 03:00:00.000000

The migration is additive for historical pouch targets. Existing non-observe
plans with schedule definitions take their authoritative end target from the
final persisted PlanDay; mutable pouch catalog data is never consulted. A
targeted plan with no final nicotine ceiling aborts before any DDL is issued.
"""

from alembic import op
import sqlalchemy as sa


revision = 'c8f2d3a4b5e6'
down_revision = 'd4f1a6b8c902'
branch_labels = None
depends_on = None


PLAN_TARGET_CHECK = (
    'end_target_mg IS NULL OR '
    '(end_target_mg >= 0 AND end_target_mg <= 999999.99)'
)
NICOTINE_FIRST_DAY_CHECK = (
    '(target_pouches IS NULL AND nicotine_ceiling_mg IS NULL) OR '
    '(target_pouches IS NULL AND nicotine_ceiling_mg >= 0) OR '
    '(target_pouches >= 0 AND nicotine_ceiling_mg IS NOT NULL AND '
    'nicotine_ceiling_mg >= 0)'
)
LEGACY_DAY_CHECK = (
    '(target_pouches IS NULL AND nicotine_ceiling_mg IS NULL) OR '
    '(target_pouches IS NOT NULL AND target_pouches >= 0 AND '
    'nicotine_ceiling_mg IS NOT NULL AND nicotine_ceiling_mg >= 0)'
)
NICOTINE_FIRST_ACTIVATION_CHECK = (
    "NOT (status = 'active' AND mode IN ('reduce', 'quit_by_date')) OR "
    '(start_date IS NOT NULL AND baseline_source IS NOT NULL AND '
    'baseline_mg IS NOT NULL AND baseline_mg > 0 AND '
    'pace IS NOT NULL AND end_target_mg IS NOT NULL)'
)
LEGACY_ACTIVATION_CHECK = (
    "NOT (status = 'active' AND mode IN ('reduce', 'quit_by_date')) OR "
    '(start_date IS NOT NULL AND baseline_source IS NOT NULL AND '
    'baseline_pouches IS NOT NULL AND baseline_pouches > 0 AND '
    'baseline_mg IS NOT NULL AND baseline_mg > 0 AND '
    'baseline_mg_per_pouch IS NOT NULL AND baseline_mg_per_pouch > 0 AND '
    'pace IS NOT NULL AND end_target_pouches IS NOT NULL)'
)


def _authoritative_targets(connection):
    plan = sa.table(
        'reduction_plan',
        sa.column('id', sa.Integer()),
        sa.column('mode', sa.String()),
        sa.column('start_date', sa.Date()),
        sa.column('target_date', sa.Date()),
        sa.column('baseline_mg', sa.Numeric(8, 2)),
        sa.column('pace', sa.String()),
        sa.column('active_revision_id', sa.Integer()),
    )
    day = sa.table(
        'plan_day',
        sa.column('id', sa.Integer()),
        sa.column('plan_id', sa.Integer()),
        sa.column('local_date', sa.Date()),
        sa.column('nicotine_ceiling_mg', sa.Numeric(8, 2)),
    )
    targeted_plans = connection.execute(
        sa.select(
            plan.c.id,
            plan.c.active_revision_id,
            plan.c.start_date,
            plan.c.target_date,
            plan.c.baseline_mg,
            plan.c.pace,
        ).where(
            plan.c.mode != 'observe',
        ).order_by(plan.c.id)
    ).mappings().all()
    targets = []
    for row in targeted_plans:
        final_row = connection.execute(
            sa.select(day.c.nicotine_ceiling_mg).where(
                day.c.plan_id == row['id']
            ).order_by(day.c.local_date.desc(), day.c.id.desc()).limit(1)
        ).first()
        has_schedule_definition = any(
            row[field] is not None
            for field in (
                'start_date',
                'target_date',
                'baseline_mg',
                'pace',
                'active_revision_id',
            )
        )
        if final_row is None and not has_schedule_definition:
            # An incomplete compatibility review shell is not yet a schedule.
            continue
        if final_row is None or final_row[0] is None:
            raise RuntimeError(
                'nicotine-first migration requires an authoritative final '
                f'ceiling for targeted plan {row["id"]}'
            )
        targets.append((row['id'], row['active_revision_id'], final_row[0]))
    return targets


def _assert_legacy_downgrade_compatible(connection):
    plan = sa.table(
        'reduction_plan',
        sa.column('id', sa.Integer()),
        sa.column('mode', sa.String()),
        sa.column('status', sa.String()),
        sa.column('start_date', sa.Date()),
        sa.column('baseline_source', sa.String()),
        sa.column('baseline_pouches', sa.Numeric(6, 2)),
        sa.column('baseline_mg', sa.Numeric(8, 2)),
        sa.column('baseline_mg_per_pouch', sa.Numeric(8, 2)),
        sa.column('pace', sa.String()),
        sa.column('end_target_pouches', sa.Integer()),
    )
    day = sa.table(
        'plan_day',
        sa.column('id', sa.Integer()),
        sa.column('target_pouches', sa.Integer()),
        sa.column('nicotine_ceiling_mg', sa.Numeric(8, 2)),
    )
    incompatible_day = connection.execute(
        sa.select(day.c.id).where(sa.or_(
            sa.and_(
                day.c.target_pouches.is_(None),
                day.c.nicotine_ceiling_mg.is_not(None),
            ),
            sa.and_(
                day.c.target_pouches.is_not(None),
                day.c.nicotine_ceiling_mg.is_(None),
            ),
            day.c.target_pouches < 0,
            day.c.nicotine_ceiling_mg < 0,
        )).limit(1)
    ).scalar_one_or_none()
    incompatible_plan = connection.execute(
        sa.select(plan.c.id).where(
            plan.c.status == 'active',
            plan.c.mode.in_(('reduce', 'quit_by_date')),
            sa.or_(
                plan.c.start_date.is_(None),
                plan.c.baseline_source.is_(None),
                plan.c.baseline_pouches.is_(None),
                plan.c.baseline_pouches <= 0,
                plan.c.baseline_mg.is_(None),
                plan.c.baseline_mg <= 0,
                plan.c.baseline_mg_per_pouch.is_(None),
                plan.c.baseline_mg_per_pouch <= 0,
                plan.c.pace.is_(None),
                plan.c.end_target_pouches.is_(None),
            ),
        ).limit(1)
    ).scalar_one_or_none()
    if incompatible_day is not None or incompatible_plan is not None:
        raise RuntimeError(
            'cannot downgrade nicotine-first plan data without '
            'legacy-compatible pouch targets'
        )


def upgrade():
    connection = op.get_bind()
    targets = _authoritative_targets(connection)

    with op.batch_alter_table('reduction_plan') as batch:
        batch.add_column(sa.Column(
            'end_target_mg', sa.Numeric(8, 2), nullable=True
        ))
    with op.batch_alter_table('plan_revision') as batch:
        batch.add_column(sa.Column(
            'end_target_mg', sa.Numeric(8, 2), nullable=True
        ))

    plan = sa.table(
        'reduction_plan',
        sa.column('id', sa.Integer()),
        sa.column('end_target_mg', sa.Numeric(8, 2)),
    )
    plan_revision = sa.table(
        'plan_revision',
        sa.column('id', sa.Integer()),
        sa.column('end_target_mg', sa.Numeric(8, 2)),
    )
    for plan_id, active_revision_id, final_ceiling in targets:
        connection.execute(
            plan.update().where(plan.c.id == plan_id).values(
                end_target_mg=final_ceiling
            )
        )
        if active_revision_id is not None:
            connection.execute(
                plan_revision.update().where(
                    plan_revision.c.id == active_revision_id
                ).values(end_target_mg=final_ceiling)
            )

    with op.batch_alter_table('plan_day') as batch:
        batch.drop_constraint('ck_plan_day_target_pair', type_='check')
        batch.create_check_constraint(
            'ck_plan_day_target_pair', NICOTINE_FIRST_DAY_CHECK
        )
    with op.batch_alter_table('reduction_plan') as batch:
        batch.drop_constraint(
            'ck_reduction_plan_targeted_activation_complete', type_='check'
        )
        batch.create_check_constraint(
            'ck_reduction_plan_end_target_mg_nonnegative', PLAN_TARGET_CHECK
        )
        batch.create_check_constraint(
            'ck_reduction_plan_targeted_activation_complete',
            NICOTINE_FIRST_ACTIVATION_CHECK,
        )
    with op.batch_alter_table('plan_revision') as batch:
        batch.create_check_constraint(
            'ck_plan_revision_end_target_mg_nonnegative', PLAN_TARGET_CHECK
        )


def downgrade():
    _assert_legacy_downgrade_compatible(op.get_bind())

    with op.batch_alter_table('plan_day') as batch:
        batch.drop_constraint('ck_plan_day_target_pair', type_='check')
        batch.create_check_constraint(
            'ck_plan_day_target_pair', LEGACY_DAY_CHECK
        )
    with op.batch_alter_table('reduction_plan') as batch:
        batch.drop_constraint(
            'ck_reduction_plan_targeted_activation_complete', type_='check'
        )
        batch.create_check_constraint(
            'ck_reduction_plan_targeted_activation_complete',
            LEGACY_ACTIVATION_CHECK,
        )
        batch.drop_constraint(
            'ck_reduction_plan_end_target_mg_nonnegative', type_='check'
        )
        batch.drop_column('end_target_mg')
    with op.batch_alter_table('plan_revision') as batch:
        batch.drop_constraint(
            'ck_plan_revision_end_target_mg_nonnegative', type_='check'
        )
        batch.drop_column('end_target_mg')
