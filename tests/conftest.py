"""
Pytest configuration and shared fixtures for the test suite.
"""
import os

# Safety net: tests must never run against a file-backed development or
# production database. create_app() reads FLASK_ENV lazily via get_config(),
# so forcing it here makes even a bare create_app() resolve to TestingConfig
# (in-memory SQLite). load_dotenv() does not override existing variables.
os.environ['FLASK_ENV'] = 'testing'

import select
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path

import pytest

from app import create_app, db
from models import User, Pouch, Log, Goal
from services import user_service, log_service, goal_service

PROJECT_ROOT = Path(__file__).resolve().parent.parent
TEST_USER_EMAIL = 'test@example.com'
TEST_USER_PASSWORD = 'password123'


def pytest_addoption(parser):
    """Global database backend selection for migration tests.

    Ordinary SQLite runs (the default) never inspect TEST_MYSQL_URL; that
    variable is only read on the explicit --db=mysql path.
    """
    parser.addoption(
        '--db',
        action='store',
        default='sqlite',
        choices=('sqlite', 'mysql'),
        help="Database backend for migration tests (default: sqlite).",
    )


def pytest_sessionstart(session):
    """Hard, non-zero gate for --db=mysql without credentials.

    A missing TEST_MYSQL_URL must fail the command clearly; it must never be
    reported as a passing skip.
    """
    backend = session.config.getoption('--db')
    if backend == 'mysql' and not os.environ.get('TEST_MYSQL_URL'):
        pytest.exit(
            'NOT_RUN: --db=mysql requires TEST_MYSQL_URL pointing at a '
            'disposable mysql+pymysql database whose name begins with '
            'nicotine_tracker_test_. MySQL gate not run.',
            returncode=2,
        )


@pytest.fixture(scope='function')
def app():
    """Create an isolated application instance for testing.

    Always loads the testing configuration and explicitly pins the
    in-memory SQLite database, so a test can never touch a file-backed
    development or production database.
    """
    app = create_app('testing')
    app.config.update({
        'TESTING': True,
        'SQLALCHEMY_DATABASE_URI': 'sqlite:///:memory:',
        'SECRET_KEY': 'test-secret-key',
        'MAIL_SUPPRESS_SEND': True,
        'WTF_CSRF_ENABLED': False,
    })

    with app.app_context():
        import models  # noqa: F401  ensure every model is registered before create_all
        db.create_all()
        yield app
        db.session.rollback()
        if db.engine.dialect.name == 'sqlite':
            # reduction_plan.active_revision_id intentionally forms a cycle
            # with plan_revision.plan_id. SQLite cannot defer that table-level
            # constraint during DROP, so clear persisted pointers in this
            # disposable in-memory database before dropping the schema.
            from models import ReductionPlan
            db.session.query(ReductionPlan).update({
                ReductionPlan.active_revision_id: None
            })
            db.session.commit()
        db.session.remove()
        db.drop_all()
        db.engine.dispose()


@pytest.fixture(scope='function')
def client(app):
    """Create test client."""
    return app.test_client()


@pytest.fixture(scope='function')
def runner(app):
    """Create test CLI runner."""
    return app.test_cli_runner()


@pytest.fixture
def db_session(app):
    """Create database session."""
    with app.app_context():
        yield db.session


@pytest.fixture
def test_user(db_session):
    """Create test user."""
    user = User(
        email=TEST_USER_EMAIL,
        email_verified=True,
        timezone='UTC'
    )

    user.set_password(TEST_USER_PASSWORD)
    db_session.add(user)
    db_session.commit()
    return user


@pytest.fixture
def test_pouch(db_session, test_user):
    """Create test pouch."""
    pouch = Pouch(
        brand='Test Brand',
        nicotine_mg=4,
        is_default=False,
        created_by=test_user.id
    )
    db_session.add(pouch)
    db_session.commit()
    return pouch


@pytest.fixture
def test_log(db_session, test_user, test_pouch):
    """Create test log entry with immutable product snapshots populated,
    exactly as the canonical write paths create it."""
    log = Log(
        user_id=test_user.id,
        quantity=2,
        log_time=datetime.now(timezone.utc),
        notes='Test log entry'
    )
    log_service.assign_log_product(log, pouch_id=test_pouch.id)
    db_session.add(log)
    db_session.commit()
    return log


@pytest.fixture
def test_goal(db_session, test_user):
    """Create test goal."""
    goal = Goal(
        user_id=test_user.id,
        goal_type='daily_pouches',
        target_value=10,
        start_date=datetime.now(timezone.utc).date(),
        end_date=(datetime.now(timezone.utc).date() + timedelta(days=30)),
        is_active=True
    )
    db_session.add(goal)
    db_session.commit()
    return goal


def login_user(client, email=TEST_USER_EMAIL, password=TEST_USER_PASSWORD):
    """Log in through the real login form.

    Authentication for session-protected routes is the Flask session
    cookie the test client stores after this POST; no Bearer token is
    involved.
    """
    return client.post('/auth/login', data={
        'email': email,
        'password': password,
    })


@pytest.fixture
def logged_in_client(client, test_user):
    """Test client authenticated with a real Flask session login."""
    response = login_user(client)
    assert response.status_code in (301, 302), (
        f'expected a redirect to the dashboard after login, got {response.status_code}'
    )
    with client.session_transaction() as session:
        assert session.get('user_id') == test_user.id, 'login did not establish a session'
    return client


@pytest.fixture
def temp_file():
    """Create temporary file for testing."""
    fd, path = tempfile.mkstemp()
    yield path
    os.close(fd)
    os.unlink(path)


