"""Server-rendered contract for the authenticated Today home."""

from dataclasses import replace
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import logging

from bs4 import BeautifulSoup
import pytest

from models import UserSettings
from services.api_types import (
    CanonicalCheckIn,
    CanonicalCraving,
    CanonicalLog,
    CheckInTimelineItem,
    CoachingAction,
    CoachingMessage,
    CravingTimelineItem,
    LogTimelineItem,
    SmartDefault,
    TodayPlan,
    TodaySummary,
)
from services.timezone_service import UserDayWindow
from services.today_service import TodayService


SELECTED_DATE = date(2026, 7, 30)
NOW_UTC = datetime(2026, 7, 30, 12, tzinfo=timezone.utc)


def _summary(**changes):
    value = TodaySummary(
        local_date=SELECTED_DATE,
        window=UserDayWindow(
            local_date=SELECTED_DATE,
            start_utc=datetime(2026, 7, 30, tzinfo=timezone.utc),
            end_utc=datetime(2026, 7, 31, tzinfo=timezone.utc),
        ),
        plan=TodayPlan(
            id=17,
            mode="reduce",
            status="active",
            local_date=SELECTED_DATE,
            day_number=4,
            target_pouches=6,
            nicotine_ceiling_mg=Decimal("36.00"),
            pace="steady",
            stage_label="Stage 1 of 3 · 6 pouches",
        ),
        actual_pouches=2,
        actual_nicotine_mg=Decimal("12.00"),
        known_nicotine_mg=Decimal("12.00"),
        unknown_strength_events=0,
        remaining_pouches=4,
        remaining_nicotine_mg=Decimal("24.00"),
        status="on_track",
        pouch_status="on_track",
        nicotine_state="on_track",
        timeline=(),
        smart_default=None,
        check_in=None,
        coaching=None,
        check_in_eligible=False,
        review_recommended=False,
        milestones=(),
        generated_at=NOW_UTC,
    )
    return replace(value, **changes)


def _timeline_items():
    local_zone = timezone(timedelta(hours=3))
    log_data = CanonicalLog(
        id=41,
        client_event_id=None,
        occurred_at_utc=datetime(2026, 7, 30, 8, tzinfo=timezone.utc),
        occurred_at_local=datetime(2026, 7, 30, 11, tzinfo=local_zone),
        pouch_id=3,
        product_brand="Steady Mint",
        nicotine_mg=Decimal("6.00"),
        quantity=1,
        total_nicotine_mg=Decimal("6.00"),
        notes=None,
        linked_craving_id=None,
    )
    craving_data = CanonicalCraving(
        id=42,
        client_event_id=None,
        occurred_at_utc=datetime(2026, 7, 30, 9, tzinfo=timezone.utc),
        occurred_at_local=datetime(2026, 7, 30, 12, tzinfo=local_zone),
        intensity=7,
        trigger="after lunch",
        outcome=None,
        linked_log_id=None,
        duration_minutes=None,
        physical_symptoms=(),
        situation_context=None,
        outcome_notes=None,
        mood_before=None,
        mood_after=None,
        stress_level=None,
        notes=None,
    )
    check_in_data = CanonicalCheckIn(
        id=43,
        local_date=SELECTED_DATE,
        mood=3,
        confidence=4,
        reflection="Kept the afternoon deliberate.",
        context=None,
    )
    return (
        LogTimelineItem(
            type="log",
            id=41,
            occurred_at_utc=log_data.occurred_at_utc,
            occurred_at_local=log_data.occurred_at_local,
            state="confirmed",
            label="Logged Steady Mint",
            data=log_data,
        ),
        CravingTimelineItem(
            type="craving",
            id=42,
            occurred_at_utc=craving_data.occurred_at_utc,
            occurred_at_local=craving_data.occurred_at_local,
            state="unresolved",
            label="Craving recorded",
            data=craving_data,
        ),
        CheckInTimelineItem(
            type="check_in",
            id=43,
            occurred_at_utc=datetime(2026, 7, 30, 10, tzinfo=timezone.utc),
            occurred_at_local=datetime(2026, 7, 30, 13, tzinfo=local_zone),
            state="completed",
            label="Daily check-in",
            data=check_in_data,
        ),
    )


