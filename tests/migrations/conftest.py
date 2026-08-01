"""Backend selection and fixture preparation for migration tests.

The --db option itself is registered globally in tests/conftest.py. Ordinary
SQLite runs never inspect TEST_MYSQL_URL; the MySQL path is only touched when
--db=mysql is selected explicitly (and tests/conftest.py has already hard-failed
the session if the variable is absent).
"""
import pytest

from tests.migrations import harness


@pytest.fixture(scope='session')
def db_backend(request):
    return request.config.getoption('--db')


@pytest.fixture(scope='session')
def mysql_engine(db_backend):
    """Verified MySQL engine, created only for --db=mysql runs."""
    if db_backend != 'mysql':
        yield None
        return
    engine = harness.create_verified_mysql_engine()
    try:
        yield engine
    finally:
        harness.cleanup_mysql_engine(engine)


@pytest.fixture
def prepare(tmp_path, db_backend, mysql_engine):
    """Factory: prepare a fixture database and return a PreparedDB handle.

    SQLite: loads the committed .sql fixture into a fresh file-backed database
    under tmp_path. MySQL: migrates a verified empty test schema to the
    fixture's starting revision and inserts the same synthetic Python manifest.
    """
    prepared = []

    def _prepare(spec):
        if db_backend == 'sqlite':
            db = harness.prepare_sqlite(spec, tmp_path)
        else:
            db = harness.prepare_mysql(spec, mysql_engine)
        prepared.append(db)
        return db

    yield _prepare

    for db in prepared:
        db.close()
