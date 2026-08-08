"""Transactional reduction-plan lifecycle behavior."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest

from models import (
    Log,
    OnboardingDraft,
    Pouch,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    ReductionPlan,
    User,
    UserPreferences,
    UserPreferredPouch,
)
from services.api_errors import ApiValidationError
from services.baseline_service import BaselineService
from services.plan_schedule import (
    PlanGenerationInput,
    PlanScheduleGenerator,
    PlanValidationError,
)
from services.plan_service import (
    ActivePlanConflictError,
    PlanNotFoundError,
    PlanService,
    PlanStateError,
    PreviewStaleError,
)


def _steady_input(**overrides):
    values = {
        'mode': 'reduce',
        'target_basis': 'nicotine_mg',
        'start_date': date(2099, 1, 1),
        'baseline_pouches': Decimal('8.00'),
        'baseline_mg': Decimal('48.00'),
        'baseline_mg_per_pouch': Decimal('6.00'),
        'pace': 'steady',
        'end_target_mg': Decimal('12.00'),
    }
    values.update(overrides)
    return PlanGenerationInput(**values)


def test_create_draft_persists_one_initial_revision_and_its_days(
    db_session, test_user,
):
    plan = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='recent_logs'
    )

    assert plan.user_id == test_user.id
    assert plan.mode == 'reduce'
    assert plan.status == 'draft'
    assert plan.active_slot is None
    assert plan.baseline_source == 'recent_logs'
    assert plan.start_date == date(2099, 1, 1)
    assert plan.target_date == date(2099, 2, 18)
    assert plan.baseline_pouches == Decimal('8.00')
    assert plan.baseline_mg == Decimal('48.00')
    assert plan.baseline_mg_per_pouch == Decimal('6.00')
    assert plan.pace == 'steady'
    assert plan.end_target_pouches is None
    assert plan.end_target_mg == Decimal('12.00')

    revisions = PlanRevision.query.filter_by(plan_id=plan.id).all()
    assert len(revisions) == 1
    revision = revisions[0]
    assert plan.active_revision_id == revision.id
    assert revision.reason == 'initial'
    assert revision.effective_date == date(2099, 1, 1)
    assert revision.target_date == date(2099, 2, 18)
    assert revision.preview_digest
    assert revision.generation_inputs == {
        'mode': 'reduce',
        'start_date': '2099-01-01',
        'baseline_pouches': '8.00',
        'baseline_mg': '48.00',
        'baseline_mg_per_pouch': '6.00',
        'pace': 'steady',
        'target_basis': 'nicotine_mg',
        'end_target_pouches': None,
        'end_target_mg': '12.00',
        'target_date': '2099-02-18',
        'duration_days': 49,
        'stage_targets': None,
    }

    days = PlanDay.query.filter_by(plan_id=plan.id).order_by(
        PlanDay.local_date
    ).all()
    assert len(days) == 49
    assert days[0].revision_id == revision.id
    assert days[0].target_pouches is None
    assert days[0].nicotine_ceiling_mg == Decimal('48.00')
    assert days[-1].local_date == date(2099, 2, 18)
    assert days[-1].target_pouches is None
    assert days[-1].nicotine_ceiling_mg == Decimal('12.00')
    assert PlanStatusEvent.query.filter_by(plan_id=plan.id).count() == 0


def test_create_draft_rolls_back_everything_when_generation_fails(
    db_session, test_user,
):
    with pytest.raises(PlanValidationError):
        PlanService.create_draft(
            test_user.id,
            _steady_input(end_target_mg=Decimal('49.00')),
            baseline_source='manual',
        )

    assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
    assert PlanRevision.query.count() == 0
    assert PlanDay.query.count() == 0


def test_activate_confirms_digest_and_appends_status_history(
    db_session, test_user,
):
    plan = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    revision = PlanRevision.query.filter_by(plan_id=plan.id).one()

    activated = PlanService.activate(
        test_user.id, plan.id, revision.preview_digest
    )

    assert activated.status == 'active'
    assert activated.active_slot == 1
    event = PlanStatusEvent.query.filter_by(plan_id=plan.id).one()
    assert event.status == 'active'
    assert event.effective_at_utc is not None
    assert event.local_date is not None
    assert event.reason == 'activated'


def test_activate_rejects_stale_preview_without_mutating_plan(
    db_session, test_user,
):
    plan = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )

    with pytest.raises(PreviewStaleError):
        PlanService.activate(test_user.id, plan.id, '0' * 64)

    db_session.refresh(plan)
    assert plan.status == 'draft'
    assert plan.active_slot is None
    assert PlanStatusEvent.query.filter_by(plan_id=plan.id).count() == 0


def test_activate_rejects_cross_user_access_as_not_found(
    db_session, test_user,
):
    from models import User

    plan = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    revision = PlanRevision.query.filter_by(plan_id=plan.id).one()
    other = User(email='other-plan-user@example.com', timezone='UTC')
    other.set_password('password123')
    db_session.add(other)
    db_session.commit()

    with pytest.raises(PlanNotFoundError):
        PlanService.activate(other.id, plan.id, revision.preview_digest)

    db_session.refresh(plan)
    assert plan.status == 'draft'


def test_activate_requires_explicit_resolution_of_an_existing_active_plan(
    db_session, test_user,
):
    first = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    first_revision = PlanRevision.query.filter_by(plan_id=first.id).one()
    PlanService.activate(test_user.id, first.id, first_revision.preview_digest)

    second = PlanService.create_draft(
        test_user.id,
        _steady_input(start_date=date(2099, 3, 1)),
        baseline_source='manual',
    )
    second_revision = PlanRevision.query.filter_by(plan_id=second.id).one()

    with pytest.raises(ActivePlanConflictError):
        PlanService.activate(
            test_user.id, second.id, second_revision.preview_digest
        )

    db_session.refresh(second)
    assert second.status == 'draft'
    assert second.active_slot is None
    assert PlanStatusEvent.query.filter_by(plan_id=second.id).count() == 0


def test_create_from_preview_activates_and_deletes_onboarding_atomically(
    db_session, test_user,
):
    generation_input = _steady_input(start_date=date(2099, 5, 1))
    preview = PlanScheduleGenerator.generate(generation_input)
    db_session.add(OnboardingDraft(
        user_id=test_user.id,
        current_step='review',
        structured_payload={'intention': 'reduce'},
    ))
    db_session.commit()

    plan = PlanService.create_from_preview(
        test_user.id,
        generation_input,
        baseline_source='manual',
        preview_digest=preview.digest,
        activation='activate',
    )

    assert plan.status == 'active'
    assert plan.active_slot == 1
    assert PlanRevision.query.filter_by(plan_id=plan.id).count() == 1
    assert PlanDay.query.filter_by(plan_id=plan.id).count() == 49
    assert PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='active'
    ).count() == 1
    assert OnboardingDraft.query.filter_by(user_id=test_user.id).first() is None


def test_create_from_preview_promotes_all_durable_support_preferences(
    db_session, test_user, test_pouch,
):
    default_pouch = Pouch(
        brand='Shared support pouch',
        nicotine_mg=Decimal('8.00'),
        is_default=True,
    )
    db_session.add(default_pouch)
    db_session.flush()
    generation_input = _steady_input(start_date=date(2099, 5, 1))
    preview = PlanScheduleGenerator.generate(generation_input)
    db_session.add(OnboardingDraft(
        user_id=test_user.id,
        current_step='review',
        structured_payload={
            'intention': 'reduce',
            'difficult_times': ['morning', 'late_night'],
            'common_triggers': ['stress', 'routine'],
            'preferred_pouch_ids': [test_pouch.id, default_pouch.id],
            'reminder_window': 'evening',
        },
    ))
    db_session.commit()

    PlanService.create_from_preview(
        test_user.id,
        generation_input,
        baseline_source='manual',
        preview_digest=preview.digest,
        activation='activate',
    )

    preferences = UserPreferences.query.filter_by(
        user_id=test_user.id
    ).one()
    assert preferences.difficult_times == ['morning', 'late_night']
    assert preferences.common_triggers == ['stress', 'routine']
    assert preferences.daily_reminders is True
    assert preferences.reminder_time == time(19, 0)
    assert [
        (row.pouch_id, row.rank)
        for row in UserPreferredPouch.query.filter_by(
            user_id=test_user.id
        ).order_by(UserPreferredPouch.rank).all()
    ] == [(test_pouch.id, 0), (default_pouch.id, 1)]


@pytest.mark.parametrize(('reminder_window', 'enabled', 'reminder_time'), [
    ('none', False, None),
    ('morning', True, time(8, 0)),
    ('afternoon', True, time(14, 0)),
    ('evening', True, time(19, 0)),
])
def test_create_from_preview_maps_reminder_window(
    db_session, test_user, reminder_window, enabled, reminder_time,
):
    generation_input = _steady_input(start_date=date(2099, 5, 1))
    preview = PlanScheduleGenerator.generate(generation_input)
    db_session.add_all([
        UserPreferences(
            user_id=test_user.id,
            daily_reminders=True,
            reminder_time=time(6, 30),
        ),
        OnboardingDraft(
            user_id=test_user.id,
            current_step='review',
            structured_payload={'reminder_window': reminder_window},
        ),
    ])
    db_session.commit()

    PlanService.create_from_preview(
        test_user.id,
        generation_input,
        baseline_source='manual',
        preview_digest=preview.digest,
        activation='draft',
    )

    preferences = UserPreferences.query.filter_by(
        user_id=test_user.id
    ).one()
    assert preferences.daily_reminders is enabled
    assert preferences.reminder_time == reminder_time


def test_create_from_preview_without_support_keys_preserves_preferences(
    db_session, test_user, test_pouch,
):
    preferences = UserPreferences(
        user_id=test_user.id,
        difficult_times=['evening'],
        common_triggers=['social'],
        daily_reminders=True,
        reminder_time=time(14, 0),
    )
    preferred = UserPreferredPouch(
        user_id=test_user.id,
        pouch_id=test_pouch.id,
        rank=0,
    )
    generation_input = _steady_input(start_date=date(2099, 5, 1))
    preview = PlanScheduleGenerator.generate(generation_input)
    db_session.add_all([
        preferences,
        preferred,
        OnboardingDraft(
            user_id=test_user.id,
            current_step='review',
            structured_payload={'intention': 'reduce', 'pace': 'steady'},
        ),
    ])
    db_session.commit()

    PlanService.create_from_preview(
        test_user.id,
        generation_input,
        baseline_source='manual',
        preview_digest=preview.digest,
        activation='draft',
    )

    db_session.refresh(preferences)
    assert preferences.difficult_times == ['evening']
    assert preferences.common_triggers == ['social']
    assert preferences.daily_reminders is True
    assert preferences.reminder_time == time(14, 0)
    assert [
        (row.pouch_id, row.rank)
        for row in UserPreferredPouch.query.filter_by(
            user_id=test_user.id
        ).all()
    ] == [(test_pouch.id, 0)]


def test_create_from_preview_inaccessible_pouch_rolls_back_complete_graph(
    db_session, test_user, test_pouch,
):
    selected_pouch = Pouch(
        brand='No longer shared',
        nicotine_mg=Decimal('6.00'),
        is_default=True,
    )
    preferences = UserPreferences(
        user_id=test_user.id,
        difficult_times=['evening'],
        common_triggers=['social'],
        daily_reminders=True,
        reminder_time=time(14, 0),
    )
    db_session.add_all([selected_pouch, preferences])
    db_session.flush()
    preferred = UserPreferredPouch(
        user_id=test_user.id,
        pouch_id=test_pouch.id,
        rank=0,
    )
    draft = OnboardingDraft(
        user_id=test_user.id,
        current_step='review',
        structured_payload={
            'intention': 'reduce',
            'difficult_times': ['morning'],
            'common_triggers': ['stress'],
            'preferred_pouch_ids': [selected_pouch.id],
            'reminder_window': 'morning',
        },
    )
    db_session.add_all([preferred, draft])
    db_session.commit()
    draft_snapshot = (draft.id, dict(draft.structured_payload))

    selected_pouch.is_default = False
    selected_pouch.created_by = None
    db_session.commit()
    generation_input = _steady_input(start_date=date(2099, 5, 1))
    preview = PlanScheduleGenerator.generate(generation_input)

    with pytest.raises(ApiValidationError) as caught:
        PlanService.create_from_preview(
            test_user.id,
            generation_input,
            baseline_source='manual',
            preview_digest=preview.digest,
            activation='activate',
        )

    assert caught.value.field_errors == {
        'structured_payload.preferred_pouch_ids': [
            'One or more selected pouches is not available.'
        ],
    }
    assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
    persisted = UserPreferences.query.filter_by(user_id=test_user.id).one()
    assert persisted.difficult_times == ['evening']
    assert persisted.common_triggers == ['social']
    assert persisted.daily_reminders is True
    assert persisted.reminder_time == time(14, 0)
    assert [
        (row.pouch_id, row.rank)
        for row in UserPreferredPouch.query.filter_by(
            user_id=test_user.id
        ).all()
    ] == [(test_pouch.id, 0)]
    persisted_draft = OnboardingDraft.query.filter_by(
        user_id=test_user.id
    ).one()
    assert (persisted_draft.id, persisted_draft.structured_payload) == draft_snapshot


def test_create_from_preview_result_builder_failure_rolls_back_preferences(
    db_session, test_user,
):
    preferences = UserPreferences(
        user_id=test_user.id,
        difficult_times=['evening'],
        common_triggers=['social'],
        daily_reminders=True,
        reminder_time=time(14, 0),
    )
    draft = OnboardingDraft(
        user_id=test_user.id,
        current_step='review',
        structured_payload={
            'difficult_times': ['morning'],
            'common_triggers': ['stress'],
            'preferred_pouch_ids': [],
            'reminder_window': 'none',
        },
    )
    db_session.add_all([preferences, draft])
    db_session.commit()
    draft_snapshot = (draft.id, dict(draft.structured_payload))
    generation_input = _steady_input(start_date=date(2099, 5, 1))
    preview = PlanScheduleGenerator.generate(generation_input)

    def fail_result_builder(_plan):
        raise RuntimeError('synthetic serialization failure')

    with pytest.raises(RuntimeError, match='synthetic serialization failure'):
        PlanService.create_from_preview(
            test_user.id,
            generation_input,
            baseline_source='manual',
            preview_digest=preview.digest,
            activation='activate',
            result_builder=fail_result_builder,
        )

    assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
    persisted = UserPreferences.query.filter_by(user_id=test_user.id).one()
    assert persisted.difficult_times == ['evening']
    assert persisted.common_triggers == ['social']
    assert persisted.daily_reminders is True
    assert persisted.reminder_time == time(14, 0)
    persisted_draft = OnboardingDraft.query.filter_by(
        user_id=test_user.id
    ).one()
    assert (persisted_draft.id, persisted_draft.structured_payload) == draft_snapshot


def test_create_from_preview_stale_digest_preserves_onboarding_and_writes_nothing(
    db_session, test_user,
):
    generation_input = _steady_input(start_date=date(2099, 5, 1))
    draft = OnboardingDraft(
        user_id=test_user.id,
        current_step='review',
        structured_payload={'intention': 'reduce'},
    )
    db_session.add(draft)
    db_session.commit()

    with pytest.raises(PreviewStaleError):
        PlanService.create_from_preview(
            test_user.id,
            generation_input,
            baseline_source='manual',
            preview_digest='f' * 64,
            activation='activate',
        )

    assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 0
    assert OnboardingDraft.query.filter_by(user_id=test_user.id).one().id == draft.id


def test_create_from_preview_active_conflict_preserves_onboarding_and_new_plan(
    db_session, test_user,
):
    existing = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    revision = PlanRevision.query.filter_by(plan_id=existing.id).one()
    PlanService.activate(test_user.id, existing.id, revision.preview_digest)

    generation_input = _steady_input(start_date=date(2099, 5, 1))
    preview = PlanScheduleGenerator.generate(generation_input)
    draft = OnboardingDraft(
        user_id=test_user.id,
        current_step='review',
        structured_payload={'intention': 'reduce'},
    )
    db_session.add(draft)
    db_session.commit()

    with pytest.raises(ActivePlanConflictError):
        PlanService.create_from_preview(
            test_user.id,
            generation_input,
            baseline_source='manual',
            preview_digest=preview.digest,
            activation='activate',
        )

    assert ReductionPlan.query.filter_by(user_id=test_user.id).count() == 1
    assert OnboardingDraft.query.filter_by(user_id=test_user.id).one().id == draft.id


def test_pause_releases_active_slot_without_changing_schedule_history(
    db_session, test_user,
):
    plan = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    revision = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, revision.preview_digest)
    day_snapshot = [
        (row.id, row.revision_id, row.local_date, row.target_pouches,
         row.nicotine_ceiling_mg)
        for row in PlanDay.query.filter_by(plan_id=plan.id).order_by(PlanDay.id)
    ]

    paused = PlanService.pause(
        test_user.id,
        plan.id,
        reason='Need a steadier week',
        now=datetime(2099, 1, 12, 15, tzinfo=timezone.utc),
    )

    assert paused.status == 'paused'
    assert paused.active_slot is None
    assert [
        (row.id, row.revision_id, row.local_date, row.target_pouches,
         row.nicotine_ceiling_mg)
        for row in PlanDay.query.filter_by(plan_id=plan.id).order_by(PlanDay.id)
    ] == day_snapshot
    event = PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='paused'
    ).one()
    assert event.local_date == date(2099, 1, 12)
    assert event.reason == 'Need a steadier week'


def test_complete_and_archive_enforce_valid_state_and_append_events(
    db_session, test_user,
):
    active = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    revision = PlanRevision.query.filter_by(plan_id=active.id).one()
    PlanService.activate(test_user.id, active.id, revision.preview_digest)
    completed = PlanService.complete(
        test_user.id,
        active.id,
        now=datetime(2099, 2, 18, 12, tzinfo=timezone.utc),
    )
    assert completed.status == 'completed'
    assert completed.active_slot is None
    assert PlanStatusEvent.query.filter_by(
        plan_id=active.id, status='completed'
    ).count() == 1

    archived = PlanService.archive(
        test_user.id,
        active.id,
        reason='Keep this in my history',
        now=datetime(2099, 2, 19, 12, tzinfo=timezone.utc),
    )
    assert archived.status == 'archived'
    event = PlanStatusEvent.query.filter_by(
        plan_id=active.id, status='archived'
    ).one()
    assert event.reason == 'Keep this in my history'

    with pytest.raises(PlanStateError):
        PlanService.pause(test_user.id, active.id)
    with pytest.raises(PlanStateError):
        PlanService.activate(
            test_user.id, active.id, revision.preview_digest
        )


def test_apply_revision_preserves_started_days_and_replaces_only_future_rows(
    db_session, test_user,
):
    plan = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    initial_revision = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, initial_revision.preview_digest)
    now = datetime(2099, 1, 10, 12, tzinfo=timezone.utc)
    effective_date = date(2099, 1, 11)
    protected_before = [
        (row.id, row.revision_id, row.local_date, row.target_pouches,
         row.nicotine_ceiling_mg)
        for row in PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date < effective_date,
        ).order_by(PlanDay.local_date)
    ]
    changes = {
        'pace': 'focused',
        'duration_days': 28,
        'end_target_mg': Decimal('6.00'),
    }

    preview = PlanService.preview_revision(
        test_user.id, plan.id, changes, effective_date, now=now
    )
    assert preview.days[0].local_date == effective_date
    assert preview.days[0].target_pouches is None
    assert preview.days[-1].target_pouches is None
    assert preview.days[-1].nicotine_ceiling_mg == Decimal('6.00')

    revision = PlanService.apply_revision(
        test_user.id,
        plan.id,
        changes,
        effective_date,
        preview.digest,
        reason='difficulty_adjustment',
        note='A little more breathing room',
        now=now,
    )

    db_session.refresh(plan)
    assert plan.active_revision_id == revision.id
    assert revision.note == 'A little more breathing room'
    assert [
        (row.id, row.revision_id, row.local_date, row.target_pouches,
         row.nicotine_ceiling_mg)
        for row in PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date < effective_date,
        ).order_by(PlanDay.local_date)
    ] == protected_before
    new_future = PlanDay.query.filter(
        PlanDay.plan_id == plan.id,
        PlanDay.local_date >= effective_date,
    ).order_by(PlanDay.local_date).all()
    assert len(new_future) == 28
    assert all(row.revision_id == revision.id for row in new_future)


def test_revision_rejects_started_effective_date_and_stale_digest(
    db_session, test_user,
):
    plan = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    revision = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, revision.preview_digest)
    now = datetime(2099, 1, 10, 12, tzinfo=timezone.utc)
    changes = {
        'pace': 'focused', 'duration_days': 28,
        'end_target_mg': Decimal('6.00'),
    }

    with pytest.raises(PlanValidationError) as caught:
        PlanService.preview_revision(
            test_user.id, plan.id, changes, date(2099, 1, 10), now=now
        )
    assert 'effective_date' in caught.value.field_errors

    preview = PlanService.preview_revision(
        test_user.id, plan.id, changes, date(2099, 1, 11), now=now
    )
    before_revision_count = PlanRevision.query.filter_by(plan_id=plan.id).count()
    before_day_ids = {
        row.id for row in PlanDay.query.filter_by(plan_id=plan.id)
    }
    with pytest.raises(PreviewStaleError):
        PlanService.apply_revision(
            test_user.id,
            plan.id,
            changes,
            date(2099, 1, 11),
            '0' * 64,
            reason='user_edit',
            now=now,
        )
    assert PlanRevision.query.filter_by(plan_id=plan.id).count() == before_revision_count
    assert {
        row.id for row in PlanDay.query.filter_by(plan_id=plan.id)
    } == before_day_ids
    assert preview.digest != '0' * 64


def test_resume_creates_future_revision_and_reactivates_atomically(
    db_session, test_user,
):
    plan = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, initial.preview_digest)
    PlanService.pause(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 10, 12, tzinfo=timezone.utc),
    )
    resume_date = date(2099, 1, 15)
    protected = [
        (row.id, row.revision_id, row.local_date, row.target_pouches)
        for row in PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date < resume_date,
        ).order_by(PlanDay.local_date)
    ]
    now = datetime(2099, 1, 12, 12, tzinfo=timezone.utc)

    preview = PlanService.preview_resume(
        test_user.id, plan.id, resume_date, now=now
    )
    resumed = PlanService.resume(
        test_user.id, plan.id, resume_date, preview.digest, now=now
    )

    assert resumed.status == 'active'
    assert resumed.active_slot == 1
    revision = PlanRevision.query.filter_by(
        plan_id=plan.id, reason='resume'
    ).one()
    assert resumed.active_revision_id == revision.id
    assert [
        (row.id, row.revision_id, row.local_date, row.target_pouches)
        for row in PlanDay.query.filter(
            PlanDay.plan_id == plan.id,
            PlanDay.local_date < resume_date,
        ).order_by(PlanDay.local_date)
    ] == protected
    event = PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='active'
    ).order_by(PlanStatusEvent.id.desc()).first()
    assert event.reason == 'resumed'


def test_observe_resume_shifts_remaining_untargeted_days_without_inventing_values(
    db_session, test_user,
):
    generation_input = PlanGenerationInput(
        mode='observe', start_date=date(2099, 1, 1)
    )
    plan = PlanService.create_draft(
        test_user.id, generation_input, baseline_source='observe'
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, initial.preview_digest)
    PlanService.pause(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 2, 12, tzinfo=timezone.utc),
    )

    now = datetime(2099, 1, 3, 12, tzinfo=timezone.utc)
    preview = PlanService.preview_resume(
        test_user.id, plan.id, date(2099, 1, 5), now=now
    )
    assert len(preview.days) == 5
    assert all(
        day.target_pouches is None and day.nicotine_ceiling_mg is None
        for day in preview.days
    )
    assert preview.normalized_stages == ()

    resumed = PlanService.resume(
        test_user.id,
        plan.id,
        date(2099, 1, 5),
        preview.digest,
        now=now,
    )
    assert resumed.status == 'active'
    assert PlanDay.query.filter(
        PlanDay.plan_id == plan.id,
        PlanDay.local_date >= date(2099, 1, 5),
        PlanDay.target_pouches.is_(None),
        PlanDay.nicotine_ceiling_mg.is_(None),
    ).count() == 5


def _active_observe_plan(test_user, start=date(2099, 1, 1)):
    generation_input = PlanGenerationInput(mode='observe', start_date=start)
    plan = PlanService.create_draft(
        test_user.id, generation_input, baseline_source='observe'
    )
    initial = PlanRevision.query.filter_by(plan_id=plan.id).one()
    PlanService.activate(test_user.id, plan.id, initial.preview_digest)
    return plan


def _log_snapshot(db_session, user_id, moment, quantity, strength):
    log = Log(
        user_id=user_id,
        log_time=moment,
        log_date=moment.date(),
        quantity=quantity,
        product_brand_snapshot=(
            'Observe product' if strength is not None else None
        ),
        nicotine_mg_snapshot=strength,
    )
    db_session.add(log)
    return log


def _log_window_days(db_session, user_id, days, quantity, strength, hour=12):
    for day in days:
        _log_snapshot(
            db_session,
            user_id,
            datetime.combine(day, time(hour, 0), tzinfo=timezone.utc),
            quantity,
            strength,
        )
    db_session.commit()


def _draft_proposals(user_id):
    return ReductionPlan.query.filter_by(
        user_id=user_id, mode='reduce', baseline_source='observe'
    ).all()


def test_finish_observe_creates_one_inactive_baseline_proposal_and_completes(
    db_session, test_user,
):
    plan = _active_observe_plan(test_user)
    days = [date(2099, 1, 1) + timedelta(days=offset) for offset in range(5)]
    for day, quantity in zip(days, [2, 4, 6, 8, 10]):
        _log_window_days(db_session, test_user.id, [day], quantity,
                         Decimal('6.00'))

    finished = PlanService.finish_observe(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
    )

    assert finished.id == plan.id
    assert finished.status == 'completed'
    assert finished.active_slot is None
    events = PlanStatusEvent.query.filter_by(plan_id=plan.id).all()
    assert [(event.status, event.reason) for event in events] == [
        ('active', 'activated'),
        ('completed', 'observe_finished'),
    ]
    completed_event = events[-1]
    assert completed_event.local_date == date(2099, 1, 8)
    assert completed_event.effective_at_utc == datetime(2099, 1, 8, 12)

    proposals = _draft_proposals(test_user.id)
    assert len(proposals) == 1
    proposal = proposals[0]
    assert proposal.status == 'draft'
    assert proposal.active_slot is None
    assert proposal.baseline_pouches == Decimal('6.00')
    assert proposal.baseline_mg == Decimal('36.00')
    assert proposal.baseline_mg_per_pouch == Decimal('6.00')
    # The proposal is intentionally incomplete: the user still chooses pace,
    # targets, and dates before any revision or schedule exists.
    assert proposal.pace is None
    assert proposal.end_target_pouches is None
    assert proposal.start_date is None
    assert proposal.target_date is None
    assert proposal.active_revision_id is None
    assert PlanRevision.query.filter_by(plan_id=proposal.id).count() == 0
    assert PlanDay.query.filter_by(plan_id=proposal.id).count() == 0
    assert PlanStatusEvent.query.filter_by(plan_id=proposal.id).count() == 0


def test_finish_observe_excludes_logs_outside_the_scheduled_window(
    db_session, test_user,
):
    plan = _active_observe_plan(test_user)
    inside = [date(2099, 1, 1) + timedelta(days=offset) for offset in range(4)]
    _log_window_days(db_session, test_user.id, inside, 4, Decimal('6.00'))
    _log_window_days(
        db_session, test_user.id, [date(2098, 12, 31)], 100, Decimal('50.00')
    )
    _log_window_days(
        db_session, test_user.id, [date(2099, 1, 8)], 100, Decimal('50.00')
    )

    PlanService.finish_observe(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 9, 12, tzinfo=timezone.utc),
    )

    proposal = _draft_proposals(test_user.id)[0]
    assert proposal.baseline_pouches == Decimal('4.00')
    assert proposal.baseline_mg == Decimal('24.00')
    assert proposal.baseline_mg_per_pouch == Decimal('6.00')


def test_finish_observe_completes_without_proposal_when_evidence_is_insufficient(
    db_session, test_user,
):
    plan = _active_observe_plan(test_user)
    inside = [date(2099, 1, 1) + timedelta(days=offset) for offset in range(3)]
    _log_window_days(db_session, test_user.id, inside, 4, Decimal('6.00'))

    finished = PlanService.finish_observe(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
    )

    assert finished.status == 'completed'
    assert finished.active_slot is None
    assert PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='completed', reason='observe_finished'
    ).count() == 1
    assert _draft_proposals(test_user.id) == []


def test_finish_observe_completes_without_inventing_values_when_strength_unknown(
    db_session, test_user,
):
    plan = _active_observe_plan(test_user)
    inside = [date(2099, 1, 1) + timedelta(days=offset) for offset in range(4)]
    for index, day in enumerate(inside):
        _log_window_days(
            db_session,
            test_user.id,
            [day],
            4,
            None if index == 1 else Decimal('6.00'),
        )

    finished = PlanService.finish_observe(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
    )

    assert finished.status == 'completed'
    assert _draft_proposals(test_user.id) == []


def test_finish_observe_rejects_early_finish_without_writes(
    db_session, test_user,
):
    plan = _active_observe_plan(test_user)

    with pytest.raises(PlanStateError):
        PlanService.finish_observe(
            test_user.id,
            plan.id,
            now=datetime(2099, 1, 5, 12, tzinfo=timezone.utc),
        )
    # The final scheduled day itself is still an incomplete observe period.
    with pytest.raises(PlanStateError):
        PlanService.finish_observe(
            test_user.id,
            plan.id,
            now=datetime(2099, 1, 7, 23, tzinfo=timezone.utc),
        )

    db_session.refresh(plan)
    assert plan.status == 'active'
    assert plan.active_slot == 1
    assert PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='completed'
    ).count() == 0
    assert _draft_proposals(test_user.id) == []


def test_finish_observe_rejects_wrong_mode_and_invalid_state(
    db_session, test_user,
):
    targeted = PlanService.create_draft(
        test_user.id, _steady_input(), baseline_source='manual'
    )
    revision = PlanRevision.query.filter_by(plan_id=targeted.id).one()
    PlanService.activate(test_user.id, targeted.id, revision.preview_digest)

    with pytest.raises(PlanStateError):
        PlanService.finish_observe(
            test_user.id,
            targeted.id,
            now=datetime(2099, 3, 1, 12, tzinfo=timezone.utc),
        )

    draft_observe = PlanService.create_draft(
        test_user.id,
        PlanGenerationInput(mode='observe', start_date=date(2099, 4, 1)),
        baseline_source='observe',
    )
    with pytest.raises(PlanStateError):
        PlanService.finish_observe(
            test_user.id,
            draft_observe.id,
            now=datetime(2099, 4, 9, 12, tzinfo=timezone.utc),
        )

    db_session.refresh(targeted)
    db_session.refresh(draft_observe)
    assert targeted.status == 'active'
    assert draft_observe.status == 'draft'
    assert PlanStatusEvent.query.filter_by(
        status='completed', reason='observe_finished'
    ).count() == 0


def test_finish_observe_rejects_cross_user_and_missing_plan(
    db_session, test_user,
):
    plan = _active_observe_plan(test_user)
    other = User(email='other-finish-user@example.com', timezone='UTC')
    other.set_password('password123')
    db_session.add(other)
    db_session.commit()

    with pytest.raises(PlanNotFoundError):
        PlanService.finish_observe(
            other.id,
            plan.id,
            now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
        )
    with pytest.raises(PlanNotFoundError):
        PlanService.finish_observe(
            test_user.id,
            plan.id + 1000,
            now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
        )

    db_session.refresh(plan)
    assert plan.status == 'active'
    assert PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='completed'
    ).count() == 0


def test_finish_observe_repeat_call_raises_and_writes_nothing(
    db_session, test_user,
):
    plan = _active_observe_plan(test_user)
    inside = [date(2099, 1, 1) + timedelta(days=offset) for offset in range(4)]
    _log_window_days(db_session, test_user.id, inside, 4, Decimal('6.00'))
    PlanService.finish_observe(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
    )

    with pytest.raises(PlanStateError):
        PlanService.finish_observe(
            test_user.id,
            plan.id,
            now=datetime(2099, 1, 9, 12, tzinfo=timezone.utc),
        )

    assert len(_draft_proposals(test_user.id)) == 1
    assert PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='completed'
    ).count() == 1


def test_finish_observe_supports_paused_plans(db_session, test_user):
    plan = _active_observe_plan(test_user)
    PlanService.pause(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 5, 12, tzinfo=timezone.utc),
    )

    finished = PlanService.finish_observe(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
    )

    assert finished.status == 'completed'
    assert finished.active_slot is None
    assert PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='completed', reason='observe_finished'
    ).count() == 1


def test_finish_observe_respects_non_midnight_reset_grouping(
    db_session, test_user,
):
    from services.preference_service import PreferenceService

    preferences = PreferenceService().get_or_create_preferences(test_user.id)
    preferences.daily_reset_time = time(4, 0)
    db_session.commit()
    plan = _active_observe_plan(test_user)

    # 02:00 on the first scheduled day belongs to the previous effective day.
    _log_window_days(
        db_session, test_user.id, [date(2099, 1, 1)], 100, Decimal('50.00'),
        hour=2,
    )
    # Three plainly in-window days plus a split final effective day.
    _log_window_days(
        db_session, test_user.id, [date(2099, 1, 2)], 4, Decimal('6.00')
    )
    _log_window_days(
        db_session, test_user.id, [date(2099, 1, 4)], 4, Decimal('6.00')
    )
    _log_window_days(
        db_session, test_user.id, [date(2099, 1, 6)], 4, Decimal('6.00')
    )
    _log_window_days(
        db_session, test_user.id, [date(2099, 1, 7)], 2, Decimal('6.00')
    )
    # 02:00 on the day after the final scheduled day still belongs to the
    # final effective day and completes the fourth logged day.
    _log_window_days(
        db_session, test_user.id, [date(2099, 1, 8)], 2, Decimal('6.00'),
        hour=2,
    )
    # 05:00 the same morning is already the next effective day: excluded.
    _log_window_days(
        db_session, test_user.id, [date(2099, 1, 8)], 100, Decimal('50.00'),
        hour=5,
    )

    PlanService.finish_observe(
        test_user.id,
        plan.id,
        now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
    )

    proposal = _draft_proposals(test_user.id)[0]
    assert proposal.baseline_pouches == Decimal('4.00')
    assert proposal.baseline_mg == Decimal('24.00')
    assert proposal.baseline_mg_per_pouch == Decimal('6.00')


def test_finish_observe_rolls_back_everything_when_evidence_derivation_fails(
    db_session, test_user, monkeypatch,
):
    plan = _active_observe_plan(test_user)

    def _explode(*args, **kwargs):
        raise RuntimeError('evidence store unavailable')

    monkeypatch.setattr(
        BaselineService, 'suggest_for_window', staticmethod(_explode)
    )

    with pytest.raises(RuntimeError):
        PlanService.finish_observe(
            test_user.id,
            plan.id,
            now=datetime(2099, 1, 8, 12, tzinfo=timezone.utc),
        )

    db_session.refresh(plan)
    assert plan.status == 'active'
    assert plan.active_slot == 1
    assert PlanStatusEvent.query.filter_by(
        plan_id=plan.id, status='completed'
    ).count() == 0
    assert _draft_proposals(test_user.id) == []
