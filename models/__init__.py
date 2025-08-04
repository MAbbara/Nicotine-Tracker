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
        # ZYN - Most popular brand
        {"brand": "ZYN", "nicotine_mg": 1.5},
        {"brand": "ZYN", "nicotine_mg": 3},
        {"brand": "ZYN", "nicotine_mg": 6},
        {"brand": "ZYN", "nicotine_mg": 9},
        {"brand": "ZYN", "nicotine_mg": 11},
        {"brand": "ZYN", "nicotine_mg": 14},
        
        # VELO - Second most popular
        {"brand": "VELO", "nicotine_mg": 2},
        {"brand": "VELO", "nicotine_mg": 4},
        {"brand": "VELO", "nicotine_mg": 7},
        
        # ON! - Popular alternative
        {"brand": "ON!", "nicotine_mg": 2},
        {"brand": "ON!", "nicotine_mg": 4},
        {"brand": "ON!", "nicotine_mg": 8},
        
        # Rogue - Growing brand
        {"brand": "Rogue", "nicotine_mg": 3},
        {"brand": "Rogue", "nicotine_mg": 6},
        {"brand": "Rogue", "nicotine_mg": 12},
        
        # Lucy - Premium brand
        {"brand": "Lucy", "nicotine_mg": 4},
        {"brand": "Lucy", "nicotine_mg": 8},
        {"brand": "Lucy", "nicotine_mg": 12},
        
        # DZRT - Original brand in the system
        {"brand": "DZRT", "nicotine_mg": 3},
        {"brand": "DZRT", "nicotine_mg": 6},
        {"brand": "DZRT", "nicotine_mg": 7},
        {"brand": "DZRT", "nicotine_mg": 10},
        
        # FRE - Popular tobacco-free option
        {"brand": "FRE", "nicotine_mg": 3},
        {"brand": "FRE", "nicotine_mg": 6},
        {"brand": "FRE", "nicotine_mg": 9},
        
        # LOOP - European popular brand
        {"brand": "LOOP", "nicotine_mg": 5},
        {"brand": "LOOP", "nicotine_mg": 9},
        {"brand": "LOOP", "nicotine_mg": 12},
        
        # KILLA - Strong option
        {"brand": "KILLA", "nicotine_mg": 16},
        {"brand": "KILLA", "nicotine_mg": 25},
        
        # PABLO - Extra strong
        {"brand": "PABLO", "nicotine_mg": 30},
        {"brand": "PABLO", "nicotine_mg": 50},
        
        # General - Traditional Swedish brand
        {"brand": "General", "nicotine_mg": 8},
        {"brand": "General", "nicotine_mg": 11},
        
        # Skruf - Another Swedish brand
        {"brand": "Skruf", "nicotine_mg": 6},
        {"brand": "Skruf", "nicotine_mg": 9},
        {"brand": "Skruf", "nicotine_mg": 12},
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
