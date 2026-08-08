"""
Flask extensions initialization.
This module contains all Flask extensions to avoid circular imports.
"""

import sqlite3

from flask_bcrypt import Bcrypt
from flask_mail import Mail
from flask_limiter import Limiter
from flask_migrate import Migrate
from flask_sqlalchemy import SQLAlchemy
from flask_wtf.csrf import CSRFProtect
from sqlalchemy import event


def _set_sqlite_pragma(dbapi_conn, connection_record):
    """Enable foreign-key enforcement for every sqlite3 DBAPI connection."""
    if isinstance(dbapi_conn, sqlite3.Connection):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


class SQLAlchemyWithFK(SQLAlchemy):
    """SQLAlchemy extension that enables SQLite foreign keys at connect time."""

    def init_app(self, app):
        super().init_app(app)
        with app.app_context():
            event.listen(self.engine, "connect", _set_sqlite_pragma)


# Initialize extensions
db = SQLAlchemyWithFK()
migrate = Migrate()
bcrypt = Bcrypt()
mail = Mail()
csrf = CSRFProtect()


def _default_rate_limit_key():
    from services.rate_limit_service import user_or_ip_key
    return user_or_ip_key()


limiter = Limiter(key_func=_default_rate_limit_key)
