"""Canonical, ownership-safe Today summary contracts."""

from dataclasses import FrozenInstanceError, replace
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy import event

from models import (
    Craving,
    DailyCheckIn,
    Log,
    PlanDay,
    PlanRevision,
    PlanStatusEvent,
    Pouch,
    ReductionPlan,
    User,
    UserPreferences,
    UserPreferredPouch,
)
from services.api_types import (
    CanonicalCheckIn,
    CanonicalCraving,
    CanonicalLog,
)
from services.coaching_service import CoachingService
from services.request_context import bind_request_id
from services.today_service import TodayService


def _active_plan(
    session,
    user,
    *,
    start: date,
    targets: list[tuple[int | None, str | None]],
    mode: str = "reduce",
    pace: str | None = "steady",
    stages: list[dict] | None = None,
):
    plan = ReductionPlan(
        user_id=user.id,
        mode=mode,
        status="draft",
        active_slot=None,
        start_date=start,
        target_date=start + timedelta(days=len(targets) - 1),
        baseline_pouches=None if mode == "observe" else Decimal("8.00"),
        baseline_mg=None if mode == "observe" else Decimal("48.00"),
        baseline_mg_per_pouch=None if mode == "observe" else Decimal("6.00"),
        baseline_source=None if mode == "observe" else "manual",
        pace=pace,
        end_target_pouches=None if mode == "observe" else targets[-1][0],
        end_target_mg=(
            None if mode == "observe" or targets[-1][1] is None
            else Decimal(targets[-1][1])
        ),
    )
    session.add(plan)
    session.flush()
    revision = PlanRevision(
        plan_id=plan.id,
        effective_date=start,
        pace=pace,
        target_date=plan.target_date,
        end_target_pouches=plan.end_target_pouches,
        end_target_mg=plan.end_target_mg,
        generation_inputs={"stage_targets": stages},
        preview_digest=(str(plan.id) * 64)[:64],
        reason="initial",
    )
    session.add(revision)
    session.flush()
    plan.active_revision_id = revision.id
    session.add_all([
        PlanDay(
            plan_id=plan.id,
            revision_id=revision.id,
            local_date=start + timedelta(days=offset),
            target_pouches=target,
            nicotine_ceiling_mg=None if ceiling is None else Decimal(ceiling),
        )
        for offset, (target, ceiling) in enumerate(targets)
    ])
    session.flush()
    plan.status = "active"
    plan.active_slot = 1
    session.commit()
    return plan


def _log(
    session,
    user,
    *,
    occurred_at: datetime,
    quantity: int = 1,
    strength: str | None = "6.00",
    brand: str | None = "Snapshot pouch",
    pouch_id: int | None = None,
):
    row = Log(
        user_id=user.id,
        log_time=occurred_at,
        quantity=quantity,
        nicotine_mg_snapshot=None if strength is None else Decimal(strength),
        product_brand_snapshot=brand,
        pouch_id=pouch_id,
    )
    session.add(row)
    session.commit()
    return row


def test_no_plan_and_no_logs_returns_a_neutral_empty_summary(db_session, test_user):
    """Returning target-like defaults without a plan must look actionable."""
    now = datetime(2026, 7, 30, 12, tzinfo=timezone.utc)

    summary = TodayService.get_summary(
        test_user.id, local_date=date(2026, 7, 30), now=now
    )

    assert summary.local_date == date(2026, 7, 30)
    assert summary.window.start_utc == datetime(
        2026, 7, 30, tzinfo=timezone.utc
    )
    assert summary.window.end_utc == datetime(
        2026, 7, 31, tzinfo=timezone.utc
    )
    assert summary.plan is None
    assert summary.actual_pouches == 0
    assert summary.actual_nicotine_mg == Decimal("0")
    assert summary.known_nicotine_mg == Decimal("0")
    assert summary.unknown_strength_events == 0
    assert summary.remaining_pouches is None
    assert summary.remaining_nicotine_mg is None
    assert summary.status == "neutral"
    assert summary.pouch_status == "neutral"
    assert summary.nicotine_state == "neutral"
    assert summary.timeline == ()
    assert summary.smart_default is None
    assert summary.check_in is None


