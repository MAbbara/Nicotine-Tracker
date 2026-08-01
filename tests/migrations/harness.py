"""Deterministic migration test harness.

Centralizes, for every migration test:

- fixture specification and the shared synthetic manifest (fixed values only,
  reserved example.invalid domain; nothing was copied from any instance
  database);
- connection-aware Alembic configuration (script_location pinned at
  migrations/, connection injected through config.attributes);
- dynamic single-head resolution and current-revision reads;
- SQLite fixture loading with FK assertions (PRAGMA foreign_keys=ON on the
  loading connection, PRAGMA foreign_key_check asserted empty before and
  after every migration phase);
- explicit schema-diff configuration (compare_type + compare_server_default,
  alembic_version excluded, no blanket operation-class filtering);
- optional verified MySQL engine/setup for the --db=mysql gate.

SQLite enforcement note: Alembic batch mode rebuilds tables by copying to a
temp table and dropping the original, and SQLite cannot DROP a parent table
while PRAGMA foreign_keys=ON and child rows exist. The migration command
therefore runs on a connection with SQLite's default enforcement, and
integrity is proven by foreign_key_check before and after every phase — the
procedure sqlite.org prescribes for schema changes. All fixture-loading and
assertion connections run with PRAGMA foreign_keys=ON.
"""
from __future__ import annotations

import json
import os
import sqlite3
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path

import sqlalchemy as sa
from alembic import command as alembic_command
from alembic.autogenerate import compare_metadata
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory

PROJECT_ROOT = Path(__file__).resolve().parents[2]
MIGRATIONS_DIR = PROJECT_ROOT / 'migrations'
FIXTURES_DIR = PROJECT_ROOT / 'tests' / 'fixtures'

LEGACY_REVISION = '9a3d3841f6c1'
CHANNELS_REVISION = 'f8e091ac4f79'
DRIFTED_REVISION = '6848755d9016'

MYSQL_TEST_DB_PREFIX = 'nicotine_tracker_test_'
MYSQL_MIN_VERSION = (8, 4)

# notification_channel meanings, exhaustive per the controller's inspection.
CHANNEL_JSON = {
    'email': ['email'],
    'discord': ['discord'],
    'both': ['email', 'discord'],
    'none': [],
}

# ---------------------------------------------------------------------------
# Shared synthetic manifest. Fixed values only; example.invalid is a reserved
# domain (RFC 2606) and the password hash is a placeholder string, not a hash.
# ---------------------------------------------------------------------------

SYNTHETIC_PASSWORD_HASH = 'synthetic-only-not-a-real-password-hash'

USERS = (
    {'id': 1, 'email': 'synthetic-alice@example.invalid', 'channel': 'email',
     'units': 'mg', 'preferred_brands': ['SYNTH-ZYN']},
    {'id': 2, 'email': 'synthetic-bob@example.invalid', 'channel': 'discord',
     'units': 'percentage', 'preferred_brands': None},
    {'id': 3, 'email': 'synthetic-carol@example.invalid', 'channel': 'both',
     'units': None, 'preferred_brands': ['SYNTH-VELO', 'SYNTH-ON']},
    {'id': 4, 'email': 'synthetic-dave@example.invalid', 'channel': 'none',
     'units': 'mg', 'preferred_brands': []},
)

POUCHES = (
    # Pouch 1 carries the fractional strength 1.5: the SQLite fixture stores it
    # as a REAL inside the INTEGER-affinity column, so the upgrade must prove
    # it is not truncated.
    {'id': 1, 'brand': 'SYNTH-Pouch', 'nicotine_mg': Decimal('1.50'),
     'is_default': False, 'created_by': 1},
    {'id': 2, 'brand': 'SYNTH-Default', 'nicotine_mg': Decimal('3.00'),
     'is_default': True, 'created_by': None},
)

# On MySQL the legacy manifest inserts into an INTEGER column, where 1.5 is
# rounded to 2 at insert time; the fraction is unrecoverable there, which is
# why the MySQL gate asserts a post-upgrade Decimal('1.50') round trip instead
# of a false historical-recovery claim.
MYSQL_LEGACY_POUCH_MG = {1: Decimal('2.00'), 2: Decimal('3.00')}
SQLITE_LEGACY_POUCH_MG = {1: Decimal('1.50'), 2: Decimal('3.00')}

LOGS = (
    {'id': 1, 'user_id': 1, 'pouch_id': 1, 'custom_brand': None,
     'custom_nicotine_mg': None, 'quantity': 2,
     'notes': 'synthetic log via pouch'},
    {'id': 2, 'user_id': 1, 'pouch_id': None, 'custom_brand': 'SYNTH-Custom',
     'custom_nicotine_mg': Decimal('6.00'), 'quantity': 1,
     'notes': 'synthetic custom log'},
    {'id': 3, 'user_id': 1, 'pouch_id': None, 'custom_brand': None,
     'custom_nicotine_mg': None, 'quantity': 1,
     'notes': 'synthetic unknown-strength log'},
)

