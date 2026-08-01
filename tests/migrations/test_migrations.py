"""Migration tests driven by fixed synthetic fixtures.

Every database exercised here is built from tests/fixtures/*.sql (SQLite) or
from the equivalent Python manifest (MySQL). No instance database is copied,
mutated, migrated, or exported. SQLite cases each use their own file-backed
database under tmp_path; they never inspect TEST_MYSQL_URL.
"""
import json
from decimal import Decimal

import pytest
import sqlalchemy as sa
from alembic import command as alembic_command
from alembic.script import ScriptDirectory
from sqlalchemy.dialects import mysql

from tests.migrations import harness

FIXTURE_IDS = [spec.key for spec in harness.FIXTURES]


def test_migration_graph_has_exactly_one_head():
    heads = harness.resolve_heads()
    assert len(heads) == 1, f'expected exactly one migration head, found {heads}'


def _revision_module(revision):
    return ScriptDirectory.from_config(
        harness.make_alembic_config()
    ).get_revision(revision).module


class TestMySQLMigrationStatementPortability:
    """Compile the exact statements used by migrations with MySQL 8 rules."""

    def test_preference_copy_statements_use_dialect_identifier_quoting(self):
        migration = _revision_module(harness.DRIFTED_REVISION)
        dialect = mysql.dialect()

        upgrade_select, _ = migration._build_copy_statements(
            source_table='user', source_id='id',
            target_table='user_preferences', target_id='user_id',
            columns=('units_preference', 'preferred_brands'),
        )
        _, downgrade_update = migration._build_copy_statements(
            source_table='user_preferences', source_id='user_id',
            target_table='user', target_id='id',
            columns=('units_preference', 'preferred_brands'),
        )

        upgrade_sql = str(upgrade_select.compile(dialect=dialect))
        downgrade_sql = str(downgrade_update.compile(dialect=dialect))
        assert 'FROM `user`' in upgrade_sql
        assert 'UPDATE `user`' in downgrade_sql
        assert '"user"' not in upgrade_sql + downgrade_sql

    def test_fractional_probe_uses_mysql_supported_integer_cast(self):
        migration = _revision_module('38495c4b5bbd')
        statement = migration._fractional_count_statement(
            table='pouch', column='nicotine_mg'
        )

        sql = str(statement.compile(dialect=mysql.dialect()))
        assert 'CAST(`pouch`.`nicotine_mg` AS SIGNED INTEGER)' in sql
        assert ' AS INTEGER)' not in sql


class _ManifestInsertDB:
    """Minimal adapter that runs the MySQL manifest SQL on a real schema."""

    def __init__(self, spec, connection):
        self.spec = spec
        self.connection = connection

    def execute(self, sql, params=None):
        result = self.connection.execute(sa.text(sql), params or {})
        self.connection.commit()
        return result


class TestMySQLDriftManifestConstruction:
    @pytest.mark.parametrize('fixture_key', ('drifted', 'stamp-drift'))
    def test_manifest_inserts_into_actual_starting_revision_before_drift(
            self, fixture_key, tmp_path):
        spec = harness.SPECS_BY_KEY[fixture_key]
        db_path = tmp_path / f'{fixture_key}-mysql-manifest.db'
        engine = sa.create_engine(f'sqlite:///{db_path}')
        connection = engine.connect()
        try:
            alembic_command.upgrade(
                harness.make_alembic_config(connection), spec.start_revision
            )
            db = _ManifestInsertDB(spec, connection)
            try:
                harness._insert_mysql_manifest(db)
            except sa.exc.SQLAlchemyError as exc:
                pytest.fail(
                    f'{fixture_key} manifest does not match its actual '
                    f'{spec.start_revision} starting schema: {exc}'
                )

            assert connection.execute(sa.text('SELECT count(*) FROM user')).scalar() == 4
            assert connection.execute(
                sa.text('SELECT count(*) FROM user_preferences')
            ).scalar() == 4
            user_columns = {
                column['name'] for column in sa.inspect(connection).get_columns('user')
            }
            pref_columns = {
                column['name']
                for column in sa.inspect(connection).get_columns('user_preferences')
            }
            if spec.start_revision == harness.LEGACY_REVISION:
                assert {'units_preference', 'preferred_brands'} <= user_columns
                assert 'units_preference' not in pref_columns
            else:
                assert 'units_preference' not in user_columns
                assert {'units_preference', 'preferred_brands'} <= pref_columns
        finally:
            connection.close()
            engine.dispose()


