"""Unit contracts for honest Insights comparison windows and sufficiency."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pandas as pd

from models import Craving, Log, PlanDay, PlanRevision, ReductionPlan, User
from services import enhanced_insights_service as insights_service
from services import log_service


LEGACY_KEYS = {
    "total_pouches",
    "daily_average",
    "peak_day",
    "average_time_between_pouches",
    "total_nicotine",
    "unknown_strength_count",
    "best_day",
    "consistency_score",
    "trend_direction",
    "consumption_by_time_of_day",
    "consumption_by_day_of_week",
    "brand_analysis",
    "consumption_trend",
    "heatmap_data",
    "ai_insights",
}


def test_nicotine_distributions_use_immutable_log_snapshots_and_report_coverage(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 8, 0, 0)
    _freeze_utcnow(monkeypatch, boundary)
    long_brand = "A deliberately long preserved product label for accessible rows"
    morning = _add_log(
        db_session, test_user, test_pouch,
        at=boundary - timedelta(days=1, hours=-8), quantity=2,
    )
    morning.product_brand_snapshot = long_brand
    morning.nicotine_mg_snapshot = Decimal("6.00")
    evening = _add_log(
        db_session, test_user, test_pouch,
        at=boundary - timedelta(days=1, hours=-20), quantity=1,
    )
    evening.product_brand_snapshot = "Zero strength"
    evening.nicotine_mg_snapshot = Decimal("0.00")
    unknown = Log(
        user_id=test_user.id,
        log_time=boundary - timedelta(days=2, hours=-14),
        product_brand_snapshot="Unknown strength",
        nicotine_mg_snapshot=None,
        quantity=3,
    )
    db_session.add(unknown)
    db_session.commit()

    # A mutable catalog record must never rewrite historical distribution data.
    test_pouch.brand = "Changed live catalog brand"
    test_pouch.nicotine_mg = Decimal("99.00")
    db_session.commit()

    result = insights_service.get_enhanced_insights(test_user.id, 7)

    assert result["nicotine_by_time_of_day"] == {
        "Morning (6AM-12PM)": 12.0,
        "Night (12AM-6AM)": 0.0,
        "Afternoon (12PM-6PM)": 0.0,
        "Evening (6PM-12AM)": 0.0,
    }
    assert result["nicotine_by_product"] == {
        long_brand: 12.0,
        "Zero strength": 0.0,
    }
    assert result["strength_coverage"] == {
        "known_pouches": 3,
        "unknown_pouches": 3,
        "total_pouches": 6,
        "known_percent": 50.0,
        "complete": False,
    }
    assert "Changed live catalog brand" not in result["nicotine_by_product"]


def test_nicotine_distributions_have_meaningful_empty_and_single_category_states(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 8, 0, 0)
    _freeze_utcnow(monkeypatch, boundary)
    empty = insights_service.get_enhanced_insights(test_user.id, 7)
    assert empty["nicotine_by_time_of_day"] == {}
    assert empty["nicotine_by_product"] == {}
    assert empty["strength_coverage"]["total_pouches"] == 0

    row = _add_log(
        db_session, test_user, test_pouch,
        at=boundary - timedelta(days=1, hours=-9), quantity=2,
    )
    row.product_brand_snapshot = "Only known product"
    row.nicotine_mg_snapshot = Decimal("4.00")
    db_session.commit()
    single = insights_service.get_enhanced_insights(test_user.id, 7)
    assert single["nicotine_by_time_of_day"] == {
        "Morning (6AM-12PM)": 8.0,
        "Night (12AM-6AM)": 0.0,
        "Afternoon (12PM-6PM)": 0.0,
        "Evening (6PM-12AM)": 0.0,
    }
    assert single["nicotine_by_product"] == {"Only known product": 8.0}
    assert single["strength_coverage"]["complete"] is True


def _freeze_utcnow(monkeypatch, value):
    class FrozenDateTime(datetime):
        @classmethod
        def utcnow(cls):
            return value

    monkeypatch.setattr(insights_service, "datetime", FrozenDateTime)


def _add_log(db_session, user, pouch, *, at, quantity):
    log = Log(user_id=user.id, log_time=at, quantity=quantity)
    log_service.assign_log_product(log, pouch_id=pouch.id)
    db_session.add(log)
    return log


def _add_plan(
        db_session, user, *, mode, status, start=date(2026, 8, 1),
        targets=()):
    targeted = mode in {"reduce", "quit_by_date"}
    plan = ReductionPlan(
        user_id=user.id,
        mode=mode,
        status="draft",
        start_date=start,
        target_date=(start + timedelta(days=max(len(targets) - 1, 0))),
        baseline_pouches=Decimal("8.00") if targeted else None,
        baseline_mg=Decimal("32.00") if targeted else None,
        baseline_mg_per_pouch=Decimal("4.00") if targeted else None,
        baseline_source="manual" if targeted else "observe",
        pace="steady" if targeted else None,
        end_target_pouches=targets[-1] if targets else (4 if targeted else None),
        end_target_mg=(
            Decimal((targets[-1] if targets else 4) * 4)
            if targeted else None
        ),
    )
    db_session.add(plan)
    db_session.flush()
    revision = PlanRevision(
        plan_id=plan.id,
        effective_date=start,
        pace=plan.pace,
        target_date=plan.target_date,
        end_target_pouches=plan.end_target_pouches,
        end_target_mg=plan.end_target_mg,
        generation_inputs={},
        preview_digest=(str(plan.id) * 64)[:64],
        reason="initial",
    )
    db_session.add(revision)
    db_session.flush()
    plan.active_revision_id = revision.id
    db_session.add_all([
        PlanDay(
            plan_id=plan.id,
            revision_id=revision.id,
            local_date=start + timedelta(days=offset),
            target_pouches=target if targeted else None,
            nicotine_ceiling_mg=(
                Decimal(target * 4) if targeted else None
            ),
        )
        for offset, target in enumerate(targets)
    ])
    plan.status = status
    plan.active_slot = 1 if status == "active" else None
    db_session.commit()
    return plan


def _plan_frame(db_session, user, pouch, *, boundary, quantities):
    for days_ago, quantity in quantities:
        _add_log(
            db_session,
            user,
            pouch,
            at=boundary - timedelta(days=days_ago, hours=-12),
            quantity=quantity,
        )
    db_session.commit()
    return insights_service.get_user_logs_df(
        user.id, user.timezone, days=7, end_at=boundary,
    )


def _add_craving(
        db_session, user, *, at, trigger, outcome, notes="private note"):
    row = Craving(
        user_id=user.id,
        craving_time=at,
        intensity=6,
        trigger=trigger,
        outcome=outcome,
        notes=notes,
        situation_context="private context",
        outcome_notes="private outcome note",
    )
    db_session.add(row)
    return row


def test_plan_context_has_exact_neutral_no_plan_contract(db_session, test_user):
    other_user = User(
        email="other-plan-owner@example.com",
        password_hash="test-hash",
        timezone="UTC",
    )
    db_session.add(other_user)
    db_session.flush()
    _add_plan(
        db_session, other_user, mode="reduce", status="active", targets=(6,),
    )

    result = insights_service._plan_context(
        test_user.id, pd.DataFrame(), datetime(2026, 8, 4), 7,
    )

    assert result == {
        "state": "none",
        "adherence_available": False,
        "mode": None,
        "status": None,
        "compared_days": 0,
        "days_on_or_below_target": None,
        "actual_pouches": None,
        "target_pouches": None,
        "difference_pouches": None,
        "adherence_rate": None,
    }


def test_plan_context_keeps_observe_and_paused_plans_neutral(
        db_session, test_user):
    observe = _add_plan(
        db_session, test_user, mode="observe", status="active",
    )

    active_observe = insights_service._plan_context(
        test_user.id, pd.DataFrame(), datetime(2026, 8, 4), 7,
    )

    assert active_observe == {
        "state": "active_observe",
        "adherence_available": False,
        "mode": "observe",
        "status": "active",
        "compared_days": 0,
        "days_on_or_below_target": None,
        "actual_pouches": None,
        "target_pouches": None,
        "difference_pouches": None,
        "adherence_rate": None,
    }

    observe.status = "archived"
    observe.active_slot = None
    _add_plan(db_session, test_user, mode="reduce", status="paused")

    paused = insights_service._plan_context(
        test_user.id, pd.DataFrame(), datetime(2026, 8, 4), 7,
    )

    assert paused == {
        "state": "paused",
        "adherence_available": False,
        "mode": "reduce",
        "status": "paused",
        "compared_days": 0,
        "days_on_or_below_target": None,
        "actual_pouches": None,
        "target_pouches": None,
        "difference_pouches": None,
        "adherence_rate": None,
    }


def test_plan_adherence_uses_only_three_matched_logged_nonfuture_dates(
        db_session, test_user, test_pouch):
    boundary = datetime(2026, 8, 4, 0, 0)
    _add_plan(
        db_session,
        test_user,
        mode="reduce",
        status="active",
        start=date(2026, 7, 31),
        targets=(9, 6, 6, 6, 2),
    )
    frame = _plan_frame(
        db_session,
        test_user,
        test_pouch,
        boundary=boundary,
        quantities=((3, 5), (2, 7), (1, 3), (0, 100)),
    )

    result = insights_service._plan_context(
        test_user.id, frame, boundary, 7,
    )

    assert result == {
        "state": "active_targeted",
        "adherence_available": True,
        "mode": "reduce",
        "status": "active",
        "compared_days": 3,
        "days_on_or_below_target": 2,
        "actual_pouches": 15,
        "target_pouches": 18,
        "difference_pouches": -3,
        "adherence_rate": 66.7,
    }


def test_plan_adherence_stays_unavailable_below_three_matched_dates(
        db_session, test_user, test_pouch):
    boundary = datetime(2026, 8, 4, 0, 0)
    _add_plan(
        db_session, test_user, mode="quit_by_date", status="active",
        start=date(2026, 8, 1), targets=(6, 6, 6),
    )
    frame = _plan_frame(
        db_session,
        test_user,
        test_pouch,
        boundary=boundary,
        quantities=((3, 5), (2, 7)),
    )

    result = insights_service._plan_context(
        test_user.id, frame, boundary, 7,
    )

    assert result == {
        "state": "active_targeted",
        "adherence_available": False,
        "mode": "quit_by_date",
        "status": "active",
        "compared_days": 2,
        "days_on_or_below_target": None,
        "actual_pouches": None,
        "target_pouches": None,
        "difference_pouches": None,
        "adherence_rate": None,
    }


def test_craving_pattern_is_unavailable_with_zero_or_two_resolved_events(
        db_session, test_user):
    start = datetime(2026, 7, 28)
    end = datetime(2026, 8, 4)

    assert insights_service._craving_pattern(test_user.id, start, end) == {
        "available": False,
        "event_count": 0,
        "resolved_count": 0,
        "leading_trigger": None,
        "leading_trigger_count": None,
        "outcome_counts": {
            "resisted": 0,
            "used_alternative": 0,
            "used_nicotine": 0,
        },
        "non_nicotine_rate": None,
    }

    _add_craving(
        db_session, test_user, at=end - timedelta(days=2),
        trigger="Stress", outcome="resisted",
    )
    _add_craving(
        db_session, test_user, at=end - timedelta(days=1),
        trigger=" stress ", outcome="used_alternative",
    )
    db_session.commit()

    sparse = insights_service._craving_pattern(test_user.id, start, end)

    assert sparse == {
        "available": False,
        "event_count": 2,
        "resolved_count": 2,
        "leading_trigger": None,
        "leading_trigger_count": None,
        "outcome_counts": {
            "resisted": 1,
            "used_alternative": 1,
            "used_nicotine": 0,
        },
        "non_nicotine_rate": None,
    }


def test_craving_pattern_requires_a_repeated_normalized_leader(
        db_session, test_user):
    start = datetime(2026, 7, 28)
    end = datetime(2026, 8, 4)
    for offset, (trigger, outcome) in enumerate((
        ("Stress", "resisted"),
        ("Social", "used_alternative"),
        ("Routine", "used_nicotine"),
    ), start=1):
        _add_craving(
            db_session, test_user, at=start + timedelta(days=offset),
            trigger=trigger, outcome=outcome,
        )
    db_session.commit()

    result = insights_service._craving_pattern(test_user.id, start, end)

    assert result["available"] is False
    assert result["event_count"] == 3
    assert result["resolved_count"] == 3
    assert result["leading_trigger"] is None
    assert result["leading_trigger_count"] is None
    assert result["non_nicotine_rate"] is None


def test_craving_pattern_requires_exact_outcomes_and_nonempty_triggers(
        db_session, test_user):
    start = datetime(2026, 7, 28)
    end = datetime(2026, 8, 4)
    rows = (
        ("Stress", "resisted"),
        (" stress ", "used_alternative"),
        ("Stress", "USED_NICOTINE"),
        ("Stress", "used_nicotine "),
        ("   ", "used_nicotine"),
    )
    for offset, (trigger, outcome) in enumerate(rows, start=1):
        _add_craving(
            db_session, test_user, at=start + timedelta(hours=offset),
            trigger=trigger, outcome=outcome,
        )
    db_session.commit()

    result = insights_service._craving_pattern(test_user.id, start, end)

    assert result == {
        "available": False,
        "event_count": 5,
        "resolved_count": 2,
        "leading_trigger": None,
        "leading_trigger_count": None,
        "outcome_counts": {
            "resisted": 1,
            "used_alternative": 1,
            "used_nicotine": 0,
        },
        "non_nicotine_rate": None,
    }


def test_craving_pattern_normalizes_trigger_and_counts_exact_outcomes(
        db_session, test_user):
    start = datetime(2026, 7, 28)
    end = datetime(2026, 8, 4)
    rows = (
        (end - timedelta(days=4), "Stress", "resisted"),
        (end - timedelta(days=3), "  stress  ", "used_alternative"),
        (end - timedelta(days=2), "Work", "used_nicotine"),
        (end - timedelta(days=1), "Stress", None),
    )
    for at, trigger, outcome in rows:
        _add_craving(
            db_session, test_user, at=at, trigger=trigger, outcome=outcome,
            notes="PRIVATE_SENTINEL",
        )
    db_session.commit()

    result = insights_service._craving_pattern(test_user.id, start, end)

    assert result == {
        "available": True,
        "event_count": 4,
        "resolved_count": 3,
        "leading_trigger": "Stress",
        "leading_trigger_count": 2,
        "outcome_counts": {
            "resisted": 1,
            "used_alternative": 1,
            "used_nicotine": 1,
        },
        "non_nicotine_rate": 66.7,
    }
    assert "PRIVATE_SENTINEL" not in repr(result)


def test_craving_pattern_excludes_other_user_future_and_out_of_range_rows(
        db_session, test_user):
    start = datetime(2026, 7, 28)
    end = datetime(2026, 8, 4)
    other_user = User(
        email="other-insights@example.com",
        password_hash="test-hash",
        timezone="UTC",
    )
    db_session.add(other_user)
    db_session.flush()
    for offset, outcome in enumerate((
        "resisted", "used_alternative", "used_nicotine",
    ), start=1):
        _add_craving(
            db_session, test_user, at=start + timedelta(days=offset),
            trigger="Routine", outcome=outcome,
        )
    excluded = (
        (test_user, start - timedelta(microseconds=1)),
        (test_user, end),
        (test_user, end + timedelta(days=1)),
        (other_user, end - timedelta(days=1)),
    )
    for owner, at in excluded:
        _add_craving(
            db_session, owner, at=at, trigger="Private trigger",
            outcome="USED_NICOTINE",
        )
    db_session.commit()

    result = insights_service._craving_pattern(test_user.id, start, end)

    assert result == {
        "available": True,
        "event_count": 3,
        "resolved_count": 3,
        "leading_trigger": "Routine",
        "leading_trigger_count": 3,
        "outcome_counts": {
            "resisted": 1,
            "used_alternative": 1,
            "used_nicotine": 1,
        },
        "non_nicotine_rate": 66.7,
    }


def test_empty_consumption_payload_keeps_plan_and_craving_authorities(
        db_session, test_user, monkeypatch):
    boundary = datetime(2026, 8, 4)
    _freeze_utcnow(monkeypatch, boundary)
    for offset, outcome in enumerate((
        "resisted", "used_alternative", "used_nicotine",
    ), start=1):
        _add_craving(
            db_session,
            test_user,
            at=boundary - timedelta(days=offset),
            trigger="Routine",
            outcome=outcome,
        )
    db_session.commit()

    result = insights_service.get_enhanced_insights(test_user.id, 7)

    assert result["total_pouches"] == 0
    assert result["observed_days"] == 0
    assert result["plan_context"]["state"] == "none"
    assert result["plan_context"]["adherence_available"] is False
    assert result["craving_pattern"] == {
        "available": True,
        "event_count": 3,
        "resolved_count": 3,
        "leading_trigger": "Routine",
        "leading_trigger_count": 3,
        "outcome_counts": {
            "resisted": 1,
            "used_alternative": 1,
            "used_nicotine": 1,
        },
        "non_nicotine_rate": 66.7,
    }
    assert result["data_sufficiency"]["plan_adherence"] is False
    assert result["data_sufficiency"]["craving_pattern"] is True


def test_equal_adjacent_windows_produce_exact_comparison_and_sufficiency(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 1, 0, 0)
    _freeze_utcnow(monkeypatch, boundary)
    current_start = boundary - timedelta(days=7)
    previous_start = current_start - timedelta(days=7)
    for offset in range(7):
        _add_log(
            db_session,
            test_user,
            test_pouch,
            at=current_start + timedelta(days=offset, hours=12),
            quantity=3,
        )
        _add_log(
            db_session,
            test_user,
            test_pouch,
            at=previous_start + timedelta(days=offset, hours=12),
            quantity=4,
        )
    db_session.commit()

    result = insights_service.get_enhanced_insights(test_user.id, 7)

    assert LEGACY_KEYS <= result.keys()
    assert result["range_days"] == 7
    assert result["observed_days"] == 7
    assert result["log_count"] == 7
    assert result["comparison"] == {
        "available": True,
        "current_total": 21,
        "previous_total": 28,
        "absolute_change": -7,
        "percent_change": -25.0,
        "direction": "down",
    }
    assert result["data_sufficiency"] == {
        "trend": True,
        "time_pattern": True,
        "brand_pattern": True,
        "heatmap": True,
        "plan_adherence": False,
        "craving_pattern": False,
    }
    assert result["plan_context"]["state"] == "none"
    assert result["craving_pattern"]["available"] is False


def test_previous_zero_is_available_without_infinite_percent(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 1, 0, 0)
    _freeze_utcnow(monkeypatch, boundary)
    _add_log(
        db_session,
        test_user,
        test_pouch,
        at=boundary - timedelta(days=1),
        quantity=2,
    )
    _add_log(
        db_session,
        test_user,
        test_pouch,
        at=boundary - timedelta(days=8),
        quantity=0,
    )
    db_session.commit()

    comparison = insights_service.get_enhanced_insights(test_user.id, 7)["comparison"]

    assert comparison == {
        "available": True,
        "current_total": 2,
        "previous_total": 0,
        "absolute_change": 2,
        "percent_change": None,
        "direction": "up",
    }


def test_sparse_and_empty_current_ranges_never_invent_a_trend(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 1, 0, 0)
    _freeze_utcnow(monkeypatch, boundary)
    for days_ago in (1, 2):
        _add_log(
            db_session,
            test_user,
            test_pouch,
            at=boundary - timedelta(days=days_ago),
            quantity=1,
        )
    _add_log(
        db_session,
        test_user,
        test_pouch,
        at=boundary - timedelta(days=8),
        quantity=3,
    )
    db_session.commit()

    sparse = insights_service.get_enhanced_insights(test_user.id, 7)
    assert sparse["observed_days"] == 2
    assert sparse["log_count"] == 2
    assert sparse["data_sufficiency"] == {
        "trend": False,
        "time_pattern": False,
        "brand_pattern": False,
        "heatmap": False,
        "plan_adherence": False,
        "craving_pattern": False,
    }

    empty_boundary = boundary + timedelta(days=7)
    _freeze_utcnow(monkeypatch, empty_boundary)
    empty = insights_service.get_enhanced_insights(test_user.id, 7)
    assert LEGACY_KEYS <= empty.keys()
    assert empty["range_days"] == 7
    assert empty["observed_days"] == 0
    assert empty["log_count"] == 0
    assert empty["comparison"]["available"] is False
    assert empty["comparison"]["current_total"] == 0
    assert empty["comparison"]["previous_total"] == 2
    assert empty["data_sufficiency"] == {
        "trend": False,
        "time_pattern": False,
        "brand_pattern": False,
        "heatmap": False,
        "plan_adherence": False,
        "craving_pattern": False,
    }


def test_log_retrieval_uses_half_open_utc_bounds_and_user_timezone(
        db_session, test_user, test_pouch):
    end_at = datetime(2026, 8, 1, 0, 0, tzinfo=timezone.utc)
    start = end_at.replace(tzinfo=None) - timedelta(days=1)
    included_start = _add_log(
        db_session, test_user, test_pouch, at=start, quantity=2,
    )
    included_end = _add_log(
        db_session, test_user, test_pouch,
        at=end_at.replace(tzinfo=None) - timedelta(microseconds=1), quantity=3,
    )
    _add_log(
        db_session, test_user, test_pouch,
        at=start - timedelta(microseconds=1), quantity=5,
    )
    _add_log(
        db_session, test_user, test_pouch,
        at=end_at.replace(tzinfo=None), quantity=7,
    )
    db_session.commit()

    frame = insights_service.get_user_logs_df(
        test_user.id, "Asia/Riyadh", days=1, end_at=end_at,
    )

    assert frame["quantity"].tolist() == [included_start.quantity, included_end.quantity]
    assert frame["utc_time"].min() == start
    assert frame["utc_time"].max() < end_at.replace(tzinfo=None)
    assert all(value.utcoffset() == timedelta(hours=3) for value in frame["user_time"])


def test_exact_shared_boundary_belongs_only_to_current_window(
        db_session, test_user, test_pouch, monkeypatch):
    boundary = datetime(2026, 8, 1, 0, 0)
    current_start = boundary - timedelta(days=7)
    _freeze_utcnow(monkeypatch, boundary)
    _add_log(db_session, test_user, test_pouch, at=current_start, quantity=5)
    _add_log(
        db_session,
        test_user,
        test_pouch,
        at=current_start - timedelta(microseconds=1),
        quantity=2,
    )
    db_session.commit()

    comparison = insights_service.get_enhanced_insights(test_user.id, 7)["comparison"]

    assert comparison["current_total"] == 5
    assert comparison["previous_total"] == 2
    assert comparison["absolute_change"] == 3