# Immutable snapshots the reconciliation revision must backfill. Unknown
# historical brand/strength stays NULL; zero is never fabricated.
EXPECTED_SNAPSHOTS = {
    1: ('SYNTH-Pouch', Decimal('1.50')),
    2: ('SYNTH-Custom', Decimal('6.00')),
    3: (None, None),
}

CRAVING = {'id': 1, 'user_id': 1, 'craving_time': '2025-01-05 09:30:00.000000',
           'intensity': 7, 'trigger': 'synthetic-stress'}

NOTIFICATION = {'id': 1, 'user_id': 1, 'notification_type': 'email',
                'category': 'daily_reminder', 'subject': 'synthetic subject',
                'message': 'synthetic message', 'recipient': USERS[0]['email'],
                'scheduled_for': '2025-01-06 08:00:00.000000',
                'created_at': '2025-01-05 08:00:00.000000',
                'status': 'pending', 'attempts': 0, 'max_attempts': 3,
                'priority': 5}

GOAL = {'id': 1, 'user_id': 1, 'goal_type': 'daily_pouches', 'target_value': 5,
        'start_date': '2025-01-01', 'is_active': True}

FIXED_LOG_TIME = '2025-01-05 12:00:00.000000'
FIXED_LOG_DATE = '2025-01-05'


@dataclass(frozen=True)
class FixtureSpec:
    key: str
    filename: str
    start_revision: str
    post_684_structure: bool   # preference columns already on user_preferences
    channels_as_json: bool     # notification_channel stored as JSON arrays
    drift_loses_brands: bool = False  # user preference source columns are gone

    @property
    def path(self) -> Path:
        return FIXTURES_DIR / self.filename


FIXTURES = (
    FixtureSpec('legacy', 'legacy_schema_9a3d3841f6c1.sql', LEGACY_REVISION,
                post_684_structure=False, channels_as_json=False),
    FixtureSpec('drifted', 'drifted_schema_6848755d9016.sql', DRIFTED_REVISION,
                post_684_structure=True, channels_as_json=True,
                drift_loses_brands=True),
    FixtureSpec('stamp-drift', 'stamp_drift_schema_9a3d3841f6c1.sql',
                LEGACY_REVISION, post_684_structure=True, channels_as_json=True),
)

SPECS_BY_KEY = {spec.key: spec for spec in FIXTURES}


def expected_units(spec) -> dict:
    """units_preference per user id once the head revision is reached."""
    if spec.drift_loses_brands:
        # The drifted fixture lost the user-side source columns, so every
        # units_preference is defaulted to 'mg'.
        return {u['id']: 'mg' for u in USERS}
    # Missing/NULL units are defaulted/backfilled to 'mg'.
    return {u['id']: (u['units'] or 'mg') for u in USERS}


def expected_preferred_brands(spec) -> dict:
    if spec.drift_loses_brands:
        return {u['id']: None for u in USERS}
    return {u['id']: u['preferred_brands'] for u in USERS}


def expected_pouch_mg(db) -> dict:
    if db.dialect == 'mysql':
        return dict(MYSQL_LEGACY_POUCH_MG)
    return dict(SQLITE_LEGACY_POUCH_MG)


# ---------------------------------------------------------------------------
# Alembic configuration, head resolution, stamps
# ---------------------------------------------------------------------------

def make_alembic_config(connection=None) -> Config:
    """Connection-aware Alembic config used by every test migration run."""
    cfg = Config()
    cfg.set_main_option('script_location', str(MIGRATIONS_DIR))
    if connection is not None:
        cfg.attributes['connection'] = connection
    return cfg


def resolve_heads(cfg=None) -> list:
    script = ScriptDirectory.from_config(cfg or make_alembic_config())
    return list(script.get_heads())


def resolve_single_head(cfg=None) -> str:
    heads = resolve_heads(cfg)
    assert len(heads) == 1, f'expected exactly one migration head, found {heads}'
    return heads[0]


def current_stamp(connection):
    return MigrationContext.configure(connection).get_current_revision()


# ---------------------------------------------------------------------------
# ORM metadata and explicit schema-diff configuration
# ---------------------------------------------------------------------------

def orm_metadata():
    import models  # noqa: F401  register every model on db.metadata
    from extensions import db
    return db.metadata


DIFF_EXCLUDED_TABLES = frozenset({'alembic_version'})

# Narrowly scoped equivalence rules. Any entry must name the exact dialect,
# table, column, and the two equivalent representations it applies to. Empty
# until a concrete dialect quirk is observed and justified; no whole operation
# classes and no blanket JSON/Numeric filtering are ever suppressed here.
NORMALIZATIONS = ()


def _include_object(obj, name, type_, reflected, compare_to):
    if type_ == 'table' and name in DIFF_EXCLUDED_TABLES:
        return False
    return True


def schema_diffs(connection, metadata=None) -> list:
    """Diff the live schema against ORM metadata with strict comparison."""
    metadata = metadata or orm_metadata()
    mc = MigrationContext.configure(connection, opts={
        'target_metadata': metadata,
        'compare_type': True,
        'compare_server_default': True,
        'include_object': _include_object,
    })
    return compare_metadata(mc, metadata)