class TestFixtureIntegrity:
    """Each fixture must carry its exact starting stamp and semantic manifest."""

    @pytest.mark.parametrize('spec', harness.FIXTURES, ids=FIXTURE_IDS)
    def test_fixture_stamp_and_manifest(self, spec, prepare):
        db = prepare(spec)
        harness.assert_starting_manifest(db)


class TestHistoricalReplay:
    """Slice B: f8e091ac4f79 and 6848755d9016 must be portable and replay-safe."""

    def test_channels_revision_roundtrip_on_legacy(self, prepare):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(harness.CHANNELS_REVISION)
        assert db.stamp() == harness.CHANNELS_REVISION
        harness.assert_channels_json(db)
        db.downgrade(harness.LEGACY_REVISION)
        harness.assert_channels_strings(db)
        # Replaying the conversion must not corrupt or duplicate anything.
        db.upgrade(harness.CHANNELS_REVISION)
        harness.assert_channels_json(db)

    def test_preferences_move_roundtrip_on_legacy(self, prepare):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(harness.DRIFTED_REVISION)
        assert db.stamp() == harness.DRIFTED_REVISION
        harness.assert_preferences_moved(db)
        db.downgrade(harness.CHANNELS_REVISION)
        harness.assert_preferences_on_user(db)
        db.upgrade(harness.DRIFTED_REVISION)
        harness.assert_preferences_moved(db)

    def test_stamp_drift_fixture_replays_safely(self, prepare):
        """Stamped 9a... but physically post-684...: both historical revisions
        must no-op against already-applied structure (no duplicate columns, no
        destructive rewrites)."""
        db = prepare(harness.SPECS_BY_KEY['stamp-drift'])
        db.upgrade('head')
        assert db.stamp() == db.head
        harness.assert_head_manifest(db)


class TestPartialSnapshotReconciliation:
    """Already-present snapshot data is preserved field-by-field.

    These cases are deliberately upgrade/idempotence-only. The historical
    schema has no ownership marker for snapshot columns that predate the
    reconciliation revision, so running its downgrade would be ambiguous.
    """

    def test_brand_only_snapshot_keeps_brand_and_backfills_pouch_strength(self, prepare):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(harness.DRIFTED_REVISION)
        db.execute(
            'ALTER TABLE log ADD COLUMN product_brand_snapshot VARCHAR(80)'
        )
        db.execute(
            'UPDATE log SET product_brand_snapshot = :preserved_brand, '
            'custom_brand = :stale_brand, custom_nicotine_mg = :stale_mg '
            'WHERE id = 1',
            {
                'preserved_brand': 'SYNTH-Preserved Brand',
                'stale_brand': 'SYNTH-Stale Custom',
                'stale_mg': '99.00',
            },
        )

        db.upgrade('head')
        row = db.select_typed('log', [
            ('id', sa.Integer),
            ('product_brand_snapshot', sa.String(80)),
            ('nicotine_mg_snapshot', sa.Numeric(8, 2)),
        ])[0]
        assert row['product_brand_snapshot'] == 'SYNTH-Preserved Brand'
        assert row['nicotine_mg_snapshot'] == harness.expected_snapshots(db)[1][1]

        first = harness.capture_manifest(db)
        db.upgrade('head')
        assert harness.capture_manifest(db) == first

    def test_strength_only_snapshot_keeps_strength_and_backfills_custom_brand(self, prepare):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        db.upgrade(harness.DRIFTED_REVISION)
        db.execute(
            'ALTER TABLE log ADD COLUMN product_brand_snapshot VARCHAR(80)'
        )
        db.execute(
            'ALTER TABLE log ADD COLUMN nicotine_mg_snapshot NUMERIC(8, 2)'
        )
        db.execute(
            'UPDATE log SET nicotine_mg_snapshot = :preserved_mg WHERE id = 2',
            {'preserved_mg': '8.25'},
        )

        db.upgrade('head')
        rows = db.select_typed('log', [
            ('id', sa.Integer),
            ('product_brand_snapshot', sa.String(80)),
            ('nicotine_mg_snapshot', sa.Numeric(8, 2)),
        ])
        row = next(item for item in rows if item['id'] == 2)
        assert row['product_brand_snapshot'] == 'SYNTH-Custom'
        assert row['nicotine_mg_snapshot'] == Decimal('8.25')

        first = harness.capture_manifest(db)
        db.upgrade('head')
        assert harness.capture_manifest(db) == first


