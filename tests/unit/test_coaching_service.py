"""Deterministic Today coaching contracts."""

import pytest

from services.api_types import CoachingAction
from services.coaching_service import CoachingService


def test_neutral_tracking_offers_a_calm_logging_action():
    """Removing the neutral branch must lose the next useful action."""
    message = CoachingService.message_for_today(status="neutral")

    assert message.key == "neutral_tracking"
    assert message.headline == "Track the day as it is"
    assert message.actions[0].href == "/today#quick-log"


def test_early_on_track_names_the_next_repeatable_action():
    """Collapsing on-track into neutral must lose its pacing guidance."""
    message = CoachingService.message_for_today(status="on_track")

    assert message.key == "early_on_track"
    assert message.headline == "You are on pace"
    assert "next choice" in message.body


def test_target_met_acknowledges_the_guardrail_without_telling_user_to_stop_tracking():
    """Treating met as ordinary on-track must lose the reached-target signal."""
    message = CoachingService.message_for_today(status="met")

    assert message.key == "target_met"
    assert message.headline == "Today's target is met"
    assert message.actions[0].key == "keep_logging"


def test_plan_exceeded_uses_candid_recovery_copy_without_guilt_language():
    """A generic error branch must not reintroduce shame or hide recovery."""
    message = CoachingService.message_for_today(status="exceeded")

    combined = " ".join((message.headline, message.body)).lower()
    assert message.key == "plan_exceeded"
    assert message.headline == "Plan exceeded"
    assert "one day does not erase your progress" in message.body.lower()
    assert not {"failed", "failure", "guilt", "cheated"}.intersection(combined.split())
    assert {action.key for action in message.actions} == {
        "keep_logging",
        "reflect",
        "review_plan",
    }


def test_unresolved_craving_takes_priority_over_ordinary_on_track_copy():
    """Ignoring an unresolved craving must not leave routine pacing copy first."""
    message = CoachingService.message_for_today(
        status="on_track", has_unresolved_craving=True
    )

    assert message.key == "unresolved_craving"
    assert message.actions[0].href == "/today#craving"


def test_end_of_day_reflection_takes_priority_over_routine_on_track_copy():
    """Losing the time-sensitive branch must lose the reflection prompt."""
    message = CoachingService.message_for_today(
        status="on_track", check_in_eligible=True
    )

    assert message.key == "end_of_day_reflection"
    assert message.actions[0].href == "/today#check-in"


def test_coaching_precedence_keeps_guardrail_and_craving_states_first():
    """Reordering selectors must not hide the most actionable state."""
    assert CoachingService.message_for_today(
        status="exceeded",
        has_unresolved_craving=True,
        check_in_eligible=True,
    ).key == "plan_exceeded"
    assert CoachingService.message_for_today(
        status="met",
        has_unresolved_craving=True,
        check_in_eligible=True,
    ).key == "unresolved_craving"
    assert CoachingService.message_for_today(
        status="met",
        check_in_eligible=True,
    ).key == "target_met"


def test_coaching_actions_reject_non_allowlisted_or_external_destinations():
    """Weakening href validation must permit an unsafe coaching destination."""
    with pytest.raises(ValueError, match="allowlisted internal"):
        CoachingAction(key="unsafe", label="Leave", href="https://example.com")

    with pytest.raises(ValueError, match="allowlisted internal"):
        CoachingAction(key="unsafe", label="Admin", href="/admin")
