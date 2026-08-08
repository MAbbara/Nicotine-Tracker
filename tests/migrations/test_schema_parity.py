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
from datetime import date, datetime
from decimal import Decimal

import pytest
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy.dialects import mysql

from tests.migrations import harness

FIXTURE_IDS = [spec.key for spec in harness.FIXTURES]
NICOTINE_FIRST_REVISION = 'c8f2d3a4b5e6'
NICOTINE_FIRST_DOWN_REVISION = 'd4f1a6b8c902'


def _seed_targeted_plan(db, *, with_days=True):
    now = datetime(2026, 8, 6, 12, 0)
    plan = sa.table(
        'reduction_plan',
        sa.column('id', sa.Integer()),
        sa.column('user_id', sa.Integer()),
        sa.column('mode', sa.String()),
        sa.column('status', sa.String()),
        sa.column('start_date', sa.Date()),
        sa.column('target_date', sa.Date()),
        sa.column('baseline_pouches', sa.Numeric(6, 2)),
        sa.column('baseline_mg', sa.Numeric(8, 2)),
        sa.column('baseline_mg_per_pouch', sa.Numeric(8, 2)),
        sa.column('baseline_source', sa.String()),
        sa.column('pace', sa.String()),
        sa.column('end_target_pouches', sa.Integer()),
        sa.column('active_revision_id', sa.Integer()),
        sa.column('active_slot', sa.Integer()),
        sa.column('migration_fingerprint', sa.String()),
        sa.column('legacy_goal_ids', sa.JSON()),
        sa.column('created_at', sa.DateTime()),
        sa.column('updated_at', sa.DateTime()),
    )
    revision = sa.table(
        'plan_revision',
        sa.column('id', sa.Integer()),
        sa.column('plan_id', sa.Integer()),
        sa.column('effective_date', sa.Date()),
        sa.column('pace', sa.String()),
        sa.column('target_date', sa.Date()),
        sa.column('end_target_pouches', sa.Integer()),
        sa.column('generation_inputs', sa.JSON()),
        sa.column('preview_digest', sa.String()),
        sa.column('reason', sa.String()),
        sa.column('note', sa.Text()),
        sa.column('created_at', sa.DateTime()),
    )
    plan_day = sa.table(
        'plan_day',
        sa.column('id', sa.Integer()),
        sa.column('plan_id', sa.Integer()),
        sa.column('revision_id', sa.Integer()),
        sa.column('local_date', sa.Date()),
        sa.column('target_pouches', sa.Integer()),
        sa.column('nicotine_ceiling_mg', sa.Numeric(8, 2)),
        sa.column('created_at', sa.DateTime()),
    )
    connection = db.connection
    connection.execute(plan.insert().values(
        id=200,
        user_id=1,
        mode='reduce',
        status='active',
        start_date=date(2026, 8, 10),
        target_date=date(2026, 9, 27),
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('40.00'),
        baseline_mg_per_pouch=Decimal('5.00'),
        baseline_source='manual',
        pace='steady',
        end_target_pouches=3,
        active_revision_id=None,
        active_slot=1,
        migration_fingerprint=None,
        legacy_goal_ids=None,
        created_at=now,
        updated_at=now,
    ))
    connection.execute(revision.insert().values(
        id=200,
        plan_id=200,
        effective_date=date(2026, 8, 10),
        pace='steady',
        target_date=date(2026, 9, 27),
        end_target_pouches=3,
        generation_inputs={'catalog_strength_at_creation': '5.00'},
        preview_digest='a' * 64,
        reason='initial',
        note='immutable historical revision',
        created_at=now,
    ))
    connection.execute(
        plan.update().where(plan.c.id == 200).values(active_revision_id=200)
    )
    if with_days:
        connection.execute(plan_day.insert(), [
            {
                'id': 200,
                'plan_id': 200,
                'revision_id': 200,
                'local_date': date(2026, 8, 10),
                'target_pouches': 8,
                'nicotine_ceiling_mg': Decimal('40.00'),
                'created_at': now,
            },
            {
                'id': 201,
                'plan_id': 200,
                'revision_id': 200,
                'local_date': date(2026, 9, 27),
                'target_pouches': 3,
                'nicotine_ceiling_mg': Decimal('17.35'),
                'created_at': now,
            },
        ])
    connection.commit()


