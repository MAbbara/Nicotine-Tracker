"""Exact ORM/metadata parity at the migration head, plus negative canaries.

compare_metadata runs with compare_type=True and compare_server_default=True
and must catch tables, columns, types/precision/scale, nullability, defaults,
indexes, unique constraints, and foreign keys. Each canary takes a clean
head-upgraded database, introduces exactly one defect, and proves the diff is
detected. Defects are introduced through Alembic/SQLAlchemy operations, never
by editing the fixtures.
"""
import hashlib
import io
import json

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mysql

from tests.migrations import harness

FIXTURE_IDS = [spec.key for spec in harness.FIXTURES]


def _wrong_server_default_defect(op, conn):
    # Scalar INTEGER defaults are accepted by SQLite and default MySQL 8.4;
    # unlike a bare JSON literal, this reaches the parity comparison on both.
    with op.batch_alter_table('log') as batch_op:
        batch_op.alter_column(
            'quantity', existing_type=sa.Integer(), nullable=False,
            server_default=sa.text('7'),
        )


def _extra_unique_constraint_defect(op, conn):
    with op.batch_alter_table('craving') as batch_op:
        batch_op.create_unique_constraint(
            'uq_rogue_craving_user_intensity', ['user_id', 'intensity']
        )


def _extra_ordinary_index_defect(op, conn):
    op.create_index(
        'ix_rogue_craving_trigger', 'craving', ['trigger'], unique=False
    )


def _extra_table_defect(op, conn):
    op.create_table(
        'rogue_table', sa.Column('id', sa.Integer(), primary_key=True)
    )


def test_parity_canary_mutations_compile_for_default_mysql_dialect():
    output = io.StringIO()
    context = MigrationContext.configure(
        dialect=mysql.dialect(),
        opts={'as_sql': True, 'output_buffer': output},
    )
    op = Operations(context)

    _wrong_server_default_defect(op, None)
    _extra_unique_constraint_defect(op, None)
    _extra_ordinary_index_defect(op, None)
    _extra_table_defect(op, None)

    ddl = output.getvalue()
    assert 'DEFAULT 7' in ddl
    assert 'ADD CONSTRAINT uq_rogue_craving_user_intensity UNIQUE' in ddl
    assert 'CREATE INDEX ix_rogue_craving_trigger' in ddl
    assert 'CREATE TABLE rogue_table' in ddl


class TestHeadParity:
    @pytest.mark.parametrize('spec', harness.FIXTURES, ids=FIXTURE_IDS)
    def test_head_schema_matches_orm_metadata_exactly(self, spec, prepare):
        db = prepare(spec)
        db.upgrade('head')
        diffs = harness.schema_diffs(db.connection)
        assert diffs == [], (
            f'{spec.key}: schema at head differs from ORM metadata:\n'
            f'{harness.render_diffs(diffs)}'
        )

    @pytest.mark.parametrize('spec', harness.FIXTURES, ids=FIXTURE_IDS)
    def test_active_legacy_pouch_goal_becomes_inactive_review_draft(
            self, spec, prepare):
        db = prepare(spec)
        db.upgrade('head')
        rows = db.rows(
            'SELECT user_id, mode, status, start_date, baseline_source, '
            'baseline_pouches, baseline_mg, baseline_mg_per_pouch, pace, '
            'end_target_pouches, active_slot, active_revision_id, '
            'migration_fingerprint, legacy_goal_ids FROM reduction_plan'
        )
        assert len(rows) == 1
        row = rows[0]
        source_ids = row['legacy_goal_ids']
        if isinstance(source_ids, str):
            source_ids = json.loads(source_ids)
        expected_fingerprint = hashlib.sha256(
            b'legacy-goals:1:1'
        ).hexdigest()
        assert dict(row) | {'legacy_goal_ids': source_ids} == {
            'user_id': 1,
            'mode': 'reduce',
            'status': 'draft',
            'start_date': None,
            'baseline_source': 'legacy_goal',
            'baseline_pouches': None,
            'baseline_mg': None,
            'baseline_mg_per_pouch': None,
            'pace': None,
            'end_target_pouches': 5,
            'active_slot': None,
            'active_revision_id': None,
            'migration_fingerprint': expected_fingerprint,
            'legacy_goal_ids': [1],
        }


