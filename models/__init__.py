"""Database models package.

This package contains the SQLAlchemy ORM model definitions for the application.
Each model lives in its own module (user, pouch, log, goal) and is re-exported
here for convenience. The `init_default_pouches` helper can be used to
populate the database with a few common pouch entries.
"""

# Re-export model classes from individual modules
from .user import User  # noqa: F401
from .pouch import Pouch  # noqa: F401
from .log import Log  # noqa: F401
from .goal import Goal  # noqa: F401

__all__ = ["User", "Pouch", "Log", "Goal", "init_default_pouches"]

def init_default_pouches():
    """
    Initialize database with common pouch brands.
    """
    from extensions import db
    from .pouch import Pouch

    default_pouches = [
        {"brand": "DZRT", "nicotine_mg": 3},
        {"brand": "DZRT", "nicotine_mg": 6},
        {"brand": "DZRT", "nicotine_mg": 7},
        {"brand": "DZRT", "nicotine_mg": 10},
    ]

    for pouch_data in default_pouches:
        existing = Pouch.query.filter_by(
            brand=pouch_data["brand"],
            nicotine_mg=pouch_data["nicotine_mg"],
            is_default=True,
        ).first()

        if not existing:
            pouch = Pouch(
                brand=pouch_data["brand"],
                nicotine_mg=pouch_data["nicotine_mg"],
                is_default=True,
            )
            db.session.add(pouch)

    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f"Error initializing default pouches: {e}")