def _historical_target_snapshot(db):
    return {
        'plan': tuple(db.rows(
            'SELECT id, mode, status, start_date, target_date, '
            'baseline_pouches, baseline_mg, baseline_mg_per_pouch, '
            'end_target_pouches, active_revision_id FROM reduction_plan '
            'WHERE id = 200'
        )[0]),
        'revision': tuple(db.rows(
            'SELECT id, plan_id, effective_date, target_date, '
            'end_target_pouches, preview_digest, reason, note '
            'FROM plan_revision WHERE id = 200'
        )[0]),
        'days': [tuple(row) for row in db.rows(
            'SELECT id, plan_id, revision_id, local_date, target_pouches, '
            'nicotine_ceiling_mg FROM plan_day WHERE plan_id = 200 '
            'ORDER BY local_date, id'
        )],
    }


def _seed_draft_targeted_plan(db, *, with_days):
    now = datetime(2026, 8, 6, 12, 30)
    plan = sa.table(
        'reduction_plan',
        sa.column('id', sa.Integer()),
        sa.column('user_id', sa.Integer()),
        sa.column('mode', sa.String()),
        sa.column('status', sa.String()),
        sa.column('start_date', sa.Date()),
        sa.column('target_date', sa.Date()),
        sa.column('baseline_pouches', sa.Numeric(6, 2)),
        sa.column('baseline_mg', sa.Numeric(8, 2)),
        sa.column('baseline_mg_per_pouch', sa.Numeric(8, 2)),
        sa.column('baseline_source', sa.String()),
        sa.column('pace', sa.String()),
        sa.column('end_target_pouches', sa.Integer()),
        sa.column('active_revision_id', sa.Integer()),
        sa.column('active_slot', sa.Integer()),
        sa.column('migration_fingerprint', sa.String()),
        sa.column('legacy_goal_ids', sa.JSON()),
        sa.column('created_at', sa.DateTime()),
        sa.column('updated_at', sa.DateTime()),
    )
    revision = sa.table(
        'plan_revision',
        sa.column('id', sa.Integer()),
        sa.column('plan_id', sa.Integer()),
        sa.column('effective_date', sa.Date()),
        sa.column('pace', sa.String()),
        sa.column('target_date', sa.Date()),
        sa.column('end_target_pouches', sa.Integer()),
        sa.column('generation_inputs', sa.JSON()),
        sa.column('preview_digest', sa.String()),
        sa.column('reason', sa.String()),
        sa.column('note', sa.Text()),
        sa.column('created_at', sa.DateTime()),
    )
    plan_day = sa.table(
        'plan_day',
        sa.column('id', sa.Integer()),
        sa.column('plan_id', sa.Integer()),
        sa.column('revision_id', sa.Integer()),
        sa.column('local_date', sa.Date()),
        sa.column('target_pouches', sa.Integer()),
        sa.column('nicotine_ceiling_mg', sa.Numeric(8, 2)),
        sa.column('created_at', sa.DateTime()),
    )
    connection = db.connection
    connection.execute(plan.insert().values(
        id=300,
        user_id=1,
        mode='reduce',
        status='draft',
        start_date=None,
        target_date=date(2026, 9, 27),
        baseline_pouches=Decimal('6.00'),
        baseline_mg=Decimal('30.00'),
        baseline_mg_per_pouch=Decimal('5.00'),
        baseline_source='manual',
        pace='steady',
        end_target_pouches=2,
        active_revision_id=None,
        active_slot=None,
        migration_fingerprint=None,
        legacy_goal_ids=None,
        created_at=now,
        updated_at=now,
    ))
    connection.execute(revision.insert().values(
        id=300,
        plan_id=300,
        effective_date=date(2026, 8, 10),
        pace='steady',
        target_date=date(2026, 9, 27),
        end_target_pouches=2,
        generation_inputs={'compatibility': 'legacy_pouches'},
        preview_digest='b' * 64,
        reason='initial',
        note='draft targeted plan without active revision marker',
        created_at=now,
    ))
    if with_days:
        connection.execute(plan_day.insert(), [
            {
                'id': 300,
                'plan_id': 300,
                'revision_id': 300,
                'local_date': date(2026, 8, 10),
                'target_pouches': 6,
                'nicotine_ceiling_mg': Decimal('30.00'),
                'created_at': now,
            },
            {
                'id': 301,
                'plan_id': 300,
                'revision_id': 300,
                'local_date': date(2026, 9, 27),
                'target_pouches': 2,
                'nicotine_ceiling_mg': Decimal('10.00'),
                'created_at': now,
            },
        ])
    connection.commit()