class TestUpgradeDowngradeReUpgrade:
    """Slice E: full cycle per fixture against the dynamically resolved head."""

    @pytest.mark.parametrize('spec', harness.FIXTURES, ids=FIXTURE_IDS)
    def test_full_upgrade_downgrade_reupgrade_cycle(self, spec, prepare):
        db = prepare(spec)

        # 1. exact starting state
        harness.assert_starting_manifest(db)

        # 2. upgrade to the dynamic single head
        db.upgrade('head')
        assert db.stamp() == db.head
        harness.assert_head_manifest(db)

        # 3. a second upgrade to head changes nothing
        first = harness.capture_manifest(db)
        db.upgrade('head')
        assert db.stamp() == db.head
        assert harness.capture_manifest(db) == first

        # 4. downgrade to the explicit starting revision
        db.downgrade(spec.start_revision)
        assert db.stamp() == spec.start_revision
        harness.assert_downgraded_manifest(db)

        # 5. re-upgrade to the same dynamic head restores manifest and parity
        db.upgrade('head')
        assert db.stamp() == db.head
        harness.assert_head_manifest(db)
        diffs = harness.schema_diffs(db.connection)
        assert diffs == [], f'unexpected schema diff after re-upgrade: {harness.render_diffs(diffs)}'


class TestMySQLFractionalRoundTrip:
    """MySQL INTEGER cannot recover an already-truncated legacy fraction, so
    instead assert that a new post-upgrade fractional value round-trips."""

    def test_new_fractional_value_round_trips_after_upgrade(self, prepare, db_backend):
        db = prepare(harness.SPECS_BY_KEY['legacy'])
        if db.dialect != 'mysql':
            pytest.skip('SQLite keeps the legacy fraction; the round-trip claim is MySQL-specific')
        db.upgrade('head')
        db.execute(
            'INSERT INTO pouch (brand, nicotine_mg, is_default, created_by) '
            'VALUES (:brand, :mg, :is_default, :created_by)',
            {'brand': 'SYNTH-Post', 'mg': '1.5', 'is_default': 0, 'created_by': 1},
        )
        rows = db.select_typed('pouch', [('id', sa.Integer), ('nicotine_mg', sa.Numeric(8, 2))])
        by_brand = {r['id']: r['nicotine_mg'] for r in rows}
        assert by_brand and Decimal('1.50') in by_brand.values()


# ---------------------------------------------------------------------------
# MySQL gate safety (Slice E): unsafe targets must be refused before any
# DDL/DML mutation. These fakes record every statement so each test can prove
# that nothing mutating ever ran; no real MySQL server is involved, so they
# run in the default SQLite mode as well.
# ---------------------------------------------------------------------------

class _FakeResult:
    def __init__(self, scalar=None):
        self._scalar = scalar

    def scalar(self):
        return self._scalar


class _FakeConnection:
    """Records statements and answers the gate's two read-only probes."""

    def __init__(self, version='8.4.0', table_count=0):
        self.version = version
        self.table_count = table_count
        self.statements = []
        self.closed = False
        self.invalidated = False

    def execute(self, clause, params=None):
        text = str(clause)
        self.statements.append(text)
        upper = text.upper()
        if 'VERSION()' in upper:
            return _FakeResult(self.version)
        if 'INFORMATION_SCHEMA' in upper:
            return _FakeResult(self.table_count)
        return _FakeResult(None)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def close(self):
        self.closed = True

    def commit(self):
        pass

    def invalidate(self):
        self.invalidated = True


class _FakeEngine:
    def __init__(self, connection):
        self.connection = connection
        self.disposed = False

    def connect(self):
        return self.connection

    def dispose(self):
        self.disposed = True


class _CleanupConnection(_FakeConnection):
    def __init__(self, *, fail_drop=False, fail_restore=False):
        super().__init__()
        self.fail_drop = fail_drop
        self.fail_restore = fail_restore

    def execute(self, clause, params=None):
        text = str(clause)
        self.statements.append(text)
        upper = text.upper()
        if 'INFORMATION_SCHEMA' in upper:
            return _FakeResult(0)
        if self.fail_drop and upper.startswith('DROP TABLE'):
            raise RuntimeError('synthetic drop failure')
        if self.fail_restore and upper == 'SET SESSION FOREIGN_KEY_CHECKS=1':
            raise RuntimeError('synthetic restore failure')
        if upper == 'SELECT @@SESSION.FOREIGN_KEY_CHECKS':
            return _FakeResult(1)
        return _FakeResult(None)


class _CloseFailConnection(_FakeConnection):
    def close(self):
        self.closed = True
        raise RuntimeError('synthetic assertion connection close failure')