class TestNegativeCanaries:
    """Every defect class below must produce a non-empty schema diff."""

    @pytest.fixture
    def head_db(self, prepare):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade('head')
        assert harness.schema_diffs(db.connection) == [], 'canary baseline is not clean'
        return db

    def _apply(self, db, fn):
        """Apply one defect on the migration connection and commit it."""
        conn = db.migrate_engine.connect()
        try:
            op = Operations(MigrationContext.configure(conn))
            fn(op, conn)
            conn.commit()
        finally:
            conn.close()

    def _assert_detected(self, db, label):
        diffs = harness.schema_diffs(db.connection)
        assert diffs != [], f'canary not detected: {label}'
        return diffs

    def test_extra_column_detected(self, head_db):
        self._apply(head_db, lambda op, conn: op.add_column(
            'pouch', sa.Column('rogue_column', sa.Integer)))
        self._assert_detected(head_db, 'extra column pouch.rogue_column')

    def test_wrong_nullability_detected(self, head_db):
        def defect(op, conn):
            with op.batch_alter_table('log') as batch_op:
                batch_op.alter_column('notes', existing_type=sa.Text(), nullable=False)
        self._apply(head_db, defect)
        self._assert_detected(head_db, 'log.notes made NOT NULL')

    def test_wrong_server_default_detected(self, head_db):
        self._apply(head_db, _wrong_server_default_defect)
        self._assert_detected(head_db, 'unexpected server default on log.quantity')

    def test_wrong_type_detected(self, head_db):
        def defect(op, conn):
            with op.batch_alter_table('pouch') as batch_op:
                batch_op.alter_column('nicotine_mg', existing_type=sa.Numeric(8, 2),
                                      type_=sa.Integer(), nullable=False)
        self._apply(head_db, defect)
        self._assert_detected(head_db, 'pouch.nicotine_mg back to INTEGER')

    def test_wrong_precision_scale_detected(self, head_db):
        def defect(op, conn):
            with op.batch_alter_table('log') as batch_op:
                batch_op.alter_column('nicotine_mg_snapshot',
                                      existing_type=sa.Numeric(8, 2),
                                      type_=sa.Numeric(10, 4), nullable=True)
        self._apply(head_db, defect)
        self._assert_detected(head_db, 'log.nicotine_mg_snapshot wrong precision/scale')

    def test_missing_unique_index_detected(self, head_db):
        self._apply(head_db, lambda op, conn: op.drop_index(
            'ix_user_email', table_name='user'))
        self._assert_detected(head_db, 'unique index ix_user_email dropped')

    def test_extra_unique_constraint_detected(self, head_db):
        self._apply(head_db, _extra_unique_constraint_defect)
        self._assert_detected(
            head_db, 'unexpected named unique constraint on craving'
        )

    def test_extra_ordinary_index_detected(self, head_db):
        self._apply(head_db, _extra_ordinary_index_defect)
        self._assert_detected(head_db, 'unexpected ordinary index on craving.trigger')

    def test_extra_table_detected(self, head_db):
        self._apply(head_db, _extra_table_defect)
        self._assert_detected(head_db, 'unexpected rogue table')

    def test_wrong_foreign_key_detected(self, head_db):
        def defect(op, conn):
            # Rebuild the log table with the FK's ON DELETE SET NULL removed.
            reflected = sa.Table('log', sa.MetaData(), autoload_with=conn)
            for const in list(reflected.constraints):
                if (isinstance(const, sa.ForeignKeyConstraint)
                        and list(const.columns.keys()) == ['pouch_id']):
                    reflected.constraints.discard(const)
            reflected.append_constraint(
                sa.ForeignKeyConstraint(['pouch_id'], ['pouch.id']))
            with op.batch_alter_table('log', copy_from=reflected, recreate='always'):
                pass
        self._apply(head_db, defect)
        self._assert_detected(head_db, 'log.pouch_id FK without ON DELETE SET NULL')