def _nicotine_schema_signature(db):
    inspector = sa.inspect(db.connection)
    signature = {}
    for table in ('plan_day', 'reduction_plan', 'plan_revision'):
        columns = tuple(
            (column['name'], str(column['type']), column['nullable'])
            for column in inspector.get_columns(table)
        )
        checks = tuple(sorted(
            (
                check['name'],
                ' '.join((check.get('sqltext') or '').split()),
            )
            for check in inspector.get_check_constraints(table)
        ))
        signature[table] = (columns, checks)
    return signature


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


class TestNicotineFirstTargetMigration:
    def test_upgrade_uses_final_persisted_ceiling_and_downgrade_is_additive(
        self, prepare,
    ):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(NICOTINE_FIRST_DOWN_REVISION)
        _seed_targeted_plan(db)
        before = _historical_target_snapshot(db)
        db.execute(
            'UPDATE pouch SET nicotine_mg = :mutable_catalog_value WHERE id = 1',
            {'mutable_catalog_value': '99.00'},
        )

        db.upgrade(NICOTINE_FIRST_REVISION)

        plan_target = db.select_typed('reduction_plan', [
            ('id', sa.Integer()),
            ('end_target_mg', sa.Numeric(8, 2)),
        ])
        revision_target = db.select_typed('plan_revision', [
            ('id', sa.Integer()),
            ('end_target_mg', sa.Numeric(8, 2)),
        ])
        assert next(row for row in plan_target if row['id'] == 200)[
            'end_target_mg'
        ] == Decimal('17.35')
        assert next(row for row in revision_target if row['id'] == 200)[
            'end_target_mg'
        ] == Decimal('17.35')
        assert _historical_target_snapshot(db) == before
        checks = {
            check['name']
            for table in ('reduction_plan', 'plan_revision', 'plan_day')
            for check in sa.inspect(db.connection).get_check_constraints(table)
        }
        assert {
            'ck_reduction_plan_end_target_mg_nonnegative',
            'ck_plan_revision_end_target_mg_nonnegative',
            'ck_plan_day_target_pair',
        } <= checks

        db.execute(
            'INSERT INTO plan_day '
            '(id, plan_id, revision_id, local_date, target_pouches, '
            'nicotine_ceiling_mg, created_at) VALUES '
            '(202, 200, 200, :local_date, NULL, :ceiling, :created_at)',
            {
                'local_date': '2026-09-28',
                'ceiling': '17.00',
                'created_at': '2026-08-06 12:00:00',
            },
        )
        assert db.scalar(
            'SELECT target_pouches FROM plan_day WHERE id = 202'
        ) is None
        db.execute('DELETE FROM plan_day WHERE id = 202')

        db.downgrade(NICOTINE_FIRST_DOWN_REVISION)

        assert 'end_target_mg' not in db.columns('reduction_plan')
        assert 'end_target_mg' not in db.columns('plan_revision')
        assert _historical_target_snapshot(db) == before

    def test_upgrade_aborts_before_ddl_without_authoritative_final_ceiling(
        self, prepare,
    ):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(NICOTINE_FIRST_DOWN_REVISION)
        _seed_targeted_plan(db, with_days=False)

        with pytest.raises(RuntimeError, match='authoritative final ceiling'):
            db.upgrade(NICOTINE_FIRST_REVISION)

        assert db.stamp() == NICOTINE_FIRST_DOWN_REVISION
        assert 'end_target_mg' not in db.columns('reduction_plan')
        assert 'end_target_mg' not in db.columns('plan_revision')

    def test_upgrade_backfills_targeted_draft_without_schedule_markers(
        self, prepare,
    ):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(NICOTINE_FIRST_DOWN_REVISION)
        _seed_draft_targeted_plan(db, with_days=True)

        db.upgrade(NICOTINE_FIRST_REVISION)

        assert db.scalar(
            'SELECT end_target_mg FROM reduction_plan WHERE id = 300'
        ) == Decimal('10.00')
        assert db.scalar(
            'SELECT end_target_mg FROM plan_revision WHERE id = 300'
        ) is None

    def test_upgrade_aborts_targeted_draft_without_final_day_before_ddl(
        self, prepare,
    ):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(NICOTINE_FIRST_DOWN_REVISION)
        _seed_draft_targeted_plan(db, with_days=False)

        with pytest.raises(RuntimeError, match='authoritative final ceiling'):
            db.upgrade(NICOTINE_FIRST_REVISION)

        assert db.stamp() == NICOTINE_FIRST_DOWN_REVISION
        assert 'end_target_mg' not in db.columns('reduction_plan')
        assert 'end_target_mg' not in db.columns('plan_revision')

    def test_downgrade_preflight_preserves_schema_for_nicotine_first_data(
        self, prepare,
    ):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(NICOTINE_FIRST_DOWN_REVISION)
        _seed_targeted_plan(db)
        db.upgrade(NICOTINE_FIRST_REVISION)
        db.execute(
            'UPDATE reduction_plan SET baseline_pouches = NULL, '
            'baseline_mg_per_pouch = NULL, end_target_pouches = NULL '
            'WHERE id = 200'
        )
        db.execute(
            'UPDATE plan_day SET target_pouches = NULL WHERE plan_id = 200'
        )
        schema_before = _nicotine_schema_signature(db)
        data_before = _historical_target_snapshot(db)

        with pytest.raises(RuntimeError, match='legacy-compatible'):
            db.downgrade(NICOTINE_FIRST_DOWN_REVISION)

        assert db.stamp() == NICOTINE_FIRST_REVISION
        assert _nicotine_schema_signature(db) == schema_before
        assert _historical_target_snapshot(db) == data_before
        db.upgrade(harness.resolve_single_head())
        assert harness.schema_diffs(db.connection) == []


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
        # MySQL's repeatable-read transaction can retain the pre-mutation
        # schema-reflection view because defects are committed on a second
        # connection. Refresh only this negative-canary assertion connection.
        db.connection.rollback()
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
            if conn.dialect.name == 'mysql':
                foreign_keys = sa.inspect(conn).get_foreign_keys('log')
                current = next(
                    fk for fk in foreign_keys
                    if fk['constrained_columns'] == ['pouch_id']
                    and fk['referred_table'] == 'pouch'
                )
                assert current.get('name'), 'MySQL pouch FK must be named'
                op.drop_constraint(
                    current['name'], 'log', type_='foreignkey'
                )
                op.create_foreign_key(
                    None, 'log', 'pouch', ['pouch_id'], ['id']
                )
                return

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
