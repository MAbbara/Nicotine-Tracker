"""Database-enforced invariants for the reduction-plan domain."""

from datetime import date, datetime
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from extensions import db
from models import (
    Craving,
    DailyCheckIn,
    Log,
    OnboardingDraft,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    ReductionPlan,
)


def test_plan_models_are_registered_with_expected_table_names():
    assert ReductionPlan.__tablename__ == 'reduction_plan'
    assert PlanRevision.__tablename__ == 'plan_revision'
    assert PlanDay.__tablename__ == 'plan_day'
    assert PlanStatusEvent.__tablename__ == 'plan_status_event'
    assert DailyCheckIn.__tablename__ == 'daily_check_in'
    assert OnboardingDraft.__tablename__ == 'onboarding_draft'


def test_reduction_plan_rejects_unknown_mode(db_session, test_user):
    db.session.add(ReductionPlan(
        user_id=test_user.id,
        mode='punitive',
        status='draft',
    ))
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_active_plan_requires_the_single_active_slot(db_session, test_user):
    db.session.add(ReductionPlan(
        user_id=test_user.id,
        mode='observe',
        status='active',
        active_slot=None,
    ))
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_targeted_activation_requires_complete_confirmed_baseline(
        db_session, test_user):
    db.session.add(ReductionPlan(
        user_id=test_user.id,
        mode='reduce',
        status='active',
        active_slot=1,
        start_date=date(2026, 8, 1),
        baseline_source='manual',
        baseline_pouches=Decimal('8.00'),
        baseline_mg=None,
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
        end_target_pouches=2,
    ))
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_plan_day_is_unique_per_plan_and_local_date(db_session, test_user):
    plan = ReductionPlan(
        user_id=test_user.id, mode='reduce', status='draft'
    )
    db.session.add(plan)
    db.session.flush()
    revision = PlanRevision(
        plan_id=plan.id,
        effective_date=date(2026, 8, 1),
        pace='steady',
        target_date=date(2026, 9, 18),
        end_target_pouches=2,
        generation_inputs={'duration_days': 49},
        preview_digest='a' * 64,
        reason='initial',
    )
    db.session.add(revision)
    db.session.flush()
    db.session.add_all([
        PlanDay(
            plan_id=plan.id, revision_id=revision.id,
            local_date=date(2026, 8, 1), target_pouches=8,
            nicotine_ceiling_mg=Decimal('48.00'),
        ),
        PlanDay(
            plan_id=plan.id, revision_id=revision.id,
            local_date=date(2026, 8, 1), target_pouches=7,
            nicotine_ceiling_mg=Decimal('42.00'),
        ),
    ])
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_active_revision_cannot_belong_to_another_plan(db_session, test_user):
    first = ReductionPlan(user_id=test_user.id, mode='observe', status='draft')
    second = ReductionPlan(user_id=test_user.id, mode='observe', status='draft')
    db.session.add_all([first, second])
    db.session.flush()
    foreign_revision = PlanRevision(
        plan_id=second.id,
        effective_date=date(2026, 8, 1),
        generation_inputs={'mode': 'observe'},
        preview_digest='b' * 64,
        reason='initial',
    )
    db.session.add(foreign_revision)
    db.session.flush()
    first.active_revision_id = foreign_revision.id
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_daily_check_in_is_unique_per_user_day(db_session, test_user):
    db.session.add_all([
        DailyCheckIn(
            user_id=test_user.id, local_date=date(2026, 8, 2), mood=3
        ),
        DailyCheckIn(
            user_id=test_user.id, local_date=date(2026, 8, 2), confidence=4
        ),
    ])
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_onboarding_draft_rejects_unknown_step(db_session, test_user):
    db.session.add(OnboardingDraft(
        user_id=test_user.id,
        current_step='diagnosis',
        structured_payload={'intention': 'reduce'},
    ))
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_status_event_rejects_non_lifecycle_status(db_session, test_user):
    plan = ReductionPlan(user_id=test_user.id, mode='observe', status='draft')
    db.session.add(plan)
    db.session.flush()
    db.session.add(PlanStatusEvent(
        plan_id=plan.id,
        status='draft',
        effective_at_utc=datetime(2026, 8, 2, 1, 0),
        local_date=date(2026, 8, 2),
        reason='created',
    ))
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_log_client_event_id_is_unique_per_user(db_session, test_user):
    moment = datetime(2026, 8, 2, 1, 0)
    db.session.add_all([
        Log(
            user_id=test_user.id, log_time=moment, quantity=1,
            client_event_id='same-log-event',
        ),
        Log(
            user_id=test_user.id, log_time=moment, quantity=1,
            client_event_id='same-log-event',
        ),
    ])
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_craving_client_event_id_is_unique_per_user(db_session, test_user):
    moment = datetime(2026, 8, 2, 1, 0)
    db.session.add_all([
        Craving(
            user_id=test_user.id, craving_time=moment, intensity=4,
            client_event_id='same-craving-event',
        ),
        Craving(
            user_id=test_user.id, craving_time=moment, intensity=7,
            client_event_id='same-craving-event',
        ),
    ])
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_deleting_linked_log_clears_craving_link(db_session, test_user):
    log = Log(
        user_id=test_user.id,
        log_time=datetime(2026, 8, 2, 1, 0),
        quantity=1,
    )
    db.session.add(log)
    db.session.flush()
    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 8, 2, 0, 55),
        intensity=6,
        outcome='used_nicotine',
        linked_log_id=log.id,
    )
    db.session.add(craving)
    db.session.commit()

    db.session.delete(log)
    db.session.commit()
    db.session.refresh(craving)

    assert craving.linked_log_id is None