def test_active_observe_plan_stays_neutral_while_exposing_its_plan_day(
    db_session, test_user
):
    """Treating Observe as no plan must hide its current schedule position."""
    selected = date(2026, 7, 30)
    plan = _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(None, None)] * 7,
        mode="observe",
        pace=None,
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.plan is not None
    assert summary.plan.id == plan.id
    assert summary.plan.mode == "observe"
    assert summary.plan.day_number == 1
    assert summary.plan.target_pouches is None
    assert summary.plan.nicotine_ceiling_mg is None
    assert summary.status == "neutral"
    assert summary.pouch_status == "neutral"
    assert summary.nicotine_state == "neutral"


def test_zero_target_with_zero_use_is_on_track(db_session, test_user):
    """Using positive-only comparisons must misclassify a valid zero day."""
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(0, "0.00")],
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.status == "on_track"
    assert summary.pouch_status == "on_track"
    assert summary.nicotine_state == "on_track"
    assert summary.remaining_pouches == 0
    assert summary.remaining_nicotine_mg == Decimal("0")


def test_below_eighty_percent_totals_quantities_and_stays_on_track(
    db_session, test_user
):
    """Ignoring quantity or snapshots must undercount today's actuals."""
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(10, "60.00")],
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=3,
        strength="6.00",
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.actual_pouches == 3
    assert summary.actual_nicotine_mg == Decimal("18.00")
    assert summary.known_nicotine_mg == Decimal("18.00")
    assert summary.status == "on_track"
    assert summary.pouch_status == "on_track"
    assert summary.nicotine_state == "on_track"
    assert summary.remaining_pouches == 7
    assert summary.remaining_nicotine_mg == Decimal("42.00")


def test_exactly_eighty_percent_is_approaching(db_session, test_user):
    """Using a strict greater-than threshold must miss the exact boundary."""
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(10, "50.00")],
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=8,
        strength="5.00",
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.status == "approaching"
    assert summary.pouch_status == "approaching"
    assert summary.nicotine_state == "approaching"


def test_exact_positive_target_is_met(db_session, test_user):
    """Leaving equality in approaching must hide a reached guardrail."""
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(3, "18.00")],
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=3,
        strength="6.00",
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.status == "met"
    assert summary.pouch_status == "met"
    assert summary.nicotine_state == "met"


@pytest.mark.parametrize(
    ("target", "ceiling", "quantity", "strength", "pouch_state", "nicotine_state"),
    (
        (5, "60.00", 6, "6.00", "exceeded", "on_track"),
        (10, "20.00", 4, "6.00", "on_track", "exceeded"),
    ),
)
def test_either_exceeded_guardrail_has_top_status_priority(
    db_session,
    test_user,
    target,
    ceiling,
    quantity,
    strength,
    pouch_state,
    nicotine_state,
):
    """Checking equality/percentage first must conceal an exceeded guardrail."""
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(target, ceiling)],
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=quantity,
        strength=strength,
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.status == "exceeded"
    assert summary.pouch_status == pouch_state
    assert summary.nicotine_state == nicotine_state
    assert summary.remaining_pouches == max(target - quantity, 0)
    assert summary.remaining_nicotine_mg == max(
        Decimal(ceiling) - Decimal(quantity) * Decimal(strength), Decimal("0")
    )


def test_unknown_strength_preserves_known_fractional_subtotal_without_claiming_status(
    db_session, test_user
):
    """Treating a missing snapshot as zero must manufacture complete mg data."""
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(10, "60.00")],
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 8),
        quantity=2,
        strength="3.25",
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=1,
        strength=None,
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.actual_pouches == 3
    assert summary.actual_nicotine_mg is None
    assert summary.known_nicotine_mg == Decimal("6.50")
    assert summary.unknown_strength_events == 1
    assert summary.remaining_pouches == 7
    assert summary.remaining_nicotine_mg is None
    assert summary.status == "unknown"
    assert summary.pouch_status == "on_track"
    assert summary.nicotine_state == "unknown"