def render_diffs(diffs) -> str:
    return '\n'.join(repr(diff) for diff in diffs)


# ---------------------------------------------------------------------------
# SQLite fixture loading and engines
# ---------------------------------------------------------------------------

def load_sqlite_fixture(spec: FixtureSpec, db_path: Path) -> Path:
    """Load a static SQLite fixture with FK enforcement and an FK check."""
    conn = sqlite3.connect(str(db_path))
    try:
        conn.execute('PRAGMA foreign_keys=ON')
        conn.executescript(spec.path.read_text())
        violations = conn.execute('PRAGMA foreign_key_check').fetchall()
        assert violations == [], (
            f'{spec.key}: fixture violates foreign keys: {violations}'
        )
    finally:
        conn.close()
    return db_path


def _fk_pragma_on(dbapi_conn, _connection_record):
    cursor = dbapi_conn.cursor()
    cursor.execute('PRAGMA foreign_keys=ON')
    cursor.close()


def _sqlite_assert_engine(db_path: Path) -> sa.engine.Engine:
    engine = sa.create_engine(f'sqlite:///{db_path}')
    sa.event.listen(engine, 'connect', _fk_pragma_on)
    return engine


def _sqlite_migrate_engine(db_path: Path) -> sa.engine.Engine:
    # Batch table rebuilds require SQLite's default FK enforcement to DROP
    # parent tables; integrity is proven with foreign_key_check instead.
    return sa.create_engine(f'sqlite:///{db_path}')


def prepare_sqlite(spec: FixtureSpec, tmp_path: Path) -> 'PreparedDB':
    db_path = load_sqlite_fixture(spec, tmp_path / f'{spec.key}.db')
    return PreparedDB(
        spec=spec,
        engine=_sqlite_assert_engine(db_path),
        migrate_engine=_sqlite_migrate_engine(db_path),
        dialect='sqlite',
    )


# ---------------------------------------------------------------------------
# Prepared database handle
# ---------------------------------------------------------------------------

class PreparedDB:
    """A fixture database plus the connections used to migrate and assert."""

    def __init__(self, spec, engine, migrate_engine, dialect):
        self.spec = spec
        self.engine = engine
        self.migrate_engine = migrate_engine
        self.dialect = dialect
        self._assert_conn = engine.connect()

    @property
    def connection(self):
        """Assertion connection (SQLite: PRAGMA foreign_keys=ON)."""
        return self._assert_conn

    @property
    def head(self) -> str:
        return resolve_single_head()

    # -- migration phases --------------------------------------------------

    def upgrade(self, revision='head'):
        self._run_phase('upgrade', revision)

    def downgrade(self, revision):
        self._run_phase('downgrade', revision)

    def _run_phase(self, direction, revision):
        command = {'upgrade': alembic_command.upgrade,
                   'downgrade': alembic_command.downgrade}[direction]
        # Release any open read transaction so a later FK pragma or a fresh
        # migration connection cannot be blocked by stale state.
        self._assert_conn.rollback()
        self.assert_fk_clean(f'{self.spec.key}: before {direction} {revision}')
        conn = self.migrate_engine.connect()
        try:
            cfg = make_alembic_config(conn)
            command(cfg, revision)
        finally:
            conn.close()
        self.assert_fk_clean(f'{self.spec.key}: after {direction} {revision}')

    # -- queries -------------------------------------------------------------

    def execute(self, sql, params=None):
        result = self._assert_conn.execute(sa.text(sql), params or {})
        self._assert_conn.commit()
        return result

    def scalar(self, sql, params=None):
        return self._assert_conn.execute(sa.text(sql), params or {}).scalar()

    def rows(self, sql, params=None):
        return self._assert_conn.execute(sa.text(sql), params or {}).mappings().all()

    def select_typed(self, table_name, columns):
        """Select with explicit column types so result processors (e.g. the
        Numeric -> Decimal conversion) are applied to raw driver values."""
        cols = [sa.column(name, type_) for name, type_ in columns]
        table = sa.table(table_name, *cols)
        return self._assert_conn.execute(sa.select(*table.c)).mappings().all()

    # -- inspection ----------------------------------------------------------

    def stamp(self):
        return current_stamp(self._assert_conn)

    def columns(self, table_name) -> dict:
        return {c['name']: c
                for c in sa.inspect(self._assert_conn).get_columns(table_name)}

    def fk_options(self, table_name, referred_table, constrained_column):
        for fk in sa.inspect(self._assert_conn).get_foreign_keys(table_name):
            if (fk['referred_table'] == referred_table
                    and fk['constrained_columns'] == [constrained_column]):
                return fk.get('options') or {}
        return None

    def fk_violations(self) -> list:
        if self.dialect == 'sqlite':
            return [tuple(row) for row in
                    self._assert_conn.exec_driver_sql('PRAGMA foreign_key_check').fetchall()]
        # MySQL runs with FOREIGN_KEY_CHECKS=1 during every phase, so
        # violations cannot be committed in the first place.
        return []

    def assert_fk_clean(self, label=''):
        violations = self.fk_violations()
        assert violations == [], f'foreign key violations {label}: {violations}'

    # -- teardown --------------------------------------------------------------

    def close(self):
        try:
            self._assert_conn.close()
        finally:
            try:
                if self.dialect == 'mysql':
                    _drop_known_mysql_tables(self.engine)
            finally:
                try:
                    self.engine.dispose()
                finally:
                    self.migrate_engine.dispose()