class TestMySQLCleanupGuarantees:
    def test_preflight_schema_failure_disposes_without_mutating(self):
        connection = _FakeConnection(table_count=1)
        engine = _FakeEngine(connection)

        with pytest.raises(RuntimeError, match='non-empty schema'):
            harness.prepare_mysql(harness.SPECS_BY_KEY['legacy'], engine)

        assert engine.disposed is True
        assert connection.statements == [
            'SELECT count(*) FROM information_schema.tables '
            'WHERE table_schema = DATABASE()'
        ]

    def test_assertion_connection_close_failure_still_restores_and_disposes(
            self, monkeypatch):
        cleanup_connection = _CleanupConnection()
        assertion_connection = _CloseFailConnection()
        engine = _FakeEngine(cleanup_connection)

        class FakePreparedDB:
            def __init__(self, *args, **kwargs):
                self._assert_conn = assertion_connection

        monkeypatch.setattr(harness, 'PreparedDB', FakePreparedDB)
        monkeypatch.setattr(
            harness.alembic_command, 'upgrade', lambda config, revision: None
        )
        monkeypatch.setattr(
            harness, '_insert_mysql_manifest',
            lambda db: (_ for _ in ()).throw(
                RuntimeError('synthetic post-assert preparation failure')
            ),
        )

        with pytest.raises(
                RuntimeError, match='synthetic post-assert preparation failure'):
            harness.prepare_mysql(harness.SPECS_BY_KEY['legacy'], engine)

        assert assertion_connection.invalidated is True
        assert cleanup_connection.statements[-2:] == [
            'SET SESSION FOREIGN_KEY_CHECKS=1',
            'SELECT @@SESSION.FOREIGN_KEY_CHECKS',
        ]
        assert cleanup_connection.invalidated is False
        assert engine.disposed is True

    def test_drop_failure_still_restores_foreign_key_checks(self):
        connection = _CleanupConnection(fail_drop=True)
        engine = _FakeEngine(connection)

        with pytest.raises(RuntimeError, match='synthetic drop failure'):
            harness._drop_known_mysql_tables(engine)

        assert connection.statements[-2:] == [
            'SET SESSION FOREIGN_KEY_CHECKS=1',
            'SELECT @@SESSION.FOREIGN_KEY_CHECKS',
        ]
        assert connection.invalidated is False

    def test_restore_failure_invalidates_unsafe_connection(self):
        connection = _CleanupConnection(fail_restore=True)
        engine = _FakeEngine(connection)

        with pytest.raises(RuntimeError, match='synthetic restore failure'):
            harness._drop_known_mysql_tables(engine)

        assert connection.invalidated is True

    def test_prepare_failure_cleans_and_disposes_before_reraising(self, monkeypatch):
        connection = _CleanupConnection()
        engine = _FakeEngine(connection)
        cleanup_calls = []

        def fail_upgrade(config, revision):
            raise RuntimeError('synthetic prepare failure')

        monkeypatch.setattr(harness.alembic_command, 'upgrade', fail_upgrade)
        monkeypatch.setattr(
            harness, '_drop_known_mysql_tables',
            lambda target: cleanup_calls.append(target),
        )

        with pytest.raises(RuntimeError, match='synthetic prepare failure'):
            harness.prepare_mysql(harness.SPECS_BY_KEY['legacy'], engine)

        assert cleanup_calls == [engine]
        assert engine.disposed is True

    def test_prepared_db_close_disposes_even_when_cleanup_fails(self, monkeypatch):
        connection = _CleanupConnection()
        engine = _FakeEngine(connection)
        prepared = harness.PreparedDB(
            spec=harness.SPECS_BY_KEY['legacy'],
            engine=engine,
            migrate_engine=engine,
            dialect='mysql',
        )

        def fail_cleanup(target):
            raise RuntimeError('synthetic close cleanup failure')

        monkeypatch.setattr(harness, '_drop_known_mysql_tables', fail_cleanup)

        with pytest.raises(RuntimeError, match='synthetic close cleanup failure'):
            prepared.close()

        assert engine.disposed is True


