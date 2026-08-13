from flask import (
    Flask,
    jsonify,
    make_response,
    redirect,
    render_template,
    request,
    session,
    url_for,
)
from config import get_config
from extensions import db, migrate, bcrypt, mail, csrf, limiter
from services.request_context import REQUEST_ID_HEADER, get_request_id, init_request_context
from flask_wtf.csrf import CSRFError
import logging
import math
import sys
import time
from datetime import date
from ipaddress import ip_address
from urllib.parse import urlsplit
from werkzeug.middleware.proxy_fix import ProxyFix

def create_app(config_name=None):
    app = Flask(__name__)
    
    # Get configuration based on environment or passed parameter
    if config_name:
        from config import config
        app.config.from_object(config[config_name])
    else:
        app.config.from_object(get_config())

    _validate_rate_limit_config(app)
    _validate_production_config(app)
    trusted_proxy_count = int(
        app.config.get('RATELIMIT_TRUSTED_PROXY_COUNT', 0) or 0
    )
    trusted_proto_count = int(
        app.config.get('PROXY_FIX_X_PROTO_COUNT', 0) or 0
    )
    if trusted_proxy_count > 0 or trusted_proto_count > 0:
        app.wsgi_app = ProxyFix(
            app.wsgi_app,
            x_for=trusted_proxy_count,
            x_proto=trusted_proto_count,
        )
    
    # Initialize configuration-specific setup
    config_class = app.config.__class__
    if hasattr(config_class, 'init_app'):
        config_class.init_app(app)
    
    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    bcrypt.init_app(app)
    mail.init_app(app)
    csrf.init_app(app)
    limiter.init_app(app)

    @app.template_filter('human_date')
    def human_date(value):
        if value is None:
            return ''
        if isinstance(value, str):
            value = date.fromisoformat(value)
        return f"{value.strftime('%B')} {value.day}"

    # Request correlation: X-Request-ID in/out + log record stamping
    init_request_context(app)

    # Import models to register them with SQLAlchemy
    from models import (
        Craving, DailyCheckIn, EmailVerification, Goal, Log,
        OnboardingDraft, PlanDay, PlanRevision, PlanStatusEvent, Pouch,
        ReductionPlan, User,
    )
    
    # Production processes write to stdout/stderr so the process manager owns
    # rotation and multiple workers never contend for a local file.
    if not app.debug:
        _configure_stdout_logging(app)
        app.logger.info('Nicotine Tracker startup')
    
    # Register blueprints
    from routes.auth import auth_bp
    from routes.catalog import catalog_bp
    from routes.logging import logging_bp
    from routes.dashboard import dashboard_bp
    from routes.goals import goals_bp
    from routes.settings import settings_bp
    from routes.api import api_bp
    from routes.insights import insights_bp
    from routes.cravings import cravings_bp
    from routes.today import today_bp
    from routes.journey import journey_bp
    from routes.you import you_bp
    from routes.pwa import pwa_bp



    
    app.register_blueprint(auth_bp, url_prefix='/auth')
    app.register_blueprint(catalog_bp, url_prefix='/catalog')
    app.register_blueprint(logging_bp, url_prefix='/log')
    app.register_blueprint(dashboard_bp, url_prefix='/dashboard')
    app.register_blueprint(goals_bp, url_prefix='/goals')
    app.register_blueprint(settings_bp, url_prefix='/settings')
    app.register_blueprint(api_bp, url_prefix='/api')
    app.register_blueprint(insights_bp, url_prefix='/insights')
    app.register_blueprint(cravings_bp, url_prefix='/cravings')
    app.register_blueprint(today_bp, url_prefix='/today')
    app.register_blueprint(journey_bp, url_prefix='/journey')
    app.register_blueprint(you_bp, url_prefix='/you')
    app.register_blueprint(pwa_bp)
    from services.rate_limit_service import register_default_limits
    register_default_limits(app)




    
    # Main route
    @app.route('/')
    def index():
        if session.get('user_id'):
            from routes.auth import get_current_user
            if get_current_user() is not None:
                return redirect(url_for('today.index'))
            session.clear()
        clear_deleted_account_site_data = session.pop(
            '_clear_site_data_after_account_deletion', False
        )
        response = make_response(render_template('./index.html'))
        if clear_deleted_account_site_data:
            response.headers['Clear-Site-Data'] = '"cache", "cookies", "storage"'
        return response
    
    # Error handlers
    @app.errorhandler(429)
    def rate_limited_error(error):
        request_limit = limiter.current_limit
        reset_at = getattr(request_limit, 'reset_at', None)
        retry_after = max(
            1,
            math.ceil(reset_at - time.time()) if reset_at else 1,
        )
        if _wants_json_response():
            from services.api_errors import rate_limited_response
            return rate_limited_response(retry_after)
        response = make_response(render_template(
            'errors/429.html', preserved_fields=_safe_429_form_values(),
        ), 429)
        response.headers['Retry-After'] = str(retry_after)
        return response

    @app.errorhandler(CSRFError)
    def handle_csrf_error(error):
        request_id = get_request_id()
        if request.path.startswith('/api/'):
            from services.api_errors import csrf_failed_response
            return csrf_failed_response()
        if _wants_json_response():
            return jsonify({
                'success': False,
                'message': 'This request could not be verified. Refresh and try again.',
                'request_id': request_id,
            }), 400
        return render_template(
            'errors/400.html',
            message='This page was open for a while. Refresh it, then try again.',
        ), 400

    @app.errorhandler(404)
    def not_found_error(error):
        if request.path.startswith('/api/'):
            from services.api_errors import not_found_response
            return not_found_response()
        return render_template('errors/404.html'), 404

    @app.errorhandler(500)
    def internal_error(error):
        db.session.rollback()
        app.logger.exception('Unhandled exception during request')
        request_id = get_request_id()
        if request.path.startswith('/api/'):
            from services.api_errors import internal_error_response
            response = internal_error_response()
        elif _wants_json_response():
            response = jsonify({
                'success': False,
                'message': 'Something went wrong on our end. Please try again later.',
                'request_id': request_id,
            })
            response.status_code = 500
        else:
            response = make_response(
                render_template('errors/500.html', request_id=request_id), 500
            )
        # Flask 2.3 routes unhandled exceptions through handle_exception, which
        # returns the response without running after_request hooks, so the
        # correlation header must be stamped here as well.
        response.headers[app.config.get('REQUEST_ID_HEADER', REQUEST_ID_HEADER)] = request_id
        return response

    return app


