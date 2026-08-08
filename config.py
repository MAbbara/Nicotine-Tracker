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
    WTF_CSRF_ENABLED = True

    
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

    # Request correlation header (inbound accepted only as canonical UUID)
    REQUEST_ID_HEADER = os.environ.get('REQUEST_ID_HEADER', 'X-Request-ID')

    # Abuse protection. Process-local memory is intentionally confined to
    # development and tests; ProductionConfig must provide shared Redis.
    RATELIMIT_ENABLED = True
    RATELIMIT_HEADERS_ENABLED = True
    RATELIMIT_STORAGE_URI = 'memory://'
    RATELIMIT_KEY_PREFIX = 'nicotine-tracker-local'
    RATELIMIT_HMAC_SECRET = SECRET_KEY
    RATELIMIT_TRUSTED_PROXY_COUNT = 0
    RATELIMIT_SWALLOW_ERRORS = False
    RATELIMIT_IN_MEMORY_FALLBACK_ENABLED = False
    RATELIMIT_STORAGE_OPTIONS = {
        'socket_connect_timeout': 0.5,
        'socket_timeout': 0.5,
    }
    RATELIMIT_DEFAULT = []
    RATELIMIT_REQUIRE_SHARED_STORAGE = False
    RATELIMIT_AUTH_ACCOUNT = '6 per 15 minutes'
    RATELIMIT_AUTH_IP = '30 per hour'
    RATELIMIT_AUTHENTICATED_WRITE = '120 per minute'
    RATELIMIT_QUICK_ADD = '30 per minute'
    RATELIMIT_BULK_ADD = '20 per hour'
    RATELIMIT_CURRENT_PASSWORD_ACTION = '5 per hour'
    RATELIMIT_DISCORD_TEST = '5 per hour'
    RATELIMIT_WEEKLY_REPORT = '2 per hour'
    RATELIMIT_PLAN_MUTATION = '30 per hour'
    RATELIMIT_EXPORT = '10 per hour'
    RATELIMIT_DESTRUCTIVE = '5 per hour'
    RATELIMIT_ANALYTICS_READ = '30 per minute'

    
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
    RATELIMIT_STORAGE_URI = os.environ.get('RATELIMIT_STORAGE_URI')
    RATELIMIT_KEY_PREFIX = os.environ.get('RATELIMIT_KEY_PREFIX')
    RATELIMIT_HMAC_SECRET = os.environ.get('RATELIMIT_HMAC_SECRET')
    RATELIMIT_TRUSTED_PROXY_COUNT = int(
        os.environ.get('RATELIMIT_TRUSTED_PROXY_COUNT', 0)
    )
    RATELIMIT_REQUIRE_SHARED_STORAGE = True


class DevelopmentConfig(Config):
    DEBUG = True
    RATELIMIT_STORAGE_URI = 'memory://'

class TestingConfig(Config):
    TESTING = True
    DEBUG = True
    SQLALCHEMY_DATABASE_URI = 'sqlite:///:memory:'
    WTF_CSRF_ENABLED = False
    RATELIMIT_STORAGE_URI = 'memory://'
    RATELIMIT_AUTH_ACCOUNT = '100000 per hour'
    RATELIMIT_AUTH_IP = '100000 per hour'
    RATELIMIT_AUTHENTICATED_WRITE = '100000 per hour'
    RATELIMIT_QUICK_ADD = '100000 per hour'
    RATELIMIT_BULK_ADD = '100000 per hour'
    RATELIMIT_CURRENT_PASSWORD_ACTION = '100000 per hour'
    RATELIMIT_DISCORD_TEST = '100000 per hour'
    RATELIMIT_WEEKLY_REPORT = '100000 per hour'
    RATELIMIT_PLAN_MUTATION = '100000 per hour'
    RATELIMIT_EXPORT = '100000 per hour'
    RATELIMIT_DESTRUCTIVE = '100000 per hour'
    RATELIMIT_ANALYTICS_READ = '100000 per hour'

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
