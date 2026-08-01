"""add coaching preferences and ranked preferred pouches

Revision ID: 5f8c9b2a4e01
Revises: 38495c4b5bbd
Create Date: 2026-07-27 18:45:00.000000
"""

import json
import secrets

from alembic import op
import sqlalchemy as sa


revision = '5f8c9b2a4e01'
down_revision = '38495c4b5bbd'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'user_preferred_pouch',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('pouch_id', sa.Integer(), nullable=False),
        sa.Column('rank', sa.Integer(), nullable=False),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            sa.column('rank') >= 0,
            name='ck_preferred_rank_nonnegative',
        ),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['pouch_id'], ['pouch.id'], ondelete='CASCADE'),
        sa.UniqueConstraint('user_id', 'pouch_id', name='uq_preferred_user_pouch'),
        sa.UniqueConstraint('user_id', 'rank', name='uq_preferred_user_rank'),
    )

    with op.batch_alter_table('user_preferences') as batch:
        batch.add_column(sa.Column('difficult_times', sa.JSON(), nullable=True))
        batch.add_column(sa.Column('common_triggers', sa.JSON(), nullable=True))
        batch.add_column(sa.Column('offline_queue_enabled', sa.Boolean(), nullable=True))
        batch.add_column(sa.Column('offline_queue_id', sa.String(64), nullable=True))
        batch.add_column(sa.Column('pending_timezone', sa.String(50), nullable=True))
        batch.add_column(sa.Column('pending_daily_reset_time', sa.Time(), nullable=True))
        batch.add_column(sa.Column('boundary_change_effective_at_utc', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column('boundary_change_target_local_date', sa.Date(), nullable=True))

    conn = op.get_bind()
    rows = conn.execute(sa.text('SELECT id FROM user_preferences')).mappings()
    for row in rows:
        conn.execute(
            sa.text(
                'UPDATE user_preferences SET difficult_times=:empty, '
                'common_triggers=:empty, offline_queue_enabled=:enabled, '
                'offline_queue_id=:queue_id WHERE id=:id'
            ),
            {
                'empty': json.dumps([]),
                'enabled': True,
                'queue_id': secrets.token_urlsafe(32),
                'id': row['id'],
            },
        )

    with op.batch_alter_table('user_preferences') as batch:
        batch.alter_column('difficult_times', existing_type=sa.JSON(), nullable=False)
        batch.alter_column('common_triggers', existing_type=sa.JSON(), nullable=False)
        batch.alter_column('offline_queue_enabled', existing_type=sa.Boolean(), nullable=False)
        batch.alter_column('offline_queue_id', existing_type=sa.String(64), nullable=False)
        batch.create_unique_constraint('uq_user_preferences_offline_queue_id', ['offline_queue_id'])

    with op.batch_alter_table('user_settings') as batch:
        batch.add_column(sa.Column('theme', sa.String(20), nullable=True))
    conn.execute(sa.text(
        "UPDATE user_settings SET theme = CASE "
        "WHEN chart_theme IN ('light', 'dark') THEN chart_theme ELSE 'system' END"
    ))
    with op.batch_alter_table('user_settings') as batch:
        batch.alter_column('theme', existing_type=sa.String(20), nullable=False)


def downgrade():
    with op.batch_alter_table('user_settings') as batch:
        batch.drop_column('theme')
    with op.batch_alter_table('user_preferences') as batch:
        batch.drop_constraint('uq_user_preferences_offline_queue_id', type_='unique')
        batch.drop_column('boundary_change_target_local_date')
        batch.drop_column('boundary_change_effective_at_utc')
        batch.drop_column('pending_daily_reset_time')
        batch.drop_column('pending_timezone')
        batch.drop_column('offline_queue_id')
        batch.drop_column('offline_queue_enabled')
        batch.drop_column('common_triggers')
        batch.drop_column('difficult_times')
    op.drop_table('user_preferred_pouch')
