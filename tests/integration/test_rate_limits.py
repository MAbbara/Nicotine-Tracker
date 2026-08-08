import pytest
import json
import os
import subprocess
import sys
import time
from flask import jsonify, session
from extensions import limiter

from app import create_app
from config import DevelopmentConfig, ProductionConfig, TestingConfig
from tests.conftest import login_user
from models import User
from extensions import db

TEST_PROD_SECRET = 'task6-test-only-' + ('a9F!' * 8)
TEST_PROD_PREFIX = 'nicotine-prod-20260808-a'


@pytest.mark.parametrize('config_class', [DevelopmentConfig, TestingConfig])
def test_nonproduction_rate_limits_default_to_memory_with_headers(config_class):
    assert config_class.RATELIMIT_STORAGE_URI == 'memory://'
    assert config_class.RATELIMIT_HEADERS_ENABLED is True
    assert config_class.RATELIMIT_ENABLED is True


@pytest.mark.parametrize('storage_uri', [None, '', 'memory://'])
def test_production_rejects_missing_or_process_local_rate_limit_storage(
        monkeypatch, storage_uri):
    monkeypatch.setattr(
        ProductionConfig, 'SQLALCHEMY_DATABASE_URI', 'sqlite:///:memory:'
    )
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_STORAGE_URI', storage_uri)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_KEY_PREFIX', TEST_PROD_PREFIX)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_HMAC_SECRET', TEST_PROD_SECRET)

    with pytest.raises(RuntimeError, match='shared Redis'):
        create_app('production')


def test_production_rejects_missing_limiter_secret_and_prefix(monkeypatch):
    monkeypatch.setattr(
        ProductionConfig, 'SQLALCHEMY_DATABASE_URI', 'sqlite:///:memory:'
    )
    monkeypatch.setattr(
        ProductionConfig, 'RATELIMIT_STORAGE_URI',
        'redis://cache.internal:6379/15',
    )
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_KEY_PREFIX', '')
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_HMAC_SECRET', '')

    with pytest.raises(RuntimeError, match='strong independent limiter secret'):
        create_app('production')


def test_production_rejects_disabled_limiter_or_negative_proxy_trust(monkeypatch):
    monkeypatch.setattr(
        ProductionConfig, 'SQLALCHEMY_DATABASE_URI', 'sqlite:///:memory:'
    )
    monkeypatch.setattr(
        ProductionConfig, 'RATELIMIT_STORAGE_URI',
        'redis://cache.internal:6379/15',
    )
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_KEY_PREFIX', TEST_PROD_PREFIX)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_HMAC_SECRET', TEST_PROD_SECRET)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_ENABLED', False)
    with pytest.raises(RuntimeError, match='must be enabled'):
        create_app('production')

    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_ENABLED', True)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_TRUSTED_PROXY_COUNT', -1)
    with pytest.raises(RuntimeError, match='proxy count'):
        create_app('production')


@pytest.mark.parametrize('storage_uri', [
    'redis://',
    'redis:///0',
    'redis://localhost:6379/0',
    'redis://127.0.0.1:6379/0',
    'redis://cache.internal/0',
    'redis://cache.internal:6379',
    'redis://cache.internal:6379/not-a-db',
])
def test_production_rejects_ambiguous_or_local_redis_endpoints(
        monkeypatch, storage_uri):
    monkeypatch.setattr(
        ProductionConfig, 'SQLALCHEMY_DATABASE_URI', 'sqlite:///:memory:'
    )
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_STORAGE_URI', storage_uri)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_KEY_PREFIX', TEST_PROD_PREFIX)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_HMAC_SECRET', TEST_PROD_SECRET)
    with pytest.raises(RuntimeError, match='concrete Redis endpoint'):
        create_app('production')


@pytest.mark.parametrize('secret', [
    '', 'short-secret', 'change-me-change-me-change-me-change-me',
    'dev-secret-key-change-in-production', 'a' * 32,
    '1234567890' * 4,
])
def test_production_rejects_missing_weak_or_predictable_limiter_secret(
        monkeypatch, secret):
    monkeypatch.setattr(
        ProductionConfig, 'SQLALCHEMY_DATABASE_URI', 'sqlite:///:memory:'
    )
    monkeypatch.setattr(
        ProductionConfig, 'RATELIMIT_STORAGE_URI',
        'redis://cache.internal:6379/3',
    )
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_KEY_PREFIX', TEST_PROD_PREFIX)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_HMAC_SECRET', secret)
    with pytest.raises(RuntimeError, match='strong independent limiter secret'):
        create_app('production')


