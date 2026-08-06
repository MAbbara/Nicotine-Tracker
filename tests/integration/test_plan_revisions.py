"""Transactional plan revision and day-boundary integration behavior."""

from contextlib import contextmanager
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
import hashlib
import json
from pathlib import Path
import sqlite3
import threading

import pytest
import pytz
from flask import Flask
from sqlalchemy import event, text
from sqlalchemy.dialects import mysql
from sqlalchemy.exc import IntegrityError, OperationalError

from extensions import db
from models import (
    OnboardingDraft,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    ReductionPlan,
    User,
    UserPreferences,
)
from services.plan_schedule import (
    PlanGenerationInput,
    PlanScheduleGenerator,
    PlanValidationError,
    StageTarget,
)
import services.plan_service as plan_service_module
from services.plan_service import (
    ActivePlanConflictError,
    PlanNotFoundError,
    PlanService,
    PlanStateError,
    PreviewStaleError,
    _is_activation_contention_error,
)
from services.preference_service import PreferenceService
from tests.migrations import harness


def _clear_registered_schema_data():
    """Delete only rows from the already-verified disposable test schema."""
    engine = db.engine
    quoted_tables = [
        engine.dialect.identifier_preparer.quote(table.name)
        for table in db.metadata.tables.values()
    ]
    with engine.connect() as connection:
        is_mysql = engine.dialect.name == 'mysql'
        disable = (
            'SET SESSION FOREIGN_KEY_CHECKS=0'
            if is_mysql else 'PRAGMA foreign_keys=OFF'
        )
        enable = (
            'SET SESSION FOREIGN_KEY_CHECKS=1'
            if is_mysql else 'PRAGMA foreign_keys=ON'
        )
        connection.exec_driver_sql(disable)
        connection.commit()
        try:
            for table in quoted_tables:
                connection.exec_driver_sql(f'DELETE FROM {table}')
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            try:
                connection.exec_driver_sql(enable)
                connection.commit()
                restored = connection.exec_driver_sql(
                    'SELECT @@SESSION.FOREIGN_KEY_CHECKS'
                    if is_mysql else 'PRAGMA foreign_keys'
                ).scalar()
                if restored != 1:
                    raise RuntimeError('foreign-key checks were not restored')
            except Exception:
                connection.invalidate()
                raise


@pytest.fixture(scope='module')
def app(pytestconfig, tmp_path_factory):
    """Use one explicit disposable backend for this integration module."""
    backend = pytestconfig.getoption('--db')
    verified_mysql_engine = None
    if backend == 'mysql':
        verified_mysql_engine = harness.create_verified_mysql_engine()
        database_uri = verified_mysql_engine.url
    else:
        sqlite_path = tmp_path_factory.mktemp('plan-lifecycle') / 'lifecycle.sqlite3'
        database_uri = f'sqlite:///{sqlite_path}'

    lifecycle_app = Flask('plan-lifecycle-integration')
    lifecycle_app.config.update({
        'TESTING': True,
        'SQLALCHEMY_DATABASE_URI': database_uri,
        'SQLALCHEMY_TRACK_MODIFICATIONS': False,
        'SECRET_KEY': 'plan-lifecycle-test-only',
    })
    db.init_app(lifecycle_app)

    app_engine = None
    try:
        with lifecycle_app.app_context():
            import models  # noqa: F401 - register the complete model inventory
            registered_tables = set(db.metadata.tables)
            missing_cleanup_tables = (
                registered_tables - set(harness.KNOWN_MYSQL_TABLES)
            )
            if missing_cleanup_tables:
                raise RuntimeError(
                    'MySQL cleanup inventory is missing registered tables: '
                    f'{sorted(missing_cleanup_tables)}'
                )
            app_engine = db.engine
            db.create_all()
        yield lifecycle_app
    finally:
        with lifecycle_app.app_context():
            db.session.remove()
            if backend == 'mysql':
                try:
                    if app_engine is not None:
                        harness.cleanup_mysql_engine(app_engine)
                        with verified_mysql_engine.connect() as connection:
                            harness.assert_mysql_schema_empty(connection)
                finally:
                    verified_mysql_engine.dispose()
            elif app_engine is not None:
                app_engine.dispose()


@pytest.fixture
def db_session(app):
    """Fresh rows per test while retaining the selected backend schema."""
    with app.app_context():
        try:
            yield db.session
        finally:
            db.session.rollback()
            db.session.remove()
            _clear_registered_schema_data()


@pytest.fixture
def test_user(db_session):
    user = User(
        email='plan-lifecycle-user@example.invalid',
        password_hash='synthetic-test-hash',
        email_verified=True,
        timezone='UTC',
    )
    db_session.add(user)
    db_session.commit()
    return user


def test_lifecycle_backend_uses_the_explicit_disposable_database(
    app, pytestconfig,
):
    """The lifecycle matrix must never use the ordinary in-memory fixture."""
    backend = pytestconfig.getoption('--db')
    with app.app_context():
        if backend == 'sqlite':
            database = db.engine.url.database
            assert database not in {None, '', ':memory:'}
            assert Path(database).is_file()
        else:
            assert db.engine.dialect.name == 'mysql'


def test_mysql_cleanup_invalidates_when_fk_restoration_readback_is_not_one():
    class ScalarResult:
        def __init__(self, value=None):
            self.value = value

        def scalar(self):
            return self.value

    class FakeConnection:
        def __init__(self):
            self.statements = []
            self.invalidated = False

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return False

        def execute(self, statement):
            sql = str(statement)
            self.statements.append(sql)
            if sql == 'SELECT @@SESSION.FOREIGN_KEY_CHECKS':
                return ScalarResult(0)
            return ScalarResult()

        def commit(self):
            return None

        def invalidate(self):
            self.invalidated = True

    class FakeEngine:
        def __init__(self):
            self.connection = FakeConnection()

        def connect(self):
            return self.connection

    engine = FakeEngine()

    with pytest.raises(RuntimeError, match='FOREIGN_KEY_CHECKS'):
        harness._drop_known_mysql_tables(engine)

    assert engine.connection.invalidated is True
    assert (
        'SELECT @@SESSION.FOREIGN_KEY_CHECKS'
        in engine.connection.statements
    )


@pytest.mark.parametrize(
    'message',
    [
        'UNIQUE constraint failed: reduction_plan.user_id, '
        'reduction_plan.active_slot',
        "(1062, \"Duplicate entry '7-1' for key "
        "'uq_reduction_plan_user_active_slot'\")",
    ],
)
def test_activation_contention_classifier_accepts_exact_active_slot_unique(
    message,
):
    error = IntegrityError('UPDATE reduction_plan', {}, Exception(message))

    assert _is_activation_contention_error(error) is True


@pytest.mark.parametrize(
    'message',
    [
        'CHECK constraint failed: ck_reduction_plan_active_slot_status',
        'FOREIGN KEY constraint failed',
        'UNIQUE constraint failed: plan_day.plan_id, plan_day.local_date',
        'UNIQUE constraint failed: plan_revision.plan_id, plan_revision.id',
        'UNIQUE constraint failed: reduction_plan.migration_fingerprint',
    ],
)
def test_activation_contention_classifier_rejects_other_integrity_errors(
    message,
):
    error = IntegrityError('INSERT', {}, sqlite3.IntegrityError(message))

    assert _is_activation_contention_error(error) is False


@pytest.mark.parametrize(
    'message',
    [
        'database is locked',
        'database table is locked',
        'database schema is locked',
        'database is locked: reduction_plan',
        'database table is locked: reduction_plan',
        'database schema is locked: main',
    ],
)
def test_activation_contention_classifier_accepts_documented_sqlite_locks(
    message,
):
    error = OperationalError('UPDATE', {}, sqlite3.OperationalError(message))

    assert _is_activation_contention_error(error) is True


@pytest.mark.parametrize(
    'message',
    [
        'disk I/O error',
        'database is locked:',
        'database is locked: reduction plan',
        'database is locked: reduction_plan: extra',
        'database is locked while updating reduction_plan',
        'prefix database is locked: reduction_plan',
    ],
)
def test_activation_contention_classifier_rejects_near_miss_operational_error(
    message,
):
    error = OperationalError('UPDATE', {}, sqlite3.OperationalError(message))

    assert _is_activation_contention_error(error) is False


def _contention_test_input(start_date):
    return PlanGenerationInput(
        mode='reduce',
        start_date=start_date,
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    )


def _contention_test_draft(user_id, start_date):
    plan = PlanService.create_draft(
        user_id,
        _contention_test_input(start_date),
        baseline_source='manual',
    )
    digest = PlanRevision.query.filter_by(
        plan_id=plan.id
    ).one().preview_digest
    return plan, digest


def _contention_operation(service_path, user_id, winner_present):
    if service_path == 'create_from_preview':
        if winner_present:
            winner, winner_digest = _contention_test_draft(
                user_id, date(2099, 1, 1)
            )
            PlanService.activate(user_id, winner.id, winner_digest)
        generation_input = _contention_test_input(date(2099, 4, 1))
        preview = PlanScheduleGenerator.generate(generation_input)
        return lambda: PlanService.create_from_preview(
            user_id,
            generation_input,
            baseline_source='manual',
            preview_digest=preview.digest,
            activation='activate',
        )

    if service_path == 'activate':
        if winner_present:
            winner, winner_digest = _contention_test_draft(
                user_id, date(2099, 1, 1)
            )
            PlanService.activate(user_id, winner.id, winner_digest)
        target, target_digest = _contention_test_draft(
            user_id, date(2099, 4, 1)
        )
        return lambda: PlanService.activate(
            user_id, target.id, target_digest
        )

    target, target_digest = _contention_test_draft(
        user_id, date(2099, 1, 1)
    )
    PlanService.activate(user_id, target.id, target_digest)
    PlanService.pause(
        user_id,
        target.id,
        now=datetime(2099, 1, 2, 12, tzinfo=timezone.utc),
    )
    target_id = target.id
    if winner_present:
        winner, winner_digest = _contention_test_draft(
            user_id, date(2099, 4, 1)
        )
        PlanService.activate(user_id, winner.id, winner_digest)
    resume_date = date(2099, 1, 5)
    resume_now = datetime(2099, 1, 3, 12, tzinfo=timezone.utc)
    resume_digest = PlanService.preview_resume(
        user_id, target_id, resume_date, now=resume_now
    ).digest
    return lambda: PlanService.resume(
        user_id,
        target_id,
        resume_date,
        resume_digest,
        now=resume_now,
    )