def test_authenticated_today_consumes_one_canonical_summary_and_renders_plan_day(
    logged_in_client,
    test_user,
    monkeypatch,
):
    """Legacy route-side aggregation must not bypass the canonical service."""
    calls = []

    def get_summary(cls, user_id):
        calls.append(user_id)
        return _summary()

    monkeypatch.setattr(TodayService, "get_summary", classmethod(get_summary))

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")

    assert response.status_code == 200
    assert calls == [test_user.id]
    assert "Plan day 4" in soup.get_text(" ", strip=True)


def test_targeted_today_renders_candid_pouch_and_nicotine_guardrails(
    logged_in_client,
    monkeypatch,
):
    """Dropping either guardrail must not leave a targeted day ambiguous."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary()),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    status = soup.select_one("section[aria-labelledby='today-status-title']")

    assert response.status_code == 200
    assert status is not None
    copy = status.get_text(" ", strip=True)
    assert "On track" in copy
    assert "2 of 6 pouches" in copy
    assert "4 pouches remaining" in copy
    assert "12.00 of 36.00 mg" in copy


def test_today_actions_are_real_links_with_stable_enhancement_hooks(
    logged_in_client,
    monkeypatch,
):
    """Replacing server links with inert controls must break no-JS use."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary()),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")

    log_action = soup.select_one(
        "a#today-log-action[data-today-action='log-nicotine']"
    )
    craving_fallback = soup.select_one(
        "[data-craving-action-slot] a[data-action-fallback]"
    )
    assert log_action is not None
    assert log_action.get_text(" ", strip=True).startswith("Log nicotine use")
    assert log_action["href"] == "/log/add"
    assert craving_fallback is not None
    assert craving_fallback.get_text(" ", strip=True).startswith(
        "I have a craving"
    )
    assert craving_fallback["href"] == "/cravings/cravings"


def _assert_action_slot(soup, slot_selector, href, control_id, action):
    """One visible fallback anchor, one hidden enhanced button, one name."""
    slot = soup.select_one(f"[data-action-slot]{slot_selector}")
    assert slot is not None
    assert slot.get("data-controller-ready") is None

    fallbacks = slot.select("[data-action-fallback]")
    enhanced = slot.select("[data-action-enhanced]")
    assert len(fallbacks) == 1
    assert len(enhanced) == 1

    fallback = fallbacks[0]
    control = enhanced[0]
    assert fallback.name == "a"
    assert fallback["href"] == href
    assert not fallback.has_attr("hidden")
    assert control.name == "button"
    assert control["type"] == "button"
    assert control.has_attr("hidden")
    assert control["id"] == control_id
    assert control["data-today-action"] == action

    fallback_name = " ".join(fallback.get_text(" ", strip=True).split())
    control_name = " ".join(control.get_text(" ", strip=True).split())
    assert fallback_name == control_name
    return slot, fallback, control