def test_production_rejects_limiter_secret_equal_to_session_secret(monkeypatch):
    shared = 'test-only-strong-shared-' + ('Z7!' * 8)
    monkeypatch.setattr(
        ProductionConfig, 'SQLALCHEMY_DATABASE_URI', 'sqlite:///:memory:'
    )
    monkeypatch.setattr(
        ProductionConfig, 'RATELIMIT_STORAGE_URI',
        'redis://cache.internal:6379/3',
    )
    monkeypatch.setattr(ProductionConfig, 'SECRET_KEY', shared)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_HMAC_SECRET', shared)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_KEY_PREFIX', TEST_PROD_PREFIX)
    with pytest.raises(RuntimeError, match='independent'):
        create_app('production')


@pytest.mark.parametrize('prefix', [
    '', 'local', 'default', 'nicotine-tracker-local', 'prod',
])
def test_production_rejects_default_local_or_ambiguous_prefix(
        monkeypatch, prefix):
    monkeypatch.setattr(
        ProductionConfig, 'SQLALCHEMY_DATABASE_URI', 'sqlite:///:memory:'
    )
    monkeypatch.setattr(
        ProductionConfig, 'RATELIMIT_STORAGE_URI',
        'redis://cache.internal:6379/3',
    )
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_HMAC_SECRET', TEST_PROD_SECRET)
    monkeypatch.setattr(ProductionConfig, 'RATELIMIT_KEY_PREFIX', prefix)
    with pytest.raises(RuntimeError, match='deployment-unique key prefix'):
        create_app('production')


def test_hmac_identity_is_stable_scoped_and_never_contains_raw_values(app):
    from services.rate_limit_service import hmac_identity

    app.config['RATELIMIT_HMAC_SECRET'] = 'identity-test-secret'
    raw = 'Person+private@example.com'
    with app.app_context():
        email_key = hmac_identity('email', raw)
        repeated = hmac_identity('email', raw)
        token_key = hmac_identity('token', raw)

    assert email_key == repeated
    assert email_key != token_key
    assert raw.casefold() not in email_key.casefold()
    assert email_key.startswith('email:')


def test_user_or_ip_key_prefers_authenticated_session_identity(app):
    from services.rate_limit_service import hmac_identity, user_or_ip_key

    app.config['RATELIMIT_HMAC_SECRET'] = 'identity-test-secret'
    with app.test_request_context('/', environ_base={'REMOTE_ADDR': '192.0.2.9'}):
        anonymous = user_or_ip_key()
        session['user_id'] = 42
        authenticated = user_or_ip_key()
        expected_user = hmac_identity('user', '42')

    assert anonymous.startswith('ip:')
    assert '192.0.2.9' not in anonymous
    assert authenticated == expected_user


def test_forwarded_ip_is_ignored_without_explicit_proxy_trust(app):
    from services.rate_limit_service import trusted_ip_key

    app.config['RATELIMIT_HMAC_SECRET'] = 'identity-test-secret'
    app.add_url_rule('/_test/ip-key', view_func=lambda: jsonify({
        'key': trusted_ip_key(),
    }))
    expected = None
    with app.test_request_context(
            '/', environ_base={'REMOTE_ADDR': '192.0.2.10'}):
        expected = trusted_ip_key()

    response = app.test_client().get(
        '/_test/ip-key',
        environ_base={'REMOTE_ADDR': '192.0.2.10'},
        headers={'X-Forwarded-For': '203.0.113.77'},
    )
    assert response.get_json()['key'] == expected


def test_one_trusted_proxy_uses_one_forwarded_hop(monkeypatch):
    from services.rate_limit_service import hmac_identity, trusted_ip_key

    monkeypatch.setattr(TestingConfig, 'RATELIMIT_TRUSTED_PROXY_COUNT', 1)
    trusted_app = create_app('testing')
    trusted_app.config['RATELIMIT_HMAC_SECRET'] = 'identity-test-secret'
    trusted_app.add_url_rule('/_test/ip-key', view_func=lambda: jsonify({
        'key': trusted_ip_key(),
    }))

    response = trusted_app.test_client().get(
        '/_test/ip-key',
        environ_base={'REMOTE_ADDR': '192.0.2.10'},
        headers={'X-Forwarded-For': '203.0.113.77'},
    )
    with trusted_app.app_context():
        expected = hmac_identity('ip', '203.0.113.77')
    assert response.get_json()['key'] == expected