def _contention_state_snapshot(user_id):
    onboarding = OnboardingDraft.query.filter_by(user_id=user_id).one_or_none()
    return {
        'graph': _persisted_plan_graph(user_id),
        'onboarding': (
            None
            if onboarding is None else (
                onboarding.id,
                onboarding.current_step,
                dict(onboarding.structured_payload),
            )
        ),
    }


def _add_contention_onboarding(user_id):
    db.session.add(OnboardingDraft(
        user_id=user_id,
        current_step='review',
        structured_payload={'intention': 'reduce'},
    ))
    db.session.commit()


@pytest.mark.parametrize(
    'error',
    [
        OperationalError(
            'UPDATE reduction_plan',
            {},
            sqlite3.OperationalError('disk I/O error'),
        ),
        IntegrityError(
            'UPDATE reduction_plan',
            {},
            sqlite3.IntegrityError(
                'CHECK constraint failed: '
                'ck_reduction_plan_active_slot_status'
            ),
        ),
    ],
    ids=['unrecognized-operational', 'unrelated-integrity'],
)
def test_activation_confirmation_tristate_returns_none_for_noncontention(error):
    assert plan_service_module._activation_conflict_is_confirmed(
        error, user_id=7, plan_id=11
    ) is None


@pytest.mark.parametrize(
    ('confirmation_result', 'retry_count', 'expected'),
    [
        (True, 0, False),
        (False, 0, True),
        (None, 0, False),
        (False, 2, False),
    ],
)
def test_activation_transaction_retry_predicate_requires_exact_false(
    confirmation_result, retry_count, expected,
):
    error = OperationalError(
        'UPDATE reduction_plan',
        {},
        sqlite3.OperationalError('database is locked'),
    )

    assert plan_service_module._activation_transaction_should_retry(
        error, confirmation_result, retry_count
    ) is expected


@pytest.mark.parametrize(
    ('confirmation_behavior', 'expected'),
    [
        ('winner', True),
        ('absent', False),
        ('failure', None),
        ('contended-until-deadline', None),
    ],
)
def test_activation_confirmation_tristate_distinguishes_all_outcomes(
    db_session, monkeypatch, confirmation_behavior, expected,
):
    error = OperationalError(
        'UPDATE reduction_plan',
        {},
        sqlite3.OperationalError('database is locked'),
    )

    class Clock:
        def __init__(self):
            self.value = 0.0

        def monotonic(self):
            return self.value

        def sleep(self, seconds):
            self.value += seconds

    def confirmation(user_id, plan_id, remaining_seconds):
        if confirmation_behavior == 'failure':
            raise RuntimeError('synthetic confirmation failure')
        if confirmation_behavior == 'contended-until-deadline':
            raise plan_service_module._ActivationConfirmationContention()
        return confirmation_behavior == 'winner'

    monkeypatch.setattr(
        plan_service_module,
        '_persisted_different_active_plan_exists',
        confirmation,
    )
    monkeypatch.setattr(plan_service_module, '_clock', Clock())

    assert plan_service_module._activation_conflict_is_confirmed(
        error, user_id=7, plan_id=11
    ) is expected
    assert db_session().in_transaction() is False


def test_activation_confirmation_tristate_returns_none_for_clock_failure(
    db_session, monkeypatch,
):
    error = OperationalError(
        'UPDATE reduction_plan',
        {},
        sqlite3.OperationalError('database is locked'),
    )

    class BrokenClock:
        @staticmethod
        def monotonic():
            raise RuntimeError('synthetic confirmation clock failure')

    monkeypatch.setattr(plan_service_module, '_clock', BrokenClock())

    assert plan_service_module._activation_conflict_is_confirmed(
        error, user_id=7, plan_id=11
    ) is None
    assert db_session().in_transaction() is False


@pytest.mark.parametrize(
    'service_path', ['create_from_preview', 'activate', 'resume']
)
@pytest.mark.parametrize('mysql_code', [1205, 1213])
@pytest.mark.parametrize('winner_present', [False, True])
def test_mysql_lock_signal_confirms_winner_or_retries_whole_operation(
    db_session,
    test_user,
    monkeypatch,
    service_path,
    mysql_code,
    winner_present,
):
    operation = _contention_operation(
        service_path, test_user.id, winner_present
    )
    session = db_session()
    original_execute = session.execute
    injected = OperationalError(
        'SELECT user FOR UPDATE',
        {},
        Exception(mysql_code, 'synthetic lock contention'),
    )
    calls = 0

    def fail_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise injected
        return original_execute(*args, **kwargs)

    monkeypatch.setattr(session, 'execute', fail_once)
    if winner_present:
        with pytest.raises(ActivePlanConflictError):
            operation()
        assert db_session().in_transaction() is False
    else:
        activated = operation()
        assert activated.status == 'active'
        assert activated.active_slot == 1
        assert calls > 2


@pytest.mark.parametrize(
    ('message', 'maps_to_conflict'),
    [
        (
            'UNIQUE constraint failed: reduction_plan.user_id, '
            'reduction_plan.active_slot',
            True,
        ),
        ('CHECK constraint failed: ck_reduction_plan_active_slot_status', False),
    ],
)
@pytest.mark.parametrize(
    'service_path', ['create_from_preview', 'activate', 'resume']
)
def test_activation_commit_maps_only_the_exact_active_slot_unique_error(
    db_session,
    test_user,
    monkeypatch,
    message,
    maps_to_conflict,
    service_path,
):
    operation = _contention_operation(
        service_path, test_user.id, winner_present=False
    )
    before = _persisted_plan_graph(test_user.id)
    injected = IntegrityError(
        'UPDATE reduction_plan', {}, sqlite3.IntegrityError(message)
    )
    commit_calls = 0

    def fail_commit():
        nonlocal commit_calls
        commit_calls += 1
        raise injected

    monkeypatch.setattr(db_session(), 'commit', fail_commit)
    expected_error = ActivePlanConflictError if maps_to_conflict else IntegrityError
    with pytest.raises(expected_error) as caught:
        operation()
    if not maps_to_conflict:
        assert caught.value is injected

    assert commit_calls == 1
    assert _persisted_plan_graph(test_user.id) == before


@pytest.mark.parametrize(
    'service_path', ['create_from_preview', 'activate', 'resume']
)
def test_confirmation_query_failure_never_retries_or_mutates_activation(
    db_session, test_user, monkeypatch, service_path,
):
    user_id = test_user.id
    operation = _contention_operation(
        service_path, user_id, winner_present=False
    )
    _add_contention_onboarding(user_id)
    before = _contention_state_snapshot(user_id)
    original_failure = OperationalError(
        'SELECT user FOR UPDATE',
        {},
        Exception(1213, 'synthetic original deadlock'),
    )
    confirmation_failure = OperationalError(
        'SELECT active plan',
        {},
        Exception(2006, 'synthetic confirmation connection failure'),
    )
    session = db_session()
    operation_attempts = 0
    confirmation_attempts = 0

    def fail_operation_then_confirmation(*args, **kwargs):
        nonlocal operation_attempts, confirmation_attempts
        if operation_attempts == confirmation_attempts:
            operation_attempts += 1
            raise original_failure
        confirmation_attempts += 1
        raise confirmation_failure

    with monkeypatch.context() as confirmation:
        confirmation.setattr(
            session, 'execute', fail_operation_then_confirmation
        )
        with pytest.raises(OperationalError) as caught:
            operation()

    assert caught.value is original_failure
    assert operation_attempts == 1
    assert confirmation_attempts == 1
    assert db_session().in_transaction() is False
    assert _contention_state_snapshot(user_id) == before


@pytest.mark.parametrize(
    'service_path', ['create_from_preview', 'activate', 'resume']
)
def test_activation_preserves_unrelated_operational_error_without_confirmation(
    db_session, test_user, monkeypatch, service_path,
):
    operation = _contention_operation(
        service_path, test_user.id, winner_present=False
    )
    before = _persisted_plan_graph(test_user.id)
    injected = OperationalError(
        'SELECT user FOR UPDATE',
        {},
        sqlite3.OperationalError('disk I/O error'),
    )
    session = db_session()
    real_execute = session.execute
    calls = 0

    def fail_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise injected
        return real_execute(*args, **kwargs)

    monkeypatch.setattr(session, 'execute', fail_once)
    with pytest.raises(OperationalError) as caught:
        operation()

    assert caught.value is injected
    assert calls == 1
    assert _persisted_plan_graph(test_user.id) == before