def test_mixed_timeline_is_chronological_typed_and_offset_aware(
    db_session, test_user
):
    """Generic or unsorted event payloads must break the canonical timeline."""
    selected = date(2026, 7, 30)
    unresolved = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 8),
        intensity=7,
        trigger=" Stress ",
        outcome=None,
    )
    db_session.add(unresolved)
    db_session.commit()
    log = _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=2,
        strength="3.25",
    )
    check_in = DailyCheckIn(
        user_id=test_user.id,
        local_date=selected,
        mood=3,
        confidence=4,
        reflection="Kept the next choice simple",
        context=None,
        created_at=datetime(2026, 7, 30, 10),
    )
    resolved = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 11),
        intensity=5,
        trigger="boredom",
        outcome="used_nicotine",
        linked_log_id=log.id,
        physical_symptoms='["restless"]',
    )
    db_session.add_all((check_in, resolved))
    db_session.commit()

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert [item.type for item in summary.timeline] == [
        "craving",
        "log",
        "check_in",
        "craving",
    ]
    assert isinstance(summary.timeline[0].data, CanonicalCraving)
    assert summary.timeline[0].state == "unresolved"
    assert summary.timeline[0].data.trigger == "stress"
    assert summary.timeline[0].data.outcome is None
    assert isinstance(summary.timeline[1].data, CanonicalLog)
    assert summary.timeline[1].data.linked_craving_id == resolved.id
    assert isinstance(summary.timeline[2].data, CanonicalCheckIn)
    assert summary.timeline[3].state == "used_nicotine"
    assert summary.timeline[3].data.physical_symptoms == ("restless",)
    for item in summary.timeline:
        assert item.occurred_at_utc.utcoffset() == timedelta(0)
        assert item.occurred_at_local.utcoffset() == timedelta(0)
    assert summary.check_in == summary.timeline[2].data


def test_non_midnight_reset_derives_local_day_and_excludes_exact_end_boundary(
    db_session, test_user
):
    """Using calendar dates or a closed end must count adjacent-day events."""
    test_user.timezone = "Asia/Riyadh"
    db_session.add(UserPreferences(
        user_id=test_user.id, daily_reset_time=time(4, 0)
    ))
    db_session.commit()
    db_session.expire(test_user, ["preferences"])
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 0, 59, 59),
        quantity=10,
    )
    included = _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 1),
        quantity=2,
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 31, 1),
        quantity=20,
    )

    summary = TodayService.get_summary(
        test_user.id,
        now=datetime(2026, 7, 30, 2),  # naive means UTC by contract
    )

    assert summary.local_date == date(2026, 7, 30)
    assert summary.window.start_utc == datetime(
        2026, 7, 30, 1, tzinfo=timezone.utc
    )
    assert summary.window.end_utc == datetime(
        2026, 7, 31, 1, tzinfo=timezone.utc
    )
    assert summary.actual_pouches == 2
    assert [item.id for item in summary.timeline] == [included.id]


def test_ranked_preferred_pouch_wins_over_more_recent_eligible_log(
    db_session, test_user
):
    """Choosing recency first must ignore the user's explicit exact preference."""
    preferred = Pouch(
        brand="Preferred",
        nicotine_mg=Decimal("4.50"),
        is_default=True,
        created_by=None,
    )
    recent = Pouch(
        brand="Recent",
        nicotine_mg=Decimal("6.00"),
        is_default=False,
        created_by=test_user.id,
    )
    db_session.add_all((preferred, recent))
    db_session.flush()
    db_session.add(UserPreferredPouch(
        user_id=test_user.id, pouch_id=preferred.id, rank=0
    ))
    db_session.commit()
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 29, 20),
        strength="6.00",
        brand="Recent",
        pouch_id=recent.id,
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.smart_default is not None
    assert summary.smart_default.pouch_id == preferred.id
    assert summary.smart_default.brand == "Preferred"
    assert summary.smart_default.nicotine_mg == Decimal("4.50")
    assert summary.smart_default.source == "preferred"


