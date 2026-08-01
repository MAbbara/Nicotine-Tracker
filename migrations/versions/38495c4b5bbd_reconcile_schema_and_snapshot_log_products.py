"""reconcile schema and snapshot log products

Revision ID: 38495c4b5bbd
Revises: 6848755d9016
Create Date: 2026-07-26 11:30:00.000000

Reconciliation head for the stabilization slice. Safe against a normal fresh
chain, the synthetic 6848755d9016 missing-field drift, and partially present
target columns: every change is guarded by inspection of the current schema.

Upgrade:
- reconciles user_preferences.units_preference (non-null string, missing or
  NULL values defaulted/backfilled to 'mg') and preferred_brands (nullable
  JSON), adding whichever is missing;
- removes the stale notification_channel server default left by the original
  f8e091ac4f79, which conflicts with the ORM metadata (Python-side default);
- changes pouch.nicotine_mg to NUMERIC(8,2) non-null and log.custom_nicotine_mg
  to NUMERIC(8,2) nullable;
- adds log.product_brand_snapshot (VARCHAR(80)) and log.nicotine_mg_snapshot
  (NUMERIC(8,2)), both nullable;
- replaces the log.pouch_id foreign key with ON DELETE SET NULL;
- backfills the snapshots from the referenced pouch or the log's custom
  values; unknown historical brand/strength stays NULL (zero is never
  fabricated).

Downgrade: portable, and it never silently destroys a fractional value. Where
a strict historical INTEGER conversion would be lossy (fractional values
present), the NUMERIC(8,2) representation is retained instead — a deliberate
meaning-preserving/schema-representation tradeoff documented here. The prior
log.pouch_id FK shape (no ON DELETE action) is always restored, and only the
columns owned by this revision (the two snapshots) are removed;
units_preference/preferred_brands belong to 6848755d9016 and are left alone,
as is the notification_channel server default the repaired f8e091ac4f79 no
longer creates.
"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '38495c4b5bbd'
down_revision = '6848755d9016'
branch_labels = None
depends_on = None

SNAPSHOT_COLUMNS = ('product_brand_snapshot', 'nicotine_mg_snapshot')


def _columns(conn, table) -> dict:
    return {c['name']: c for c in sa.inspect(conn).get_columns(table)}


def _is_numeric_8_2(column) -> bool:
    col_type = column['type']
    return (isinstance(col_type, sa.Numeric)
            and col_type.precision == 8 and col_type.scale == 2)


def _fractional_count_statement(table, column):
    """Build a dialect-aware count of non-integral stored values."""
    table_clause = sa.table(
        sa.sql.quoted_name(table, quote=True),
        sa.column(sa.sql.quoted_name(column, quote=True)),
    )
    value = table_clause.c[column]
    return (
        sa.select(sa.func.count())
        .select_from(table_clause)
        .where(value != sa.cast(value, sa.Integer()))
    )


def _has_fractional_values(conn, table, column) -> bool:
    # Portable fraction detection: SQLite's CAST truncates and MySQL's CAST
    # rounds, but on both an integral value always equals its INTEGER cast
    # while a fractional value never does. (SQLite's ``%`` is unusable here:
    # it casts both operands to INTEGER first.) NULLs compare to NULL and are
    # not counted.
    return bool(conn.execute(
        _fractional_count_statement(table, column)
    ).scalar())


def _replace_log_pouch_fk(conn, ondelete):
    """Point the log.pouch_id FK at pouch(id) with the requested ON DELETE
    action, only when the current action differs.

    SQLite cannot drop the historical unnamed FK in place, so the table is
    rebuilt in batch mode from a corrected reflection. MySQL names its FKs,
    so a plain drop/create is used there.
    """
    inspector = sa.inspect(conn)
    current = None
    for fk in inspector.get_foreign_keys('log'):
        if fk['referred_table'] == 'pouch' and fk['constrained_columns'] == ['pouch_id']:
            current = fk
            break
    current_action = (((current or {}).get('options') or {}).get('ondelete') or '').upper()
    wanted = (ondelete or '').upper()
    if current is not None and current_action == wanted:
        return

    if conn.dialect.name == 'sqlite':
        reflected = sa.Table('log', sa.MetaData(), autoload_with=conn)
        for const in list(reflected.constraints):
            if (isinstance(const, sa.ForeignKeyConstraint)
                    and list(const.columns.keys()) == ['pouch_id']):
                reflected.constraints.discard(const)
        fk = sa.ForeignKeyConstraint(['pouch_id'], ['pouch.id'])
        if ondelete:
            fk = sa.ForeignKeyConstraint(['pouch_id'], ['pouch.id'], ondelete=ondelete)
        reflected.append_constraint(fk)
        with op.batch_alter_table('log', copy_from=reflected, recreate='always'):
            pass
    else:
        if current is not None and current.get('name'):
            op.drop_constraint(current['name'], 'log', type_='foreignkey')
        op.create_foreign_key(None, 'log', 'pouch', ['pouch_id'], ['id'],
                              ondelete=ondelete)


def _reconcile_user_preferences(conn):
    columns = _columns(conn, 'user_preferences')

    if 'units_preference' not in columns:
        with op.batch_alter_table('user_preferences', schema=None) as batch_op:
            batch_op.add_column(sa.Column('units_preference', sa.String(length=20), nullable=True))
        columns = _columns(conn, 'user_preferences')

    conn.execute(sa.text("UPDATE user_preferences SET units_preference = 'mg' "
                         "WHERE units_preference IS NULL"))
    if columns['units_preference']['nullable']:
        with op.batch_alter_table('user_preferences', schema=None) as batch_op:
            batch_op.alter_column('units_preference',
                                  existing_type=sa.String(length=20),
                                  nullable=False)

    if 'preferred_brands' not in columns:
        with op.batch_alter_table('user_preferences', schema=None) as batch_op:
            batch_op.add_column(sa.Column('preferred_brands', sa.JSON(), nullable=True))

    # Remove the stale notification_channel server default: it conflicts with
    # the ORM metadata (Python-side default only) and must not be filtered
    # from parity reporting.
    columns = _columns(conn, 'user_preferences')
    if columns['notification_channel']['default'] is not None:
        with op.batch_alter_table('user_preferences', schema=None) as batch_op:
            batch_op.alter_column('notification_channel',
                                  existing_type=sa.JSON(),
                                  nullable=False,
                                  server_default=None)


def _reconcile_pouch(conn):
    column = _columns(conn, 'pouch')['nicotine_mg']
    if not _is_numeric_8_2(column) or column['nullable']:
        with op.batch_alter_table('pouch', schema=None) as batch_op:
            batch_op.alter_column('nicotine_mg',
                                  existing_type=column['type'],
                                  type_=sa.Numeric(8, 2),
                                  nullable=False)


def _reconcile_log_columns(conn):
    columns = _columns(conn, 'log')

    if not _is_numeric_8_2(columns['custom_nicotine_mg']):
        with op.batch_alter_table('log', schema=None) as batch_op:
            batch_op.alter_column('custom_nicotine_mg',
                                  existing_type=columns['custom_nicotine_mg']['type'],
                                  type_=sa.Numeric(8, 2),
                                  nullable=True)

    columns = _columns(conn, 'log')
    add_brand = 'product_brand_snapshot' not in columns
    add_mg = 'nicotine_mg_snapshot' not in columns
    if add_brand or add_mg:
        with op.batch_alter_table('log', schema=None) as batch_op:
            if add_brand:
                batch_op.add_column(sa.Column('product_brand_snapshot', sa.String(length=80), nullable=True))
            if add_mg:
                batch_op.add_column(sa.Column('nicotine_mg_snapshot', sa.Numeric(8, 2), nullable=True))


def _backfill_log_snapshots(conn):
    rows = conn.execute(sa.text(
        'SELECT l.id AS log_id, l.custom_brand AS custom_brand, '
        'l.custom_nicotine_mg AS custom_mg, p.brand AS pouch_brand, '
        'p.nicotine_mg AS pouch_mg, '
        'l.product_brand_snapshot AS existing_brand, '
        'l.nicotine_mg_snapshot AS existing_mg '
        'FROM log l LEFT JOIN pouch p ON l.pouch_id = p.id '
        'WHERE l.product_brand_snapshot IS NULL OR l.nicotine_mg_snapshot IS NULL'
    )).mappings()
    for row in rows:
        brand = row['pouch_brand'] if row['pouch_brand'] is not None else row['custom_brand']
        mg = row['pouch_mg'] if row['pouch_mg'] is not None else row['custom_mg']
        assignments = []
        params = {'log_id': row['log_id']}
        if row['existing_brand'] is None and brand is not None:
            assignments.append('product_brand_snapshot = :brand')
            params['brand'] = brand
        if row['existing_mg'] is None and mg is not None:
            assignments.append('nicotine_mg_snapshot = :mg')
            params['mg'] = mg
        if not assignments:
            # Unknown historical fields stay NULL, while any already-known
            # field remains untouched. Never fabricate zero or overwrite a
            # pre-existing snapshot.
            continue
        conn.execute(sa.text(
            f'UPDATE log SET {", ".join(assignments)} WHERE id = :log_id'
        ), params)


def upgrade():
    conn = op.get_bind()
    _reconcile_user_preferences(conn)
    _reconcile_pouch(conn)
    _reconcile_log_columns(conn)
    _backfill_log_snapshots(conn)
    _replace_log_pouch_fk(conn, 'SET NULL')


def _restore_integer_if_lossless(conn, table, column, nullable):
    """Restore the historical INTEGER representation only when no fractional
    value would be destroyed; otherwise retain NUMERIC(8,2) (documented
    meaning-preserving/schema-representation tradeoff)."""
    current = _columns(conn, table)[column]
    if not _is_numeric_8_2(current):
        return
    if _has_fractional_values(conn, table, column):
        # Retaining NUMERIC(8,2): converting these rows to INTEGER would
        # silently truncate a fractional strength.
        return
    with op.batch_alter_table(table, schema=None) as batch_op:
        batch_op.alter_column(column,
                              existing_type=current['type'],
                              type_=sa.Integer(),
                              nullable=nullable)


def downgrade():
    conn = op.get_bind()

    # Restore the prior FK shape (plain FK, no ON DELETE action).
    _replace_log_pouch_fk(conn, None)

    # Remove only the columns owned by this revision.
    columns = _columns(conn, 'log')
    droppable = [c for c in SNAPSHOT_COLUMNS if c in columns]
    if droppable:
        with op.batch_alter_table('log', schema=None) as batch_op:
            for column in droppable:
                batch_op.drop_column(column)

    # Numeric columns return to the historical INTEGER representation only
    # when doing so cannot truncate a fractional value.
    _restore_integer_if_lossless(conn, 'log', 'custom_nicotine_mg', nullable=True)
    _restore_integer_if_lossless(conn, 'pouch', 'nicotine_mg', nullable=False)
