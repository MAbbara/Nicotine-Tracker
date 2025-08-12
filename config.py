import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Security settings
    SECRET_KEY = os.environ.get('SECRET_KEY') or 'dev-secret-key-change-in-production'
    SERVER_NAME = os.environ.get('SERVER_NAME')
    APPLICATION_ROOT = os.environ.get('APPLICATION_ROOT', '/')
    PREFERRED_URL_SCHEME = os.environ.get('PREFERRED_URL_SCHEME', 'http')
    
    # Database configuration

    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'sqlite:///nicotine_tracker.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Session configuration
    SESSION_COOKIE_SECURE = False
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    PERMANENT_SESSION_LIFETIME = int(os.environ.get('SESSION_LIFETIME', 86400))  # 24 hours default
    
    # CSRF protection
    WTF_CSRF_ENABLED = os.environ.get('WTF_CSRF_ENABLED', 'False').lower() == 'true'

    
    # Email configuration
    MAIL_SERVER = os.environ.get('MAIL_SERVER')
    MAIL_PORT = int(os.environ.get('MAIL_PORT', 587))
    MAIL_USE_TLS = os.environ.get('MAIL_USE_TLS', 'True').lower() == 'true'
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER')
    
    # File upload settings
    MAX_CONTENT_LENGTH = int(os.environ.get('MAX_CONTENT_LENGTH', 16 * 1024 * 1024))  # 16MB default
    UPLOAD_FOLDER = os.environ.get('UPLOAD_FOLDER', 'uploads')
    
    # Pagination
    LOGS_PER_PAGE = int(os.environ.get('LOGS_PER_PAGE', 20))

    # Notification settings
    NOTIFICATION_PROCESS_INTERVAL = int(os.environ.get('NOTIFICATION_PROCESS_INTERVAL', 30))
    NOTIFICATION_MAX_RETRIES = int(os.environ.get('NOTIFICATION_MAX_RETRIES', 3))
    NOTIFICATION_BATCH_SIZE = int(os.environ.get('NOTIFICATION_BATCH_SIZE', 10))
    NOTIFICATION_DEBUG = os.environ.get('NOTIFICATION_DEBUG', 'False').lower() == 'true'
    
    # Logging
    LOG_TO_STDOUT = os.environ.get('LOG_TO_STDOUT', 'False').lower() == 'true'
    LOG_LEVEL = os.environ.get('LOG_LEVEL', 'INFO').upper()

    
    # Debug mode - automatically set based on environment
    @property
    def DEBUG(self):
        env = os.environ.get('FLASK_ENV', 'development').lower()
        return env == 'development'
    
    # Testing mode
    TESTING = False

class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True


class DevelopmentConfig(Config):
    DEBUG = True

class TestingConfig(Config):
    TESTING = True
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False

config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': Config
}

def get_config():
    """Get configuration based on environment variable"""
    env = os.environ.get('FLASK_ENV', 'development').lower()
    return config.get(env, config['default'])