def test_recent_default_skips_a_newer_foreign_custom_pouch(
    db_session, test_user
):
    """Removing ownership filtering must leak another user's product default."""
    other = User(
        email="other-today@example.com",
        password_hash="not-used",
        email_verified=True,
        timezone="UTC",
    )
    db_session.add(other)
    db_session.flush()
    owned = Pouch(
        brand="Owned",
        nicotine_mg=Decimal("5.00"),
        is_default=False,
        created_by=test_user.id,
    )
    foreign = Pouch(
        brand="Foreign",
        nicotine_mg=Decimal("9.00"),
        is_default=False,
        created_by=other.id,
    )
    db_session.add_all((owned, foreign))
    db_session.commit()
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 29, 20),
        pouch_id=owned.id,
        brand="Owned",
        strength="5.00",
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 29, 21),
        pouch_id=foreign.id,
        brand="Foreign",
        strength="9.00",
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.smart_default is not None
    assert summary.smart_default.pouch_id == owned.id
    assert summary.smart_default.source == "recent"


def test_deleted_preferred_link_falls_back_to_recent_global_default(
    db_session, test_user
):
    """A stale preferred association must not suppress a usable recent default."""
    preferred = Pouch(
        brand="Temporary preferred",
        nicotine_mg=Decimal("4.00"),
        is_default=False,
        created_by=test_user.id,
    )
    global_default = Pouch(
        brand="Global",
        nicotine_mg=Decimal("6.00"),
        is_default=True,
        created_by=None,
    )
    db_session.add_all((preferred, global_default))
    db_session.flush()
    db_session.add(UserPreferredPouch(
        user_id=test_user.id, pouch_id=preferred.id, rank=0
    ))
    db_session.commit()
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 29, 20),
        pouch_id=global_default.id,
        brand="Global",
        strength="6.00",
    )
    db_session.delete(preferred)
    db_session.commit()

    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.smart_default is not None
    assert summary.smart_default.pouch_id == global_default.id
    assert summary.smart_default.brand == "Global"
    assert summary.smart_default.source == "recent"


@pytest.mark.parametrize(
    ("now", "eligible"),
    (
        (datetime(2026, 7, 30, 21, 59, tzinfo=timezone.utc), False),
        (datetime(2026, 7, 30, 22, 0, tzinfo=timezone.utc), True),
        (datetime(2026, 7, 30, 23, 59, tzinfo=timezone.utc), True),
        (datetime(2026, 7, 31, 0, 0, tzinfo=timezone.utc), False),
    ),
)
def test_check_in_is_offered_only_inside_final_two_hours_before_window_end(
    db_session, test_user, now, eligible
):
    """A loose time comparison must expose reflection outside its window."""
    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=now,
    )

    assert summary.check_in_eligible is eligible


@pytest.mark.parametrize(("quantity", "expected_status"), ((3, "met"), (4, "exceeded")))
def test_met_or_exceeded_status_offers_check_in_immediately(
    db_session, test_user, quantity, expected_status
):
    """Requiring late-day timing must hide reflection after a decisive state."""
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(3, "18.00")],
    )
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=quantity,
        strength="6.00",
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.status == expected_status
    assert summary.check_in_eligible is True


def test_saved_check_in_remains_visible_outside_offer_window_and_resets_next_day(
    db_session, test_user
):
    """Eligibility must not hide today's save or leak it into tomorrow."""
    saved = DailyCheckIn(
        user_id=test_user.id,
        local_date=date(2026, 7, 30),
        mood=4,
        confidence=3,
        reflection="A short walk helped.",
        created_at=datetime(2026, 7, 30, 12),
    )
    db_session.add(saved)
    db_session.commit()

    same_day = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 14, tzinfo=timezone.utc),
    )
    next_day = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 31),
        now=datetime(2026, 7, 31, 14, tzinfo=timezone.utc),
    )

    assert same_day.check_in_eligible is False
    assert same_day.check_in is not None
    assert same_day.check_in.id == saved.id
    assert [item.type for item in same_day.timeline] == ["check_in"]
    assert next_day.check_in is None
    assert all(item.type != "check_in" for item in next_day.timeline)


