import importlib
import json

import pytest
import sqlalchemy as sa
from alembic import command as alembic_command

from tests.migrations import harness


REVISION = 'd9e3f4a5b6c7'
DOWN_REVISION = 'c8f2d3a4b5e6'
HEAD_REVISION = 'e0f1a2b3c4d5'


def test_weekly_idempotency_revision_is_the_single_head():
    assert harness.resolve_single_head() == HEAD_REVISION
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


def test_sent_weekly_ledger_period_survives_downgrade_and_reupgrade():
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
        connection.exec_driver_sql(
            'CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)'
        )
        connection.execute(sa.text(
            'INSERT INTO alembic_version (version_num) VALUES (:revision)'
        ), {'revision': DOWN_REVISION})
        connection.execute(sa.text('''
            INSERT INTO notification_queue (
                id, user_id, notification_type, category, subject, message,
                recipient, scheduled_for, created_at, status, attempts,
                max_attempts, priority, extra_data
            ) VALUES (
                1, 1, 'email', 'weekly_report', NULL,
                '[weekly report delivered]', '[scrubbed-after-delivery]',
                '2030-01-14 12:00:00', '2030-01-14 12:00:00',
                'sent', 1, 3, 4, :extra
            )
        '''), {'extra': json.dumps({'week_start': '2030-01-07'})})

        alembic_command.upgrade(harness.make_alembic_config(connection), REVISION)
        connection.execute(sa.text('''
            UPDATE notification_queue
            SET extra_data = :extra
            WHERE id = 1
        '''), {'extra': json.dumps({'retention': 'delivery_metadata_only'})})
        alembic_command.downgrade(
            harness.make_alembic_config(connection), DOWN_REVISION
        )
        downgraded = connection.execute(sa.text(
            'SELECT extra_data FROM notification_queue WHERE id = 1'
        )).scalar_one()
        if isinstance(downgraded, str):
            downgraded = json.loads(downgraded)
        assert downgraded == {
            'retention': 'delivery_metadata_only',
            'week_start': '2030-01-07',
        }

        alembic_command.upgrade(harness.make_alembic_config(connection), REVISION)
        restored = connection.execute(sa.text('''
            SELECT report_period_start, idempotency_key
            FROM notification_queue WHERE id = 1
        ''')).mappings().one()
        assert restored['report_period_start'] == '2030-01-07'
        assert len(restored['idempotency_key']) == 64


def test_delivery_lease_upgrade_quarantines_legacy_processing_rows():
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
                error_message TEXT, priority INTEGER NOT NULL, extra_data JSON,
                report_period_start DATE, idempotency_key VARCHAR(64)
            )
        ''')
        connection.exec_driver_sql(
            'CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)'
        )
        connection.execute(sa.text(
            'INSERT INTO alembic_version (version_num) VALUES (:revision)'
        ), {'revision': REVISION})
        connection.execute(sa.text('''
            INSERT INTO notification_queue (
                id, user_id, notification_type, category, subject, message,
                recipient, scheduled_for, created_at, status, attempts,
                max_attempts, priority, extra_data
            ) VALUES (
                1, 1, 'discord', 'password_reset', 'Reset',
                'https://local/reset/raw-token',
                'https://discord.com/api/webhooks/123/raw-token',
                '2030-01-14 12:00:00', '2030-01-14 12:00:00',
                'processing', 1, 3, 4, :extra
            )
        '''), {'extra': json.dumps({'reset_url': 'raw-token'})})

        alembic_command.upgrade(
            harness.make_alembic_config(connection), HEAD_REVISION
        )

        row = connection.execute(sa.text('''
            SELECT status, claim_owner, claimed_at, delivery_started_at,
                   recipient, subject, message, extra_data, error_message
            FROM notification_queue WHERE id = 1
        ''')).mappings().one()
        assert row['status'] == 'failed'
        assert row['claim_owner'] is None
        assert row['claimed_at'] is None
        assert row['delivery_started_at'] is None
        assert row['recipient'] == '[scrubbed-after-delivery-start]'
        assert row['subject'] is None
        assert row['message'] == '[credential delivery outcome unknown]'
        assert row['extra_data'] is None
        assert row['error_message'] == (
            'delivery outcome unknown during worker lease migration'
        )


def test_mysql_weekly_marker_survives_d9_downgrade_reupgrade(
        db_backend, mysql_engine):
    if db_backend != 'mysql':
        pytest.skip('MySQL-only JSON downgrade contract')
    with mysql_engine.begin() as connection:
        assert not sa.inspect(connection).get_table_names()
        connection.exec_driver_sql('CREATE TABLE user (id INTEGER PRIMARY KEY)')
        connection.exec_driver_sql('INSERT INTO user (id) VALUES (1)')
        connection.exec_driver_sql('''
            CREATE TABLE notification_queue (
                id INTEGER PRIMARY KEY,
                user_id INTEGER NOT NULL,
                notification_type VARCHAR(50) NOT NULL,
                category VARCHAR(50) NOT NULL,
                subject VARCHAR(255), message TEXT NOT NULL,
                recipient VARCHAR(255) NOT NULL,
                scheduled_for DATETIME NOT NULL, created_at DATETIME NOT NULL,
                status VARCHAR(20) NOT NULL, attempts INTEGER NOT NULL,
                max_attempts INTEGER NOT NULL, last_attempt_at DATETIME,
                error_message TEXT, priority INTEGER NOT NULL, extra_data JSON,
                CONSTRAINT fk_queue_user FOREIGN KEY (user_id) REFERENCES user(id)
            )
        ''')
        connection.exec_driver_sql(
            'CREATE TABLE alembic_version (version_num VARCHAR(32) NOT NULL)'
        )
        connection.execute(sa.text(
            'INSERT INTO alembic_version (version_num) VALUES (:revision)'
        ), {'revision': DOWN_REVISION})
        connection.execute(sa.text('''
            INSERT INTO notification_queue (
                id, user_id, notification_type, category, subject, message,
                recipient, scheduled_for, created_at, status, attempts,
                max_attempts, priority, extra_data
            ) VALUES (
                1, 1, 'email', 'weekly_report', NULL,
                '[weekly report delivered]', '[scrubbed-after-delivery]',
                '2030-01-14 12:00:00', '2030-01-14 12:00:00',
                'sent', 1, 3, 4, :extra
            )
        '''), {'extra': json.dumps({'week_start': '2030-01-07'})})

        cfg = harness.make_alembic_config(connection)
        alembic_command.upgrade(cfg, REVISION)
        connection.execute(sa.text('''
            UPDATE notification_queue SET extra_data = :extra WHERE id = 1
        '''), {'extra': json.dumps({'retention': 'delivery_metadata_only'})})
        alembic_command.downgrade(cfg, DOWN_REVISION)
        downgraded = connection.execute(sa.text(
            'SELECT extra_data FROM notification_queue WHERE id = 1'
        )).scalar_one()
        if isinstance(downgraded, str):
            downgraded = json.loads(downgraded)
        assert downgraded['week_start'] == '2030-01-07'

        alembic_command.upgrade(cfg, REVISION)
        restored = connection.execute(sa.text('''
            SELECT report_period_start, idempotency_key
            FROM notification_queue WHERE id = 1
        ''')).mappings().one()
        assert str(restored['report_period_start']) == '2030-01-07'
        assert len(restored['idempotency_key']) == 64

        alembic_command.downgrade(cfg, DOWN_REVISION)
        connection.exec_driver_sql('DROP TABLE notification_queue')
        connection.exec_driver_sql('DROP TABLE user')
        connection.exec_driver_sql('DROP TABLE alembic_version')