def _validate_rate_limit_config(app):
    """Reject process-local or ambiguous limiter configuration in production."""
    if not app.config.get('RATELIMIT_REQUIRE_SHARED_STORAGE'):
        return
    if not app.config.get('RATELIMIT_ENABLED'):
        raise RuntimeError('Production rate limits must be enabled.')
    storage_uri = (app.config.get('RATELIMIT_STORAGE_URI') or '').strip()
    if not storage_uri.startswith(('redis://', 'rediss://')):
        raise RuntimeError(
            'Production rate limits require shared Redis storage.'
        )
    try:
        endpoint = urlsplit(storage_uri)
        redis_port = endpoint.port
    except ValueError as exc:
        raise RuntimeError(
            'Production rate limits require a concrete Redis endpoint.'
        ) from exc
    database = endpoint.path.removeprefix('/')
    redis_host = endpoint.hostname or ''
    approved_single_host_redis = storage_uri == 'redis://127.0.0.1:6379/4'
    try:
        redis_is_loopback = ip_address(redis_host).is_loopback
    except ValueError:
        redis_is_loopback = redis_host.casefold() == 'localhost'
    if (
        endpoint.scheme not in {'redis', 'rediss'}
        or not redis_host
        or redis_port is None
        or (redis_is_loopback and not approved_single_host_redis)
        or not database.isdigit()
        or endpoint.query
        or endpoint.fragment
    ):
        raise RuntimeError(
            'Production rate limits require a concrete Redis endpoint.'
        )
    secret = (app.config.get('RATELIMIT_HMAC_SECRET') or '').strip()
    prefix = (app.config.get('RATELIMIT_KEY_PREFIX') or '').strip()
    predictable_secrets = {
        'change-me-change-me-change-me-change-me',
        'dev-secret-key-change-in-production',
    }
    if (
        len(secret) < 32
        or len(set(secret)) < 12
        or 'change_me' in secret.casefold()
        or secret.casefold() in predictable_secrets
        or secret == app.config.get('SECRET_KEY')
    ):
        raise RuntimeError(
            'Production rate limits require a strong independent limiter secret.'
        )
    disallowed_prefixes = {
        '', 'local', 'default', 'nicotine-tracker-local', 'prod',
    }
    if (
        len(prefix) < 8
        or 'change_me' in prefix.casefold()
        or prefix.casefold() in disallowed_prefixes
    ):
        raise RuntimeError(
            'Production rate limits require a deployment-unique key prefix.'
        )
    proxy_count = app.config.get('RATELIMIT_TRUSTED_PROXY_COUNT', 0)
    if not isinstance(proxy_count, int) or isinstance(proxy_count, bool) or proxy_count < 0:
        raise RuntimeError(
            'Production trusted proxy hops (proxy count) must be zero or greater.'
        )