def test_api_rate_limit_uses_canonical_retryable_envelope_and_retry_after(app):
    app.add_url_rule(
        '/api/_test/limited',
        endpoint='test_api_limited',
        view_func=limiter.limit('1/minute')(
            lambda: jsonify({'ok': True})
        ),
    )
    client = app.test_client()

    assert client.get('/api/_test/limited').status_code == 200
    response = client.get('/api/_test/limited')

    assert response.status_code == 429
    assert int(response.headers['Retry-After']) > 0
    assert response.get_json() == {
        'error': {
            'code': 'rate_limited',
            'message': 'Too many requests. Pause for a moment, then try again.',
            'field_errors': {},
            'retryable': True,
        }
    }


def test_html_rate_limit_is_calm_and_never_leaks_bucket_details(app):
    app.add_url_rule(
        '/_test/limited',
        endpoint='test_html_limited',
        view_func=limiter.limit('1/minute')(
            lambda: '<p>ok</p>'
        ),
    )
    client = app.test_client()

    assert client.get('/_test/limited').status_code == 200
    response = client.get('/_test/limited')
    body = response.get_data(as_text=True).casefold()

    assert response.status_code == 429
    assert int(response.headers['Retry-After']) > 0
    assert 'too many requests' not in body
    assert 'take a short pause' in body
    assert '1 per 1 minute' not in body


def _set_test_limits(app, **limits):
    app.config.update({f'RATELIMIT_{name}': value for name, value in limits.items()})


def _assert_third_is_limited(responses):
    assert [response.status_code for response in responses[:2]] != [429, 429]
    limited = responses[2]
    assert limited.status_code == 429
    assert int(limited.headers['Retry-After']) > 0
    return limited


def test_login_has_independent_hmac_account_and_trusted_ip_buckets(app):
    _set_test_limits(app, AUTH_ACCOUNT='2/minute', AUTH_IP='2/minute')
    client = app.test_client()

    account_responses = [
        client.post('/auth/login', data={
            'email': 'same-account@example.com', 'password': 'wrong-password',
        }, environ_base={'REMOTE_ADDR': f'192.0.2.{index}'})
        for index in (1, 2, 3)
    ]
    _assert_third_is_limited(account_responses)

    ip_responses = [
        client.post('/auth/login', data={
            'email': f'different-{index}@example.com', 'password': 'wrong-password',
        }, environ_base={'REMOTE_ADDR': '198.51.100.20'})
        for index in (1, 2, 3)
    ]
    _assert_third_is_limited(ip_responses)


def test_authenticated_verification_resend_uses_user_not_empty_email_bucket(
        app, db_session, test_user):
    second = User(
        email='second-verification@example.com',
        email_verified=True,
        timezone='UTC',
    )
    second.set_password('password123')
    db_session.add(second)
    db_session.commit()
    _set_test_limits(app, AUTH_ACCOUNT='1/minute', AUTH_IP='20/minute')
    responses = []
    for user_id in (test_user.id, second.id):
        client = app.test_client()
        with client.session_transaction() as stored:
            stored['user_id'] = user_id
        responses.append(client.post('/auth/resend_verification'))

    assert all(response.status_code != 429 for response in responses)


def test_password_recovery_keeps_generic_copy_after_credential_cooldown(
        app, client, test_user):
    _set_test_limits(app, AUTH_ACCOUNT='20/minute', AUTH_IP='40/minute')

    known = [
        client.post('/auth/forgot_password', data={'email': test_user.email},
                    follow_redirects=True)
        for _ in range(4)
    ]
    unknown = [
        client.post('/auth/forgot_password', data={'email': 'missing@example.com'},
                    follow_redirects=True)
        for _ in range(4)
    ]

    generic = 'If an account with that email exists, a password reset link has been sent.'
    assert generic in known[-1].get_data(as_text=True)
    assert generic in unknown[-1].get_data(as_text=True)
    assert 'Too many password reset attempts' not in known[-1].get_data(as_text=True)


def test_authenticated_api_writes_share_one_user_bucket(app, logged_in_client):
    _set_test_limits(app, AUTHENTICATED_WRITE='2/minute')

    responses = [
        logged_in_client.post('/api/check-ins', json={}),
        logged_in_client.post('/api/logs', json={}),
        logged_in_client.post('/api/cravings', json={}),
    ]

    limited = _assert_third_is_limited(responses)
    assert limited.get_json()['error'] == {
        'code': 'rate_limited',
        'message': 'Too many requests. Pause for a moment, then try again.',
        'field_errors': {},
        'retryable': True,
    }


