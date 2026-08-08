import importlib
import json

import pytest
import sqlalchemy as sa
from alembic import command as alembic_command

from tests.migrations import harness


REVISION = 'd9e3f4a5b6c7'
DOWN_REVISION = 'c8f2d3a4b5e6'


def test_weekly_idempotency_revision_is_the_single_head():
    assert harness.resolve_single_head() == REVISION
    module = importlib.import_module(
        'migrations.versions.d9e3f4a5b6c7_add_weekly_report_idempotency'
    )
    assert module.down_revision == DOWN_REVISION


def test_weekly_migration_backfills_only_parseable_periods_and_enforces_channel_key():
    engine = sa.create_engine('sqlite:///:memory:')
    with engine.begin() as connection:
        connection.exec_driver_sql('CREATE TABLE user (id INTEGER PRIMARY KEY)')
        connection.exec_driver_sql('INSERT INTO user (id) VALUES (1)')
        connection.exec_driver_sql('''
            CREATE TABLE notification_queue (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES user(id),
                notification_type VARCHAR(50) NOT NULL,
                category VARCHAR(50) NOT NULL,
                subject VARCHAR(255), message TEXT NOT NULL,
                recipient VARCHAR(255) NOT NULL,
                scheduled_for DATETIME NOT NULL, created_at DATETIME NOT NULL,
                status VARCHAR(20) NOT NULL, attempts INTEGER NOT NULL,
                max_attempts INTEGER NOT NULL, last_attempt_at DATETIME,
                error_message TEXT, priority INTEGER NOT NULL, extra_data JSON
            )
        ''')
        payloads = [
            (1, 'email', 'weekly_report', {'week_start': '2030-01-07'}),
            (2, 'discord', 'weekly_report', {'week_start': 'not-a-date'}),
            (3, 'email', 'daily_reminder', {'week_start': '2030-01-07'}),
            (4, 'email', 'weekly_report', {'week_start': '2030-01-07'}),
        ]
        for row_id, channel, category, extra in payloads:
            connection.execute(sa.text('''
                INSERT INTO notification_queue (
                    id, user_id, notification_type, category, message,
                    recipient, scheduled_for, created_at, status, attempts,
                    max_attempts, priority, extra_data
                ) VALUES (
                    :id, 1, :channel, :category, 'message', 'recipient',
                    '2030-01-14 12:00:00', '2030-01-14 12:00:00',
                    'pending', 0, 3, 4, :extra
                )
            '''), {
                'id': row_id, 'channel': channel, 'category': category,
                'extra': json.dumps(extra),
            })
        connection.exec_driver_sql(
            "CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)"
        )
        connection.execute(sa.text(
            'INSERT INTO alembic_version (version_num) VALUES (:revision)'
        ), {'revision': DOWN_REVISION})
        alembic_command.upgrade(harness.make_alembic_config(connection), REVISION)

        rows = connection.execute(sa.text('''
            SELECT id, report_period_start, idempotency_key
            FROM notification_queue ORDER BY id
        ''')).mappings().all()
        assert rows[0]['report_period_start'] == '2030-01-07'
        assert len(rows[0]['idempotency_key']) == 64
        assert rows[1]['report_period_start'] is None
        assert rows[1]['idempotency_key'] is None
        assert rows[2]['report_period_start'] is None
        assert rows[2]['idempotency_key'] is None
        assert rows[3]['report_period_start'] is None
        assert rows[3]['idempotency_key'] is None

        with pytest.raises(sa.exc.IntegrityError):
            connection.execute(sa.text('''
                INSERT INTO notification_queue (
                    id, user_id, notification_type, category, message,
                    recipient, scheduled_for, created_at, status, attempts,
                    max_attempts, priority, report_period_start
                ) VALUES (
                    5, 1, 'email', 'weekly_report', 'message', 'recipient',
                    '2030-01-14 12:00:00', '2030-01-14 12:00:00',
                    'pending', 0, 3, 4, '2030-01-07'
                )
            '''))

        alembic_command.downgrade(
            harness.make_alembic_config(connection), DOWN_REVISION
        )
        columns = {
            column['name']
            for column in sa.inspect(connection).get_columns(
                'notification_queue'
            )
        }
        indexes = {
            index['name']
            for index in sa.inspect(connection).get_indexes(
                'notification_queue'
            )
        }
        assert 'report_period_start' not in columns
        assert 'idempotency_key' not in columns
        assert 'ix_notification_queue_user_id' not in indexes
