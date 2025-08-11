from flask import Flask, render_template
from config import get_config
from extensions import db, migrate, bcrypt, mail
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
    
    # Import models to register them with SQLAlchemy
    from models import User, Pouch, Log, Goal, EmailVerification
    
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

    
    app.register_blueprint(auth_bp, url_prefix='/auth')
    app.register_blueprint(catalog_bp, url_prefix='/catalog')
    app.register_blueprint(logging_bp, url_prefix='/log')
    app.register_blueprint(dashboard_bp, url_prefix='/dashboard')
    app.register_blueprint(goals_bp, url_prefix='/goals')
    app.register_blueprint(settings_bp, url_prefix='/settings')
    app.register_blueprint(api_bp, url_prefix='/api')

    
    # Main route
    @app.route('/')
    def index():
        return render_template('./index.html')
    
    # Error handlers
    @app.errorhandler(404)
    def not_found_error(error):
        return render_template('errors/404.html'), 404
    
    @app.errorhandler(500)
    def internal_error(error):
        db.session.rollback()
        return render_template('errors/500.html'), 500
    
    return app