def test_quick_and_bulk_logging_have_stricter_costed_buckets(app, logged_in_client):
    _set_test_limits(
        app,
        AUTHENTICATED_WRITE='100/minute',
        QUICK_ADD='2/minute',
        BULK_ADD='5/minute',
    )
    quick = [logged_in_client.post('/api/quick_add', json={}) for _ in range(3)]
    _assert_third_is_limited(quick)

    first_bulk = logged_in_client.post('/log/bulk', data={
        'log_date': '2026-08-08', 'bulk_text': '1 pouch at 09:00',
    })
    second_bulk = logged_in_client.post('/log/bulk', data={
        'log_date': '2026-08-08', 'bulk_text': '1 pouch at 09:00',
    })
    assert first_bulk.status_code != 429
    assert second_bulk.status_code == 429


def test_notification_actions_have_independent_user_buckets(app, logged_in_client):
    _set_test_limits(
        app,
        AUTHENTICATED_WRITE='100/minute',
        WEEKLY_REPORT='2/minute',
        DISCORD_TEST='2/minute',
    )
    weekly = [
        logged_in_client.post('/settings/notifications/trigger-weekly')
        for _ in range(3)
    ]
    weekly_limited = _assert_third_is_limited(weekly)
    assert weekly_limited.get_json()['error']['code'] == 'rate_limited'
    discord = [
        logged_in_client.post('/settings/test-discord-webhook', json={})
        for _ in range(3)
    ]
    _assert_third_is_limited(discord)


def test_current_password_actions_share_one_bucket(app, logged_in_client):
    _set_test_limits(app, CURRENT_PASSWORD_ACTION='2/minute')
    responses = [
        logged_in_client.post('/settings/account', data={
            'action': 'update_email', 'current_password': 'wrong',
            'new_email': 'one@example.com',
        }),
        logged_in_client.post('/settings/account', data={
            'action': 'change_password', 'current_password': 'wrong',
            'new_password': 'password456', 'confirm_password': 'password456',
        }),
        logged_in_client.post('/settings/account', data={
            'action': 'delete_account', 'password': 'wrong',
            'confirmation': 'delete my account',
        }),
    ]
    _assert_third_is_limited(responses)


def test_plan_preview_and_apply_share_one_user_bucket(app, logged_in_client):
    _set_test_limits(
        app, AUTHENTICATED_WRITE='100/minute', PLAN_MUTATION='2/minute'
    )
    responses = [
        logged_in_client.post('/api/plans/preview', json={}),
        logged_in_client.post('/api/plans', json={}),
        logged_in_client.post('/api/plans/preview', json={}),
    ]
    _assert_third_is_limited(responses)


def test_exports_and_destructive_data_actions_have_separate_buckets(
        app, logged_in_client):
    _set_test_limits(
        app,
        EXPORT='2/minute',
        DESTRUCTIVE='2/minute',
        AUTHENTICATED_WRITE='100/minute',
    )
    exports = [logged_in_client.get('/insights/api/export') for _ in range(3)]
    _assert_third_is_limited(exports)

    destructive = [
        logged_in_client.post('/settings/data', data={
            'action': 'delete_old_logs',
            'retention_days': '30',
            'confirm_delete_logs': 'wrong',
        })
        for _ in range(3)
    ]
    _assert_third_is_limited(destructive)


def test_settings_export_and_destructive_actions_use_separate_buckets(
        app, logged_in_client):
    _set_test_limits(
        app,
        EXPORT='1/minute',
        DESTRUCTIVE='1/minute',
        AUTHENTICATED_WRITE='100/minute',
    )
    first_export = logged_in_client.post('/settings/data', data={
        'action': 'export_data',
    })
    first_destructive = logged_in_client.post('/settings/data', data={
        'action': 'delete_old_logs', 'retention_days': '30',
        'confirm_delete_logs': 'wrong',
    })
    second_export = logged_in_client.post('/settings/data', data={
        'action': 'export_data',
    })
    second_destructive = logged_in_client.post('/settings/data', data={
        'action': 'delete_old_logs', 'retention_days': '30',
        'confirm_delete_logs': 'wrong',
    })
    assert first_export.status_code != 429
    assert first_destructive.status_code != 429
    assert second_export.status_code == 429
    assert second_destructive.status_code == 429