def test_sqlite_winner_confirmation_caps_real_lock_wait_and_restores_timeout(
    app, db_session, test_user, monkeypatch,
):
    _require_sqlite_backend()
    plan, digest = _contention_test_draft(
        test_user.id, date(2099, 1, 1)
    )
    user_id = test_user.id
    plan_id = plan.id
    db.session.rollback()
    connection = db.session.connection()
    connection.exec_driver_sql('PRAGMA busy_timeout = 1200')
    assert connection.exec_driver_sql('PRAGMA busy_timeout').scalar() == 1200
    db.session.rollback()

    locker = sqlite3.connect(db.engine.url.database, timeout=0.1)
    locker.execute('PRAGMA busy_timeout = 0')
    locker.execute('BEGIN EXCLUSIVE')
    original_failure = OperationalError(
        'UPDATE reduction_plan',
        {},
        sqlite3.OperationalError('database is locked: reduction_plan'),
    )
    session = db_session()
    real_execute = session.execute
    calls = 0

    def fail_once(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise original_failure
        return real_execute(*args, **kwargs)

    monkeypatch.setattr(session, 'execute', fail_once)
    monkeypatch.setattr(
        plan_service_module,
        '_activation_transaction_should_retry',
        lambda exc, confirmation_result, retry_count: False,
    )
    started = plan_service_module._clock.monotonic()
    try:
        with pytest.raises(OperationalError) as caught:
            PlanService.activate(user_id, plan_id, digest)
        elapsed = plan_service_module._clock.monotonic() - started
    finally:
        locker.rollback()
        locker.close()

    assert caught.value is original_failure
    assert 0.15 <= elapsed <= 0.75
    restored_connection = db.session.connection()
    assert (
        restored_connection.exec_driver_sql('PRAGMA busy_timeout').scalar()
        == 1200
    )


def test_mysql_winner_confirmation_query_compiles_remaining_budget_hint():
    statement = plan_service_module._active_plan_confirmation_query(
        user_id=7,
        plan_id=11,
        mysql_timeout_ms=87,
    )

    sql = str(statement.compile(
        dialect=mysql.dialect(),
        compile_kwargs={'literal_binds': True},
    ))
    normalized = ' '.join(sql.split())
    assert normalized.startswith(
        'SELECT /*+ MAX_EXECUTION_TIME(87) */ reduction_plan.id '
    )
    assert 'reduction_plan.user_id = 7' in normalized
    assert 'reduction_plan.id != 11' in normalized
    assert normalized.endswith('LIMIT 1')


@pytest.mark.parametrize(
    'failure_mode',
    ['restore_set', 'readback', 'conversion', 'mismatch'],
)
@pytest.mark.parametrize(
    'service_path', ['create_from_preview', 'activate', 'resume']
)
def test_sqlite_timeout_restore_failure_never_retries_or_mutates_activation(
    db_session, test_user, monkeypatch, failure_mode, service_path,
):
    class ScalarResult:
        def __init__(self, value):
            self.value = value

        def scalar(self):
            return self.value

    class FakeConnection:
        def __init__(self):
            self.invalidated = False

        def exec_driver_sql(self, statement):
            if statement.startswith('PRAGMA busy_timeout ='):
                if failure_mode == 'restore_set':
                    raise RuntimeError('synthetic restore SET failure')
                return ScalarResult(None)
            if failure_mode == 'readback':
                raise RuntimeError('synthetic restore readback failure')
            if failure_mode == 'conversion':
                return ScalarResult('not-an-integer')
            return ScalarResult(1199)

        def invalidate(self):
            self.invalidated = True

    user_id = test_user.id
    operation = _contention_operation(
        service_path, user_id, winner_present=False
    )
    _add_contention_onboarding(user_id)
    before = _contention_state_snapshot(user_id)
    original_failure = OperationalError(
        'UPDATE reduction_plan',
        {},
        sqlite3.OperationalError('database is locked'),
    )
    fake_connection = FakeConnection()

    def fail_during_restoration(user_id, plan_id, remaining_seconds):
        plan_service_module._restore_sqlite_busy_timeout(
            fake_connection, 1200
        )

    session = db_session()
    operation_attempts = 0

    def fail_activation(*args, **kwargs):
        nonlocal operation_attempts
        operation_attempts += 1
        raise original_failure

    with monkeypatch.context() as restoration:
        restoration.setattr(session, 'execute', fail_activation)
        restoration.setattr(
            plan_service_module,
            '_persisted_different_active_plan_exists',
            fail_during_restoration,
        )
        with pytest.raises(OperationalError) as caught:
            operation()

    assert caught.value is original_failure
    assert operation_attempts == 1
    assert fake_connection.invalidated is True
    assert db_session().in_transaction() is False
    assert _contention_state_snapshot(user_id) == before


class _FakeConfirmationClock:
    def __init__(self):
        self.value = 0.0

    def monotonic(self):
        return self.value

    def sleep(self, seconds):
        self.value += seconds


@pytest.mark.parametrize(
    'service_path', ['create_from_preview', 'activate', 'resume']
)
def test_activation_transaction_retry_exhaustion_preserves_last_error_and_graph(
    db_session, test_user, monkeypatch, service_path,
):
    user_id = test_user.id
    operation = _contention_operation(
        service_path, user_id, winner_present=False
    )
    before = _persisted_plan_graph(user_id)
    injected = OperationalError(
        'SELECT user FOR UPDATE',
        {},
        sqlite3.OperationalError('database is locked'),
    )
    operation_attempts = 0

    def always_fail_operation(*args, **kwargs):
        nonlocal operation_attempts
        operation_attempts += 1
        raise injected

    def no_persisted_winner(user_id, plan_id, remaining_seconds):
        return False

    fake_clock = _FakeConfirmationClock()
    with monkeypatch.context() as contention:
        contention.setattr(db_session(), 'execute', always_fail_operation)
        contention.setattr(
            plan_service_module,
            '_persisted_different_active_plan_exists',
            no_persisted_winner,
        )
        contention.setattr(plan_service_module, '_clock', fake_clock)

        with pytest.raises(OperationalError) as caught:
            operation()

        assert caught.value is injected
        assert operation_attempts == 3
        assert fake_clock.value == pytest.approx(0.75)
        assert db_session().in_transaction() is False

    assert _persisted_plan_graph(user_id) == before


@contextmanager
def _temporary_sqlite_busy_timeout(value):
    connection = db.session.connection()
    driver_connection = connection.connection.driver_connection
    prior_timeout = int(
        driver_connection.execute('PRAGMA busy_timeout').fetchone()[0]
    )
    driver_connection.execute(f'PRAGMA busy_timeout = {int(value)}')
    db.session.rollback()
    try:
        yield prior_timeout
    finally:
        driver_connection.execute(
            f'PRAGMA busy_timeout = {prior_timeout}'
        )
        restored_timeout = int(
            driver_connection.execute('PRAGMA busy_timeout').fetchone()[0]
        )
        db.session.rollback()
        assert restored_timeout == prior_timeout


def _require_sqlite_backend():
    if db.engine.dialect.name != 'sqlite':
        pytest.skip('SQLite-specific lock and busy_timeout semantics')


def test_zero_timeout_confirmation_retries_then_maps_later_visible_winner(
    db_session, test_user, monkeypatch,
):
    _require_sqlite_backend()
    winner, winner_digest = _contention_test_draft(
        test_user.id, date(2099, 1, 1)
    )
    PlanService.activate(test_user.id, winner.id, winner_digest)
    target, target_digest = _contention_test_draft(
        test_user.id, date(2099, 4, 1)
    )
    user_id = test_user.id
    target_id = target.id
    db.session.rollback()
    original_failure = OperationalError(
        'SELECT user FOR UPDATE',
        {},
        sqlite3.OperationalError('database is locked'),
    )
    confirmation_lock = OperationalError(
        'SELECT active plan',
        {},
        sqlite3.OperationalError('database is locked: reduction_plan'),
    )
    session = db_session()
    real_execute = session.execute
    calls = 0

    def fail_activation_and_first_confirmation(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise original_failure
        if calls == 2:
            raise confirmation_lock
        return real_execute(*args, **kwargs)

    fake_clock = _FakeConfirmationClock()
    monkeypatch.setattr(session, 'execute', fail_activation_and_first_confirmation)
    monkeypatch.setattr(plan_service_module, '_clock', fake_clock)

    with _temporary_sqlite_busy_timeout(0):
        with pytest.raises(ActivePlanConflictError):
            PlanService.activate(user_id, target_id, target_digest)

        assert calls == 3
        assert fake_clock.value == pytest.approx(0.01)
        assert db_session().in_transaction() is False


def test_zero_timeout_confirmation_retries_are_bounded_without_winner(
    db_session, test_user, monkeypatch,
):
    _require_sqlite_backend()
    target, target_digest = _contention_test_draft(
        test_user.id, date(2099, 1, 1)
    )
    user_id = test_user.id
    target_id = target.id
    db.session.rollback()
    original_failure = OperationalError(
        'SELECT user FOR UPDATE',
        {},
        sqlite3.OperationalError('database is locked'),
    )
    confirmation_lock = OperationalError(
        'SELECT active plan',
        {},
        sqlite3.OperationalError('database table is locked: reduction_plan'),
    )
    session = db_session()
    calls = 0

    def always_contended(*args, **kwargs):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise original_failure
        raise confirmation_lock

    fake_clock = _FakeConfirmationClock()
    monkeypatch.setattr(session, 'execute', always_contended)
    monkeypatch.setattr(plan_service_module, '_clock', fake_clock)
    monkeypatch.setattr(
        plan_service_module,
        '_activation_transaction_should_retry',
        lambda exc, confirmation_result, retry_count: False,
    )

    with _temporary_sqlite_busy_timeout(0):
        with pytest.raises(OperationalError) as caught:
            PlanService.activate(user_id, target_id, target_digest)

        assert caught.value is original_failure
        assert calls >= 20
        assert 0.25 <= fake_clock.value <= 0.26
        assert db_session().in_transaction() is False


def test_zero_timeout_scenarios_leave_pooled_timeout_unchanged(db_session):
    _require_sqlite_backend()
    timeout = db.session.connection().exec_driver_sql(
        'PRAGMA busy_timeout'
    ).scalar()

    assert timeout > 0


def test_resume_preview_uses_newest_pause_id_when_event_instants_tie(
    db_session, test_user,
):
    plan, _ = _contention_test_draft(test_user.id, date(2099, 1, 1))
    plan.status = 'paused'
    tied_instant = datetime(2099, 1, 5, 12)
    older = PlanStatusEvent(
        plan_id=plan.id,
        status='paused',
        effective_at_utc=tied_instant,
        local_date=date(2099, 1, 2),
        reason='older pause',
    )
    newer = PlanStatusEvent(
        plan_id=plan.id,
        status='paused',
        effective_at_utc=tied_instant,
        local_date=date(2099, 1, 5),
        reason='newer pause',
    )
    db_session.add_all([older, newer])
    db_session.commit()
    assert newer.id > older.id

    preview = PlanService.preview_resume(
        test_user.id,
        plan.id,
        date(2099, 1, 7),
        now=datetime(2099, 1, 6, 12, tzinfo=timezone.utc),
    )

    assert len(preview.days) == 44
    assert preview.days[0].local_date == date(2099, 1, 7)


def _persisted_plan_graph(user_id):
    plans = ReductionPlan.query.filter_by(user_id=user_id).order_by(
        ReductionPlan.id
    ).all()
    plan_ids = [plan.id for plan in plans]
    return {
        'plans': [
            (plan.id, plan.status, plan.active_slot, plan.active_revision_id)
            for plan in plans
        ],
        'revisions': [
            (row.id, row.plan_id, row.preview_digest, row.reason)
            for row in PlanRevision.query.filter(
                PlanRevision.plan_id.in_(plan_ids)
            ).order_by(PlanRevision.id)
        ],
        'days': [
            (
                row.id,
                row.plan_id,
                row.revision_id,
                row.local_date,
                row.target_pouches,
                row.nicotine_ceiling_mg,
            )
            for row in PlanDay.query.filter(
                PlanDay.plan_id.in_(plan_ids)
            ).order_by(PlanDay.id)
        ],
        'events': [
            (
                row.id,
                row.plan_id,
                row.status,
                row.effective_at_utc,
                row.local_date,
                row.reason,
            )
            for row in PlanStatusEvent.query.filter(
                PlanStatusEvent.plan_id.in_(plan_ids)
            ).order_by(PlanStatusEvent.id)
        ],
    }


@pytest.mark.parametrize(
    'worker_busy_timeout',
    [None, 0],
    ids=['default-timeout', 'zero-timeout'],
)
def test_two_independent_connections_map_activation_race_to_one_conflict(
    app, db_session, test_user, worker_busy_timeout,
):
    first = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(
            mode='reduce',
            start_date=date(2099, 1, 1),
            baseline_pouches=Decimal('8.00'),
            baseline_mg=Decimal('48.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            pace='steady',
            end_target_pouches=2,
        ),
        baseline_source='manual',
    )
    second = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(
            mode='reduce',
            start_date=date(2099, 3, 1),
            baseline_pouches=Decimal('6.00'),
            baseline_mg=Decimal('36.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            pace='gentle',
            end_target_pouches=1,
        ),
        baseline_source='manual',
    )
    db_session.add(OnboardingDraft(
        user_id=test_user.id,
        current_step='review',
        structured_payload={'intention': 'reduce'},
    ))
    db_session.commit()
    user_id = test_user.id
    attempts = [
        (
            first.id,
            PlanRevision.query.filter_by(
                plan_id=first.id
            ).one().preview_digest,
        ),
        (
            second.id,
            PlanRevision.query.filter_by(
                plan_id=second.id
            ).one().preview_digest,
        ),
    ]
    before = _persisted_plan_graph(user_id)
    onboarding_before = OnboardingDraft.query.filter_by(user_id=user_id).one()
    onboarding_snapshot = (
        onboarding_before.id,
        onboarding_before.current_step,
        onboarding_before.structured_payload,
    )
    db.session.remove()

    barrier = threading.Barrier(2)
    conflict_read_barrier = threading.Barrier(2)
    outcomes = []
    connection_ids = []
    timeout_restorations = []
    removed_threads = []
    outcome_lock = threading.Lock()
    synchronized_conflict_reads = 0

    def synchronize_conflict_reads(
        connection, cursor, statement, parameters, context, executemany,
    ):
        nonlocal synchronized_conflict_reads
        normalized = ' '.join(statement.lower().split())
        if (
            engine.dialect.name == 'sqlite'
            and normalized.startswith(
                'select reduction_plan.id from reduction_plan where'
            )
            and 'reduction_plan.active_slot =' in normalized
        ):
            with outcome_lock:
                synchronized_conflict_reads += 1
                should_wait = synchronized_conflict_reads <= 2
            if should_wait:
                conflict_read_barrier.wait(timeout=5)

    engine = db.engine
    event.listen(engine, 'before_cursor_execute', synchronize_conflict_reads)

    def activate_in_own_context(plan_id, digest):
        outcome = None
        driver_connection = None
        prior_busy_timeout = None
        applied_busy_timeout = None
        with app.app_context():
            try:
                driver_connection = (
                    db.session.connection().connection.driver_connection
                )
                with outcome_lock:
                    connection_ids.append(id(driver_connection))
                if db.engine.dialect.name == 'sqlite':
                    prior_busy_timeout = int(
                        driver_connection.execute(
                            'PRAGMA busy_timeout'
                        ).fetchone()[0]
                    )
                    if worker_busy_timeout is not None:
                        driver_connection.execute(
                            f'PRAGMA busy_timeout = {worker_busy_timeout}'
                        )
                    applied_busy_timeout = int(
                        driver_connection.execute(
                            'PRAGMA busy_timeout'
                        ).fetchone()[0]
                    )
                    db.session.execute(text('BEGIN'))
                barrier.wait(timeout=5)
                activated = PlanService.activate(user_id, plan_id, digest)
                outcome = ('success', activated.id)
            except ActivePlanConflictError as exc:
                outcome = ('conflict', type(exc))
            except BaseException as exc:  # surfaced in the controller thread
                outcome = ('unexpected', exc)
            finally:
                if prior_busy_timeout is not None:
                    try:
                        driver_connection.execute(
                            f'PRAGMA busy_timeout = {prior_busy_timeout}'
                        )
                        restored_busy_timeout = int(
                            driver_connection.execute(
                                'PRAGMA busy_timeout'
                            ).fetchone()[0]
                        )
                        with outcome_lock:
                            timeout_restorations.append((
                                prior_busy_timeout,
                                applied_busy_timeout,
                                restored_busy_timeout,
                            ))
                    except BaseException as exc:
                        outcome = ('unexpected', exc)
                db.session.remove()
                with outcome_lock:
                    outcomes.append(outcome)
                    removed_threads.append(threading.current_thread().name)

    threads = [
        threading.Thread(
            target=activate_in_own_context,
            args=attempt,
            name=f'activation-{index}',
        )
        for index, attempt in enumerate(attempts, start=1)
    ]
    try:
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=10)
    finally:
        event.remove(engine, 'before_cursor_execute', synchronize_conflict_reads)

    assert not [thread.name for thread in threads if thread.is_alive()]
    assert len(set(connection_ids)) == 2
    if engine.dialect.name == 'sqlite':
        assert len(timeout_restorations) == 2
        assert all(
            restored == prior
            for prior, _applied, restored in timeout_restorations
        )
        if worker_busy_timeout is not None:
            assert all(
                applied == worker_busy_timeout
                for _prior, applied, _restored in timeout_restorations
            )
    unexpected = [value for kind, value in outcomes if kind == 'unexpected']
    assert unexpected == [], [
        {
            'type': type(value).__name__,
            'statement': getattr(value, 'statement', None),
            'original': str(getattr(value, 'orig', value)),
        }
        for value in unexpected
    ]
    assert [kind for kind, _ in outcomes].count('success') == 1
    assert [kind for kind, _ in outcomes].count('conflict') == 1
    assert len(removed_threads) == 2

    after = _persisted_plan_graph(user_id)
    active = [
        row for row in after['plans']
        if row[1] == 'active' and row[2] == 1
    ]
    draft = [row for row in after['plans'] if row[1] == 'draft']
    assert len(active) == 1
    assert len(draft) == 1
    assert draft[0][2] is None
    assert len(after['events']) == 1
    assert after['events'][0][2] == 'active'
    assert after['revisions'] == before['revisions']
    assert after['days'] == before['days']
    onboarding_after = OnboardingDraft.query.filter_by(user_id=user_id).one()
    assert (
        onboarding_after.id,
        onboarding_after.current_step,
        onboarding_after.structured_payload,
    ) == onboarding_snapshot


def _activate_at(monkeypatch, user_id, plan_id, digest, instant):
    class FrozenDateTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return instant if tz is not None else instant.replace(tzinfo=None)

    with monkeypatch.context() as clock:
        clock.setattr(plan_service_module, 'datetime', FrozenDateTime)
        return PlanService.activate(user_id, plan_id, digest)


def _event_rows(plan_id):
    return [
        (
            row.id,
            row.status,
            row.effective_at_utc,
            row.local_date,
            row.reason,
        )
        for row in PlanStatusEvent.query.filter_by(plan_id=plan_id).order_by(
            PlanStatusEvent.effective_at_utc,
            PlanStatusEvent.id,
        )
    ]


def _paused_intervals(events):
    intervals = []
    for index, event_row in enumerate(events):
        if event_row[1] != 'paused':
            continue
        closing = next(
            candidate
            for candidate in events[index + 1:]
            if candidate[1] in {'active', 'completed', 'archived'}
        )
        intervals.append((event_row[2], closing[2], closing[1]))
    return intervals


def test_status_history_is_append_only_and_derives_all_paused_intervals(
    db_session, test_user, monkeypatch,
):
    test_user.timezone = 'Asia/Riyadh'
    db_session.add(UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    ))
    db_session.commit()
    plan = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(
            mode='reduce',
            start_date=date(2099, 1, 1),
            baseline_pouches=Decimal('8.00'),
            baseline_mg=Decimal('48.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            pace='steady',
            end_target_pouches=2,
        ),
        baseline_source='manual',
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    _activate_at(
        monkeypatch,
        test_user.id,
        plan.id,
        initial.preview_digest,
        datetime(2099, 1, 1, 0, 30, tzinfo=timezone.utc),
    )
    PlanService.pause(
        test_user.id,
        plan.id,
        reason='travel week',
        now=datetime(2099, 1, 2, 0, 30, tzinfo=timezone.utc),
    )
    first_resume = PlanService.preview_resume(
        test_user.id,
        plan.id,
        date(2099, 1, 3),
        now=datetime(2099, 1, 2, 2, tzinfo=timezone.utc),
    )
    PlanService.resume(
        test_user.id,
        plan.id,
        date(2099, 1, 3),
        first_resume.digest,
        now=datetime(2099, 1, 2, 2, tzinfo=timezone.utc),
    )
    immutable_prefix = _event_rows(plan.id)

    PlanService.pause(
        test_user.id,
        plan.id,
        reason='sleep disruption',
        now=datetime(2099, 1, 4, 0, 30, tzinfo=timezone.utc),
    )
    second_resume = PlanService.preview_resume(
        test_user.id,
        plan.id,
        date(2099, 1, 5),
        now=datetime(2099, 1, 4, 2, tzinfo=timezone.utc),
    )
    PlanService.resume(
        test_user.id,
        plan.id,
        date(2099, 1, 5),
        second_resume.digest,
        now=datetime(2099, 1, 4, 2, tzinfo=timezone.utc),
    )
    PlanService.complete(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 6, 0, 30, tzinfo=timezone.utc),
    )
    PlanService.archive(
        test_user.id,
        plan.id,
        reason='kept for reflection',
        now=datetime(2099, 1, 6, 2, tzinfo=timezone.utc),
    )

    events = _event_rows(plan.id)
    assert events[:len(immutable_prefix)] == immutable_prefix
    assert [(row[1], row[2], row[3], row[4]) for row in events] == [
        ('active', datetime(2099, 1, 1, 0, 30), date(2098, 12, 31), 'activated'),
        ('paused', datetime(2099, 1, 2, 0, 30), date(2099, 1, 1), 'travel week'),
        ('active', datetime(2099, 1, 2, 2), date(2099, 1, 2), 'resumed'),
        ('paused', datetime(2099, 1, 4, 0, 30), date(2099, 1, 3), 'sleep disruption'),
        ('active', datetime(2099, 1, 4, 2), date(2099, 1, 4), 'resumed'),
        ('completed', datetime(2099, 1, 6, 0, 30), date(2099, 1, 5), 'completed'),
        ('archived', datetime(2099, 1, 6, 2), date(2099, 1, 6), 'kept for reflection'),
    ]
    assert _paused_intervals(events) == [
        (datetime(2099, 1, 2, 0, 30), datetime(2099, 1, 2, 2), 'active'),
        (datetime(2099, 1, 4, 0, 30), datetime(2099, 1, 4, 2), 'active'),
    ]