# ---------------------------------------------------------------------------
# Semantic manifest assertions
# ---------------------------------------------------------------------------

def _user(user_id):
    return next(u for u in USERS if u['id'] == user_id)


def assert_starting_manifest(db: PreparedDB):
    """Exact starting stamp plus the fixture's semantic starting state."""
    spec = db.spec
    assert db.stamp() == spec.start_revision, (
        f'{spec.key}: expected stamp {spec.start_revision}, found {db.stamp()}'
    )
    pref_cols = db.columns('user_preferences')
    user_cols = db.columns('user')
    if spec.post_684_structure:
        assert 'units_preference' not in user_cols, f'{spec.key}: drift doc mismatch'
        assert 'preferred_brands' not in user_cols, f'{spec.key}: drift doc mismatch'
        if spec.drift_loses_brands:
            # The deliberate drift: target columns never created.
            assert 'units_preference' not in pref_cols
            assert 'preferred_brands' not in pref_cols
        else:
            assert 'units_preference' in pref_cols
            assert 'preferred_brands' in pref_cols
    else:
        assert 'units_preference' in user_cols
        assert 'preferred_brands' in user_cols

    if spec.channels_as_json:
        assert_channels_json(db)
    else:
        assert_channels_strings(db)

    # Representative rows attached to user 1
    assert db.scalar('SELECT count(*) FROM user') == len(USERS)
    assert db.scalar('SELECT count(*) FROM pouch') == len(POUCHES)
    assert db.scalar('SELECT count(*) FROM log') == len(LOGS)
    assert db.scalar('SELECT count(*) FROM craving WHERE user_id = 1') == 1
    assert db.scalar('SELECT count(*) FROM notification_queue WHERE user_id = 1') == 1
    assert db.scalar('SELECT count(*) FROM goal WHERE user_id = 1 AND is_active = 1') == 1

    # The fractional pouch strength must start untruncated (SQLite; on MySQL
    # the manifest inserts the already-rounded integer).
    mg = db.select_typed('pouch', [('id', sa.Integer), ('nicotine_mg', sa.Numeric(8, 2))])
    actual = {row['id']: row['nicotine_mg'] for row in mg}
    for pouch_id, expected in expected_pouch_mg(db).items():
        assert actual[pouch_id] == expected, (
            f'{db.spec.key}: pouch {pouch_id} starts at {actual[pouch_id]}, '
            f'expected {expected}'
        )
    db.assert_fk_clean(f'{db.spec.key}: starting manifest')


def assert_channels_json(db: PreparedDB):
    """All four notification_channel meanings as JSON arrays."""
    rows = db.rows('SELECT user_id, notification_channel FROM user_preferences')
    assert len(rows) == len(USERS)
    for row in rows:
        expected = CHANNEL_JSON[_user(row['user_id'])['channel']]
        raw = row['notification_channel']
        parsed = json.loads(raw) if isinstance(raw, str) else list(raw)
        assert parsed == expected, (
            f'user {row["user_id"]}: expected channels {expected}, found {parsed}'
        )


def assert_channels_strings(db: PreparedDB):
    """All four notification_channel meanings as plain legacy strings."""
    rows = db.rows('SELECT user_id, notification_channel FROM user_preferences')
    assert len(rows) == len(USERS)
    for row in rows:
        expected = _user(row['user_id'])['channel']
        assert row['notification_channel'] == expected, (
            f'user {row["user_id"]}: expected channel {expected!r}, '
            f'found {row["notification_channel"]!r}'
        )


def assert_preferences_moved(db: PreparedDB):
    """Post-684... state: columns on user_preferences, gone from user."""
    pref_cols = db.columns('user_preferences')
    user_cols = db.columns('user')
    assert 'units_preference' in pref_cols
    assert 'preferred_brands' in pref_cols
    assert 'units_preference' not in user_cols
    assert 'preferred_brands' not in user_cols
    assert pref_cols['units_preference']['nullable'] is False

    units = {r['user_id']: r['units_preference']
             for r in db.rows('SELECT user_id, units_preference FROM user_preferences')}
    assert units == expected_units(db.spec)
    brands = {r['user_id']: r['preferred_brands']
              for r in db.rows('SELECT user_id, preferred_brands FROM user_preferences')}
    for user_id, expected in expected_preferred_brands(db.spec).items():
        raw = brands[user_id]
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        assert parsed == expected, (
            f'user {user_id}: expected preferred_brands {expected}, found {parsed}'
        )


