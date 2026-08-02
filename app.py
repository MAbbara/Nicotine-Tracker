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
from extensions import db, migrate, bcrypt, mail, csrf
from services.request_context import REQUEST_ID_HEADER, get_request_id, init_request_context
from flask_wtf.csrf import CSRFError
import logging
from logging.handlers import RotatingFileHandler
import os

def create_app(config_name=None):
    app = Flask(__name__)
    
    # Get configuration based on environment or passed parameter
    if config_name:
        from config import config
        app.config.from_object(config[config_name])
    else:
        app.config.from_object(get_config())
    
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

    # Request correlation: X-Request-ID in/out + log record stamping
    init_request_context(app)

    # Import models to register them with SQLAlchemy
    from models import (
        Craving, DailyCheckIn, EmailVerification, Goal, Log,
        OnboardingDraft, PlanDay, PlanRevision, PlanStatusEvent, Pouch,
        ReductionPlan, User,
    )
    
    # Setup error logging to file
    if not app.debug:
        if not os.path.exists('logs'):
            os.mkdir('logs')
        file_handler = RotatingFileHandler('logs/nicotine_tracker.log', maxBytes=10240, backupCount=10)
        file_handler.setFormatter(logging.Formatter(
            '%(asctime)s %(levelname)s: %(message)s [in %(pathname)s:%(lineno)d]'))
        file_handler.setLevel(logging.INFO)
        app.logger.addHandler(file_handler)
        app.logger.setLevel(logging.INFO)
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




    
    # Main route
    @app.route('/')
    def index():
        if session.get('user_id'):
            from routes.auth import get_current_user
            if get_current_user() is not None:
                return redirect(url_for('today.index'))
            session.clear()
        return render_template('./index.html')
    
    # Error handlers
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


def _wants_json_response():
    """True when the client asked for JSON or the endpoint is API-scoped."""
    if request.path.startswith('/api/'):
        return True
    best = request.accept_mimetypes.best_match(['application/json', 'text/html'])
    return (
        best == 'application/json'
        and request.accept_mimetypes['application/json'] > request.accept_mimetypes['text/html']
    )