def test_completing_a_paused_plan_closes_its_interval_without_resume(
    db_session, test_user, monkeypatch,
):
    plan = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(
            mode='reduce',
            start_date=date(2099, 2, 1),
            baseline_pouches=Decimal('5.00'),
            baseline_mg=Decimal('30.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            pace='focused',
            end_target_pouches=1,
        ),
        baseline_source='manual',
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    _activate_at(
        monkeypatch,
        test_user.id,
        plan.id,
        initial.preview_digest,
        datetime(2099, 2, 1, 12, tzinfo=timezone.utc),
    )
    PlanService.pause(
        test_user.id,
        plan.id,
        reason='pause before completion',
        now=datetime(2099, 2, 2, 12, tzinfo=timezone.utc),
    )
    PlanService.complete(
        test_user.id,
        plan.id,
        now=datetime(2099, 2, 3, 12, tzinfo=timezone.utc),
    )

    events = _event_rows(plan.id)
    assert [row[1] for row in events] == ['active', 'paused', 'completed']
    assert _paused_intervals(events) == [(
        datetime(2099, 2, 2, 12),
        datetime(2099, 2, 3, 12),
        'completed',
    )]


def _ownership_snapshot(owner_id, other_id):
    plans = ReductionPlan.query.filter_by(user_id=owner_id).order_by(
        ReductionPlan.id
    ).all()
    plan_ids = [plan.id for plan in plans]
    return {
        'owner_plan_count': ReductionPlan.query.filter_by(user_id=owner_id).count(),
        'other_plan_count': ReductionPlan.query.filter_by(user_id=other_id).count(),
        'plans': [
            (
                plan.id,
                plan.user_id,
                plan.mode,
                plan.status,
                plan.start_date,
                plan.target_date,
                plan.active_revision_id,
                plan.active_slot,
                plan.updated_at,
            )
            for plan in plans
        ],
        'revisions': [
            (
                row.id,
                row.plan_id,
                row.effective_date,
                row.preview_digest,
                row.reason,
                row.note,
                json.dumps(row.generation_inputs, sort_keys=True),
            )
            for row in PlanRevision.query.filter(
                PlanRevision.plan_id.in_(plan_ids)
            ).order_by(PlanRevision.id)
        ],
        'days': [
            (
                row.id,
                row.plan_id,
                row.revision_id,
                row.local_date,
                row.target_pouches,
                row.nicotine_ceiling_mg,
            )
            for row in PlanDay.query.filter(
                PlanDay.plan_id.in_(plan_ids)
            ).order_by(PlanDay.id)
        ],
        'events': [
            (
                row.id,
                row.plan_id,
                row.status,
                row.effective_at_utc,
                row.local_date,
                row.reason,
            )
            for row in PlanStatusEvent.query.filter(
                PlanStatusEvent.plan_id.in_(plan_ids)
            ).order_by(PlanStatusEvent.id)
        ],
    }


def test_cross_user_lifecycle_matrix_is_not_found_and_mutation_free(
    db_session, test_user, monkeypatch,
):
    other = User(
        email='other-plan-owner@example.invalid',
        password_hash='synthetic-test-hash',
        email_verified=True,
        timezone='UTC',
    )
    db_session.add(other)
    db_session.commit()
    plan = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(
            mode='reduce',
            start_date=date(2099, 1, 1),
            baseline_pouches=Decimal('8.00'),
            baseline_mg=Decimal('48.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            pace='steady',
            end_target_pouches=2,
        ),
        baseline_source='manual',
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    _activate_at(
        monkeypatch,
        test_user.id,
        plan.id,
        initial.preview_digest,
        datetime(2099, 1, 1, 12, tzinfo=timezone.utc),
    )
    observe = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(mode='observe', start_date=date(2099, 3, 1)),
        baseline_source='observe',
    )
    owner_id = test_user.id
    other_id = other.id
    changes = {
        'pace': 'focused',
        'duration_days': 28,
        'end_target_pouches': 1,
    }
    now = datetime(2099, 1, 10, 12, tzinfo=timezone.utc)
    effective_date = date(2099, 1, 11)
    before = _ownership_snapshot(owner_id, other_id)

    calls = (
        lambda: PlanService.preview_revision(
            other_id, plan.id, changes, effective_date, now=now
        ),
        lambda: PlanService.apply_revision(
            other_id,
            plan.id,
            changes,
            effective_date,
            '0' * 64,
            reason='user_edit',
            now=now,
        ),
        lambda: PlanService.pause(other_id, plan.id, reason='not mine', now=now),
        lambda: PlanService.complete(other_id, plan.id, now=now),
        lambda: PlanService.archive(other_id, plan.id, reason='not mine', now=now),
        lambda: PlanService.preview_resume(
            other_id, plan.id, date(2099, 1, 15), now=now
        ),
        lambda: PlanService.resume(
            other_id,
            plan.id,
            date(2099, 1, 15),
            '0' * 64,
            now=now,
        ),
        lambda: PlanService.finish_observe(
            other_id,
            observe.id,
            now=datetime(2099, 3, 9, 12, tzinfo=timezone.utc),
        ),
    )
    for call in calls:
        with pytest.raises(PlanNotFoundError, match='plan not found'):
            call()

    db.session.expire_all()
    assert _ownership_snapshot(owner_id, other_id) == before


@pytest.mark.parametrize('activation', ['draft', 'activate'])
def test_create_from_preview_generator_failure_preserves_onboarding_atomically(
    db_session, test_user, monkeypatch, activation,
):
    generation_input = PlanGenerationInput(
        mode='reduce',
        start_date=date(2099, 5, 1),
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    )
    preview = PlanScheduleGenerator.generate(generation_input)
    onboarding = OnboardingDraft(
        user_id=test_user.id,
        current_step='review',
        structured_payload={'intention': 'reduce', 'pace': 'steady'},
    )
    db_session.add(onboarding)
    db_session.commit()
    onboarding_snapshot = (
        onboarding.id,
        onboarding.current_step,
        dict(onboarding.structured_payload),
    )

    def fail_generation(cls, generation_input, *, reference_date=None):
        raise PlanValidationError({'schedule': 'injected generation failure'})

    monkeypatch.setattr(
        PlanScheduleGenerator,
        'generate',
        classmethod(fail_generation),
    )
    with pytest.raises(PlanValidationError) as caught:
        PlanService.create_from_preview(
            test_user.id,
            generation_input,
            baseline_source='manual',
            preview_digest=preview.digest,
            activation=activation,
        )
    assert caught.value.field_errors == {
        'schedule': 'injected generation failure'
    }

    persisted_onboarding = OnboardingDraft.query.filter_by(
        user_id=test_user.id
    ).one()
    assert (
        persisted_onboarding.id,
        persisted_onboarding.current_step,
        persisted_onboarding.structured_payload,
    ) == onboarding_snapshot
    assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
    assert PlanRevision.query.count() == 0
    assert PlanDay.query.count() == 0
    assert PlanStatusEvent.query.count() == 0


def test_resume_preview_detects_source_day_drift_without_partial_resume(
    db_session, test_user, monkeypatch,
):
    plan = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(
            mode='reduce',
            start_date=date(2099, 1, 1),
            baseline_pouches=Decimal('8.00'),
            baseline_mg=Decimal('48.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            pace='steady',
            end_target_pouches=2,
        ),
        baseline_source='manual',
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    _activate_at(
        monkeypatch,
        test_user.id,
        plan.id,
        initial.preview_digest,
        datetime(2099, 1, 1, 12, tzinfo=timezone.utc),
    )
    PlanService.pause(
        test_user.id,
        plan.id,
        reason='pause for drift test',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )
    resume_date = date(2099, 1, 15)
    now = datetime(2099, 1, 12, 12, tzinfo=timezone.utc)
    preview = PlanService.preview_resume(
        test_user.id, plan.id, resume_date, now=now
    )

    source_day = PlanDay.query.filter(
        PlanDay.plan_id == plan.id,
        PlanDay.local_date > date(2099, 1, 10),
    ).order_by(PlanDay.local_date).first()
    source_day.target_pouches -= 1
    source_day.nicotine_ceiling_mg = (
        Decimal(source_day.target_pouches) * Decimal('6.00')
    )
    db_session.commit()
    drifted_snapshot = _persisted_plan_graph(test_user.id)
    drifted_active_revision_id = plan.active_revision_id

    with pytest.raises(PreviewStaleError, match='preview digest is stale'):
        PlanService.resume(
            test_user.id,
            plan.id,
            resume_date,
            preview.digest,
            now=now,
        )

    db.session.expire_all()
    persisted = db.session.get(ReductionPlan, plan.id)
    assert persisted.status == 'paused'
    assert persisted.active_slot is None
    assert persisted.active_revision_id == drifted_active_revision_id
    assert _persisted_plan_graph(test_user.id) == drifted_snapshot
    assert PlanRevision.query.filter_by(
        plan_id=plan.id, reason='resume'
    ).count() == 0
    assert PlanStatusEvent.query.filter_by(
        plan_id=plan.id, reason='resumed'
    ).count() == 0


def _exact_day_rows_through(plan_id, through_date):
    return [
        (
            row.id,
            row.plan_id,
            row.revision_id,
            row.local_date,
            row.target_pouches,
            row.nicotine_ceiling_mg,
            row.created_at,
        )
        for row in PlanDay.query.filter(
            PlanDay.plan_id == plan_id,
            PlanDay.local_date <= through_date,
        ).order_by(PlanDay.local_date)
    ]


def test_revision_at_exact_non_midnight_reset_protects_the_new_day(
    db_session, test_user, monkeypatch,
):
    db_session.add(UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    ))
    db_session.commit()
    plan = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(
            mode='reduce',
            start_date=date(2099, 1, 1),
            baseline_pouches=Decimal('8.00'),
            baseline_mg=Decimal('48.00'),
            baseline_mg_per_pouch=Decimal('6.00'),
            pace='steady',
            end_target_pouches=2,
        ),
        baseline_source='manual',
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    _activate_at(
        monkeypatch,
        test_user.id,
        plan.id,
        initial.preview_digest,
        datetime(2099, 1, 1, 4, tzinfo=timezone.utc),
    )
    reset_instant = datetime(2099, 1, 10, 4, tzinfo=timezone.utc)
    changes = {
        'pace': 'focused',
        'duration_days': 28,
        'end_target_pouches': 1,
    }
    protected_before = _exact_day_rows_through(plan.id, date(2099, 1, 10))

    with pytest.raises(PlanValidationError) as caught:
        PlanService.preview_revision(
            test_user.id,
            plan.id,
            changes,
            date(2099, 1, 10),
            now=reset_instant,
        )
    assert caught.value.field_errors == {
        'effective_date': 'must be after the current user day'
    }

    preview = PlanService.preview_revision(
        test_user.id,
        plan.id,
        changes,
        date(2099, 1, 11),
        now=reset_instant,
    )
    assert preview.days[0].local_date == date(2099, 1, 11)
    PlanService.apply_revision(
        test_user.id,
        plan.id,
        changes,
        date(2099, 1, 11),
        preview.digest,
        reason='user_edit',
        now=reset_instant,
    )

    assert _exact_day_rows_through(
        plan.id, date(2099, 1, 10)
    ) == protected_before


def test_schedule_boundary_change_locks_user_then_preferences_and_commits_once(
    app, db_session, test_user,
):
    user_id = test_user.id
    db_session.expunge_all()
    lock_requests = []
    commits = []

    def _capture_statement(
        connection, clauseelement, multiparams, params, execution_options,
    ):
        descriptions = getattr(clauseelement, 'column_descriptions', ())
        entity = descriptions[0].get('entity') if descriptions else None
        if entity in {User, UserPreferences}:
            lock_requests.append((
                entity,
                getattr(clauseelement, '_for_update_arg', None) is not None,
            ))

    def _capture_commit(session):
        commits.append(session)

    session = db_session()
    engine = session.get_bind()
    event.listen(engine, 'before_execute', _capture_statement)
    event.listen(session, 'after_commit', _capture_commit)
    try:
        scheduled = PreferenceService().schedule_day_boundary_change(
            user_id,
            'America/Los_Angeles',
            '04:00',
            now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
        )
    finally:
        event.remove(engine, 'before_execute', _capture_statement)
        event.remove(session, 'after_commit', _capture_commit)

    assert lock_requests[:2] == [
        (User, True),
        (UserPreferences, True),
    ]
    assert len(commits) == 1
    assert scheduled.user_id == user_id
    assert UserPreferences.query.filter_by(user_id=user_id).count() == 1


def test_schedule_boundary_change_validates_before_writing(db_session, test_user):
    service = PreferenceService()

    with pytest.raises(pytz.exceptions.UnknownTimeZoneError):
        service.schedule_day_boundary_change(
            test_user.id, 'Not/A_Real_Zone', '04:00'
        )
    with pytest.raises(ValueError, match='HH:MM'):
        service.schedule_day_boundary_change(test_user.id, 'UTC', '4:00')
    with pytest.raises(ValueError, match='user not found'):
        service.schedule_day_boundary_change(999999, 'UTC', '04:00')

    assert UserPreferences.query.filter_by(user_id=test_user.id).first() is None
    assert test_user.timezone == 'UTC'


def test_schedule_boundary_change_riyadh_to_los_angeles_is_deferred(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()

    scheduled = PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )

    assert test_user.timezone == 'Asia/Riyadh'
    assert scheduled.daily_reset_time == time(4, 0)
    assert scheduled.pending_timezone == 'America/Los_Angeles'
    assert scheduled.pending_daily_reset_time == time(4, 0)
    assert scheduled.boundary_change_effective_at_utc == datetime(
        2099, 1, 11, 12
    )
    assert scheduled.boundary_change_target_local_date == date(2099, 1, 11)


@pytest.mark.parametrize(
    ('applied_timezone', 'applied_reset', 'requested_timezone',
     'requested_reset', 'now', 'effective_at', 'target_date'),
    [
        (
            'America/Los_Angeles', time(4, 0), 'Asia/Riyadh', '04:00',
            datetime(2099, 1, 10, 20, tzinfo=timezone.utc),
            datetime(2099, 1, 12, 1), date(2099, 1, 12),
        ),
        (
            'America/New_York', time(1, 30), 'America/New_York', '02:30',
            datetime(2026, 3, 7, 12, tzinfo=timezone.utc),
            datetime(2026, 3, 8, 7, 30), date(2026, 3, 8),
        ),
        (
            'America/New_York', time(0, 30), 'America/New_York', '01:30',
            datetime(2026, 10, 31, 12, tzinfo=timezone.utc),
            datetime(2026, 11, 1, 5, 30), date(2026, 11, 1),
        ),
    ],
)
def test_schedule_boundary_change_uses_first_requested_reset_after_old_day(
    db_session,
    test_user,
    applied_timezone,
    applied_reset,
    requested_timezone,
    requested_reset,
    now,
    effective_at,
    target_date,
):
    test_user.timezone = applied_timezone
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=applied_reset
    )
    db_session.add(preferences)
    db_session.commit()

    scheduled = PreferenceService().schedule_day_boundary_change(
        test_user.id, requested_timezone, requested_reset, now=now
    )

    assert scheduled.boundary_change_effective_at_utc == effective_at
    assert scheduled.boundary_change_target_local_date == target_date
    assert test_user.timezone == applied_timezone
    assert scheduled.daily_reset_time == applied_reset