@pytest.fixture
def sample_log_data():
    """Sample log data for testing."""
    return {
        'pouch_id': 1,
        'quantity': 2,
        'log_time': datetime.now(timezone.utc).isoformat(),
        'notes': 'Test log entry'
    }


@pytest.fixture
def sample_user_data():
    """Sample user data for testing."""
    return {
        'email': 'newuser@example.com',
        'password': 'securepassword123',
        'confirm_password': 'securepassword123'
    }


# ---------------------------------------------------------------------------
# Live server
# ---------------------------------------------------------------------------
#
# The server runs as a child process so the test suite keeps its own
# in-memory databases. The child pins the testing config to a temporary
# file-backed SQLite database before create_app() builds its engine
# (engines are bound at init_app time, so config updates afterwards are
# too late).
#
# The child owns its port: it binds 127.0.0.1:0 through a retained werkzeug
# make_server, which has already bound and listened when it returns, and only
# then prints the actual port on stdout. The parent never predicts a port, so
# simultaneous servers and occupied ports cannot collide with a prediction.

_LIVE_SERVER_BOOTSTRAP = """
import sys
import config as _config

db_path = sys.argv[1]
_config.TestingConfig.SQLALCHEMY_DATABASE_URI = 'sqlite:///' + db_path

from app import create_app, db
from models import User
from werkzeug.serving import make_server

app = create_app('testing')
app.config.update({'SECRET_KEY': 'test-secret-key', 'MAIL_SUPPRESS_SEND': True})

with app.app_context():
    db.create_all()
    if not User.query.filter_by(email='test@example.com').first():
        user = User(email='test@example.com', email_verified=True, timezone='UTC')
        user.set_password('password123')
        db.session.add(user)
        db.session.commit()

# make_server has already bound and listened when it returns, so the port
# printed here is the child's own OS-assigned port — announced, not predicted.
server = make_server('127.0.0.1', 0, app, threaded=True)
print(server.socket.getsockname()[1], flush=True)
server.serve_forever()
"""

_LIVE_SERVER_READINESS_TIMEOUT = 10.0


def _read_announced_port(process, timeout):
    """Read the port the child prints on stdout, with a bounded wait.

    The child announces its port only after its socket is bound, so this
    never returns a parent-predicted port.
    """
    deadline = time.monotonic() + timeout
    data = b''
    fd = process.stdout.fileno()
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f'live server process exited early with code {process.returncode}'
            )
        ready, _, _ = select.select([fd], [], [], 0.1)
        if not ready:
            continue
        chunk = os.read(fd, 256)
        if not chunk:
            raise RuntimeError('live server exited without announcing a port')
        data += chunk
        if b'\n' in data:
            line = data.split(b'\n', 1)[0].strip()
            try:
                return int(line)
            except ValueError:
                raise RuntimeError(f'live server announced an invalid port: {line!r}')
    raise RuntimeError(f'live server did not announce a port within {timeout:.1f}s')


def _wait_for_server(base_url, process, timeout):
    """Poll until the server answers or the timeout expires."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(
                f'live server process exited early with code {process.returncode}'
            )
        try:
            with urllib.request.urlopen(f'{base_url}/auth/login', timeout=1) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError(f'live server did not answer within {timeout:.1f}s')


def _stop_process(process, timeout=5.0):
    """Terminate the server process, escalating to kill if needed."""
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=timeout)


@contextmanager
def managed_live_server(
    readiness_timeout=_LIVE_SERVER_READINESS_TIMEOUT,
    *,
    popen_factory=subprocess.Popen,
    temp_parent=None,
):
    """Run the Flask app on the child's own OS-assigned loopback port.

    Yields the base URL. Uses a temporary file-backed SQLite database,
    polls for readiness with a bounded timeout, and guarantees process
    and temp-file cleanup. Readiness failures raise with the captured
    server output.

    ``popen_factory`` (keyword-only, default ``subprocess.Popen``) spawns the
    child; ``temp_parent`` (keyword-only, optional) redirects the fixture's
    temporary files into that directory. Cleanup is established before any
    temporary file is allocated, so a failing ``popen_factory`` leaves no
    files behind.
    """
    process = None
    db_path = None
    log_file = None
    try:
        db_fd, db_path = tempfile.mkstemp(suffix='.db', dir=temp_parent)
        os.close(db_fd)
        log_file = tempfile.NamedTemporaryFile(
            mode='w+', suffix='.log', prefix='live-server-', delete=False,
            dir=temp_parent,
        )
        process = popen_factory(
            [sys.executable, '-c', _LIVE_SERVER_BOOTSTRAP, db_path],
            cwd=PROJECT_ROOT,
            stdout=subprocess.PIPE,
            stderr=log_file,
        )
        try:
            port = _read_announced_port(process, readiness_timeout)
            base_url = f'http://127.0.0.1:{port}'
            _wait_for_server(base_url, process, readiness_timeout)
        except Exception:
            _stop_process(process)
            log_file.seek(0)
            diagnostics = log_file.read()[-4000:].strip()
            raise RuntimeError(
                'Live server failed to become ready.\n'
                f'--- captured server output ---\n{diagnostics or "(no output)"}'
            )
        yield base_url
    finally:
        if process is not None:
            _stop_process(process)
            if process.stdout is not None:
                process.stdout.close()
        if log_file is not None:
            log_file.close()
        for path in (db_path, log_file.name if log_file is not None else None):
            if path is None:
                continue
            try:
                os.unlink(path)
            except FileNotFoundError:
                pass


@pytest.fixture(scope='class')
def live_server():
    """Yield the base URL of a live test server with a seeded test user."""
    with managed_live_server() as base_url:
        yield base_url