def assert_preferences_on_user(db: PreparedDB):
    """Post-downgrade state: preference columns restored on user as the
    historical representations (units string, preferred_brands JSON text)."""
    user_cols = db.columns('user')
    assert 'units_preference' in user_cols
    assert 'preferred_brands' in user_cols
    units = {r['id']: r['units_preference']
             for r in db.rows('SELECT id, units_preference FROM user')}
    assert units == expected_units(db.spec)
    brands = {r['id']: r['preferred_brands']
              for r in db.rows('SELECT id, preferred_brands FROM user')}
    for user_id, expected in expected_preferred_brands(db.spec).items():
        raw = brands[user_id]
        parsed = json.loads(raw) if isinstance(raw, str) else raw
        assert parsed == expected, (
            f'user {user_id}: preferred_brands JSON meaning lost: '
            f'expected {expected}, found {parsed}'
        )


def assert_head_manifest(db: PreparedDB):
    """Full semantic state required at the dynamically resolved head."""
    assert_preferences_moved(db)
    assert_channels_json(db)

    # Decimals, untruncated
    mg = db.select_typed('pouch', [('id', sa.Integer), ('nicotine_mg', sa.Numeric(8, 2))])
    actual_mg = {row['id']: row['nicotine_mg'] for row in mg}
    for pouch_id, expected in expected_pouch_mg(db).items():
        assert actual_mg[pouch_id] == expected, (
            f'{db.spec.key}: pouch {pouch_id} is {actual_mg[pouch_id]} at head, '
            f'expected {expected} (fraction truncated?)'
        )

    # Immutable product snapshots, unknown values NULL
    snap = db.select_typed('log', [
        ('id', sa.Integer),
        ('product_brand_snapshot', sa.String(80)),
        ('nicotine_mg_snapshot', sa.Numeric(8, 2)),
    ])
    actual_snap = {r['id']: (r['product_brand_snapshot'], r['nicotine_mg_snapshot'])
                   for r in snap}
    for log_id, (brand, strength) in EXPECTED_SNAPSHOTS.items():
        assert actual_snap[log_id] == (brand, strength), (
            f'{db.spec.key}: log {log_id} snapshots {actual_snap[log_id]}, '
            f'expected {(brand, strength)}'
        )

    # log.pouch_id must carry ON DELETE SET NULL
    options = db.fk_options('log', 'pouch', 'pouch_id')
    assert options is not None, f'{db.spec.key}: log.pouch_id FK missing at head'
    assert (options.get('ondelete') or '').upper() == 'SET NULL', (
        f'{db.spec.key}: log.pouch_id FK options {options}, expected ON DELETE SET NULL'
    )
    db.assert_fk_clean(f'{db.spec.key}: head manifest')


def assert_downgraded_manifest(db: PreparedDB):
    """Documented representation at the fixture's explicit starting revision."""
    spec = db.spec
    # Channels round-tripped to legacy strings (only when the f8... downgrade
    # actually ran, i.e. for 9a... starting revisions).
    if spec.start_revision == LEGACY_REVISION:
        assert_channels_strings(db)
        assert_preferences_on_user(db)
    else:
        # Downgrading to 684... yields the canonical post-684... shape: the
        # reconciliation revision treats units_preference/preferred_brands as
        # owned by 684... and does not remove them.
        assert_preferences_moved(db)
        assert_channels_json(db)

    # Snapshot columns owned by the reconciliation revision are gone.
    log_cols = db.columns('log')
    assert 'product_brand_snapshot' not in log_cols
    assert 'nicotine_mg_snapshot' not in log_cols

    # The fractional value must survive the downgrade; the schema
    # representation may legitimately remain NUMERIC (documented tradeoff),
    # but the meaning is never truncated.
    mg = db.select_typed('pouch', [('id', sa.Integer), ('nicotine_mg', sa.Numeric(8, 2))])
    actual_mg = {row['id']: row['nicotine_mg'] for row in mg}
    for pouch_id, expected in expected_pouch_mg(db).items():
        assert actual_mg[pouch_id] == expected, (
            f'{spec.key}: downgrade destroyed the fractional value: '
            f'pouch {pouch_id} is {actual_mg[pouch_id]}, expected {expected}'
        )

    # A valid prior FK shape is restored: FK present, no ON DELETE action.
    options = db.fk_options('log', 'pouch', 'pouch_id')
    assert options is not None, f'{spec.key}: log.pouch_id FK missing after downgrade'
    assert (options.get('ondelete') or 'NO ACTION').upper() in ('', 'NO ACTION'), (
        f'{spec.key}: unexpected FK options after downgrade: {options}'
    )
    db.assert_fk_clean(f'{spec.key}: downgraded manifest')