def test_rescheduling_replaces_pending_values_from_still_applied_clock(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    service = PreferenceService()
    service.schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )

    rescheduled = service.schedule_day_boundary_change(
        test_user.id,
        'UTC',
        '04:00',
        now=datetime(2099, 1, 10, 12),
    )

    assert test_user.timezone == 'Asia/Riyadh'
    assert rescheduled.daily_reset_time == time(4, 0)
    assert rescheduled.pending_timezone == 'UTC'
    assert rescheduled.pending_daily_reset_time == time(4, 0)
    assert rescheduled.boundary_change_effective_at_utc == datetime(
        2099, 1, 11, 4
    )
    assert rescheduled.boundary_change_target_local_date == date(2099, 1, 11)
    before_invalid = _preference_snapshot(test_user, rescheduled)

    with pytest.raises(ValueError, match='HH:MM'):
        service.schedule_day_boundary_change(test_user.id, 'UTC', '04:00:00')
    assert _preference_snapshot(test_user, rescheduled) == before_invalid


def test_same_value_boundary_change_is_scheduled_deterministically(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()

    scheduled = PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'Asia/Riyadh',
        '04:00',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )

    assert scheduled.pending_timezone == 'Asia/Riyadh'
    assert scheduled.pending_daily_reset_time == time(4, 0)
    assert scheduled.boundary_change_effective_at_utc == datetime(
        2099, 1, 11, 1
    )
    assert scheduled.boundary_change_target_local_date == date(2099, 1, 11)


