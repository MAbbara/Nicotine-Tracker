"""Read-only legacy-goal draft discovery contract tests.

Covers ``LegacyGoalService.get_draft_candidates``: it explains the inactive
draft ``ReductionPlan`` rows the additive migration created from legacy
``Goal`` rows, plus the active legacy goals that stayed unattached context.
The service is read-only: it never mutates ``Goal`` or ``ReductionPlan``
rows and never exposes ``migration_fingerprint``.
"""

import hashlib
from dataclasses import FrozenInstanceError, fields
from datetime import date

import pytest

from extensions import db
from models import Goal, ReductionPlan, User
from services.legacy_goal_service import (
    LegacyGoalDraftCandidate,
    LegacyGoalDraftReview,
    LegacyGoalRecord,
    LegacyGoalService,
)

START = date(2026, 7, 1)
END = date(2026, 8, 1)
OTHER_START = date(2026, 7, 2)
OTHER_END = date(2026, 8, 2)


def _create_user(email):
    user = User(email=email, email_verified=True, timezone='UTC')
    user.set_password('password123')
    db.session.add(user)
    db.session.commit()
    return user


def _create_goal(user_id, goal_type, target_value, start_date=START,
                 end_date=END, is_active=True):
    goal = Goal(
        user_id=user_id,
        goal_type=goal_type,
        target_value=target_value,
        start_date=start_date,
        end_date=end_date,
        is_active=is_active,
    )
    db.session.add(goal)
    db.session.commit()
    return goal


def _fingerprint(user_id, source_ids):
    canonical = ','.join(str(value) for value in sorted(source_ids))
    digest_input = f'legacy-goals:{user_id}:{canonical}'
    return hashlib.sha256(digest_input.encode('utf-8')).hexdigest()


def _create_migrated_plan(user_id, source_ids, end_target_pouches, **overrides):
    """Mirror the additive migration's legacy-goal draft backfill shape."""
    values = {
        'user_id': user_id,
        'mode': 'reduce',
        'status': 'draft',
        'baseline_source': 'legacy_goal',
        'end_target_pouches': end_target_pouches,
        'migration_fingerprint': _fingerprint(user_id, source_ids),
        'legacy_goal_ids': sorted(source_ids),
    }
    values.update(overrides)
    plan = ReductionPlan(**values)
    db.session.add(plan)
    db.session.commit()
    return plan


def _snapshot_rows():
    goals = {
        row.id: (
            row.user_id, row.goal_type, row.target_value, row.start_date,
            row.end_date, row.is_active, row.updated_at,
        )
        for row in Goal.query.all()
    }
    plans = {
        row.id: (
            row.user_id, row.mode, row.status, row.baseline_source,
            row.end_target_pouches, row.migration_fingerprint,
            list(row.legacy_goal_ids or []), row.updated_at,
        )
        for row in ReductionPlan.query.all()
    }
    return goals, plans