def test_account_delete_uses_destructive_and_current_password_buckets(
        app, logged_in_client):
    _set_test_limits(
        app,
        DESTRUCTIVE='1/minute',
        CURRENT_PASSWORD_ACTION='100/minute',
        AUTHENTICATED_WRITE='100/minute',
    )
    first_delete = logged_in_client.post('/settings/account', data={
        'action': 'delete_account', 'password': 'wrong',
        'confirmation': 'delete my account',
    })
    second_delete = logged_in_client.post('/settings/account', data={
        'action': 'delete_account', 'password': 'wrong',
        'confirmation': 'delete my account',
    })
    assert first_delete.status_code != 429
    assert second_delete.status_code == 429


def test_legacy_and_canonical_craving_posts_share_the_write_bucket(
        app, logged_in_client):
    _set_test_limits(app, AUTHENTICATED_WRITE='2/minute')
    responses = [
        logged_in_client.post('/cravings/cravings', data={}),
        logged_in_client.post('/cravings/api/cravings', json={}),
        logged_in_client.post('/api/cravings', json={}),
    ]
    _assert_third_is_limited(responses)


def test_journey_onboarding_preview_and_apply_share_plan_bucket(
        app, logged_in_client):
    _set_test_limits(
        app, AUTHENTICATED_WRITE='100/minute', PLAN_MUTATION='2/minute'
    )
    responses = [
        logged_in_client.post('/journey/onboarding', data={}),
        logged_in_client.post(
            '/journey/onboarding', data={'form_action': 'confirm'}
        ),
        logged_in_client.post('/journey/onboarding', data={}),
    ]
    _assert_third_is_limited(responses)


def test_email_token_verification_has_token_and_ip_inventory(app):
    _set_test_limits(app, AUTH_ACCOUNT='2/minute', AUTH_IP='20/minute')
    client = app.test_client()
    responses = [
        client.get(
            '/auth/verify_email/repeated-secret-token',
            environ_base={'REMOTE_ADDR': f'192.0.2.{index}'},
        )
        for index in (31, 32, 33)
    ]
    _assert_third_is_limited(responses)


def test_goal_and_catalog_deletions_share_destructive_inventory(
        app, logged_in_client):
    _set_test_limits(
        app, AUTHENTICATED_WRITE='100/minute', DESTRUCTIVE='2/minute'
    )
    responses = [
        logged_in_client.post('/goals/delete/999991'),
        logged_in_client.post('/catalog/delete/999992'),
        logged_in_client.post('/goals/delete/999993'),
    ]
    _assert_third_is_limited(responses)


def test_expensive_analytics_routes_share_one_read_inventory(
        app, logged_in_client):
    _set_test_limits(app, ANALYTICS_READ='2/minute')
    responses = [
        logged_in_client.get('/insights/api/insights?days=7'),
        logged_in_client.get('/cravings/api/analytics'),
        logged_in_client.get('/api/daily_intake'),
    ]
    _assert_third_is_limited(responses)


def _redis_test_app(monkeypatch, endpoint):
    redis_url = os.environ.get('TEST_RATELIMIT_REDIS_URL')
    prefix = os.environ.get('TEST_RATELIMIT_KEY_PREFIX')
    if not redis_url or not prefix:
        pytest.skip('live Redis proof requires an explicit disposable URL and prefix')
    monkeypatch.setattr(TestingConfig, 'RATELIMIT_STORAGE_URI', redis_url)
    monkeypatch.setattr(TestingConfig, 'RATELIMIT_KEY_PREFIX', prefix)
    monkeypatch.setattr(TestingConfig, 'RATELIMIT_HMAC_SECRET', 'task6-live-secret')
    app = create_app('testing')
    from services.rate_limit_service import trusted_ip_key
    app.add_url_rule(
        '/api/_test/redis-shared', endpoint=endpoint,
        view_func=limiter.shared_limit(
            '1/minute', 'task6-live-shared', key_func=trusted_ip_key,
        )(lambda: jsonify({'ok': True})),
    )
    return app