def _validate_production_config(app):
    """Fail closed when a production process has an unsafe origin/runtime."""
    if not app.config.get('PRODUCTION'):
        return

    secret = (app.config.get('SECRET_KEY') or '').strip()
    predictable = {
        'dev-secret-key-change-in-production',
        'change-me-change-me-change-me-change-me',
        'your-strong-and-unique-secret-key-for-production',
    }
    if (
        len(secret) < 32
        or len(set(secret)) < 12
        or 'change_me' in secret.casefold()
        or secret.casefold() in predictable
    ):
        raise RuntimeError(
            'Production requires a strong session secret of at least 32 characters.'
        )

    database_uri = (app.config.get('SQLALCHEMY_DATABASE_URI') or '').strip()
    try:
        database = urlsplit(database_uri)
        database_port = database.port
    except ValueError as exc:
        raise RuntimeError(
            'Production requires a named MySQL database.'
        ) from exc
    database_name = database.path.removeprefix('/')
    if (
        database.scheme != 'mysql+pymysql'
        or not database.hostname
        or not database_name
        or '/' in database_name
        or database.fragment
        or database_port is not None and database_port <= 0
    ):
        raise RuntimeError('Production requires a named MySQL database.')

    server_name = (app.config.get('SERVER_NAME') or '').strip()
    origin = urlsplit(f'//{server_name}')
    if (
        app.config.get('PREFERRED_URL_SCHEME') != 'https'
        or not server_name
        or '://' in server_name
        or not origin.hostname
        or origin.hostname.casefold() in {'localhost', '127.0.0.1', '::1'}
        or origin.path
        or origin.query
        or origin.fragment
        or origin.username
        or origin.password
    ):
        raise RuntimeError(
            'Production requires a canonical HTTPS origin in SERVER_NAME.'
        )

    x_for = app.config.get('RATELIMIT_TRUSTED_PROXY_COUNT')
    x_proto = app.config.get('PROXY_FIX_X_PROTO_COUNT')
    if any(
        not isinstance(value, int) or isinstance(value, bool) or value < 1
        for value in (x_for, x_proto)
    ):
        raise RuntimeError(
            'Production trusted proxy hops must explicitly cover both '
            'forwarded address and scheme headers.'
        )
    if not app.config.get('LOG_TO_STDOUT'):
        raise RuntimeError('Production logging must use stdout/stderr.')


def _configure_stdout_logging(app):
    level_name = str(app.config.get('LOG_LEVEL', 'INFO')).upper()
    level = getattr(logging, level_name, logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setLevel(level)
    handler.setFormatter(logging.Formatter(
        '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'
    ))
    app.logger.handlers.clear()
    app.logger.addHandler(handler)
    app.logger.setLevel(level)
    app.logger.propagate = False


def _wants_json_response():
    """True when the client asked for JSON or the endpoint is API-scoped."""
    if (
        request.path.startswith('/api/')
        or '/api/' in request.path
        or request.is_json
        or request.endpoint in {
            'settings.trigger_weekly_report',
            'settings.test_discord_webhook',
        }
    ):
        return True
    best = request.accept_mimetypes.best_match(['application/json', 'text/html'])
    return (
        best == 'application/json'
        and request.accept_mimetypes['application/json'] > request.accept_mimetypes['text/html']
    )


_SAFE_429_FIELDS = {
    'auth.register': {
        'email': 'Email address', 'terms': 'Terms acknowledgement',
    },
    'auth.login': {
        'email': 'Email address', 'remember_me': 'Remember me',
    },
    'auth.forgot_password': {'email': 'Email address'},
    'settings.account': {
        'action': 'Account action', 'new_email': 'New email address',
        'confirmation': 'Confirmation',
    },
    'settings.notifications': {
        'notification_channel': 'Delivery channel',
        'goal_notifications': 'Goal notifications',
        'achievement_notifications': 'Achievement notifications',
        'daily_reminders': 'Daily reminders',
        'weekly_reports': 'Weekly reports',
        'reminder_time': 'Reminder time',
        'quiet_hours_start': 'Quiet hours start',
        'quiet_hours_end': 'Quiet hours end',
    },
    'settings.preferences': {
        'units_preference': 'Units preference', 'timezone': 'Time zone',
        'daily_reset_time': 'Daily reset time',
        'preferred_brands': 'Preferred products',
    },
    'settings.profile': {
        'age': 'Age', 'gender': 'Gender', 'weight': 'Weight',
    },
}


def _safe_429_form_values():
    """Return bounded, endpoint-allowlisted form state for the HTML 429 page."""
    allowed = _SAFE_429_FIELDS.get(request.endpoint, {})
    preserved = []
    for field, label in allowed.items():
        values = request.form.getlist(field)
        safe_values = []
        for raw in values[:20]:
            value = str(raw).strip()
            if not value:
                continue
            if field in {
                'remember_me', 'terms', 'goal_notifications',
                'achievement_notifications', 'daily_reminders',
                'weekly_reports',
            }:
                value = 'Selected'
            safe_values.append(value[:120])
        if safe_values:
            preserved.append((label, ', '.join(safe_values)))
    return preserved
