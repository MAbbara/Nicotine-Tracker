"""add weekly report idempotency

Revision ID: d9e3f4a5b6c7
Revises: c8f2d3a4b5e6
Create Date: 2026-08-08 12:00:00.000000
"""

import hashlib
import json
from datetime import date

from alembic import op
import sqlalchemy as sa


revision = 'd9e3f4a5b6c7'
down_revision = 'c8f2d3a4b5e6'
branch_labels = None
depends_on = None


def _extra_dict(value):
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (TypeError, ValueError):
            return {}
        return parsed if isinstance(parsed, dict) else {}
    return {}


def _idempotency_key(user_id, period_start, notification_type):
    material = (
        f'weekly-report\0{user_id}\0{period_start.isoformat()}\0'
        f'{notification_type}'
    )
    return hashlib.sha256(material.encode('utf-8')).hexdigest()


def upgrade():
    with op.batch_alter_table('notification_queue') as batch:
        batch.add_column(sa.Column(
            'report_period_start', sa.Date(), nullable=True
        ))
        batch.add_column(sa.Column(
            'idempotency_key', sa.String(64), nullable=True
        ))

    connection = op.get_bind()
    queue = sa.table(
        'notification_queue',
        sa.column('id', sa.Integer()),
        sa.column('user_id', sa.Integer()),
        sa.column('notification_type', sa.String()),
        sa.column('category', sa.String()),
        sa.column('extra_data', sa.JSON()),
        sa.column('report_period_start', sa.Date()),
        sa.column('idempotency_key', sa.String()),
    )
    rows = connection.execute(sa.select(
        queue.c.id,
        queue.c.user_id,
        queue.c.notification_type,
        queue.c.extra_data,
    ).where(
        queue.c.category == 'weekly_report'
    ).order_by(queue.c.id)).mappings()
    backfilled_period_channels = set()
    for row in rows:
        raw_period = _extra_dict(row['extra_data']).get('week_start')
        try:
            period_start = date.fromisoformat(raw_period)
        except (TypeError, ValueError):
            continue
        period_channel = (
            row['user_id'], period_start, row['notification_type']
        )
        if period_channel in backfilled_period_channels:
            # Preserve duplicate legacy history without allowing it to block
            # the new uniqueness guarantee. The earliest row becomes the
            # canonical replay target; later historical rows remain unchanged.
            continue
        backfilled_period_channels.add(period_channel)
        connection.execute(
            queue.update().where(queue.c.id == row['id']).values(
                report_period_start=period_start,
                idempotency_key=_idempotency_key(
                    row['user_id'], period_start, row['notification_type']
                ),
            )
        )

    indexes = sa.inspect(connection).get_indexes('notification_queue')
    if not any(
        index.get('name') == 'ix_notification_queue_user_id'
        for index in indexes
    ):
        op.create_index(
            'ix_notification_queue_user_id',
            'notification_queue',
            ['user_id'],
        )

    with op.batch_alter_table('notification_queue') as batch:
        batch.create_unique_constraint(
            'uq_notification_weekly_period_channel',
            ['user_id', 'category', 'report_period_start', 'notification_type'],
        )


def downgrade():
    connection = op.get_bind()
    queue = sa.table(
        'notification_queue',
        sa.column('id', sa.Integer()),
        sa.column('category', sa.String()),
        sa.column('extra_data', sa.JSON()),
        sa.column('report_period_start', sa.Date()),
    )
    rows = connection.execute(sa.select(
        queue.c.id, queue.c.extra_data, queue.c.report_period_start,
    ).where(
        queue.c.category == 'weekly_report',
        queue.c.report_period_start.is_not(None),
    )).mappings()
    for row in rows:
        extra = _extra_dict(row['extra_data'])
        extra['week_start'] = row['report_period_start'].isoformat()
        connection.execute(
            queue.update().where(queue.c.id == row['id']).values(
                extra_data=extra,
            )
        )
    indexes = sa.inspect(connection).get_indexes('notification_queue')
    if not any(
        index.get('column_names') == ['user_id']
        for index in indexes
    ):
        op.create_index(
            'ix_notification_queue_user_id',
            'notification_queue',
            ['user_id'],
        )
    with op.batch_alter_table('notification_queue') as batch:
        batch.drop_constraint(
            'uq_notification_weekly_period_channel', type_='unique'
        )
        batch.drop_column('idempotency_key')
        batch.drop_column('report_period_start')
    indexes = sa.inspect(connection).get_indexes('notification_queue')
    if any(
        index.get('name') == 'ix_notification_queue_user_id'
        for index in indexes
    ):
        if connection.dialect.name == 'mysql' and not any(
            index.get('name') != 'ix_notification_queue_user_id'
            and index.get('column_names') == ['user_id']
            for index in indexes
        ):
            # MySQL may discard its implicit FK index after the explicit index
            # is introduced. Recreate the down-revision support index before
            # removing ours so the foreign key remains valid.
            op.create_index('user_id', 'notification_queue', ['user_id'])
        op.drop_index(
            'ix_notification_queue_user_id',
            table_name='notification_queue',
        )
