"""enforce one active legacy goal per user and type

Revision ID: d4f1a6b8c902
Revises: 8a2d1c4e6f90
Create Date: 2026-08-03 02:15:00.000000

The nullable active slot preserves unlimited inactive history while its
three-column unique constraint serializes concurrent activation. Existing
duplicates are reconciled deterministically: the lowest Goal ID remains
active for each (user_id, goal_type), and later duplicates become inactive.
"""

from alembic import op
import sqlalchemy as sa


revision = 'd4f1a6b8c902'
down_revision = '8a2d1c4e6f90'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('goal') as batch:
        batch.add_column(sa.Column('active_slot', sa.Integer(), nullable=True))

    connection = op.get_bind()
    goal = sa.table(
        'goal',
        sa.column('id', sa.Integer()),
        sa.column('user_id', sa.Integer()),
        sa.column('goal_type', sa.String(length=20)),
        sa.column('is_active', sa.Boolean()),
        sa.column('active_slot', sa.Integer()),
    )
    connection.execute(
        goal.update().where(goal.c.is_active.is_(None)).values(
            is_active=False, active_slot=None
        )
    )
    active_rows = connection.execute(
        sa.select(goal.c.id, goal.c.user_id, goal.c.goal_type).where(
            goal.c.is_active.is_(True)
        ).order_by(goal.c.user_id, goal.c.goal_type, goal.c.id)
    ).mappings().all()
    keepers = []
    seen = set()
    for row in active_rows:
        key = (row['user_id'], row['goal_type'])
        if key not in seen:
            keepers.append(row['id'])
            seen.add(key)
    if active_rows:
        connection.execute(
            goal.update().where(goal.c.is_active.is_(True)).values(
                is_active=False, active_slot=None
            )
        )
    if keepers:
        connection.execute(
            goal.update().where(goal.c.id.in_(keepers)).values(
                is_active=True, active_slot=1
            )
        )

    with op.batch_alter_table('goal') as batch:
        batch.alter_column(
            'is_active',
            existing_type=sa.Boolean(),
            nullable=False,
        )
        batch.create_check_constraint(
            'ck_goal_active_slot_state',
            '(is_active = 1 AND active_slot = 1) OR '
            '(is_active = 0 AND active_slot IS NULL)',
        )
        batch.create_unique_constraint(
            'uq_goal_user_type_active_slot',
            ['user_id', 'goal_type', 'active_slot'],
        )


def downgrade():
    with op.batch_alter_table('goal') as batch:
        batch.drop_constraint(
            'uq_goal_user_type_active_slot', type_='unique'
        )
        batch.drop_constraint('ck_goal_active_slot_state', type_='check')
        batch.alter_column(
            'is_active',
            existing_type=sa.Boolean(),
            nullable=True,
        )
        batch.drop_column('active_slot')
