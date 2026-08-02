"""Goal service transaction and contention classification contracts."""

import sqlite3

import pytest
from sqlalchemy.exc import IntegrityError, OperationalError

from services import goal_service


@pytest.mark.parametrize(
    'message',
    [
        'UNIQUE constraint failed: goal.user_id, goal.goal_type, '
        'goal.active_slot',
        "(1062, \"Duplicate entry '7-daily_pouches-1' for key "
        "'uq_goal_user_type_active_slot'\")",
    ],
)
def test_goal_contention_classifier_accepts_only_active_slot_unique(message):
    error = IntegrityError('UPDATE goal', {}, sqlite3.IntegrityError(message))

    assert goal_service._is_active_goal_contention_error(error) is True


@pytest.mark.parametrize(
    'message',
    [
        'CHECK constraint failed: ck_goal_active_slot_state',
        'FOREIGN KEY constraint failed',
        'UNIQUE constraint failed: goal.id',
        'UNIQUE constraint failed: goal.user_id, goal.goal_type',
    ],
)
def test_goal_contention_classifier_rejects_unrelated_integrity(message):
    error = IntegrityError('UPDATE goal', {}, sqlite3.IntegrityError(message))

    assert goal_service._is_active_goal_contention_error(error) is False


@pytest.mark.parametrize(
    ('message', 'expected'),
    [
        ('database is locked', True),
        ('database table is locked: goal', True),
        ('database schema is locked: main', True),
        ('database is locked while updating goal', False),
        ('disk I/O error', False),
    ],
)
def test_goal_contention_classifier_accepts_only_documented_lock_signals(
        message, expected):
    error = OperationalError('UPDATE goal', {}, sqlite3.OperationalError(message))

    assert goal_service._is_active_goal_contention_error(error) is expected


@pytest.mark.parametrize(
    ('message', 'expected_error'),
    [
        (
            'UNIQUE constraint failed: goal.user_id, goal.goal_type, '
            'goal.active_slot',
            goal_service.ActiveGoalConflict,
        ),
        (
            'CHECK constraint failed: ck_goal_active_slot_state',
            IntegrityError,
        ),
    ],
)
def test_create_maps_only_exact_active_slot_unique_error(
        db_session, test_user, monkeypatch, message, expected_error):
    injected = IntegrityError(
        'INSERT INTO goal', {}, sqlite3.IntegrityError(message)
    )

    def fail_commit():
        raise injected

    monkeypatch.setattr(db_session, 'commit', fail_commit)

    with pytest.raises(expected_error) as caught:
        goal_service.create_goal(
            user_id=test_user.id,
            goal_type='daily_pouches',
            target_value=7,
        )

    if expected_error is IntegrityError:
        assert caught.value is injected
    assert db_session().in_transaction() is False


def test_winner_confirmation_read_error_does_not_replace_original_contention(
        monkeypatch):
    contention = OperationalError(
        'INSERT INTO goal', {}, sqlite3.OperationalError('database is locked')
    )

    def fail_confirmation(*_args, **_kwargs):
        raise RuntimeError('confirmation read failed')

    monkeypatch.setattr(
        goal_service, '_different_active_goal_exists', fail_confirmation
    )

    assert goal_service._activation_conflict_is_confirmed(
        contention,
        {
            'user_id': 7,
            'goal_type': 'daily_pouches',
            'goal_id': None,
            'activating': True,
        },
    ) is None
