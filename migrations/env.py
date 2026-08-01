import logging
from logging.config import fileConfig

from alembic import context

# this is the Alembic Config object, which provides
# access to the values within the .ini file in use.
config = context.config

# Interpret the config file for Python logging.
# Test harnesses build a programmatic Config without an .ini file, so only
# configure logging when a config file actually exists.
if config.config_file_name is not None:
    fileConfig(config.config_file_name)
logger = logging.getLogger('alembic.env')

# Import/register models explicitly so db.metadata is fully populated for
# autogenerate comparison, without requiring an incidental Flask application
# context (e.g. when a test injects a connection).
import models  # noqa: F401,E402
from extensions import db  # noqa: E402


def get_metadata():
    if hasattr(db, 'metadatas'):
        return db.metadatas[None]
    return db.metadata


def run_migrations_offline():
    """Run migrations in 'offline' mode.

    This configures the context with just a URL
    and not an Engine, though an Engine is acceptable
    here as well.  By skipping the Engine creation
    we don't even need a DBAPI to be available.

    Calls to context.execute() here emit the given string to the
    script output.

    """
    url = config.get_main_option("sqlalchemy.url")
    if not url:
        # Normal Flask-Migrate operation provides the application context.
        config.set_main_option('sqlalchemy.url', get_engine_url())
        url = config.get_main_option("sqlalchemy.url")
    context.configure(
        url=url, target_metadata=get_metadata(), literal_binds=True
    )

    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online():
    """Run migrations in 'online' mode.

    A connection injected through config.attributes["connection"] (by a test
    harness or by Flask-Migrate) is used as-is: the URL is not overwritten
    and no Flask application context is required. Without an injected
    connection, normal Flask-Migrate operation is preserved.

    """
    injected = config.attributes.get('connection')
    if injected is not None:
        context.configure(
            connection=injected,
            target_metadata=get_metadata(),
        )
        with context.begin_transaction():
            context.run_migrations()
        return

    # Normal Flask-Migrate operation (requires an application context).
    config.set_main_option('sqlalchemy.url', get_engine_url())

    # this callback is used to prevent an auto-migration from being generated
    # when there are no changes to the schema
    # reference: http://alembic.zzzcomputing.com/en/latest/cookbook.html
    def process_revision_directives(context, revision, directives):
        if getattr(config.cmd_opts, 'autogenerate', False):
            script = directives[0]
            if script.upgrade_ops.is_empty():
                directives[:] = []
                logger.info('No changes in schema detected.')

    from flask import current_app

    # Do not mutate Flask-Migrate's shared configure_args dictionary in place.
    conf_args = dict(current_app.extensions['migrate'].configure_args)
    if conf_args.get("process_revision_directives") is None:
        conf_args["process_revision_directives"] = process_revision_directives

    connectable = get_engine()

    with connectable.connect() as connection:
        context.configure(
            connection=connection,
            target_metadata=get_metadata(),
            **conf_args
        )

        with context.begin_transaction():
            context.run_migrations()


def get_engine():
    from flask import current_app

    try:
        # this works with Flask-SQLAlchemy<3 and Alchemical
        return current_app.extensions['migrate'].db.get_engine()
    except (TypeError, AttributeError):
        # this works with Flask-SQLAlchemy>=3
        return current_app.extensions['migrate'].db.engine


def get_engine_url():
    try:
        return get_engine().url.render_as_string(hide_password=False).replace(
            '%', '%%')
    except AttributeError:
        return str(get_engine().url).replace('%', '%%')


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
