"""add portable notification delivery leases

Revision ID: e0f1a2b3c4d5
Revises: d9e3f4a5b6c7
Create Date: 2026-08-09 13:00:00.000000
"""

from alembic import op
import sqlalchemy as sa


revision = 'e0f1a2b3c4d5'
down_revision = 'd9e3f4a5b6c7'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('notification_queue') as batch:
        batch.add_column(sa.Column('claim_owner', sa.String(64), nullable=True))
        batch.add_column(sa.Column('claimed_at', sa.DateTime(), nullable=True))
        batch.add_column(sa.Column(
            'delivery_started_at', sa.DateTime(), nullable=True
        ))
        batch.create_index(
            'ix_notification_queue_claim',
            ['status', 'scheduled_for', 'claimed_at'],
            unique=False,
        )

    # A pre-lease worker may have delivered any row it left in ``processing``.
    # There is no ownership evidence with which to resume safely, so quarantine
    # these rows instead of risking duplicate credential or report delivery.
    queue = sa.table(
        'notification_queue',
        sa.column('status', sa.String(20)),
        sa.column('category', sa.String(50)),
        sa.column('claim_owner', sa.String(64)),
        sa.column('claimed_at', sa.DateTime()),
        sa.column('delivery_started_at', sa.DateTime()),
        sa.column('recipient', sa.String(255)),
        sa.column('subject', sa.String(255)),
        sa.column('message', sa.Text()),
        sa.column('extra_data', sa.JSON()),
        sa.column('error_message', sa.Text()),
    )
    op.get_bind().execute(
        queue.update().where(queue.c.status == 'processing').values(
            status='failed',
            claim_owner=None,
            claimed_at=None,
            delivery_started_at=None,
            recipient='[scrubbed-after-delivery-start]',
            subject=None,
            message=sa.case(
                (
                    queue.c.category.in_([
                        'password_reset', 'email_verification',
                    ]),
                    '[credential delivery outcome unknown]',
                ),
                (
                    queue.c.category == 'weekly_report',
                    '[weekly report delivery outcome unknown]',
                ),
                else_='[delivery outcome unknown]',
            ),
            extra_data=sa.null(),
            error_message=(
                'delivery outcome unknown during worker lease migration'
            ),
        )
    )


def downgrade():
    with op.batch_alter_table('notification_queue') as batch:
        batch.drop_index('ix_notification_queue_claim')
        batch.drop_column('delivery_started_at')
        batch.drop_column('claimed_at')
        batch.drop_column('claim_owner')