def test_smart_default_action_slots_pair_visible_fallback_with_hidden_enhanced(
    logged_in_client,
    monkeypatch,
):
    """Each slot must degrade to a real link and enhance to one same-named button."""
    smart_default = SmartDefault(
        pouch_id=9,
        brand="Steady Mint",
        nicotine_mg=Decimal("6.00"),
        source="preferred",
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(smart_default=smart_default)
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")

    _, _, log_control = _assert_action_slot(
        soup,
        "[data-log-action-slot]",
        "/log/add",
        "today-log-action",
        "log-nicotine",
    )
    assert log_control["data-smart-default-pouch-id"] == "9"
    assert log_control["data-smart-default-brand"] == "Steady Mint"
    assert log_control["data-smart-default-strength"] == "6.00"

    _assert_action_slot(
        soup,
        "[data-craving-action-slot]",
        "/cravings/cravings",
        "today-craving-action",
        "craving",
    )


def test_log_action_without_smart_default_renders_only_the_usable_fallback(
    logged_in_client,
    monkeypatch,
):
    """No smart default means no enhanced Log control, but Craving still pairs."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(smart_default=None)),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")

    assert soup.select_one("[data-log-action-slot]") is None
    assert soup.select_one("button#today-log-action") is None
    fallback = soup.select_one("a#today-log-action")
    assert fallback is not None
    assert fallback["href"] == "/log/add"
    assert not fallback.has_attr("hidden")

    _assert_action_slot(
        soup,
        "[data-craving-action-slot]",
        "/cravings/cravings",
        "today-craving-action",
        "craving",
    )


def test_today_timeline_preserves_service_order_and_aware_datetimes(
    logged_in_client,
    monkeypatch,
):
    """Resorting or dropping machine-readable event time must be caught."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(timeline=_timeline_items())
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    timeline = soup.select_one("ol[data-today-timeline]")

    assert timeline is not None
    assert [
        " ".join(item.get_text(" ", strip=True).split())
        for item in timeline.select(":scope > li")
    ] == [
        "11:00 Logged Steady Mint Steady Mint · 1 pouch · 6.00 mg",
        "12:00 Craving recorded Intensity 7 · Outcome not recorded",
        "13:00 Daily check-in Mood 3 of 5 · Confidence 4 of 5",
    ]
    assert [time["datetime"] for time in timeline.select("time")] == [
        "2026-07-30T11:00:00+03:00",
        "2026-07-30T12:00:00+03:00",
        "2026-07-30T13:00:00+03:00",
    ]
    assert [time["data-occurred-at-utc"] for time in timeline.select("time")] == [
        "2026-07-30T08:00:00+00:00",
        "2026-07-30T09:00:00+00:00",
        "2026-07-30T10:00:00+00:00",
    ]


def test_existing_check_in_renders_canonical_summary_and_progressive_edit_form(
    logged_in_client,
    monkeypatch,
):
    """A saved reflection must stay visible while editing remains progressive."""
    check_in = CanonicalCheckIn(
        id=51,
        local_date=SELECTED_DATE,
        mood=3,
        confidence=4,
        reflection="An afternoon walk helped.",
        context="Workday",
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(check_in=check_in)),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    check_in_section = soup.select_one(
        "section[aria-labelledby='today-check-in-title']"
    )

    assert check_in_section is not None
    assert "An afternoon walk helped." in check_in_section.get_text(" ", strip=True)
    assert "Mood 3 of 5" in check_in_section.get_text(" ", strip=True)
    assert check_in_section.select_one("[data-check-in-summary]") is not None
    assert check_in_section.select_one("button[data-check-in-edit]").get_text(
        " ", strip=True
    ) == "Edit reflection"
    form = check_in_section.select_one("form[data-check-in-form]")
    assert form is not None
    assert form.has_attr("hidden")
    assert form.select_one("textarea[name='reflection'][maxlength='2000']") is not None
    assert check_in_section.select_one("script[data-check-in-canonical]") is not None
    timeline_section = soup.select_one("section.today-timeline")
    assert list(timeline_section.next_siblings).index(check_in_section) >= 0


def test_eligible_check_in_offers_an_optional_progressive_form(
    logged_in_client,
    monkeypatch,
):
    """Eligibility should expose the real optional form without requiring it."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                check_in=None,
                check_in_eligible=True,
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    check_in_section = soup.select_one("section.today-check-in")

    assert check_in_section is not None
    offer = check_in_section.select_one("[data-check-in-offer]")
    assert offer is not None
    assert offer.select_one("button[data-check-in-open]").get_text(
        " ", strip=True
    ) == "Take a short check-in"
    assert "Details are optional" in check_in_section.get_text(" ", strip=True)
    form = check_in_section.select_one("form[data-check-in-form]")
    assert form is not None
    assert form.has_attr("hidden")
    assert len(form.select("input[name='mood'][type='radio']")) == 5
    assert len(form.select("input[name='confidence'][type='radio']")) == 5


def test_typed_coaching_renders_between_actions_and_timeline(
    logged_in_client,
    monkeypatch,
):
    """Bypassing typed coaching would duplicate decision logic in Jinja."""
    coaching = CoachingMessage(
        key="early_on_track",
        headline="Keep the next choice simple",
        body="You are within today's plan. Log the next pouch when it happens.",
        actions=(
            CoachingAction(
                key="keep_logging",
                label="Keep logging",
                href="/today#quick-log",
            ),
        ),
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(coaching=coaching)),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    coaching_section = soup.select_one("section[data-coaching-key='early_on_track']")

    assert coaching_section is not None
    assert "Keep the next choice simple" in coaching_section.get_text(" ", strip=True)
    assert coaching_section.select_one("a[href='/today#quick-log']") is not None
    assert soup.select_one("section.today-actions").find_next_sibling("section") == coaching_section
    assert coaching_section.find_next_sibling("section") == soup.select_one(
        "section.today-timeline"
    )


def test_coaching_null_uses_one_service_milestone_without_hiding_core_content(
    logged_in_client,
    monkeypatch,
):
    """A coaching outage must not remove status, actions, or useful progress."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                coaching=None,
                milestones=(
                    "Completed 7-pouch stage",
                    "Next reduction: 5 pouches on Aug 3",
                ),
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")

    milestone = soup.select_one("section[data-today-milestone]")
    assert milestone is not None
    assert "Completed 7-pouch stage" in milestone.get_text(" ", strip=True)
    assert "Next reduction: 5 pouches" not in milestone.get_text(" ", strip=True)
    assert soup.select_one("section.today-status") is not None
    assert soup.select_one("#today-log-action") is not None


def test_no_plan_explains_the_choice_without_blocking_neutral_tracking(
    logged_in_client,
    monkeypatch,
):
    """A missing plan must not become a dead end or a target-like zero."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                plan=None,
                actual_pouches=0,
                actual_nicotine_mg=Decimal("0.00"),
                known_nicotine_mg=Decimal("0.00"),
                remaining_pouches=None,
                remaining_nicotine_mg=None,
                status="neutral",
                pouch_status="neutral",
                nicotine_state="neutral",
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    status = soup.select_one("section.today-status")

    assert "No active plan" in status.get_text(" ", strip=True)
    assert "turn today's logs into a clear daily target" in status.get_text(
        " ", strip=True
    )
    assert status.select_one("a[href='/journey/onboarding']").get_text(
        " ", strip=True
    ) == "Create a plan"
    assert status.select_one("a[href='/log/add']").get_text(
        " ", strip=True
    ) == "Continue neutral tracking"


def test_no_logs_surfaces_the_smart_default_and_explains_what_logging_unlocks(
    logged_in_client,
    monkeypatch,
):
    """A blank timeline must still teach the user's most useful first action."""
    smart_default = SmartDefault(
        pouch_id=9,
        brand="Steady Mint",
        nicotine_mg=Decimal("6.00"),
        source="preferred",
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                actual_pouches=0,
                actual_nicotine_mg=Decimal("0.00"),
                known_nicotine_mg=Decimal("0.00"),
                remaining_pouches=6,
                remaining_nicotine_mg=Decimal("36.00"),
                timeline=(),
                smart_default=smart_default,
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    log_action = soup.select_one("#today-log-action")
    timeline = soup.select_one("section.today-timeline")

    assert log_action["data-smart-default-pouch-id"] == "9"
    assert "Steady Mint · 6.00 mg is ready" in log_action.get_text(
        " ", strip=True
    )
    assert "Your first log will make timing, pouch totals, and nicotine exposure visible" in timeline.get_text(
        " ", strip=True
    )


def test_observe_day_is_a_tracking_period_without_a_reduction_target(
    logged_in_client,
    monkeypatch,
):
    """Observe must never be presented as a zero or missing targeted plan."""
    observe_plan = TodayPlan(
        id=18,
        mode="observe",
        status="active",
        local_date=SELECTED_DATE,
        day_number=5,
        target_pouches=None,
        nicotine_ceiling_mg=None,
        pace=None,
        stage_label="Observe and learn",
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                plan=observe_plan,
                actual_pouches=3,
                actual_nicotine_mg=Decimal("18.00"),
                known_nicotine_mg=Decimal("18.00"),
                remaining_pouches=None,
                remaining_nicotine_mg=None,
                status="neutral",
                pouch_status="neutral",
                nicotine_state="neutral",
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    page_copy = " ".join(soup.get_text(" ", strip=True).split())
    status = soup.select_one("section.today-status")

    assert "Observe day 5" in page_copy
    assert "tracking period without a daily reduction target" in status.get_text(
        " ", strip=True
    )
    assert "3 pouches logged" in status.get_text(" ", strip=True)
    assert "18.00 mg tracked" in status.get_text(" ", strip=True)


def test_unknown_strength_keeps_pouch_progress_and_calls_the_subtotal_partial(
    logged_in_client,
    monkeypatch,
):
    """Unknown strength must never be displayed as zero or on-track nicotine."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                actual_pouches=3,
                actual_nicotine_mg=None,
                known_nicotine_mg=Decimal("12.00"),
                unknown_strength_events=1,
                remaining_pouches=3,
                remaining_nicotine_mg=None,
                status="unknown",
                pouch_status="on_track",
                nicotine_state="unknown",
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    status = soup.select_one("section.today-status")
    copy = " ".join(status.get_text(" ", strip=True).split())

    assert "3 of 6 pouches" in copy
    assert "Nicotine unknown" in copy
    assert "Unknown — 12.00 mg known subtotal is partial" in copy
    assert "0.00 of 36.00 mg" not in copy


@pytest.mark.parametrize(
    ("state", "actual_pouches", "actual_mg", "remaining", "label"),
    (
        ("approaching", 5, "30.00", 1, "Approaching plan"),
        ("met", 6, "36.00", 0, "Plan met"),
        ("exceeded", 7, "42.00", 0, "Plan exceeded"),
    ),
)
def test_targeted_status_labels_retain_actual_counts_without_failure_language(
    logged_in_client,
    monkeypatch,
    state,
    actual_pouches,
    actual_mg,
    remaining,
    label,
):
    """Canonical attention states must remain text-labelled and candid."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                actual_pouches=actual_pouches,
                actual_nicotine_mg=Decimal(actual_mg),
                known_nicotine_mg=Decimal(actual_mg),
                remaining_pouches=remaining,
                remaining_nicotine_mg=Decimal("0.00") if remaining == 0 else Decimal("6.00"),
                status=state,
                pouch_status=state,
                nicotine_state=state,
            )
        ),
    )

    response = logged_in_client.get("/today/")
    status_copy = BeautifulSoup(response.data, "html.parser").select_one(
        "section.today-status"
    ).get_text(" ", strip=True)

    assert label in status_copy
    assert f"{actual_pouches} of 6 pouches" in status_copy
    assert "Failed" not in status_copy


