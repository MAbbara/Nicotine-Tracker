"""enforce one active legacy goal per user and type

Revision ID: d4f1a6b8c902
Revises: 8a2d1c4e6f90
Create Date: 2026-08-03 02:15:00.000000

The nullable active slot preserves unlimited inactive history while its
three-column unique constraint serializes concurrent activation. Existing
duplicates are reconciled deterministically: the lowest Goal ID remains
active for each (user_id, goal_type), and later duplicates become inactive.
Legacy NULL goal types are normalized before reconciliation so they cannot
escape or collide with the active daily-pouches invariant.
"""

from alembic import op
import sqlalchemy as sa


revision = 'd4f1a6b8c902'
down_revision = '8a2d1c4e6f90'
branch_labels = None
depends_on = None

MYSQL_DOWNGRADE_SUPPORT_INDEX = 'ix_goal_user_id_downgrade_support'


def _mysql_goal_index_names(connection):
    return set(connection.execute(sa.text(
        'SELECT INDEX_NAME FROM information_schema.STATISTICS '
        'WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = \'goal\''
    )).scalars())


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
    connection.execute(
        goal.update().where(goal.c.goal_type.is_(None)).values(
            goal_type='daily_pouches'
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
        batch.alter_column(
            'goal_type',
            existing_type=sa.String(length=20),
            nullable=False,
        )
        batch.create_check_constraint(
            'ck_goal_active_slot_state',
            '(is_active = 1 AND active_slot IS NOT NULL '
            'AND active_slot = 1) OR '
            '(is_active = 0 AND active_slot IS NULL)',
        )
        batch.create_unique_constraint(
            'uq_goal_user_type_active_slot',
            ['user_id', 'goal_type', 'active_slot'],
        )

    # The wider unique index now supports the user foreign key. Remove only
    # the migration-owned downgrade support index; never touch a historical or
    # operator-created ``user_id`` index.
    if connection.dialect.name == 'mysql':
        index_names = _mysql_goal_index_names(connection)
        if (
            'uq_goal_user_type_active_slot' in index_names
            and MYSQL_DOWNGRADE_SUPPORT_INDEX in index_names
        ):
            op.drop_index(MYSQL_DOWNGRADE_SUPPORT_INDEX, table_name='goal')


def downgrade():
    # InnoDB removes its original implicit ``user_id`` index when the wider
    # active-slot unique index can support the existing user foreign key.
    # Restore a migration-owned supporting index before dropping the wider
    # one. The catalog check makes a retried downgrade safe without assuming
    # ownership of a generic ``user_id`` index.
    connection = op.get_bind()
    if (
        connection.dialect.name == 'mysql'
        and MYSQL_DOWNGRADE_SUPPORT_INDEX not in _mysql_goal_index_names(connection)
    ):
        op.create_index(
            MYSQL_DOWNGRADE_SUPPORT_INDEX,
            'goal',
            ['user_id'],
            unique=False,
        )

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
        batch.alter_column(
            'goal_type',
            existing_type=sa.String(length=20),
            nullable=True,
        )
        batch.drop_column('active_slot')