def _preference_snapshot(user, preferences):
    return (
        user.timezone,
        preferences.daily_reset_time,
        preferences.pending_timezone,
        preferences.pending_daily_reset_time,
        preferences.boundary_change_effective_at_utc,
        preferences.boundary_change_target_local_date,
    )


def test_apply_boundary_change_without_pending_state_is_mutation_free(
    db_session, test_user,
):
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    before = _preference_snapshot(test_user, preferences)

    assert PlanService.apply_boundary_change(
        test_user.id, now=datetime(2099, 1, 10, 12)
    ) is None
    assert _preference_snapshot(test_user, preferences) == before

    db_session.delete(test_user)
    db_session.commit()
    with pytest.raises(PlanNotFoundError):
        PlanService.apply_boundary_change(
            test_user.id, now=datetime(2099, 1, 10, 12)
        )


def test_apply_boundary_change_before_effective_instant_is_mutation_free(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )
    before = _preference_snapshot(test_user, preferences)

    assert PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 1, 11, 11, 59, 59, tzinfo=timezone.utc),
    ) is None
    assert _preference_snapshot(test_user, preferences) == before


def _active_targeted_plan(test_user):
    generation_input = PlanGenerationInput(
        mode='reduce',
        start_date=date(2099, 1, 1),
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    )
    plan = PlanService.create_draft(
        test_user.id, generation_input, baseline_source='manual'
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, initial.preview_digest)
    return plan, initial


