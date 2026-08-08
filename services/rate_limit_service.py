"""Privacy-preserving identities and shared rate-limit helpers."""

import hashlib
import hmac
import ipaddress

from flask import current_app, request, session
from extensions import limiter


def _normalized_identity(kind, value):
    text = str(value or '').strip()
    if kind == 'email':
        return text.casefold()
    if kind == 'ip':
        try:
            return ipaddress.ip_address(text).compressed
        except ValueError:
            return 'unknown'
    return text


def hmac_identity(kind, value):
    """Return a scoped digest; raw credentials and addresses never enter keys."""
    secret = current_app.config.get('RATELIMIT_HMAC_SECRET')
    if not secret:
        raise RuntimeError('RATELIMIT_HMAC_SECRET is required')
    normalized = _normalized_identity(kind, value)
    digest = hmac.new(
        str(secret).encode('utf-8'),
        f'{kind}\0{normalized}'.encode('utf-8'),
        hashlib.sha256,
    ).hexdigest()
    return f'{kind}:{digest}'


def trusted_ip_key():
    """Hash Flask's effective remote address after explicit ProxyFix handling."""
    return hmac_identity('ip', request.remote_addr or 'unknown')


def user_or_ip_key():
    """Prefer an authenticated user bucket; otherwise use the effective IP."""
    user_id = session.get('user_id')
    if (
        isinstance(user_id, int)
        and not isinstance(user_id, bool)
        and 0 < user_id <= 2_147_483_647
    ):
        return hmac_identity('user', str(user_id))
    return trusted_ip_key()


def credential_email_key():
    return hmac_identity('email', request.form.get('email', ''))


def credential_token_key():
    return hmac_identity('token', (request.view_args or {}).get('token', ''))


def configured_limit(config_name, scope, *, key_func=user_or_ip_key,
                     methods=None, cost=1, exempt_when=None):
    """Build a shared, late-bound limit from application configuration."""
    return limiter.shared_limit(
        lambda: current_app.config[f'RATELIMIT_{config_name}'],
        scope,
        key_func=key_func,
        methods=methods,
        cost=cost,
        exempt_when=exempt_when,
    )


def authenticated_write_limit():
    return configured_limit(
        'AUTHENTICATED_WRITE',
        'authenticated-write',
        exempt_when=lambda: request.method not in {'POST', 'PUT', 'PATCH', 'DELETE'},
    )


def auth_account_limit(*, token=False):
    return configured_limit(
        'AUTH_ACCOUNT',
        'auth-account',
        key_func=credential_token_key if token else credential_email_key,
        methods=['POST'],
    )


def auth_ip_limit():
    return configured_limit(
        'AUTH_IP', 'auth-ip', key_func=trusted_ip_key, methods=['POST']
    )


def auth_user_limit():
    return configured_limit(
        'AUTH_ACCOUNT', 'auth-account', key_func=user_or_ip_key,
        methods=['POST'],
    )


def quick_add_limit():
    return configured_limit('QUICK_ADD', 'quick-add')


def bulk_add_limit():
    return configured_limit('BULK_ADD', 'bulk-add', methods=['POST'], cost=5)


def current_password_limit():
    return configured_limit(
        'CURRENT_PASSWORD_ACTION', 'current-password-action', methods=['POST']
    )


def discord_test_limit():
    return configured_limit('DISCORD_TEST', 'discord-test')


def weekly_report_limit():
    return configured_limit('WEEKLY_REPORT', 'weekly-report')


def plan_mutation_limit(*, methods=None, exempt_when=None):
    return configured_limit(
        'PLAN_MUTATION', 'plan-mutation', methods=methods,
        exempt_when=exempt_when,
    )


def export_limit(*, methods=None, exempt_when=None):
    return configured_limit(
        'EXPORT', 'export', methods=methods, exempt_when=exempt_when
    )


def destructive_limit(*, methods=None, exempt_when=None):
    return configured_limit(
        'DESTRUCTIVE', 'destructive', methods=methods,
        exempt_when=exempt_when,
    )
