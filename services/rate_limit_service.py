"""Privacy-preserving identities and shared rate-limit helpers."""

import hashlib
import hmac
import ipaddress
from functools import wraps

from email_validator import EmailNotValidError, validate_email
from flask import Blueprint, current_app, request, session
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
    raw = request.form.get('email', '')
    try:
        normalized = validate_email(
            str(raw).strip(), check_deliverability=False
        ).normalized
    except EmailNotValidError:
        normalized = str(raw).strip().casefold()
    return hmac_identity('email', normalized)


def credential_token_key():
    return hmac_identity('token', (request.view_args or {}).get('token', ''))


def user_action_key():
    user_id = session.get('user_id')
    action = request.form.get('action') or request.endpoint or 'unknown'
    return hmac_identity('user-action', f'{user_id}:{action}')


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


def stacked_limits(*decorators):
    """Apply independent limiter dimensions to one endpoint."""
    def decorate(function):
        wrapped = function
        for limiter_decorator in reversed(decorators):
            wrapped = limiter_decorator(wrapped)
        return wraps(function)(wrapped)
    return decorate


def _authenticated():
    user_id = session.get('user_id')
    return isinstance(user_id, int) and not isinstance(user_id, bool) and user_id > 0


default_limits_bp = Blueprint('default_rate_limits', __name__)


@default_limits_bp.before_app_request
@configured_limit(
    'ANONYMOUS_DEFAULT', 'default-anonymous', key_func=trusted_ip_key,
    exempt_when=_authenticated,
)
def _anonymous_default_limit():
    return None


@default_limits_bp.before_app_request
@configured_limit(
    'AUTHENTICATED_DEFAULT_USER', 'default-auth-user', key_func=user_or_ip_key,
    exempt_when=lambda: not _authenticated(),
)
def _authenticated_user_default_limit():
    return None


@default_limits_bp.before_app_request
@configured_limit(
    'AUTHENTICATED_DEFAULT_IP', 'default-auth-ip', key_func=trusted_ip_key,
    exempt_when=lambda: not _authenticated(),
)
def _authenticated_ip_default_limit():
    return None


def register_default_limits(app):
    """Install independent anonymous and authenticated request ceilings."""
    app.register_blueprint(default_limits_bp)


def registration_limits():
    return stacked_limits(
        configured_limit(
            'REGISTRATION_EMAIL', 'registration-email',
            key_func=credential_email_key, methods=['POST'],
        ),
        configured_limit(
            'REGISTRATION_IP', 'registration-ip',
            key_func=trusted_ip_key, methods=['POST'],
        ),
        auth_account_limit(), auth_ip_limit(),
    )


def login_limits():
    return stacked_limits(
        configured_limit(
            'LOGIN_ACCOUNT', 'login-account', key_func=credential_email_key,
            methods=['POST'],
        ),
        configured_limit(
            'LOGIN_IP', 'login-ip', key_func=trusted_ip_key, methods=['POST'],
        ),
        auth_account_limit(), auth_ip_limit(),
    )


def forgot_password_limits():
    return stacked_limits(
        configured_limit(
            'FORGOT_PASSWORD_ACCOUNT', 'forgot-password-account',
            key_func=credential_email_key, methods=['POST'],
        ),
        configured_limit(
            'FORGOT_PASSWORD_IP', 'forgot-password-ip', key_func=trusted_ip_key,
            methods=['POST'],
        ),
    )


def reset_token_limits():
    return stacked_limits(
        configured_limit(
            'RESET_TOKEN', 'reset-token', key_func=credential_token_key,
            methods=['POST'],
        ),
        configured_limit(
            'RESET_IP', 'reset-ip', key_func=trusted_ip_key, methods=['POST'],
        ),
    )


def verification_resend_limits():
    return stacked_limits(
        configured_limit(
            'VERIFICATION_USER', 'verification-user', key_func=user_or_ip_key,
            methods=['POST'],
        ),
        configured_limit(
            'VERIFICATION_IP', 'verification-ip', key_func=trusted_ip_key,
            methods=['POST'],
        ),
        auth_user_limit(), auth_ip_limit(),
    )


def authenticated_write_limit():
    mutation_exempt = lambda: request.method not in {
        'POST', 'PUT', 'PATCH', 'DELETE'
    }
    return stacked_limits(
        configured_limit(
            'AUTHENTICATED_WRITE_USER', 'authenticated-write-user',
            key_func=user_or_ip_key, exempt_when=mutation_exempt,
        ),
        configured_limit(
            'AUTHENTICATED_WRITE_IP', 'authenticated-write-ip',
            key_func=trusted_ip_key, exempt_when=mutation_exempt,
        ),
        configured_limit(
            'AUTHENTICATED_WRITE', 'authenticated-write-legacy',
            key_func=user_or_ip_key, exempt_when=mutation_exempt,
        ),
    )


def canonical_write_limit(*, exempt_when=None):
    return stacked_limits(
        configured_limit(
            'CANONICAL_WRITE', 'canonical-write-user',
            key_func=user_or_ip_key, methods=['POST', 'PUT', 'PATCH', 'DELETE'],
            exempt_when=exempt_when,
        ),
        configured_limit(
            'CANONICAL_WRITE', 'canonical-write-ip', key_func=trusted_ip_key,
            methods=['POST', 'PUT', 'PATCH', 'DELETE'],
            exempt_when=exempt_when,
        ),
    )


def auth_account_limit(*, token=False, methods=None):
    return configured_limit(
        'AUTH_ACCOUNT',
        'auth-account',
        key_func=credential_token_key if token else credential_email_key,
        methods=methods or ['POST'],
    )


def auth_ip_limit(*, methods=None):
    return configured_limit(
        'AUTH_IP', 'auth-ip', key_func=trusted_ip_key,
        methods=methods or ['POST'],
    )


def auth_user_limit():
    return configured_limit(
        'AUTH_ACCOUNT', 'auth-account', key_func=user_or_ip_key,
        methods=['POST'],
    )


def quick_add_limit():
    return stacked_limits(
        configured_limit(
            'QUICK_ADD', 'quick-add-user', key_func=user_or_ip_key,
        ),
        configured_limit(
            'QUICK_ADD', 'quick-add-ip', key_func=trusted_ip_key,
        ),
    )


def bulk_add_limit():
    return configured_limit('BULK_ADD', 'bulk-add', methods=['POST'])


def current_password_limit():
    return stacked_limits(
        configured_limit(
            'CURRENT_PASSWORD_USER', 'current-password-user',
            key_func=user_or_ip_key, methods=['POST'],
        ),
        configured_limit(
            'CURRENT_PASSWORD_IP', 'current-password-ip',
            key_func=trusted_ip_key, methods=['POST'],
        ),
        configured_limit(
            'CURRENT_PASSWORD_ACTION', 'current-password-action-legacy',
            key_func=user_or_ip_key, methods=['POST'],
        ),
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


def plan_preview_limit(*, methods=None, exempt_when=None):
    return configured_limit(
        'PLAN_PREVIEW', 'plan-preview', methods=methods,
        exempt_when=exempt_when,
    )


def export_limit(*, methods=None, exempt_when=None):
    return configured_limit(
        'EXPORT', 'export', methods=methods, exempt_when=exempt_when
    )


def destructive_limit(*, methods=None, exempt_when=None):
    return configured_limit(
        'DESTRUCTIVE', 'destructive', key_func=user_action_key,
        methods=methods,
        exempt_when=exempt_when,
    )


def analytics_read_limit():
    return configured_limit('ANALYTICS_READ', 'analytics-read', methods=['GET'])