def test_paused_plan_is_explicit_neutral_tracking_without_allowance_or_pace(
    db_session, test_user
):
    """Treating a paused plan as absent or targeted must mislead the user."""
    selected = date(2026, 7, 30)
    plan = _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(5, "30.00")],
    )
    plan.status = "paused"
    plan.active_slot = None
    db_session.add(PlanStatusEvent(
        plan_id=plan.id,
        status="paused",
        effective_at_utc=datetime(2026, 7, 30, 8),
        local_date=selected,
        reason="User pause",
    ))
    db_session.commit()
    _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 10),
        quantity=7,
        strength="6.00",
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.plan is not None
    assert summary.plan.id == plan.id
    assert summary.plan.status == "paused"
    assert summary.actual_pouches == 7
    assert summary.known_nicotine_mg == Decimal("42.00")
    assert summary.status == "neutral"
    assert summary.pouch_status == "neutral"
    assert summary.nicotine_state == "neutral"
    assert summary.remaining_pouches is None
    assert summary.remaining_nicotine_mg is None


def test_stage_metadata_drives_day_number_label_and_next_reduction_milestones(
    db_session, test_user
):
    """Wall-clock math or missing stage parsing must misstate plan position."""
    start = date(2026, 7, 28)
    stages = [
        {
            "start_date": "2026-07-28",
            "end_date": "2026-07-29",
            "target_pouches": 8,
            "nicotine_ceiling_mg": "48.00",
        },
        {
            "start_date": "2026-07-30",
            "end_date": "2026-07-31",
            "target_pouches": 6,
            "nicotine_ceiling_mg": "36.00",
        },
        {
            "start_date": "2026-08-01",
            "end_date": "2026-08-02",
            "target_pouches": 4,
            "nicotine_ceiling_mg": "24.00",
        },
    ]
    _active_plan(
        db_session,
        test_user,
        start=start,
        targets=[
            (8, "48.00"),
            (8, "48.00"),
            (6, "36.00"),
            (6, "36.00"),
            (4, "24.00"),
            (4, "24.00"),
        ],
        stages=stages,
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.plan is not None
    assert summary.plan.day_number == 3
    assert summary.plan.stage_label == "Stage 2 of 3 · 6 pouches"
    assert summary.milestones == (
        "Completed 8-pouch stage",
        "Next reduction: 4 pouches on Aug 1",
    )


def test_schedule_without_stage_metadata_uses_candid_label_and_next_reduction(
    db_session, test_user
):
    """Missing explicit stages must not erase the next dated pouch reduction."""
    start = date(2026, 7, 28)
    _active_plan(
        db_session,
        test_user,
        start=start,
        targets=[
            (8, "48.00"),
            (8, "48.00"),
            (6, "36.00"),
            (6, "36.00"),
        ],
        stages=None,
    )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 29),
        now=datetime(2026, 7, 29, 12, tzinfo=timezone.utc),
    )

    assert summary.plan is not None
    assert summary.plan.stage_label == "Plan day 2"
    assert summary.milestones == (
        "Next reduction: 6 pouches on Jul 30",
    )


def test_three_exceeded_days_among_last_five_completed_targets_recommends_review(
    db_session, test_user
):
    """Counting only the current status must miss a repeated recent pattern."""
    start = date(2026, 7, 25)
    _active_plan(
        db_session,
        test_user,
        start=start,
        targets=[(5, "30.00")] * 7,
    )
    for offset, quantity in enumerate((6, 5, 6, 5, 6)):
        _log(
            db_session,
            test_user,
            occurred_at=datetime(2026, 7, 25 + offset, 10),
            quantity=quantity,
            strength="6.00",
        )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.review_recommended is True


