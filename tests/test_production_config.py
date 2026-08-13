from pathlib import Path

import pytest

from app import create_app
from config import ProductionConfig


ROOT = Path(__file__).resolve().parent.parent
STRONG_SECRET = 'release-test-only-' + ('A7!z' * 10)
LIMITER_SECRET = 'limiter-test-only-' + ('Q9#v' * 10)


def configure_valid_production(monkeypatch):
    values = {
        'SECRET_KEY': STRONG_SECRET,
        'SERVER_NAME': 'nicotinetracker.example',
        'PREFERRED_URL_SCHEME': 'https',
        'SQLALCHEMY_DATABASE_URI': (
            'mysql+pymysql://app:password@db.internal/nicotine_tracker'
        ),
        'RATELIMIT_STORAGE_URI': 'redis://127.0.0.1:6379/4',
        'RATELIMIT_KEY_PREFIX': 'nicotine-release-test-a',
        'RATELIMIT_HMAC_SECRET': LIMITER_SECRET,
        'RATELIMIT_TRUSTED_PROXY_COUNT': 1,
        'PROXY_FIX_X_PROTO_COUNT': 1,
        'LOG_TO_STDOUT': True,
    }
    for name, value in values.items():
        monkeypatch.setattr(ProductionConfig, name, value, raising=False)


@pytest.mark.parametrize('secret', [
    '',
    'dev-secret-key-change-in-production',
    'CHANGE_ME_GENERATE_WITH_SECRETS_TOKEN_URLSAFE_48',
    'a' * 48,
])
def test_production_rejects_weak_session_secrets(monkeypatch, secret):
    configure_valid_production(monkeypatch)
    monkeypatch.setattr(ProductionConfig, 'SECRET_KEY', secret)

    with pytest.raises(RuntimeError, match='strong session secret'):
        create_app('production')


@pytest.mark.parametrize('database_uri', [
    '',
    'sqlite:///instance/nicotine_tracker.db',
    'postgresql://app:password@db.internal/nicotine_tracker',
    'mysql+pymysql://app:password@db.internal',
])
def test_production_requires_named_mysql_database(monkeypatch, database_uri):
    configure_valid_production(monkeypatch)
    monkeypatch.setattr(ProductionConfig, 'SQLALCHEMY_DATABASE_URI', database_uri)

    with pytest.raises(RuntimeError, match='named MySQL database'):
        create_app('production')


def test_production_accepts_mysql_driver_options(monkeypatch):
    configure_valid_production(monkeypatch)
    monkeypatch.setattr(
        ProductionConfig,
        'SQLALCHEMY_DATABASE_URI',
        'mysql+pymysql://app:password@db.internal/nicotine_tracker'
        '?charset=utf8mb4&ssl_ca=%2Fetc%2Fssl%2Fmysql-ca.pem',
    )

    app = create_app('production')

    assert app.config['SQLALCHEMY_DATABASE_URI'].endswith(
        'ssl_ca=%2Fetc%2Fssl%2Fmysql-ca.pem'
    )


@pytest.mark.parametrize(('server_name', 'scheme'), [
    ('', 'https'),
    ('localhost:5050', 'https'),
    ('https://nicotinetracker.example', 'https'),
    ('nicotinetracker.example', 'http'),
])
def test_production_requires_canonical_https_origin(
        monkeypatch, server_name, scheme):
    configure_valid_production(monkeypatch)
    monkeypatch.setattr(ProductionConfig, 'SERVER_NAME', server_name)
    monkeypatch.setattr(ProductionConfig, 'PREFERRED_URL_SCHEME', scheme)

    with pytest.raises(RuntimeError, match='canonical HTTPS origin'):
        create_app('production')


def test_production_uses_exact_proxy_hops(monkeypatch):
    configure_valid_production(monkeypatch)

    app = create_app('production')

    assert app.wsgi_app.x_for == 1
    assert app.wsgi_app.x_proto == 1


@pytest.mark.parametrize(('x_for', 'x_proto'), [
    (0, 1),
    (1, 0),
    (-1, 1),
    (1, -1),
    (True, 1),
])
def test_production_rejects_invalid_proxy_hops(monkeypatch, x_for, x_proto):
    configure_valid_production(monkeypatch)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_TRUSTED_PROXY_COUNT', x_for)
    monkeypatch.setattr(ProductionConfig, 'PROXY_FIX_X_PROTO_COUNT', x_proto)

    with pytest.raises(RuntimeError, match='trusted proxy hops'):
        create_app('production')


def test_production_and_worker_logging_never_create_local_files(
        monkeypatch, tmp_path):
    import logging
    from run_background_tasks import setup_background_logger

    configure_valid_production(monkeypatch)
    monkeypatch.chdir(tmp_path)
    app = create_app('production')
    assert not any(
        isinstance(handler, logging.FileHandler)
        for handler in app.logger.handlers
    )

    worker_logger = logging.getLogger('background_tasks')
    original_handlers = worker_logger.handlers[:]
    worker_logger.handlers.clear()
    try:
        setup_background_logger()
        assert not any(
            isinstance(handler, logging.FileHandler)
            for handler in worker_logger.handlers
        )
        assert not (tmp_path / 'logs').exists()
    finally:
        worker_logger.handlers.clear()
        worker_logger.handlers.extend(original_handlers)


def test_production_environment_example_is_canonical():
    example = (ROOT / '.env.prod.example').read_text()
    keys = {
        line.split('=', 1)[0]
        for line in example.splitlines()
        if line and not line.startswith('#') and '=' in line
    }
    assert {
        'FLASK_ENV', 'SECRET_KEY', 'SERVER_NAME', 'PREFERRED_URL_SCHEME',
        'DATABASE_URL', 'RATELIMIT_STORAGE_URI', 'RATELIMIT_KEY_PREFIX',
        'RATELIMIT_HMAC_SECRET', 'RATELIMIT_TRUSTED_PROXY_COUNT',
        'PROXY_FIX_X_PROTO_COUNT', 'LOG_TO_STDOUT',
    } <= keys
    assert 'RATELIMIT_STORAGE_URI=redis://127.0.0.1:6379/4' in example
    assert 'PYTHONDONTWRITEBYTECODE' not in example
    assert example.count('python3 -c "') == 3
    assert not (ROOT / '.env.production.example').exists()