def test_observe_plan_can_activate_without_target_baseline(db_session, test_user):
    plan = ReductionPlan(
        user_id=test_user.id,
        mode='observe',
        status='active',
        active_slot=1,
    )
    db.session.add(plan)
    db.session.commit()
    assert plan.id is not None


def test_database_allows_only_one_active_plan_per_user(db_session, test_user):
    db.session.add_all([
        ReductionPlan(
            user_id=test_user.id, mode='observe', status='active', active_slot=1
        ),
        ReductionPlan(
            user_id=test_user.id, mode='observe', status='active', active_slot=1
        ),
    ])
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_null_event_ids_may_repeat(db_session, test_user):
    moment = datetime(2026, 8, 2, 2, 0)
    db.session.add_all([
        Log(user_id=test_user.id, log_time=moment, quantity=1),
        Log(user_id=test_user.id, log_time=moment, quantity=1),
        Craving(user_id=test_user.id, craving_time=moment, intensity=3),
        Craving(user_id=test_user.id, craving_time=moment, intensity=5),
    ])
    db.session.commit()
    assert Log.query.filter_by(user_id=test_user.id).count() == 2
    assert Craving.query.filter_by(user_id=test_user.id).count() == 2


def test_same_event_id_is_allowed_for_different_users(db_session, test_user):
    from models import User

    other = User(email='plan-other@example.com', email_verified=True, timezone='UTC')
    other.set_password('password123')
    db.session.add(other)
    db.session.flush()
    moment = datetime(2026, 8, 2, 2, 0)
    db.session.add_all([
        Log(
            user_id=test_user.id, log_time=moment, quantity=1,
            client_event_id='scoped-event',
        ),
        Log(
            user_id=other.id, log_time=moment, quantity=1,
            client_event_id='scoped-event',
        ),
    ])
    db.session.commit()


def test_onboarding_draft_is_unique_per_user(db_session, test_user):
    db.session.add_all([
        OnboardingDraft(
            user_id=test_user.id, current_step='intention', structured_payload={}
        ),
        OnboardingDraft(
            user_id=test_user.id, current_step='baseline', structured_payload={}
        ),
    ])
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_plan_day_cannot_use_revision_from_another_plan(db_session, test_user):
    first = ReductionPlan(user_id=test_user.id, mode='observe', status='draft')
    second = ReductionPlan(user_id=test_user.id, mode='observe', status='draft')
    db.session.add_all([first, second])
    db.session.flush()
    revision = PlanRevision(
        plan_id=second.id,
        effective_date=date(2026, 8, 3),
        generation_inputs={'mode': 'observe'},
        preview_digest='c' * 64,
        reason='initial',
    )
    db.session.add(revision)
    db.session.flush()
    db.session.add(PlanDay(
        plan_id=first.id,
        revision_id=revision.id,
        local_date=date(2026, 8, 3),
        target_pouches=None,
        nicotine_ceiling_mg=None,
    ))
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_plan_day_rejects_half_known_target(db_session, test_user):
    plan = ReductionPlan(user_id=test_user.id, mode='reduce', status='draft')
    db.session.add(plan)
    db.session.flush()
    revision = PlanRevision(
        plan_id=plan.id,
        effective_date=date(2026, 8, 3),
        generation_inputs={'mode': 'reduce'},
        preview_digest='d' * 64,
        reason='initial',
    )
    db.session.add(revision)
    db.session.flush()
    db.session.add(PlanDay(
        plan_id=plan.id,
        revision_id=revision.id,
        local_date=date(2026, 8, 3),
        target_pouches=4,
        nicotine_ceiling_mg=None,
    ))
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_check_in_rejects_out_of_range_mood(db_session, test_user):
    db.session.add(DailyCheckIn(
        user_id=test_user.id, local_date=date(2026, 8, 3), mood=6
    ))
    with pytest.raises(IntegrityError):
        db.session.commit()


def test_status_event_history_is_append_only_data(db_session, test_user):
    plan = ReductionPlan(user_id=test_user.id, mode='observe', status='draft')
    db.session.add(plan)
    db.session.flush()
    db.session.add_all([
        PlanStatusEvent(
            plan_id=plan.id, status='active',
            effective_at_utc=datetime(2026, 8, 3, 0, 0),
            local_date=date(2026, 8, 3), reason='confirmed',
        ),
        PlanStatusEvent(
            plan_id=plan.id, status='paused',
            effective_at_utc=datetime(2026, 8, 4, 0, 0),
            local_date=date(2026, 8, 4), reason='user_request',
        ),
    ])
    db.session.commit()
    assert [event.status for event in plan.status_events] == ['active', 'paused']