def test_future_schedule_rows_cannot_hide_the_last_five_completed_targets(
    db_session, test_user
):
    """The bounded candidate query must exclude future rows before its limit."""
    start = date(2026, 1, 1)
    _active_plan(
        db_session,
        test_user,
        start=start,
        targets=[(5, "30.00")] * 150,
    )
    for offset, quantity in enumerate((6, 5, 6, 5, 6)):
        _log(
            db_session,
            test_user,
            occurred_at=datetime(2026, 1, 1 + offset, 10),
            quantity=quantity,
            strength="6.00",
        )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 1, 6),
        now=datetime(2026, 1, 6, 12, tzinfo=timezone.utc),
    )

    assert summary.review_recommended is True


def test_paused_and_incomplete_days_do_not_enter_review_threshold(
    db_session, test_user
):
    """Counting paused/current days must create a premature review prompt."""
    start = date(2026, 7, 24)
    plan = _active_plan(
        db_session,
        test_user,
        start=start,
        targets=[(5, "30.00")] * 7,
    )
    db_session.add_all((
        PlanStatusEvent(
            plan_id=plan.id,
            status="active",
            effective_at_utc=datetime(2026, 7, 24),
            local_date=date(2026, 7, 24),
        ),
        PlanStatusEvent(
            plan_id=plan.id,
            status="paused",
            effective_at_utc=datetime(2026, 7, 27),
            local_date=date(2026, 7, 27),
        ),
        PlanStatusEvent(
            plan_id=plan.id,
            status="active",
            effective_at_utc=datetime(2026, 7, 28),
            local_date=date(2026, 7, 28),
        ),
    ))
    db_session.commit()
    for offset, quantity in enumerate((5, 5, 5, 6, 6, 6, 6)):
        _log(
            db_session,
            test_user,
            occurred_at=datetime(2026, 7, 24 + offset, 10),
            quantity=quantity,
            strength="6.00",
        )

    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.status == "exceeded"
    assert summary.review_recommended is False


def test_coaching_failure_isolated_with_correlation_warning_and_core_data_intact(
    db_session, test_user, monkeypatch, caplog
):
    """Letting coaching escape must hide counts and primary Today data."""
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        test_user,
        start=selected,
        targets=[(5, "30.00")],
    )
    log = _log(
        db_session,
        test_user,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=2,
        strength="6.00",
    )
    request_id = "123e4567-e89b-12d3-a456-426614174000"
    bind_request_id(request_id)

    def fail_coaching(**_kwargs):
        raise RuntimeError("synthetic coaching failure")

    monkeypatch.setattr(CoachingService, "message_for_today", fail_coaching)
    caplog.set_level("WARNING", logger="services.today_service")

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.coaching is None
    assert summary.actual_pouches == 2
    assert summary.known_nicotine_mg == Decimal("12.00")
    assert summary.plan is not None
    assert [item.id for item in summary.timeline] == [log.id]
    warnings = [
        record for record in caplog.records
        if record.name == "services.today_service"
    ]
    assert len(warnings) == 1
    assert request_id in warnings[0].getMessage()


