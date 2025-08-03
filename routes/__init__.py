# Blueprint registration module
from flask import Blueprint

# Import all blueprints
from .auth import auth_bp
from .profile import profile_bp
from .catalog import catalog_bp
from .logging import logging_bp
from .dashboard import dashboard_bp
from .goals import goals_bp
from .import_export import import_export_bp
from .settings import settings_bp

__all__ = [
    'auth_bp',
    'profile_bp', 
    'catalog_bp',
    'logging_bp',
    'dashboard_bp',
    'goals_bp',
    'import_export_bp',
    'settings_bp'
]
