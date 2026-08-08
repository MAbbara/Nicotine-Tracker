"""Journey progress must reuse Today nicotine facts for one user-day."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from importlib import import_module

import pytest

from models import Log, PlanDay, PlanRevision, ReductionPlan
from services.today_service import TodayService


def _mg_plan(session, user, local_date, ceilings):
    plan = ReductionPlan(
        user_id=user.id,
        mode='reduce',
        status='draft',
        active_slot=None,
        start_date=local_date,
        target_date=local_date + timedelta(days=len(ceilings) - 1),
        baseline_mg=Decimal(ceilings[0]),
        baseline_source='manual',
        pace='steady',
        end_target_mg=Decimal(ceilings[-1]),
    )
    session.add(plan)
    session.flush()
    revision = PlanRevision(
        plan_id=plan.id,
        effective_date=local_date,
        pace='steady',
        target_date=plan.target_date,
        end_target_mg=plan.end_target_mg,
        generation_inputs={
            'target_basis': 'nicotine_mg',
            'end_target_mg': format(plan.end_target_mg, '.2f'),
        },
        preview_digest='j' * 64,
        reason='initial',
    )
    session.add(revision)
    session.flush()
    plan.active_revision_id = revision.id
    session.add_all([
        PlanDay(
            plan_id=plan.id,
            revision_id=revision.id,
            local_date=local_date + timedelta(days=offset),
            target_pouches=None,
            nicotine_ceiling_mg=Decimal(ceiling),
        )
        for offset, ceiling in enumerate(ceilings)
    ])
    session.flush()
    plan.status = 'active'
    plan.active_slot = 1
    session.commit()
    return plan


def _log(session, user, occurred_at, *, quantity, strength):
    session.add(Log(
        user_id=user.id,
        log_time=occurred_at.replace(tzinfo=None),
        quantity=quantity,
        nicotine_mg_snapshot=(
            None if strength is None else Decimal(strength)
        ),
        product_brand_snapshot='Progress fixture',
    ))
    session.commit()


@pytest.mark.parametrize(
    ('ceiling', 'logs', 'expected_known', 'expected_complete',
     'expected_remaining', 'expected_status'),
    [
        ('30.00', ((2, '10.00'),), '20.00', True, '10.00', 'below_ceiling'),
        ('30.00', ((3, '10.00'),), '30.00', True, '0.00', 'at_ceiling'),
        ('30.00', ((4, '10.00'),), '40.00', True, '0.00', 'above_ceiling'),
        (None, ((2, '6.00'),), '12.00', True, None, 'no_ceiling'),
        (
            '30.00',
            ((6, '6.00'), (1, None)),
            '36.00',
            False,
            None,
            'nicotine_total_incomplete',
        ),
    ],
)
def test_journey_progress_reuses_today_nicotine_facts(
    db_session,
    test_user,
    ceiling,
    logs,
    expected_known,
    expected_complete,
    expected_remaining,
    expected_status,
):
    """A second Journey calculation could drift from Today at any boundary."""
    now = datetime.now(timezone.utc)
    test_user.timezone = 'UTC'
    db_session.commit()
    if ceiling is not None:
        _mg_plan(db_session, test_user, now.date(), [ceiling])
    for quantity, strength in logs:
        _log(
            db_session,
            test_user,
            now,
            quantity=quantity,
            strength=strength,
        )

    service = import_module(
        'services.journey_progress_service'
    ).JourneyProgressService
    progress = service.get(test_user.id)
    today = TodayService.get_summary(test_user.id)

    assert progress.known_mg == today.known_nicotine_mg == Decimal(
        expected_known
    )
    assert progress.total_complete is expected_complete
    assert progress.total_complete is (today.unknown_strength_events == 0)
    assert progress.ceiling_mg == (
        today.plan.nicotine_ceiling_mg if today.plan else None
    )
    assert progress.remaining_mg == today.remaining_nicotine_mg
    assert progress.remaining_mg == (
        None if expected_remaining is None else Decimal(expected_remaining)
    )
    assert progress.status == expected_status
    assert progress.pouches_logged == today.actual_pouches == sum(
        quantity for quantity, _strength in logs
    )


def test_journey_progress_finds_first_future_ceiling_change(
    db_session, test_user
):
    """Choosing the next row instead of the next change would mislead users."""
    now = datetime.now(timezone.utc)
    test_user.timezone = 'UTC'
    db_session.commit()
    _mg_plan(
        db_session,
        test_user,
        now.date(),
        ['30.00', '30.00', '24.00', '24.00'],
    )

    service = import_module(
        'services.journey_progress_service'
    ).JourneyProgressService
    progress = service.get(test_user.id)

    assert progress.next_change is not None
    assert progress.next_change.kind == 'ceiling_change'
    assert progress.next_change.local_date == now.date() + timedelta(days=2)
    assert progress.next_change.ceiling_mg == Decimal('24.00')
    assert progress.next_change.change_mg == Decimal('-6.00')


def test_journey_progress_labels_first_ceiling_before_plan_start(
    db_session, test_user
):
    """A future first ceiling is not a change from today's neutral tracking."""
    now = datetime.now(timezone.utc)
    test_user.timezone = 'UTC'
    db_session.commit()
    start_date = now.date() + timedelta(days=2)
    _mg_plan(db_session, test_user, start_date, ['30.00', '24.00'])

    service = import_module(
        'services.journey_progress_service'
    ).JourneyProgressService
    progress = service.get(test_user.id)

    assert progress.status == 'no_ceiling'
    assert progress.ceiling_mg is None
    assert progress.next_change is not None
    assert progress.next_change.kind == 'first_ceiling'
    assert progress.next_change.local_date == start_date
    assert progress.next_change.ceiling_mg == Decimal('30.00')
    assert progress.next_change.change_mg is None


def test_journey_progress_paused_transition_has_no_future_date(
    db_session, test_user
):
    """Persisted future rows must not imply that a paused schedule will proceed."""
    now = datetime.now(timezone.utc)
    test_user.timezone = 'UTC'
    db_session.commit()
    plan = _mg_plan(
        db_session,
        test_user,
        now.date(),
        ['30.00', '24.00', '18.00'],
    )
    plan.status = 'paused'
    plan.active_slot = None
    db_session.commit()
    _log(
        db_session,
        test_user,
        now,
        quantity=1,
        strength=None,
    )

    service = import_module(
        'services.journey_progress_service'
    ).JourneyProgressService
    progress = service.get(test_user.id)

    assert progress.status == 'no_ceiling'
    assert progress.total_complete is False
    assert progress.remaining_mg is None
    assert progress.next_change is not None
    assert progress.next_change.kind == 'resume_required'
    assert progress.next_change.local_date is None
    assert progress.next_change.ceiling_mg is None
    assert progress.next_change.change_mg is None