def test_every_today_domain_query_is_scoped_to_the_requested_owner(
    db_session, test_user
):
    """Removing any ownership predicate must leak foreign daily state."""
    other = User(
        email="foreign-summary@example.com",
        password_hash="not-used",
        email_verified=True,
        timezone="UTC",
    )
    db_session.add(other)
    db_session.commit()
    selected = date(2026, 7, 30)
    _active_plan(
        db_session,
        other,
        start=selected,
        targets=[(2, "12.00")],
    )
    _log(
        db_session,
        other,
        occurred_at=datetime(2026, 7, 30, 9),
        quantity=9,
        strength="9.00",
    )
    foreign_pouch = Pouch(
        brand="Foreign preferred",
        nicotine_mg=Decimal("9.00"),
        is_default=False,
        created_by=other.id,
    )
    db_session.add(foreign_pouch)
    db_session.flush()
    db_session.add_all((
        UserPreferredPouch(
            user_id=other.id, pouch_id=foreign_pouch.id, rank=0
        ),
        Craving(
            user_id=other.id,
            craving_time=datetime(2026, 7, 30, 10),
            intensity=9,
        ),
        DailyCheckIn(
            user_id=other.id,
            local_date=selected,
            mood=1,
            created_at=datetime(2026, 7, 30, 11),
        ),
    ))
    db_session.commit()

    summary = TodayService.get_summary(
        test_user.id,
        local_date=selected,
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert summary.plan is None
    assert summary.actual_pouches == 0
    assert summary.known_nicotine_mg == Decimal("0")
    assert summary.timeline == ()
    assert summary.check_in is None
    assert summary.smart_default is None
    assert summary.review_recommended is False


def test_event_composition_query_count_is_constant_as_timeline_grows(
    db_session, test_user
):
    """Per-event product reads must make the larger timeline issue more SELECTs."""
    user_id = test_user.id
    db_session.add(Log(
        user_id=user_id,
        log_time=datetime(2026, 7, 30, 8),
        quantity=1,
        nicotine_mg_snapshot=Decimal("3.25"),
        product_brand_snapshot="Immutable snapshot",
    ))
    db_session.commit()
    engine = db_session.get_bind()
    select_count = 0

    def count_selects(_conn, _cursor, statement, _parameters, _context, _many):
        nonlocal select_count
        if statement.lstrip().upper().startswith("SELECT"):
            select_count += 1

    event.listen(engine, "before_cursor_execute", count_selects)
    try:
        db_session.expunge_all()
        select_count = 0
        TodayService.get_summary(
            user_id,
            local_date=date(2026, 7, 30),
            now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
        )
        one_event_queries = select_count

        db_session.add_all([
            Log(
                user_id=user_id,
                log_time=datetime(2026, 7, 30, 8) + timedelta(minutes=index),
                quantity=1,
                nicotine_mg_snapshot=Decimal("3.25"),
                product_brand_snapshot=f"Snapshot {index}",
            )
            for index in range(1, 21)
        ])
        db_session.commit()
        db_session.expunge_all()
        select_count = 0
        summary = TodayService.get_summary(
            user_id,
            local_date=date(2026, 7, 30),
            now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
        )
        many_event_queries = select_count
    finally:
        event.remove(engine, "before_cursor_execute", count_selects)

    assert len(summary.timeline) == 21
    assert many_event_queries == one_event_queries
    assert many_event_queries <= 10


def test_today_summary_is_an_immutable_value_object(db_session, test_user):
    """Removing frozen dataclass semantics must permit post-composition drift."""
    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    with pytest.raises(FrozenInstanceError):
        summary.status = "exceeded"


@pytest.mark.parametrize(
    "invalid_generated_at",
    (
        datetime(2026, 7, 30, 12),
        datetime(
            2026, 7, 30, 15,
            tzinfo=timezone(timedelta(hours=3)),
        ),
    ),
)
def test_today_summary_rejects_generated_at_without_explicit_utc(
    db_session, test_user, invalid_generated_at
):
    """Weak timestamp validation must admit naive or non-UTC generation time."""
    summary = TodayService.get_summary(
        test_user.id,
        local_date=date(2026, 7, 30),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    with pytest.raises(ValueError, match="generated_at must be UTC"):
        replace(summary, generated_at=invalid_generated_at)


def test_canonical_event_rejects_a_non_utc_occurred_at_utc_value():
    """An aware non-UTC offset must not satisfy the canonical UTC field."""
    local = datetime(
        2026, 7, 30, 15,
        tzinfo=timezone(timedelta(hours=3)),
    )

    with pytest.raises(ValueError, match="occurred_at_utc must be UTC"):
        CanonicalLog(
            id=1,
            client_event_id=None,
            occurred_at_utc=local,
            occurred_at_local=local,
            pouch_id=None,
            product_brand=None,
            nicotine_mg=None,
            quantity=1,
            total_nicotine_mg=None,
            notes=None,
            linked_craving_id=None,
        )
