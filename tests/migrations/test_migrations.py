"""
Tests for database migrations using Alembic.
"""
import pytest
from flask import current_app
from extensions import db
from alembic.command import upgrade, downgrade

from alembic.config import Config
from alembic.script import ScriptDirectory

def test_migrations_run_without_error(runner):
    """
    Test that all migrations can run without raising an error.
    This test will upgrade to the latest version and then downgrade to base.
    """
    db.drop_all()
    # Load alembic configuration

    alembic_cfg = Config('migrations/alembic.ini')
    alembic_cfg.set_main_option('script_location', 'migrations')
    
    # Ensure we're using the test database
    alembic_cfg.set_main_option('sqlalchemy.url', current_app.config['SQLALCHEMY_DATABASE_URI'])

    # Get all revisions
    script = ScriptDirectory.from_config(alembic_cfg)
    revisions = [rev.revision for rev in script.walk_revisions()]

    # Upgrade to head
    upgrade(alembic_cfg, 'head')

    # Downgrade to base
    downgrade(alembic_cfg, 'base')

    # Upgrade back to head to leave the database in a clean state
    upgrade(alembic_cfg, 'head')