@pytest.mark.parametrize(
    (
        "pouch_status", "nicotine_state", "actual_pouches", "actual_mg",
        "expected", "absent",
    ),
    (
        (
            "exceeded", "approaching", 7, "30.00",
            "Pouch guardrail: 7 pouches logged; target 6.",
            "Nicotine guardrail:",
        ),
        (
            "approaching", "exceeded", 5, "42.00",
            "Nicotine guardrail: 42.00 mg logged; target 36.00 mg.",
            "Pouch guardrail:",
        ),
        (
            "exceeded", "exceeded", 7, "42.00",
            "Pouch guardrail: 7 pouches logged; target 6.",
            None,
        ),
    ),
)
def test_exceeded_recovery_names_only_the_guardrails_canonical_today_exceeded(
    logged_in_client,
    monkeypatch,
    pouch_status,
    nicotine_state,
    actual_pouches,
    actual_mg,
    expected,
    absent,
):
    """Generic or color-only recovery must not obscure which limit changed."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                actual_pouches=actual_pouches,
                actual_nicotine_mg=Decimal(actual_mg),
                known_nicotine_mg=Decimal(actual_mg),
                remaining_pouches=max(6 - actual_pouches, 0),
                remaining_nicotine_mg=max(
                    Decimal("36.00") - Decimal(actual_mg), Decimal("0.00")
                ),
                status="exceeded",
                pouch_status=pouch_status,
                nicotine_state=nicotine_state,
                check_in_eligible=True,
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    recovery = soup.select_one("[data-plan-recovery]")
    copy = " ".join(recovery.get_text(" ", strip=True).split())

    assert response.status_code == 200
    assert not recovery.has_attr("hidden")
    assert "One day does not erase your progress." in copy
    assert expected in copy
    if absent is not None:
        hidden = recovery.select_one(
            "[data-plan-recovery-nicotine]"
            if absent.startswith("Nicotine")
            else "[data-plan-recovery-pouch]"
        )
        assert hidden.has_attr("hidden")


def test_unscheduled_and_paused_plan_days_render_explicit_neutral_states(
    logged_in_client,
    monkeypatch,
):
    """Neither a schedule gap nor a pause may manufacture an allowance."""
    unscheduled = replace(
        _summary().plan,
        target_pouches=None,
        nicotine_ceiling_mg=None,
        stage_label="Plan schedule",
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(
            plan=unscheduled,
            status="neutral",
            pouch_status="neutral",
            nicotine_state="neutral",
            remaining_pouches=None,
            remaining_nicotine_mg=None,
            review_recommended=True,
        )),
    )
    unscheduled_response = logged_in_client.get("/today/")
    unscheduled_copy = BeautifulSoup(
        unscheduled_response.data, "html.parser"
    ).select_one(".today-status").get_text(" ", strip=True)
    assert "No target is scheduled for this user day." in unscheduled_copy
    assert "remaining" not in unscheduled_copy.lower()
    assert "Recent days suggest the plan may deserve a review." in unscheduled_copy

    paused = replace(_summary().plan, status="paused")
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(
            plan=paused,
            actual_pouches=7,
            actual_nicotine_mg=Decimal("42.00"),
            known_nicotine_mg=Decimal("42.00"),
            status="neutral",
            pouch_status="neutral",
            nicotine_state="neutral",
            remaining_pouches=None,
            remaining_nicotine_mg=None,
            review_recommended=True,
        )),
    )
    paused_response = logged_in_client.get("/today/")
    paused_copy = BeautifulSoup(
        paused_response.data, "html.parser"
    ).select_one(".today-status").get_text(" ", strip=True)
    assert "Plan paused" in paused_copy
    assert "7 pouches logged" in paused_copy
    assert "42.00 mg tracked" in paused_copy
    assert "Plan day" not in paused_copy
    assert "remaining" not in paused_copy.lower()
    assert "Recent days suggest the plan may deserve a review." in paused_copy


@pytest.mark.parametrize(
    "forbidden",
    ("failed", "failure", "broken streak", "cheated", "blew it", "relapse"),
)
def test_exceeded_user_facing_today_copy_excludes_forbidden_language(
    logged_in_client, monkeypatch, forbidden
):
    """Recovery copy must stay candid without becoming punitive."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(
            actual_pouches=7,
            actual_nicotine_mg=Decimal("42.00"),
            known_nicotine_mg=Decimal("42.00"),
            remaining_pouches=0,
            remaining_nicotine_mg=Decimal("0.00"),
            status="exceeded",
            pouch_status="exceeded",
            nicotine_state="exceeded",
            check_in_eligible=True,
            review_recommended=True,
        )),
    )

    response = logged_in_client.get("/today/")
    visible_copy = BeautifulSoup(response.data, "html.parser").get_text(
        " ", strip=True
    ).lower()
    assert forbidden not in visible_copy


