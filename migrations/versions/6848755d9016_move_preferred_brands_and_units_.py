"""Move preferred_brands and units_preference to UserPreferences

Revision ID: 6848755d9016
Revises: f8e091ac4f79
Create Date: 2025-08-24 01:14:01.898060

Portable, replay-safe implementation. No UPDATE ... JOIN: the data move runs
as a select/update loop with bound parameters, and every column is added,
dropped, or copied only when the inspected schema requires it, so a
stamp-drifted database (physically past this revision despite a 9a3d3841f6c1
stamp) replays safely on both SQLite and MySQL.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '6848755d9016'
down_revision = 'f8e091ac4f79'
branch_labels = None
depends_on = None

_MOVED_COLUMNS = ('units_preference', 'preferred_brands')


def _columns(conn, table) -> set:
    return {c['name'] for c in sa.inspect(conn).get_columns(table)}


def _build_copy_statements(source_table, source_id, target_table, target_id,
                           columns):
    """Build dialect-quoted select/update statements for a row-wise copy.

    The ``user`` table name is quoted through SQLAlchemy so SQLite emits
    double quotes and MySQL emits backticks under its default SQL mode.
    """
    source = sa.table(
        sa.sql.quoted_name(source_table, quote=True),
        sa.column(sa.sql.quoted_name(source_id, quote=True)),
        *(sa.column(sa.sql.quoted_name(name, quote=True)) for name in columns),
    )
    target = sa.table(
        sa.sql.quoted_name(target_table, quote=True),
        sa.column(sa.sql.quoted_name(target_id, quote=True)),
        *(sa.column(sa.sql.quoted_name(name, quote=True)) for name in columns),
    )
    select_stmt = sa.select(
        source.c[source_id], *(source.c[name] for name in columns)
    )
    update_stmt = (
        sa.update(target)
        .where(target.c[target_id] == sa.bindparam('copy_target_id'))
        .values({name: sa.bindparam(f'copy_{name}') for name in columns})
    )
    return select_stmt, update_stmt


def _copy_rows(conn, source_table, source_id, target_table, target_id,
               columns):
    select_stmt, update_stmt = _build_copy_statements(
        source_table, source_id, target_table, target_id, columns
    )
    for row in conn.execute(select_stmt).mappings():
        params = {'copy_target_id': row[source_id]}
        params.update({f'copy_{name}': row[name] for name in columns})
        conn.execute(update_stmt, params)


def upgrade():
    conn = op.get_bind()
    user_cols = _columns(conn, 'user')
    pref_cols = _columns(conn, 'user_preferences')

    # Step 1: add the target columns only when missing (nullable for now).
    add_units = 'units_preference' not in pref_cols
    add_brands = 'preferred_brands' not in pref_cols
    if add_units or add_brands:
        with op.batch_alter_table('user_preferences', schema=None) as batch_op:
            if add_units:
                batch_op.add_column(sa.Column('units_preference', sa.String(length=20), nullable=True))
            if add_brands:
                batch_op.add_column(sa.Column('preferred_brands', sa.JSON(), nullable=True))

    # Step 2: portable data migration — copy only the columns that actually
    # exist on both sides, row by row with bound parameters.
    pref_cols = _columns(conn, 'user_preferences')
    movable = [c for c in _MOVED_COLUMNS if c in user_cols and c in pref_cols]
    if movable:
        _copy_rows(
            conn, source_table='user', source_id='id',
            target_table='user_preferences', target_id='user_id',
            columns=movable,
        )

    # Step 3: default missing/null units_preference to 'mg'.
    if 'units_preference' in pref_cols:
        conn.execute(sa.text("UPDATE user_preferences SET units_preference = 'mg' "
                             "WHERE units_preference IS NULL"))

    # Step 4: make units_preference non-nullable (only when it is not already).
    inspector = sa.inspect(conn)
    units_col = next(c for c in inspector.get_columns('user_preferences')
                     if c['name'] == 'units_preference')
    if units_col['nullable']:
        with op.batch_alter_table('user_preferences', schema=None) as batch_op:
            batch_op.alter_column('units_preference',
                                  existing_type=sa.String(length=20),
                                  nullable=False)

    # Step 5: drop the old columns from the user table, only when present.
    droppable = [c for c in _MOVED_COLUMNS if c in user_cols]
    if droppable:
        with op.batch_alter_table('user', schema=None) as batch_op:
            for column in droppable:
                batch_op.drop_column(column)


def downgrade():
    conn = op.get_bind()
    user_cols = _columns(conn, 'user')
    pref_cols = _columns(conn, 'user_preferences')

    # Step 1: add the historical user columns back, only when missing.
    # Representation note: user_preferences.preferred_brands is JSON while the
    # historical user.preferred_brands column is TEXT; the JSON document is
    # copied verbatim as text below, so the JSON meaning is preserved across
    # the representation change.
    add_units = 'units_preference' not in user_cols
    add_brands = 'preferred_brands' not in user_cols
    if add_units or add_brands:
        with op.batch_alter_table('user', schema=None) as batch_op:
            if add_units:
                batch_op.add_column(sa.Column('units_preference', sa.String(length=20), nullable=True))
            if add_brands:
                batch_op.add_column(sa.Column('preferred_brands', sa.Text(), nullable=True))

    # Step 2: portable data migration back to the user table.
    user_cols = _columns(conn, 'user')
    movable = [c for c in _MOVED_COLUMNS if c in user_cols and c in pref_cols]
    if movable:
        _copy_rows(
            conn, source_table='user_preferences', source_id='user_id',
            target_table='user', target_id='id', columns=movable,
        )

    # Step 3: drop the columns from user_preferences, only when present.
    droppable = [c for c in _MOVED_COLUMNS if c in pref_cols]
    if droppable:
        with op.batch_alter_table('user_preferences', schema=None) as batch_op:
            for column in droppable:
                batch_op.drop_column(column)
