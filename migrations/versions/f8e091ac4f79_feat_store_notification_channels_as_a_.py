"""feat: Store notification channels as a JSON list

Revision ID: f8e091ac4f79
Revises: 9a3d3841f6c1
Create Date: 2025-08-12 08:03:50.723219

Portable, replay-safe implementation. No MySQL-only JSON functions: every row
transform runs through SQLAlchemy/Python on op.get_bind(), and the type change
uses a temporary typed column plus portable batch operations. The upgrade
inspects the current schema first, so replaying over a database whose
notification_channel is already JSON (e.g. a stamp-drifted database physically
past this revision) is a safe no-op that neither duplicates nor destructively
rewrites the column.
"""
import json

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f8e091ac4f79'
down_revision = '9a3d3841f6c1'
branch_labels = None
depends_on = None

# The four legacy meanings, normalized exactly.
CHANNEL_TO_JSON = {
    'email': ['email'],
    'discord': ['discord'],
    'both': ['email', 'discord'],
    'none': [],
}

# Downgrade round-trips all four meanings; 'both' is preserved as a set, never
# truncated to its first channel. Unexpected shapes degrade to 'none'.
JSON_TO_CHANNEL = {
    frozenset(['email']): 'email',
    frozenset(['discord']): 'discord',
    frozenset(['email', 'discord']): 'both',
    frozenset(): 'none',
}


def _notification_channel_is_json(conn) -> bool:
    inspector = sa.inspect(conn)
    for column in inspector.get_columns('user_preferences'):
        if column['name'] == 'notification_channel':
            return 'JSON' in str(column['type']).upper()
    raise RuntimeError('user_preferences.notification_channel is missing')


def upgrade():
    conn = op.get_bind()
    if _notification_channel_is_json(conn):
        # Already converted (stamp-drift replay): do not duplicate or rewrite.
        return

    # Step 1: temporary typed column; in-place VARCHAR -> JSON conversion is
    # unsafe when a dialect validates every existing value as JSON.
    with op.batch_alter_table('user_preferences', schema=None) as batch_op:
        batch_op.add_column(sa.Column('notification_channel_json', sa.JSON(), nullable=True))

    # Step 2: data migration through SQLAlchemy/Python.
    rows = conn.execute(
        sa.text('SELECT id, notification_channel FROM user_preferences')
    ).mappings()
    for row in rows:
        channels = CHANNEL_TO_JSON.get(row['notification_channel'])
        if channels is None:
            # Unexpected legacy value: left NULL in the new column rather than
            # being mis-serialized; the NOT NULL alter below will surface it.
            continue
        conn.execute(
            sa.text('UPDATE user_preferences SET notification_channel_json = :channels '
                    'WHERE id = :id'),
            {'channels': json.dumps(channels), 'id': row['id']},
        )

    # Step 3: swap the columns and tighten nullability. No server default is
    # set: the ORM metadata declares a Python-side default only, and MySQL
    # JSON columns cannot carry a plain literal default anyway.
    with op.batch_alter_table('user_preferences', schema=None) as batch_op:
        batch_op.drop_column('notification_channel')
    with op.batch_alter_table('user_preferences', schema=None) as batch_op:
        batch_op.alter_column('notification_channel_json',
                              new_column_name='notification_channel',
                              existing_type=sa.JSON(),
                              nullable=False)


def downgrade():
    conn = op.get_bind()
    if not _notification_channel_is_json(conn):
        # Already string-shaped (nothing to convert back).
        return

    # Step 1: temporary typed column for the string representation.
    with op.batch_alter_table('user_preferences', schema=None) as batch_op:
        batch_op.add_column(sa.Column('notification_channel_str', sa.String(length=20), nullable=True))

    # Step 2: data migration through SQLAlchemy/Python, round-tripping all
    # four meanings (including 'both', not only the first channel).
    rows = conn.execute(
        sa.text('SELECT id, notification_channel FROM user_preferences')
    ).mappings()
    for row in rows:
        raw = row['notification_channel']
        channels = json.loads(raw) if isinstance(raw, str) else list(raw or [])
        value = JSON_TO_CHANNEL.get(frozenset(channels), 'none')
        conn.execute(
            sa.text('UPDATE user_preferences SET notification_channel_str = :value '
                    'WHERE id = :id'),
            {'value': value, 'id': row['id']},
        )

    # Step 3: swap the columns back and restore the historical default.
    with op.batch_alter_table('user_preferences', schema=None) as batch_op:
        batch_op.drop_column('notification_channel')
    with op.batch_alter_table('user_preferences', schema=None) as batch_op:
        batch_op.alter_column('notification_channel_str',
                              new_column_name='notification_channel',
                              existing_type=sa.String(length=20),
                              nullable=False,
                              server_default=sa.text("'email'"))