def test_core_summary_failure_keeps_recovery_actions_and_logs_request_id(
    logged_in_client,
    monkeypatch,
    caplog,
):
    """A core read failure must not become fake zero data or a generic 500."""
    request_id = "123e4567-e89b-12d3-a456-426614174000"

    def fail_summary(cls, user_id):
        raise RuntimeError("simulated Today composition failure")

    monkeypatch.setattr(TodayService, "get_summary", classmethod(fail_summary))

    with caplog.at_level(logging.ERROR, logger="app"):
        response = logged_in_client.get(
            "/today/",
            headers={"X-Request-ID": request_id},
        )
    soup = BeautifulSoup(response.data, "html.parser")
    recovery = soup.select_one("section[data-today-recovery]")

    assert response.status_code == 200
    assert recovery is not None
    assert "Today's details are temporarily unavailable" in recovery.get_text(
        " ", strip=True
    )
    assert soup.select_one("a#today-log-action[href='/log/add']") is not None
    assert soup.select_one(
        "[data-craving-action-slot] a[data-action-fallback][href='/cravings/cravings']"
    ) is not None
    assert recovery.select_one("a[href='/journey/']") is not None
    assert request_id in recovery.get_text(" ", strip=True)
    assert "0 pouches" not in soup.get_text(" ", strip=True)
    assert any(
        request_id in record.getMessage()
        and "Today summary unavailable" in record.getMessage()
        for record in caplog.records
    )