def test_nicotine_first_plan_persists_exact_target_and_null_pouch_days(
    db_session, test_user,
):
    generation_input = PlanGenerationInput(
        mode='reduce',
        start_date=date(2099, 1, 1),
        baseline_mg=Decimal('40.00'),
        pace='steady',
        end_target_mg=Decimal('20.00'),
    )

    plan = PlanService.create_draft(
        test_user.id, generation_input, baseline_source='manual'
    )
    revision = PlanRevision.query.filter_by(plan_id=plan.id).one()
    days = PlanDay.query.filter_by(plan_id=plan.id).order_by(
        PlanDay.local_date
    ).all()

    assert plan.end_target_mg == Decimal('20.00')
    assert plan.end_target_pouches is None
    assert revision.end_target_mg == Decimal('20.00')
    assert revision.end_target_pouches is None
    assert revision.generation_inputs['target_basis'] == 'nicotine_mg'
    assert revision.generation_inputs['end_target_mg'] == '20.00'
    assert days[0].nicotine_ceiling_mg == Decimal('40.00')
    assert days[-1].nicotine_ceiling_mg == Decimal('20.00')
    assert {day.target_pouches for day in days} == {None}

    activated = PlanService.activate(
        test_user.id, plan.id, revision.preview_digest
    )
    assert activated.status == 'active'


def test_first_nicotine_revision_preserves_started_rows_and_legacy_metadata(
    db_session, test_user,
):
    initial_input = PlanGenerationInput(
        mode='reduce',
        start_date=date(2099, 1, 1),
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    )
    plan = PlanService.create_draft(
        test_user.id, initial_input, baseline_source='manual'
    )
    initial_revision = PlanRevision.query.filter_by(plan_id=plan.id).one()
    assert initial_revision.end_target_mg == Decimal('12.00')
    assert plan.end_target_mg == Decimal('12.00')
    PlanService.activate(
        test_user.id, plan.id, initial_revision.preview_digest,
    )
    effective_date = date(2099, 1, 3)
    protected_before = _day_snapshot(
        plan.id, lambda row: row.local_date < effective_date
    )
    changes = {'end_target_mg': Decimal('10.00')}
    preview = PlanService.preview_revision(
        test_user.id,
        plan.id,
        changes,
        effective_date,
        now=datetime(2099, 1, 1, 12, tzinfo=timezone.utc),
    )

    revised = PlanService.apply_revision(
        test_user.id,
        plan.id,
        changes,
        effective_date,
        preview.digest,
        reason='user_edit',
        now=datetime(2099, 1, 1, 12, tzinfo=timezone.utc),
    )

    assert _day_snapshot(
        plan.id, lambda row: row.local_date < effective_date
    ) == protected_before
    future = PlanDay.query.filter(
        PlanDay.plan_id == plan.id,
        PlanDay.local_date >= effective_date,
    ).order_by(PlanDay.local_date).all()
    assert future[0].nicotine_ceiling_mg == Decimal('48.00')
    assert future[-1].nicotine_ceiling_mg == Decimal('10.00')
    assert {day.target_pouches for day in future} == {None}
    assert revised.end_target_mg == Decimal('10.00')
    assert plan.end_target_mg == Decimal('10.00')
    assert initial_revision.end_target_pouches == 2
    assert initial_revision.end_target_mg == Decimal('12.00')


def _day_snapshot(plan_id, predicate=None):
    query = PlanDay.query.filter_by(plan_id=plan_id)
    rows = query.order_by(PlanDay.local_date).all()
    if predicate is not None:
        rows = [row for row in rows if predicate(row)]
    return [
        (
            row.id,
            row.revision_id,
            row.local_date,
            row.target_pouches,
            row.nicotine_ceiling_mg,
        )
        for row in rows
    ]


def test_due_targeted_boundary_change_preserves_started_days_and_redates_future(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    plan, initial = _active_targeted_plan(test_user)
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )
    protected_before = _day_snapshot(
        plan.id, lambda row: row.local_date <= date(2099, 1, 11)
    )
    future_before = _day_snapshot(
        plan.id, lambda row: row.local_date > date(2099, 1, 11)
    )
    future_targets = [row[3:] for row in future_before]
    protected_payload = [
        {
            'id': row[0],
            'revision_id': row[1],
            'local_date': row[2].isoformat(),
            'target_pouches': row[3],
            'nicotine_ceiling_mg': format(row[4], '.2f'),
        }
        for row in protected_before
    ]
    redated_payload = [
        {
            'local_date': row[2].isoformat(),
            'target_pouches': row[3],
            'nicotine_ceiling_mg': format(row[4], '.2f'),
        }
        for row in future_before
    ]
    expected_digest = hashlib.sha256(json.dumps(
        {
            'plan_id': plan.id,
            'pending_timezone': 'America/Los_Angeles',
            'pending_daily_reset_time': '04:00:00',
            'boundary_change_effective_at_utc': '2099-01-11T12:00:00',
            'boundary_change_target_local_date': '2099-01-11',
            'protected_days': protected_payload,
            'future_days': redated_payload,
        },
        sort_keys=True,
        separators=(',', ':'),
    ).encode()).hexdigest()

    revision = PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 1, 11, 12, tzinfo=timezone.utc),
    )

    assert revision is not None
    assert revision.reason == 'boundary_change'
    assert revision.effective_date == date(2099, 1, 12)
    assert revision.target_date == date(2099, 2, 18)
    assert revision.pace == 'steady'
    assert revision.end_target_pouches == 2
    assert revision.preview_digest == expected_digest
    assert revision.generation_inputs['stage_targets'] is not None
    assert revision.generation_inputs['start_date'] == '2099-01-12'
    assert revision.generation_inputs['target_date'] == '2099-02-18'
    assert revision.generation_inputs['duration_days'] == len(future_before)
    normalized_pairs = []
    for stage in revision.generation_inputs['stage_targets']:
        stage_start = date.fromisoformat(stage['start_date'])
        stage_end = date.fromisoformat(stage['end_date'])
        for offset in range((stage_end - stage_start).days + 1):
            normalized_pairs.append((
                stage_start + timedelta(days=offset),
                stage['target_pouches'],
                Decimal(stage['nicotine_ceiling_mg']),
            ))
    assert normalized_pairs == [
        (row[2], row[3], row[4]) for row in future_before
    ]
    assert _day_snapshot(
        plan.id, lambda row: row.local_date <= date(2099, 1, 11)
    ) == protected_before
    future_after = _day_snapshot(
        plan.id, lambda row: row.local_date > date(2099, 1, 11)
    )
    assert [row[2] for row in future_after] == [
        row[2] for row in future_before
    ]
    assert [row[3:] for row in future_after] == future_targets
    assert all(row[1] == revision.id for row in future_after)

    db_session.refresh(plan)
    db_session.refresh(test_user)
    db_session.refresh(preferences)
    assert plan.active_revision_id == revision.id
    assert plan.target_date == date(2099, 2, 18)
    assert test_user.timezone == 'America/Los_Angeles'
    assert preferences.daily_reset_time == time(4, 0)
    assert _preference_snapshot(test_user, preferences)[2:] == (None,) * 4
    revision_count = PlanRevision.query.filter_by(plan_id=plan.id).count()
    all_days = _day_snapshot(plan.id)

    assert PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 1, 11, 12, tzinfo=timezone.utc),
    ) is None
    assert PlanRevision.query.filter_by(plan_id=plan.id).count() == revision_count
    assert _day_snapshot(plan.id) == all_days
    assert initial.id != revision.id


def test_reverse_boundary_change_protects_new_target_clock_day(
    db_session, test_user,
):
    test_user.timezone = 'America/Los_Angeles'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    plan, _ = _active_targeted_plan(test_user)
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'Asia/Riyadh',
        '04:00',
        now=datetime(2099, 1, 10, 20, tzinfo=timezone.utc),
    )
    protected_before = _day_snapshot(
        plan.id, lambda row: row.local_date <= date(2099, 1, 12)
    )
    future_targets = [
        row[3:] for row in _day_snapshot(
            plan.id, lambda row: row.local_date > date(2099, 1, 12)
        )
    ]

    revision = PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 1, 12, 1, tzinfo=timezone.utc),
    )

    assert revision.effective_date == date(2099, 1, 13)
    assert _day_snapshot(
        plan.id, lambda row: row.local_date <= date(2099, 1, 12)
    ) == protected_before
    future_after = _day_snapshot(
        plan.id, lambda row: row.local_date > date(2099, 1, 12)
    )
    assert [row[3:] for row in future_after] == future_targets
    all_dates = [row[2] for row in _day_snapshot(plan.id)]
    assert len(all_dates) == len(set(all_dates))
    assert date(2099, 1, 12) in all_dates
    assert date(2099, 1, 13) in all_dates