def test_two_app_instances_share_the_disposable_redis_counter(monkeypatch):
    first_app = _redis_test_app(monkeypatch, 'redis_shared_first')
    second_app = _redis_test_app(monkeypatch, 'redis_shared_second')

    first = first_app.test_client().get(
        '/api/_test/redis-shared', environ_base={'REMOTE_ADDR': '192.0.2.44'}
    )
    second = second_app.test_client().get(
        '/api/_test/redis-shared', environ_base={'REMOTE_ADDR': '192.0.2.44'}
    )

    assert first.status_code == 200
    assert second.status_code == 429
    assert second.get_json()['error']['code'] == 'rate_limited'


def test_redis_outage_fails_closed_without_silent_memory_fallback(monkeypatch):
    if os.environ.get('TEST_RATELIMIT_EXPECT_OUTAGE') != '1':
        pytest.skip('outage proof runs only after the disposable Redis is stopped')
    monkeypatch.setattr(TestingConfig, 'RATELIMIT_STORAGE_OPTIONS', {
        'socket_connect_timeout': 0.25,
        'socket_timeout': 0.25,
    }, raising=False)
    app = _redis_test_app(monkeypatch, 'redis_outage')
    app.config['PROPAGATE_EXCEPTIONS'] = False

    started = time.monotonic()
    response = app.test_client().get('/api/_test/redis-shared')
    elapsed = time.monotonic() - started

    assert response.status_code == 500
    assert elapsed < 2


def _isolated_process_status(storage_uri, prefix):
    program = r'''
import json
import os
import time
from flask import jsonify
from config import TestingConfig

TestingConfig.RATELIMIT_STORAGE_URI = os.environ['TASK6_STORAGE_URI']
TestingConfig.RATELIMIT_KEY_PREFIX = os.environ['TASK6_KEY_PREFIX']
TestingConfig.RATELIMIT_HMAC_SECRET = 'task6-isolated-process-secret-only'
from app import create_app
from extensions import limiter
from services.rate_limit_service import trusted_ip_key

app = create_app('testing')
app.config['PROPAGATE_EXCEPTIONS'] = False
app.add_url_rule(
    '/api/_test/isolated', endpoint='isolated_process_limit',
    view_func=limiter.shared_limit(
        '1/minute', 'isolated-process-proof', key_func=trusted_ip_key,
    )(lambda: jsonify({'ok': True})),
)
started = time.monotonic()
response = app.test_client().get(
    '/api/_test/isolated', environ_base={'REMOTE_ADDR': '192.0.2.88'}
)
print('TASK6_RESULT=' + json.dumps({
    'status': response.status_code,
    'elapsed': time.monotonic() - started,
}))
'''
    environment = os.environ.copy()
    environment.update({
        'TASK6_STORAGE_URI': storage_uri,
        'TASK6_KEY_PREFIX': prefix,
    })
    result = subprocess.run(
        [sys.executable, '-c', program],
        cwd=os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
        env=environment,
        capture_output=True,
        text=True,
        timeout=8,
        check=True,
    )
    marker = next(
        line.removeprefix('TASK6_RESULT=')
        for line in result.stdout.splitlines()
        if line.startswith('TASK6_RESULT=')
    )
    return json.loads(marker)


def test_isolated_processes_share_only_the_disposable_redis_counter():
    redis_url = os.environ.get('TEST_RATELIMIT_REDIS_URL')
    prefix = os.environ.get('TEST_RATELIMIT_KEY_PREFIX')
    if not redis_url or not prefix:
        pytest.skip('cross-process proof requires disposable Redis URL/prefix')

    first = _isolated_process_status(redis_url, prefix + '-process')
    second = _isolated_process_status(redis_url, prefix + '-process')
    memory_first = _isolated_process_status('memory://', prefix + '-memory')
    memory_second = _isolated_process_status('memory://', prefix + '-memory')

    assert [first['status'], second['status']] == [200, 429]
    assert [memory_first['status'], memory_second['status']] == [200, 200]


def test_isolated_process_redis_outage_is_bounded_and_fails_closed():
    if os.environ.get('TEST_RATELIMIT_EXPECT_OUTAGE') != '1':
        pytest.skip('cross-process outage proof runs after Redis is stopped')
    redis_url = os.environ.get('TEST_RATELIMIT_REDIS_URL')
    prefix = os.environ.get('TEST_RATELIMIT_KEY_PREFIX')
    if not redis_url or not prefix:
        pytest.skip('cross-process outage proof requires disposable Redis URL/prefix')

    result = _isolated_process_status(redis_url, prefix + '-process-outage')
    assert result['status'] == 500
    assert result['elapsed'] < 2