def test_root_remains_public_but_authenticated_root_redirects_to_today(
    app,
    logged_in_client,
):
    """Making Today home must not turn the public landing page private."""
    public_response = app.test_client().get("/", follow_redirects=False)
    authenticated_response = logged_in_client.get("/", follow_redirects=False)

    assert public_response.status_code == 200
    assert BeautifulSoup(public_response.data, "html.parser").select_one(
        "a[href='/auth/login']"
    ) is not None
    assert authenticated_response.status_code == 302
    assert authenticated_response.headers["Location"].endswith("/today/")


def test_successful_login_and_authenticated_login_visit_land_on_today(
    client,
    test_user,
):
    """The legacy dashboard must not remain the default authenticated home."""
    login_response = client.post(
        "/auth/login",
        data={"email": test_user.email, "password": "password123"},
        follow_redirects=False,
    )
    revisit_response = client.get("/auth/login", follow_redirects=False)

    assert login_response.status_code == 302
    assert login_response.headers["Location"].endswith("/today/")
    assert revisit_response.status_code == 302
    assert revisit_response.headers["Location"].endswith("/today/")


@pytest.mark.parametrize(
    ("next_target", "expected_location"),
    (
        ("/journey/?view=schedule", "/journey/?view=schedule"),
        ("http://localhost/journey/", "/journey/"),
        ("https://outside.example/collect", "/today/"),
        ("//outside.example/collect", "/today/"),
    ),
)
def test_login_preserves_only_internal_next_destinations(
    client,
    test_user,
    next_target,
    expected_location,
):
    """External and protocol-relative next values must never receive login."""
    response = client.post(
        "/auth/login",
        query_string={"next": next_target},
        data={"email": test_user.email, "password": "password123"},
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["Location"] == expected_location


def test_targeted_status_exposes_pace_and_accessible_pouch_progress(
    logged_in_client,
    monkeypatch,
):
    """Removing pace or progress context would weaken today's plan read."""
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary()),
    )

    response = logged_in_client.get("/today/")
    status = BeautifulSoup(response.data, "html.parser").select_one(
        "section.today-status"
    )
    progress = status.select_one("meter[aria-label='Pouch plan progress']")

    assert "Steady pace" in status.get_text(" ", strip=True)
    assert progress is not None
    assert progress["value"] == "2"
    assert progress["max"] == "6"