def test_migrated_candidate_with_exact_daily_mg_context_attaches(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    mg = _create_goal(test_user.id, 'daily_mg', 24)
    plan = _create_migrated_plan(test_user.id, [pouch.id, mg.id], 4)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert isinstance(review, LegacyGoalDraftReview)
    assert review.unattached_context_goals == ()
    assert len(review.candidates) == 1

    candidate = review.candidates[0]
    assert candidate.plan_id == plan.id
    # The plan's persisted end target is authoritative, not the goal's
    # current (possibly edited) target value.
    assert candidate.end_target_pouches == 4
    assert candidate.source_goal_ids == tuple(sorted((pouch.id, mg.id)))

    pouch_record = candidate.pouch_goal
    assert isinstance(pouch_record, LegacyGoalRecord)
    assert pouch_record.id == pouch.id
    assert pouch_record.goal_type == 'daily_pouches'
    assert pouch_record.target_value == 4
    assert pouch_record.start_date == START
    assert pouch_record.end_date == END
    assert pouch_record.is_active is True

    context = candidate.nicotine_context
    assert isinstance(context, LegacyGoalRecord)
    assert context.id == mg.id
    assert context.goal_type == 'daily_mg'
    assert context.target_value == 24
    assert context.start_date == START
    assert context.end_date == END
    assert context.is_active is True

    assert '4 pouches per day' in candidate.explanation
    assert 'nicotine' in candidate.explanation
    assert 'is included as context' in candidate.explanation


def test_only_listed_exact_date_daily_mg_attaches_as_nicotine_context(
        db_session, test_user):
    """Exact dates alone do not attach an unlisted daily-mg goal."""
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    listed_mg = _create_goal(test_user.id, 'daily_mg', 24)
    unlisted_mg = _create_goal(test_user.id, 'daily_mg', 18)
    plan = _create_migrated_plan(
        test_user.id, [pouch.id, listed_mg.id], 4,
    )

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    candidate = review.candidates[0]
    assert candidate.plan_id == plan.id
    assert candidate.nicotine_context is not None
    assert candidate.nicotine_context.id == listed_mg.id
    assert [
        record.id for record in review.unattached_context_goals
    ] == [unlisted_mg.id]


def test_plan_end_target_stays_authoritative_after_goal_edit(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    plan = _create_migrated_plan(test_user.id, [pouch.id], 4)
    pouch.target_value = 7
    db.session.commit()

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    candidate = review.candidates[0]
    assert candidate.plan_id == plan.id
    assert candidate.end_target_pouches == 4
    assert candidate.pouch_goal.target_value == 7
    assert '4 pouches per day' in candidate.explanation


def test_zero_date_matches_keep_daily_mg_as_separate_context(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 5)
    mg = _create_goal(
        test_user.id, 'daily_mg', 30,
        start_date=OTHER_START, end_date=OTHER_END,
    )
    plan = _create_migrated_plan(test_user.id, [pouch.id], 5)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    candidate = review.candidates[0]
    assert candidate.plan_id == plan.id
    assert candidate.nicotine_context is None
    assert '5 pouches per day' in candidate.explanation
    assert 'nicotine' in candidate.explanation
    assert 'is included as context' not in candidate.explanation

    assert [record.id for record in review.unattached_context_goals] == [mg.id]
    assert review.unattached_context_goals[0].goal_type == 'daily_mg'


def test_multiple_date_matches_remain_separate_context(db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 6)
    mg_first = _create_goal(test_user.id, 'daily_mg', 20)
    mg_second = _create_goal(test_user.id, 'daily_mg', 36)
    plan = _create_migrated_plan(test_user.id, [pouch.id], 6)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    assert review.candidates[0].plan_id == plan.id
    assert review.candidates[0].nicotine_context is None
    assert [
        record.id for record in review.unattached_context_goals
    ] == sorted((mg_first.id, mg_second.id))


def test_conflicting_listed_mg_sources_also_remain_separate(
        db_session, test_user):
    """Even if legacy_goal_ids lists two exactly matching daily_mg goals,
    the conflict stays visible as separate context instead of attaching."""
    pouch = _create_goal(test_user.id, 'daily_pouches', 6)
    mg_first = _create_goal(test_user.id, 'daily_mg', 20)
    mg_second = _create_goal(test_user.id, 'daily_mg', 36)
    plan = _create_migrated_plan(
        test_user.id, [pouch.id, mg_first.id, mg_second.id], 6,
    )

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    assert review.candidates[0].plan_id == plan.id
    assert review.candidates[0].nicotine_context is None
    assert [
        record.id for record in review.unattached_context_goals
    ] == sorted((mg_first.id, mg_second.id))


def test_date_match_broken_after_migration_detaches_context(
        db_session, test_user):
    """A listed daily_mg source only attaches while its dates still exactly
    match the pouch goal; after drift it remains separate context."""
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    mg = _create_goal(test_user.id, 'daily_mg', 24)
    plan = _create_migrated_plan(test_user.id, [pouch.id, mg.id], 4)
    mg.end_date = OTHER_END
    db.session.commit()

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    assert review.candidates[0].plan_id == plan.id
    assert review.candidates[0].nicotine_context is None
    assert [record.id for record in review.unattached_context_goals] == [mg.id]


def test_weekly_reduction_goal_appears_only_as_unattached_context(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 8)
    weekly = _create_goal(test_user.id, 'weekly_reduction', 2)
    plan = _create_migrated_plan(test_user.id, [pouch.id], 8)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    assert review.candidates[0].plan_id == plan.id
    assert review.candidates[0].nicotine_context is None
    assert [record.id for record in review.unattached_context_goals] == [
        weekly.id
    ]
    assert review.unattached_context_goals[0].goal_type == 'weekly_reduction'


def test_foreign_pouch_source_produces_no_candidate(db_session, test_user):
    other = _create_user('other@example.com')
    foreign_pouch = _create_goal(other.id, 'daily_pouches', 4)
    _create_migrated_plan(test_user.id, [foreign_pouch.id], 4)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert review.candidates == ()
    # The foreign goal must not leak into the requesting user's review.
    assert review.unattached_context_goals == ()


def test_foreign_mg_source_is_ignored_without_leaking(db_session, test_user):
    other = _create_user('other@example.com')
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    foreign_mg = _create_goal(other.id, 'daily_mg', 24)
    plan = _create_migrated_plan(test_user.id, [pouch.id, foreign_mg.id], 4)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    assert review.candidates[0].plan_id == plan.id
    assert review.candidates[0].nicotine_context is None
    assert review.unattached_context_goals == ()


def test_other_users_plans_and_goals_are_not_visible(db_session, test_user):
    other = _create_user('other@example.com')
    other_pouch = _create_goal(other.id, 'daily_pouches', 3)
    other_mg = _create_goal(other.id, 'daily_mg', 18)
    _create_migrated_plan(other.id, [other_pouch.id, other_mg.id], 3)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert review.candidates == ()
    assert review.unattached_context_goals == ()


def test_missing_pouch_source_produces_no_candidate(db_session, test_user):
    _create_migrated_plan(test_user.id, [999999], 4)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert review.candidates == ()
    assert review.unattached_context_goals == ()


def test_missing_mg_source_does_not_raise_or_leak(db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    plan = _create_migrated_plan(test_user.id, [pouch.id, 999998], 4)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    assert review.candidates[0].plan_id == plan.id
    assert review.candidates[0].nicotine_context is None
    assert review.candidates[0].source_goal_ids == tuple(
        sorted((pouch.id, 999998))
    )
    assert review.unattached_context_goals == ()


def test_non_pouch_only_source_produces_no_candidate(db_session, test_user):
    mg = _create_goal(test_user.id, 'daily_mg', 24)
    _create_migrated_plan(test_user.id, [mg.id], 24)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert review.candidates == ()
    # The active daily_mg goal is still surfaced as separate context.
    assert [record.id for record in review.unattached_context_goals] == [mg.id]


def test_plan_without_end_target_or_source_list_is_invalid_review_data(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    no_target = _create_migrated_plan(
        test_user.id, [pouch.id], None,
    )
    no_sources = _create_migrated_plan(
        test_user.id, [pouch.id], 4,
        migration_fingerprint=_fingerprint(test_user.id, [pouch.id, 1]),
        legacy_goal_ids=None,
    )

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert no_target.id != no_sources.id
    assert review.candidates == ()
    assert review.unattached_context_goals == ()


def test_active_legacy_plan_is_not_a_draft_candidate(db_session, test_user):
    from decimal import Decimal

    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    plan = _create_migrated_plan(
        test_user.id, [pouch.id], 4,
        status='active',
        active_slot=1,
        start_date=date(2026, 7, 15),
        baseline_pouches=Decimal('8.00'),
        baseline_mg=Decimal('48.00'),
        baseline_mg_per_pouch=Decimal('6.00'),
        pace='steady',
    )

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert plan.status == 'active'
    assert review.candidates == ()


def test_non_migration_and_non_legacy_plans_are_excluded(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    manual = ReductionPlan(
        user_id=test_user.id,
        mode='reduce',
        status='draft',
        baseline_source='manual',
        end_target_pouches=4,
        migration_fingerprint=_fingerprint(test_user.id, [pouch.id, 77]),
        legacy_goal_ids=[pouch.id],
    )
    no_fingerprint = ReductionPlan(
        user_id=test_user.id,
        mode='reduce',
        status='draft',
        baseline_source='legacy_goal',
        end_target_pouches=4,
        migration_fingerprint=None,
        legacy_goal_ids=[pouch.id],
    )
    db.session.add_all([manual, no_fingerprint])
    db.session.commit()

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert review.candidates == ()


def test_inactive_context_goals_are_omitted(db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    inactive_mg = _create_goal(
        test_user.id, 'daily_mg', 24, is_active=False,
    )
    inactive_weekly = _create_goal(
        test_user.id, 'weekly_reduction', 2, is_active=False,
    )
    plan = _create_migrated_plan(test_user.id, [pouch.id, inactive_mg.id], 4)

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    assert review.candidates[0].plan_id == plan.id
    assert review.candidates[0].nicotine_context is None
    assert inactive_weekly.is_active is False
    assert review.unattached_context_goals == ()


def test_deactivated_pouch_goal_keeps_reviewable_candidate(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    plan = _create_migrated_plan(test_user.id, [pouch.id], 4)
    pouch.is_active = False
    db.session.commit()

    review = LegacyGoalService.get_draft_candidates(test_user.id)

    assert len(review.candidates) == 1
    candidate = review.candidates[0]
    assert candidate.plan_id == plan.id
    assert candidate.pouch_goal.is_active is False


def test_deterministic_ordering_of_candidates_and_context(
        db_session, test_user):
    pouch_one = _create_goal(test_user.id, 'daily_pouches', 4)
    pouch_two = _create_goal(
        test_user.id, 'daily_pouches', 6,
        start_date=OTHER_START, end_date=OTHER_END,
    )
    mg = _create_goal(
        test_user.id, 'daily_mg', 30,
        start_date=date(2026, 6, 1), end_date=date(2026, 7, 1),
    )
    weekly = _create_goal(test_user.id, 'weekly_reduction', 2)
    plan_two = _create_migrated_plan(test_user.id, [pouch_two.id], 6)
    plan_one = _create_migrated_plan(test_user.id, [pouch_one.id], 4)
    assert plan_one.id > plan_two.id  # insertion order was reversed

    first = LegacyGoalService.get_draft_candidates(test_user.id)
    second = LegacyGoalService.get_draft_candidates(test_user.id)

    assert [c.plan_id for c in first.candidates] == sorted(
        (plan_one.id, plan_two.id)
    )
    assert [r.id for r in first.unattached_context_goals] == sorted(
        (mg.id, weekly.id)
    )
    assert first == second


def test_outputs_are_immutable_and_hide_the_fingerprint(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    mg = _create_goal(test_user.id, 'daily_mg', 24)
    _create_migrated_plan(test_user.id, [pouch.id, mg.id], 4)

    review = LegacyGoalService.get_draft_candidates(test_user.id)
    candidate = review.candidates[0]

    assert isinstance(review.candidates, tuple)
    assert isinstance(review.unattached_context_goals, tuple)
    assert isinstance(candidate.source_goal_ids, tuple)

    with pytest.raises(FrozenInstanceError):
        candidate.end_target_pouches = 1
    with pytest.raises(FrozenInstanceError):
        candidate.pouch_goal.target_value = 1
    with pytest.raises(FrozenInstanceError):
        review.candidates = ()

    for dataclass_type in (
            LegacyGoalRecord, LegacyGoalDraftCandidate, LegacyGoalDraftReview):
        assert 'migration_fingerprint' not in {
            field.name for field in fields(dataclass_type)
        }


def test_service_never_mutates_goal_or_plan_rows(db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    mg = _create_goal(test_user.id, 'daily_mg', 24)
    _create_migrated_plan(test_user.id, [pouch.id, mg.id], 4)
    before = _snapshot_rows()

    LegacyGoalService.get_draft_candidates(test_user.id)

    assert not db.session.new
    assert not db.session.dirty
    db.session.commit()
    assert _snapshot_rows() == before


def test_service_does_not_autoflush_caller_owned_pending_goal_or_plan_state(
        db_session, test_user):
    pouch = _create_goal(test_user.id, 'daily_pouches', 4)
    plan = _create_migrated_plan(test_user.id, [pouch.id], 4)
    before = _snapshot_rows()
    user_id = test_user.id

    pouch.target_value = 7
    plan.end_target_pouches = 7
    pending_goal = Goal(
        user_id=user_id,
        goal_type='daily_mg',
        target_value=42,
        start_date=START,
        end_date=END,
        is_active=True,
    )
    pending_plan = ReductionPlan(
        user_id=user_id,
        mode='observe',
        status='draft',
        baseline_source='manual',
    )
    db.session.add_all([pending_goal, pending_plan])

    assert pouch in db.session.dirty
    assert plan in db.session.dirty
    assert pending_goal in db.session.new
    assert pending_plan in db.session.new
    assert pending_goal.id is None
    assert pending_plan.id is None

    LegacyGoalService.get_draft_candidates(user_id)

    assert pouch in db.session.dirty
    assert plan in db.session.dirty
    assert pending_goal in db.session.new
    assert pending_plan in db.session.new
    assert pending_goal.id is None
    assert pending_plan.id is None

    db.session.rollback()
    assert _snapshot_rows() == before


def test_missing_user_returns_empty_review(db_session):
    review = LegacyGoalService.get_draft_candidates(424242)

    assert isinstance(review, LegacyGoalDraftReview)
    assert review.candidates == ()
    assert review.unattached_context_goals == ()