def capture_manifest(db: PreparedDB) -> dict:
    """A comparable snapshot of the semantic state, for idempotence checks."""
    channels = {r['user_id']: r['notification_channel']
                for r in db.rows('SELECT user_id, notification_channel FROM user_preferences')}
    units = {r['user_id']: r['units_preference']
             for r in db.rows('SELECT user_id, units_preference FROM user_preferences')}
    brands = {r['user_id']: r['preferred_brands']
              for r in db.rows('SELECT user_id, preferred_brands FROM user_preferences')}
    pouch = {r['id']: str(r['nicotine_mg'])
             for r in db.select_typed('pouch', [('id', sa.Integer), ('nicotine_mg', sa.Numeric(8, 2))])}
    snapshots = {
        r['id']: (r['product_brand_snapshot'], str(r['nicotine_mg_snapshot']))
        for r in db.select_typed('log', [
            ('id', sa.Integer),
            ('product_brand_snapshot', sa.String(80)),
            ('nicotine_mg_snapshot', sa.Numeric(8, 2)),
        ])
    }
    return {
        'stamp': db.stamp(),
        'channels': channels,
        'units': units,
        'preferred_brands': brands,
        'pouch_mg': pouch,
        'snapshots': snapshots,
    }


# ---------------------------------------------------------------------------
# MySQL gate (--db=mysql only; SQLite paths never read TEST_MYSQL_URL)
# ---------------------------------------------------------------------------

KNOWN_MYSQL_TABLES = (
    'notification_history', 'notification_queue', 'user_activity',
    'user_settings', 'user_preferences', 'email_verifications',
    'password_resets', 'daily_check_in', 'plan_status_event', 'plan_day',
    'onboarding_draft', 'user_preferred_pouch', 'craving', 'goal', 'log',
    'reduction_plan', 'plan_revision', 'pouch', 'user', 'alembic_version',
)


def create_verified_mysql_engine() -> sa.engine.Engine:
    """Create a MySQL engine only after every safety check passes.

    Nothing is created, dropped, truncated, or altered unless the URL parses,
    the dialect is mysql+pymysql, the database name begins exactly with
    nicotine_tracker_test_, the server is MySQL 8.4+ (never MariaDB), and the
    target schema is verified empty. Only read-only probes run before all of
    those checks pass; the first mutating statement is the caller's.
    Passwords are hidden in every diagnostic.
    """
    raw = os.environ.get('TEST_MYSQL_URL')
    if not raw:
        raise RuntimeError(
            'NOT_RUN: --db=mysql requires TEST_MYSQL_URL (mysql+pymysql DSN '
            f'for a disposable {MYSQL_TEST_DB_PREFIX}* database).'
        )
    try:
        url = sa.engine.make_url(raw)
    except Exception as exc:
        # The parse error embeds the raw DSN; re-raise without it so a
        # credential can never leak through diagnostics.
        raise RuntimeError(
            'TEST_MYSQL_URL could not be parsed as a SQLAlchemy URL '
            '(value hidden to protect credentials)'
        ) from exc
    safe = url.render_as_string(hide_password=True)
    if url.drivername != 'mysql+pymysql':
        raise RuntimeError(
            f'TEST_MYSQL_URL must use the mysql+pymysql dialect, got '
            f'{url.drivername!r} ({safe})'
        )
    database = url.database or ''
    if not database.startswith(MYSQL_TEST_DB_PREFIX) or database == MYSQL_TEST_DB_PREFIX:
        raise RuntimeError(
            f'refusing to use database {database!r}: the name must begin '
            f'exactly with {MYSQL_TEST_DB_PREFIX!r} ({safe})'
        )
    engine = sa.create_engine(url)
    try:
        with engine.connect() as conn:
            version = conn.execute(sa.text('SELECT VERSION()')).scalar()
            if 'mariadb' in version.lower():
                raise RuntimeError(f'MariaDB is not supported by this gate: {version} ({safe})')
            parts = version.split('-')[0].split('.')
            major, minor = int(parts[0]), int(parts[1])
            if (major, minor) < MYSQL_MIN_VERSION:
                raise RuntimeError(
                    f'MySQL {MYSQL_MIN_VERSION[0]}.{MYSQL_MIN_VERSION[1]}+ is '
                    f'required, found {version} ({safe})'
                )
            # The schema must be verified empty before the first DDL/DML
            # mutation; everything above is a read-only probe.
            assert_mysql_schema_empty(conn)
            conn.execute(sa.text('SET SESSION FOREIGN_KEY_CHECKS=1'))
    except Exception:
        engine.dispose()
        raise
    return engine


def assert_mysql_schema_empty(conn) -> None:
    """Refuse to mutate a non-empty schema.

    The gate only ever migrates or inserts into a verified empty disposable
    test schema. Anything already present means the database is not the
    disposable target it claims to be, so the run fails instead of cleaning
    (and thereby mutating) an unverified database.
    """
    count = conn.execute(sa.text(
        'SELECT count(*) FROM information_schema.tables '
        'WHERE table_schema = DATABASE()'
    )).scalar()
    if count:
        raise RuntimeError(
            f'refusing to mutate a non-empty schema: {count} table(s) '
            f'present; expected an empty disposable {MYSQL_TEST_DB_PREFIX}* '
            'database'
        )