def test_delayed_boundary_apply_protects_days_started_since_due_in_both_clocks(
    db_session, test_user,
):
    test_user.timezone = 'America/Los_Angeles'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    plan, _ = _active_targeted_plan(test_user)
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'Asia/Riyadh',
        '04:00',
        now=datetime(2099, 1, 10, 20, tzinfo=timezone.utc),
    )
    protected_before = _day_snapshot(
        plan.id, lambda row: row.local_date <= date(2099, 1, 13)
    )
    future_targets = [
        row[3:] for row in _day_snapshot(
            plan.id, lambda row: row.local_date > date(2099, 1, 13)
        )
    ]

    revision = PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 1, 13, 1, tzinfo=timezone.utc),
    )

    assert revision.effective_date == date(2099, 1, 14)
    assert _day_snapshot(
        plan.id, lambda row: row.local_date <= date(2099, 1, 13)
    ) == protected_before
    assert [
        row[3:] for row in _day_snapshot(
            plan.id, lambda row: row.local_date > date(2099, 1, 13)
        )
    ] == future_targets


def test_boundary_change_renormalizes_an_explicit_stage_cut_by_protected_day(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    generation_input = PlanGenerationInput(
        mode='reduce',
        start_date=date(2099, 1, 1),
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
        stage_targets=(
            StageTarget(
                date(2099, 1, 1), date(2099, 1, 10), 8, Decimal('48.00')
            ),
            StageTarget(
                date(2099, 1, 11), date(2099, 1, 20), 7, Decimal('42.00')
            ),
            StageTarget(
                date(2099, 1, 21), date(2099, 2, 10), 4, Decimal('24.00')
            ),
            StageTarget(
                date(2099, 2, 11), date(2099, 2, 18), 2, Decimal('12.00')
            ),
        ),
    )
    plan = PlanService.create_draft(
        test_user.id, generation_input, baseline_source='manual'
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, initial.preview_digest)
    january_11_before = _day_snapshot(
        plan.id, lambda row: row.local_date == date(2099, 1, 11)
    )
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )

    revision = PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 1, 11, 12, tzinfo=timezone.utc),
    )

    assert _day_snapshot(
        plan.id, lambda row: row.local_date == date(2099, 1, 11)
    ) == january_11_before
    assert revision.generation_inputs['stage_targets'] == [
        {
            'start_date': '2099-01-12',
            'end_date': '2099-01-20',
            'target_pouches': 7,
            'nicotine_ceiling_mg': '42.00',
        },
        {
            'start_date': '2099-01-21',
            'end_date': '2099-02-10',
            'target_pouches': 4,
            'nicotine_ceiling_mg': '24.00',
        },
        {
            'start_date': '2099-02-11',
            'end_date': '2099-02-18',
            'target_pouches': 2,
            'nicotine_ceiling_mg': '12.00',
        },
    ]


def test_observe_boundary_change_keeps_future_target_pairs_null(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    plan = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(mode='observe', start_date=date(2099, 1, 1)),
        baseline_source='observe',
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, initial.preview_digest)
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 1, 2, 12, tzinfo=timezone.utc),
    )
    protected_before = _day_snapshot(
        plan.id, lambda row: row.local_date <= date(2099, 1, 3)
    )

    revision = PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 1, 3, 12, tzinfo=timezone.utc),
    )

    assert revision.reason == 'boundary_change'
    assert revision.effective_date == date(2099, 1, 4)
    assert revision.target_date == date(2099, 1, 7)
    assert revision.pace is None
    assert revision.end_target_pouches is None
    assert revision.generation_inputs['stage_targets'] is None
    assert _day_snapshot(
        plan.id, lambda row: row.local_date <= date(2099, 1, 3)
    ) == protected_before
    future = _day_snapshot(
        plan.id, lambda row: row.local_date > date(2099, 1, 3)
    )
    assert all(row[1] == revision.id for row in future)
    assert all(row[3] is None and row[4] is None for row in future)


def test_due_boundary_change_without_active_plan_applies_preferences_only(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )

    result = PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 1, 11, 12, tzinfo=timezone.utc),
    )

    assert result is None
    assert test_user.timezone == 'America/Los_Angeles'
    assert preferences.daily_reset_time == time(4, 0)
    assert _preference_snapshot(test_user, preferences)[2:] == (None,) * 4
    assert PlanRevision.query.count() == 0
    assert PlanDay.query.count() == 0


def test_due_boundary_change_with_no_future_days_preserves_plan_history(
    db_session, test_user,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    plan, initial = _active_targeted_plan(test_user)
    days_before = _day_snapshot(plan.id)
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 2, 20, 12, tzinfo=timezone.utc),
    )

    result = PlanService.apply_boundary_change(
        test_user.id,
        now=datetime(2099, 2, 21, 12, tzinfo=timezone.utc),
    )

    assert result is None
    assert plan.active_revision_id == initial.id
    assert plan.target_date == date(2099, 2, 18)
    assert PlanRevision.query.filter_by(plan_id=plan.id).count() == 1
    assert _day_snapshot(plan.id) == days_before
    assert test_user.timezone == 'America/Los_Angeles'
    assert _preference_snapshot(test_user, preferences)[2:] == (None,) * 4


def test_incomplete_pending_boundary_state_raises_and_is_preserved(
    db_session, test_user,
):
    preferences = UserPreferences(
        user_id=test_user.id,
        daily_reset_time=time(4, 0),
        pending_timezone='America/Los_Angeles',
    )
    db_session.add(preferences)
    db_session.commit()
    before = _preference_snapshot(test_user, preferences)

    with pytest.raises(PlanStateError, match='incomplete'):
        PlanService.apply_boundary_change(
            test_user.id, now=datetime(2099, 1, 11, 12)
        )

    db_session.refresh(test_user)
    db_session.refresh(preferences)
    assert _preference_snapshot(test_user, preferences) == before


def test_corrupt_pending_boundary_state_raises_and_is_preserved(
    db_session, test_user,
):
    preferences = UserPreferences(
        user_id=test_user.id,
        daily_reset_time=time(4, 0),
        pending_timezone='America/Los_Angeles',
        pending_daily_reset_time=time(4, 0),
        boundary_change_effective_at_utc=datetime(2099, 1, 11, 13),
        boundary_change_target_local_date=date(2099, 1, 11),
    )
    db_session.add(preferences)
    db_session.commit()
    before = _preference_snapshot(test_user, preferences)

    with pytest.raises(PlanStateError, match='corrupt'):
        PlanService.apply_boundary_change(
            test_user.id, now=datetime(2099, 1, 11, 13)
        )

    db_session.refresh(test_user)
    db_session.refresh(preferences)
    assert _preference_snapshot(test_user, preferences) == before


@pytest.mark.parametrize(
    ('pending_reset', 'effective_at'),
    [
        (time(4, 0, 30), datetime(2099, 1, 11, 4, 0, 30)),
        (time(4, 0, 0, 1), datetime(2099, 1, 11, 4, 0, 0, 1)),
    ],
)
def test_subminute_pending_reset_is_corrupt_and_rolls_back_exact_state(
    db_session, test_user, pending_reset, effective_at,
):
    if pending_reset.microsecond and db.engine.dialect.name == 'mysql':
        pytest.skip(
            'MySQL TIME/DATETIME columns use fsp=0 and normalize microseconds'
        )
    preferences = UserPreferences(
        user_id=test_user.id,
        daily_reset_time=time(0, 0),
        pending_timezone='UTC',
        pending_daily_reset_time=pending_reset,
        boundary_change_effective_at_utc=effective_at,
        boundary_change_target_local_date=date(2099, 1, 11),
    )
    db_session.add(preferences)
    db_session.commit()
    before = _preference_snapshot(test_user, preferences)

    with pytest.raises(PlanStateError, match='corrupt'):
        PlanService.apply_boundary_change(
            test_user.id,
            now=effective_at.replace(tzinfo=timezone.utc),
        )

    db_session.refresh(test_user)
    db_session.refresh(preferences)
    assert _preference_snapshot(test_user, preferences) == before
    assert PlanRevision.query.count() == 0
    assert PlanDay.query.count() == 0


def test_boundary_change_failure_after_flush_rolls_back_everything(
    db_session, test_user, monkeypatch,
):
    test_user.timezone = 'Asia/Riyadh'
    preferences = UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    )
    db_session.add(preferences)
    db_session.commit()
    plan, initial = _active_targeted_plan(test_user)
    PreferenceService().schedule_day_boundary_change(
        test_user.id,
        'America/Los_Angeles',
        '04:00',
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )
    preference_before = _preference_snapshot(test_user, preferences)
    plan_before = (plan.active_revision_id, plan.target_date)
    days_before = _day_snapshot(plan.id)

    def _flush_then_fail():
        db_session.flush()
        raise RuntimeError('injected commit failure')

    monkeypatch.setattr(db_session, 'commit', _flush_then_fail)

    with pytest.raises(RuntimeError, match='injected commit failure'):
        PlanService.apply_boundary_change(
            test_user.id,
            now=datetime(2099, 1, 11, 12, tzinfo=timezone.utc),
        )

    db_session.refresh(test_user)
    db_session.refresh(preferences)
    db_session.refresh(plan)
    assert _preference_snapshot(test_user, preferences) == preference_before
    assert (plan.active_revision_id, plan.target_date) == plan_before
    assert PlanRevision.query.filter_by(plan_id=plan.id).count() == 1
    assert PlanRevision.query.filter_by(plan_id=plan.id).one().id == initial.id
    assert _day_snapshot(plan.id) == days_before
