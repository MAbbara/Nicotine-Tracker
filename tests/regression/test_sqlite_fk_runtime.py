"""
Regression: SQLite foreign-key enforcement must be enabled at runtime.

Flask-SQLAlchemy does not turn on PRAGMA foreign_keys by default, so
application code that relies on ON DELETE CASCADE or referential integrity
would silently misbehave. This test verifies the connect listener in
extensions.py enables enforcement for every sqlite3 DBAPI connection.
"""

from extensions import db


def test_sqlite_foreign_keys_enabled(app):
    """PRAGMA foreign_keys must return 1 on a real application connection."""
    with app.app_context():
        result = db.session.execute(db.text("PRAGMA foreign_keys")).scalar()
        assert result == 1