def _drop_known_mysql_tables(engine):
    """Best-effort cleanup with guaranteed FK restoration.

    Every known table is attempted even if one drop fails. The first cleanup
    error is retained, but ``FOREIGN_KEY_CHECKS=1`` is always attempted; a
    connection whose restoration cannot be confirmed is invalidated so it
    can never return to the pool in an unsafe state.
    """
    with engine.connect() as conn:
        first_error = None
        try:
            conn.execute(sa.text('SET SESSION FOREIGN_KEY_CHECKS=0'))
            for table in KNOWN_MYSQL_TABLES:
                try:
                    conn.execute(sa.text(f'DROP TABLE IF EXISTS `{table}`'))
                except Exception as exc:
                    if first_error is None:
                        first_error = exc
        except Exception as exc:
            first_error = exc
        finally:
            try:
                conn.execute(sa.text('SET SESSION FOREIGN_KEY_CHECKS=1'))
                conn.commit()
                restored = conn.execute(sa.text(
                    'SELECT @@SESSION.FOREIGN_KEY_CHECKS'
                )).scalar()
                if restored != 1:
                    raise RuntimeError(
                        'MySQL FOREIGN_KEY_CHECKS restoration could not be '
                        f'confirmed: expected 1, found {restored!r}'
                    )
            except Exception as restore_error:
                conn.invalidate()
                if first_error is None:
                    first_error = restore_error
        if first_error is not None:
            raise first_error


def cleanup_mysql_engine(engine):
    try:
        _drop_known_mysql_tables(engine)
    finally:
        engine.dispose()


def prepare_mysql(spec: FixtureSpec, engine) -> PreparedDB:
    """Build the logical fixture equivalent on MySQL.

    The schema is verified empty again at this mutation point, then migrated
    to the fixture's starting revision and loaded with the same synthetic
    Python manifest. The SQLite .sql files are never executed on MySQL.
    """
    db = None
    mutation_started = False
    prepared = False
    try:
        # Preflight is read-only but still owned by this preparation attempt.
        # A connection/schema-check failure must dispose the engine without
        # cleaning an unverified (possibly non-empty) schema.
        with engine.connect() as conn:
            assert_mysql_schema_empty(conn)

        migrate_conn = engine.connect()
        try:
            cfg = make_alembic_config(migrate_conn)
            mutation_started = True
            alembic_command.upgrade(cfg, spec.start_revision)
        finally:
            migrate_conn.close()

        db = PreparedDB(
            spec=spec, engine=engine, migrate_engine=engine, dialect='mysql'
        )
        _insert_mysql_manifest(db)
        if spec.key == 'drifted':
            _apply_mysql_column_drift(db)
        elif spec.key == 'stamp-drift':
            _apply_mysql_stamp_drift(db)
        db.assert_fk_clean(f'{spec.key}: mysql fixture build')
        prepared = True
        return db
    except Exception as prepare_error:
        if db is not None:
            try:
                db._assert_conn.close()
            except Exception as close_error:
                try:
                    db._assert_conn.invalidate()
                except Exception as invalidate_error:
                    prepare_error.add_note(
                        'additional MySQL assertion-connection invalidation '
                        f'failure: {invalidate_error}'
                    )
                prepare_error.add_note(
                    'additional MySQL assertion-connection close failure: '
                    f'{close_error}'
                )
        if mutation_started:
            try:
                _drop_known_mysql_tables(engine)
            except Exception as cleanup_error:
                prepare_error.add_note(
                    f'additional MySQL preparation cleanup failure: {cleanup_error}'
                )
        raise
    finally:
        if not prepared:
            engine.dispose()