class TestMySQLGateSafety:
    SECRET = 's3cr3t-gate-probe'
    SAFE_URL = ('mysql+pymysql://u:s3cr3t-gate-probe@db.example.invalid/'
                'nicotine_tracker_test_gate')

    def _install_fake_engine(self, monkeypatch, url, version='8.4.0', table_count=0):
        monkeypatch.setenv('TEST_MYSQL_URL', url)
        connection = _FakeConnection(version=version, table_count=table_count)
        engine = _FakeEngine(connection)
        created = []

        def fake_create_engine(*args, **kwargs):
            created.append((args, kwargs))
            return engine

        monkeypatch.setattr(harness.sa, 'create_engine', fake_create_engine)
        return connection, engine, created

    @staticmethod
    def _mutations(connection):
        """Recorded statements that are not read-only probes."""
        return [s for s in connection.statements
                if not s.lstrip().upper().startswith(('SELECT', 'SHOW'))]

    def test_unparseable_url_rejected_without_leaking_secret(self, monkeypatch):
        _, _, created = self._install_fake_engine(
            monkeypatch, f'not a url at all {self.SECRET}')
        with pytest.raises(RuntimeError) as excinfo:
            harness.create_verified_mysql_engine()
        assert created == [], 'engine created for an unparseable URL'
        assert self.SECRET not in str(excinfo.value), 'credential leaked in diagnostics'

    def test_wrong_dialect_rejected_before_engine_creation(self, monkeypatch):
        _, _, created = self._install_fake_engine(
            monkeypatch, self.SAFE_URL.replace('mysql+pymysql', 'mysql+mysqldb'))
        with pytest.raises(RuntimeError) as excinfo:
            harness.create_verified_mysql_engine()
        assert created == [], 'engine created for a non-PyMySQL dialect'
        assert self.SECRET not in str(excinfo.value), 'credential leaked in diagnostics'

    def test_missing_database_name_rejected(self, monkeypatch):
        _, _, created = self._install_fake_engine(
            monkeypatch, 'mysql+pymysql://u:x@db.example.invalid/')
        with pytest.raises(RuntimeError):
            harness.create_verified_mysql_engine()
        assert created == [], 'engine created without a database name'

    def test_wrong_database_prefix_rejected(self, monkeypatch):
        _, _, created = self._install_fake_engine(
            monkeypatch, self.SAFE_URL.replace('nicotine_tracker_test_gate', 'production'))
        with pytest.raises(RuntimeError) as excinfo:
            harness.create_verified_mysql_engine()
        assert created == [], 'engine created for a non-test database name'
        assert self.SECRET not in str(excinfo.value), 'credential leaked in diagnostics'

    def test_bare_prefix_database_name_rejected(self, monkeypatch):
        _, _, created = self._install_fake_engine(
            monkeypatch,
            self.SAFE_URL.replace('nicotine_tracker_test_gate',
                                  'nicotine_tracker_test_'))
        with pytest.raises(RuntimeError):
            harness.create_verified_mysql_engine()
        assert created == [], 'engine created for the bare prefix as a name'

    def test_mariadb_rejected_after_read_only_probe(self, monkeypatch):
        connection, engine, _ = self._install_fake_engine(
            monkeypatch, self.SAFE_URL, version='10.11.6-MariaDB')
        with pytest.raises(RuntimeError):
            harness.create_verified_mysql_engine()
        assert self._mutations(connection) == [], 'mutation ran before MariaDB refusal'
        assert engine.disposed, 'refused engine was not disposed'

    def test_old_mysql_version_rejected_after_read_only_probe(self, monkeypatch):
        connection, engine, _ = self._install_fake_engine(
            monkeypatch, self.SAFE_URL, version='8.0.36')
        with pytest.raises(RuntimeError):
            harness.create_verified_mysql_engine()
        assert self._mutations(connection) == [], 'mutation ran before version refusal'
        assert engine.disposed, 'refused engine was not disposed'

    def test_non_empty_schema_rejected_before_any_mutation(self, monkeypatch):
        connection, engine, _ = self._install_fake_engine(
            monkeypatch, self.SAFE_URL, table_count=2)
        with pytest.raises(RuntimeError) as excinfo:
            harness.create_verified_mysql_engine()
        assert 'non-empty' in str(excinfo.value)
        assert self._mutations(connection) == [], (
            'mutation ran before the empty-schema verification'
        )
        assert engine.disposed, 'refused engine was not disposed'

    def test_verified_engine_for_safe_target(self, monkeypatch):
        connection, engine, created = self._install_fake_engine(
            monkeypatch, self.SAFE_URL)
        assert harness.create_verified_mysql_engine() is engine
        assert len(created) == 1
        # The safe probe sequence: version read, emptiness read, then session
        # FK enforcement — a session setting, still no DDL/DML mutation.
        assert self._mutations(connection) == ['SET SESSION FOREIGN_KEY_CHECKS=1']
        assert not engine.disposed

    def test_assert_mysql_schema_empty_raises_on_non_empty(self):
        connection = _FakeConnection(table_count=1)
        with pytest.raises(RuntimeError) as excinfo:
            harness.assert_mysql_schema_empty(connection)
        assert 'non-empty' in str(excinfo.value)

    def test_assert_mysql_schema_empty_accepts_empty(self):
        harness.assert_mysql_schema_empty(_FakeConnection(table_count=0))
