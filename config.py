import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    # Development-friendly security settings
    SECRET_KEY = os.environ.get('SECRET_KEY')
    
    # Database configuration - SQLite for development, easy MySQL migration
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL', 'sqlite:///nicotine_tracker.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    
    # Session configuration - relaxed for development
    SESSION_COOKIE_SECURE = False  # Set to True in production with HTTPS
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = 'Lax'
    PERMANENT_SESSION_LIFETIME = 86400  # 24 hours
    
    # CSRF protection - disabled for development ease
    WTF_CSRF_ENABLED = False  # Set to True in production
    
    # Email configuration (placeholders for environment variables)
    MAIL_SERVER = os.environ.get('MAIL_SERVER')
    MAIL_PORT = int(os.environ.get('MAIL_PORT'))
    MAIL_USE_TLS = True
    MAIL_USERNAME = os.environ.get('MAIL_USERNAME')
    MAIL_PASSWORD = os.environ.get('MAIL_PASSWORD')
    MAIL_DEFAULT_SENDER = os.environ.get('MAIL_DEFAULT_SENDER')
    
    # File upload settings
    MAX_CONTENT_LENGTH = 16 * 1024 * 1024  # 16MB max file size
    UPLOAD_FOLDER = 'uploads'
    
    # Pagination
    LOGS_PER_PAGE = 20
    
    # Development settings
    DEBUG = True
    TESTING = False
    
    # Logging
    LOG_TO_STDOUT = os.environ.get('LOG_TO_STDOUT')

class ProductionConfig(Config):
    DEBUG = False
    SESSION_COOKIE_SECURE = True
    WTF_CSRF_ENABLED = True
    SQLALCHEMY_DATABASE_URI = os.environ.get('DATABASE_URL')

class DevelopmentConfig(Config):
    DEBUG = True

class TestingConfig(Config):
    TESTING = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False

config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}