def _insert_mysql_manifest(db: PreparedDB):
    """Insert the shared manifest in the actual starting revision shape.

    A drift specification describes the shape *after* its deliberate drift is
    applied. The schema immediately after Alembic reaches ``start_revision``
    is canonical: 9a keeps preference sources on ``user`` with string
    channels, while 684 keeps targets on ``user_preferences`` with JSON
    channels. Insert that canonical shape first; drift transforms run later.
    """
    spec = db.spec
    starts_post_684 = spec.start_revision == DRIFTED_REVISION
    now = '2025-01-05 08:00:00'
    for user in USERS:
        row = {
            'id': user['id'], 'email': user['email'],
            'password_hash': SYNTHETIC_PASSWORD_HASH, 'created_at': now,
            'email_verified': 1, 'timezone': 'UTC',
        }
        if not starts_post_684:
            row['units_preference'] = user['units']
            brands = user['preferred_brands']
            row['preferred_brands'] = json.dumps(brands) if brands is not None else None
        columns = ', '.join(row)
        binds = ', '.join(f':{k}' for k in row)
        db.execute(f'INSERT INTO user ({columns}) VALUES ({binds})', row)
        channel = (json.dumps(CHANNEL_JSON[user['channel']])
                   if starts_post_684 else user['channel'])
        pref = {
            'user_id': user['id'], 'created_at': now, 'updated_at': now,
            'goal_notifications': 1, 'daily_reminders': 0, 'weekly_reports': 0,
            'achievement_notifications': 1, 'notification_frequency': 'immediate',
            'notification_channel': channel,
        }
        if starts_post_684:
            pref['units_preference'] = user['units'] or 'mg'
            brands = user['preferred_brands']
            pref['preferred_brands'] = json.dumps(brands) if brands is not None else None
        columns = ', '.join(pref)
        binds = ', '.join(f':{k}' for k in pref)
        db.execute(f'INSERT INTO user_preferences ({columns}) VALUES ({binds})', pref)

    for pouch in POUCHES:
        # MySQL INTEGER rounds 1.5 to 2 at insert; the fraction is
        # unrecoverable here (see MYSQL_LEGACY_POUCH_MG and the explicit
        # post-upgrade round-trip test).
        mg = MYSQL_LEGACY_POUCH_MG[pouch['id']] if pouch['id'] == 1 else str(pouch['nicotine_mg'])
        db.execute(
            'INSERT INTO pouch (id, brand, nicotine_mg, is_default, created_by, created_at) '
            'VALUES (:id, :brand, :mg, :is_default, :created_by, :created_at)',
            {'id': pouch['id'], 'brand': pouch['brand'], 'mg': str(mg),
             'is_default': 1 if pouch['is_default'] else 0,
             'created_by': pouch['created_by'], 'created_at': now},
        )
    for log in LOGS:
        db.execute(
            'INSERT INTO log (id, user_id, log_date, log_time, pouch_id, custom_brand, '
            'custom_nicotine_mg, quantity, notes, created_at) VALUES (:id, :user_id, '
            ':log_date, :log_time, :pouch_id, :custom_brand, :custom_mg, :quantity, '
            ':notes, :created_at)',
            {'id': log['id'], 'user_id': log['user_id'], 'log_date': FIXED_LOG_DATE,
             'log_time': FIXED_LOG_TIME, 'pouch_id': log['pouch_id'],
             'custom_brand': log['custom_brand'],
             'custom_mg': (str(log['custom_nicotine_mg'])
                           if log['custom_nicotine_mg'] is not None else None),
             'quantity': log['quantity'], 'notes': log['notes'], 'created_at': now},
        )
    db.execute(
        'INSERT INTO craving (id, user_id, craving_time, intensity, `trigger`) '
        'VALUES (:id, :user_id, :craving_time, :intensity, :trigger)', CRAVING)
    db.execute(
        'INSERT INTO notification_queue (id, user_id, notification_type, category, '
        'subject, message, recipient, scheduled_for, created_at, status, attempts, '
        'max_attempts, priority) VALUES (:id, :user_id, :notification_type, :category, '
        ':subject, :message, :recipient, :scheduled_for, :created_at, :status, '
        ':attempts, :max_attempts, :priority)', NOTIFICATION)
    db.execute(
        'INSERT INTO goal (id, user_id, created_at, goal_type, target_value, '
        'start_date, is_active) VALUES (:id, :user_id, :created_at, :goal_type, '
        ':target_value, :start_date, :is_active)',
        {**GOAL, 'created_at': now, 'is_active': 1})


def _apply_mysql_column_drift(db: PreparedDB):
    """The deliberate 684... drift: drop the two target preference columns."""
    db.execute('ALTER TABLE user_preferences DROP COLUMN units_preference')
    db.execute('ALTER TABLE user_preferences DROP COLUMN preferred_brands')


def _apply_mysql_stamp_drift(db: PreparedDB):
    """Stamped 9a... while physically post-684...: move the preference
    structure forward by hand, leaving the alembic stamp at 9a....
    (MySQL JSON columns cannot carry a literal server default, so the drifted
    shape omits the historical DEFAULT clause on MySQL.)"""
    db.execute("UPDATE user_preferences SET notification_channel = "
               "CASE notification_channel "
               "WHEN 'email' THEN '[\"email\"]' WHEN 'discord' THEN '[\"discord\"]' "
               "WHEN 'both' THEN '[\"email\", \"discord\"]' ELSE '[]' END")
    db.execute('ALTER TABLE user_preferences MODIFY notification_channel JSON NOT NULL')
    db.execute("ALTER TABLE user_preferences ADD COLUMN units_preference VARCHAR(20) NULL")
    db.execute('ALTER TABLE user_preferences ADD COLUMN preferred_brands JSON NULL')
    db.execute('UPDATE user_preferences up JOIN user u ON up.user_id = u.id '
               'SET up.units_preference = u.units_preference, '
               'up.preferred_brands = u.preferred_brands')
    db.execute("UPDATE user_preferences SET units_preference = 'mg' WHERE units_preference IS NULL")
    db.execute('ALTER TABLE user_preferences MODIFY units_preference VARCHAR(20) NOT NULL')
    db.execute('ALTER TABLE user DROP COLUMN preferred_brands')
    db.execute('ALTER TABLE user DROP COLUMN units_preference')