def test_today_has_one_h1_labelled_sections_fixed_order_and_no_chart_assets(
    logged_in_client,
    monkeypatch,
):
    """Dashboard dependencies or ambiguous document structure must stay out."""
    coaching = CoachingMessage(
        key="early_on_track",
        headline="Keep it simple",
        body="Log what happens next.",
        actions=(),
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                timeline=_timeline_items(),
                coaching=coaching,
                check_in_eligible=True,
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    page = soup.select_one("div.today-home")
    direct_sections = page.find_all("section", recursive=False)

    assert len(soup.find_all("h1")) == 1
    assert all(
        section.get("aria-labelledby")
        and section.select_one(f"#{section['aria-labelledby']}") is not None
        for section in direct_sections
    )
    assert [section.get("class", [""])[0] for section in direct_sections] == [
        "today-status",
        "today-actions",
        "today-coaching",
        "today-timeline",
        "today-check-in",
    ]
    asset_sources = " ".join(
        tag.get("src", "").casefold() for tag in soup.select("script[src]")
    )
    assert "preline" not in asset_sources
    assert "apexcharts" not in asset_sources
    assert "lodash" not in asset_sources
    assert "dashboard-charts" not in asset_sources


def test_anonymous_today_redirects_to_login_with_a_return_destination(client):
    """Today must remain session-authenticated after becoming the home."""
    response = client.get("/today/", follow_redirects=False)

    assert response.status_code == 302
    assert response.headers["Location"].startswith("/auth/login?next=")
    assert "%2Ftoday%2F" in response.headers["Location"] or "/today/" in response.headers[
        "Location"
    ]


def test_registration_without_an_active_plan_still_enters_onboarding(client):
    """Changing login home must not bypass the new-user plan decision."""
    response = client.post(
        "/auth/register",
        data={
            "email": "today-new-user@example.com",
            "password": "password123",
            "confirm_password": "password123",
        },
        follow_redirects=False,
    )

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/journey/onboarding")


def test_typed_coaching_fragment_actions_resolve_to_real_today_targets(
    logged_in_client,
    monkeypatch,
):
    """Allowlisted coaching links must not land on missing page fragments."""
    coaching = CoachingMessage(
        key="recovery_choices",
        headline="Choose a useful next step",
        body="Your record remains useful.",
        actions=(
            CoachingAction(key="log", label="Log", href="/today#quick-log"),
            CoachingAction(key="craving", label="Craving", href="/today#craving"),
            CoachingAction(key="reflect", label="Reflect", href="/today#check-in"),
        ),
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                coaching=coaching,
                check_in_eligible=True,
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")

    for fragment in ("quick-log", "craving", "check-in"):
        assert soup.select_one(f"a[href='/today#{fragment}']") is not None
        assert soup.select_one(f"#{fragment}") is not None


def test_active_targeted_plan_outside_its_schedule_tracks_neutrally_without_day_zero(
    logged_in_client,
    monkeypatch,
):
    """Plan mode alone must not imply that today's nullable guardrails exist."""
    between_days = TodayPlan(
        id=19,
        mode="reduce",
        status="active",
        local_date=SELECTED_DATE,
        day_number=0,
        target_pouches=None,
        nicotine_ceiling_mg=None,
        pace="steady",
        stage_label="Plan schedule",
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(
            lambda cls, user_id: _summary(
                plan=between_days,
                remaining_pouches=None,
                remaining_nicotine_mg=None,
                status="neutral",
                pouch_status="neutral",
                nicotine_state="neutral",
            )
        ),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    status = soup.select_one("section.today-status")
    page_copy = " ".join(soup.get_text(" ", strip=True).split())

    assert response.status_code == 200
    assert "Plan schedule" in page_copy
    assert "Plan day 0" not in page_copy
    assert "No target is scheduled for this user day" in status.get_text(
        " ", strip=True
    )
    assert "2 pouches logged" in status.get_text(" ", strip=True)
    assert "12.00 mg tracked" in status.get_text(" ", strip=True)
    assert soup.select_one("#today-log-action") is not None


def test_today_get_does_not_create_or_commit_missing_theme_settings(
    logged_in_client,
    test_user,
    db_session,
    monkeypatch,
):
    """A read-only Today visit must not introduce a settings write path."""
    assert UserSettings.query.filter_by(user_id=test_user.id).one_or_none() is None
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary()),
    )

    response = logged_in_client.get("/today/")

    assert response.status_code == 200
    db_session.expire_all()
    assert UserSettings.query.filter_by(user_id=test_user.id).one_or_none() is None


def test_stale_root_session_is_cleared_and_rendered_as_anonymous(client):
    """A deleted-user session must not render authenticated landing controls."""
    with client.session_transaction() as browser_session:
        browser_session["user_id"] = 2_147_483_647
        browser_session["user_email"] = "deleted@example.com"

    response = client.get("/", follow_redirects=False)
    soup = BeautifulSoup(response.data, "html.parser")

    assert response.status_code == 200
    with client.session_transaction() as browser_session:
        assert "user_id" not in browser_session
        assert "user_email" not in browser_session
    assert soup.select_one("a[href='/auth/login']") is not None
    assert soup.select_one("a[href='/dashboard/']") is None


def test_today_resolves_an_existing_persisted_theme_without_mutating_it(
    logged_in_client,
    test_user,
    db_session,
    monkeypatch,
):
    """The read-only settings path must still drive server theme resolution."""
    settings = UserSettings(
        user_id=test_user.id,
        theme="dark",
        chart_theme="dark",
    )
    db_session.add(settings)
    db_session.commit()
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary()),
    )

    response = logged_in_client.get("/today/")
    html = BeautifulSoup(response.data, "html.parser").select_one("html")

    assert response.status_code == 200
    assert html["data-saved-theme"] == "dark"
    assert UserSettings.query.filter_by(user_id=test_user.id).count() == 1
