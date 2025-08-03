# services/pouch_service.py

from models import Pouch
from extensions import db

def get_default_pouches():
    """
    Return all “default” pouches (i.e. system-provided).
    """
    return (
        Pouch.query
        .filter_by(is_default=True)
        .order_by(Pouch.brand, Pouch.nicotine_mg)
        .all()
    )

def get_user_pouches(user_id):
    """
    Return all custom pouches created by a given user.
    """
    return (
        Pouch.query
        .filter_by(created_by=user_id)
        .order_by(Pouch.brand, Pouch.nicotine_mg)
        .all()
    )

def get_all_pouches(user_id):
    """
    Convenience wrapper: returns a tuple of (default_pouches, user_pouches)
    which you can then pass into your template context.
    """
    default = get_default_pouches()
    custom = get_user_pouches(user_id)
    return default, custom
