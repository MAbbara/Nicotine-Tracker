"""Canonical daily check-in parsing and persistence contracts."""

from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from extensions import db
from models import (
    DailyCheckIn,
    PlanDay,
    PlanRevision,
    ReductionPlan,
    UserPreferences,
)
from services.api_errors import ApiValidationError
from services.check_in_service import (
    CheckInPersistenceError,
    CheckInService,
    parse_check_in_payload,
)


def _plan_for_day(session, user, local_date):
    plan = ReductionPlan(
        user_id=user.id,
        mode="reduce",
        status="draft",
        start_date=local_date,
        target_date=local_date,
        baseline_pouches=Decimal("6.00"),
        baseline_mg=Decimal("36.00"),
        baseline_mg_per_pouch=Decimal("6.00"),
        baseline_source="manual",
        pace="steady",
        end_target_pouches=5,
    )
    session.add(plan)
    session.flush()
    revision = PlanRevision(
        plan_id=plan.id,
        effective_date=local_date,
        pace="steady",
        target_date=local_date,
        end_target_pouches=5,
        generation_inputs={},
        preview_digest="c" * 64,
        reason="initial",
    )
    session.add(revision)
    session.flush()
    plan.active_revision_id = revision.id
    plan.status = "active"
    plan.active_slot = 1
    session.add(PlanDay(
        plan_id=plan.id,
        revision_id=revision.id,
        local_date=local_date,
        target_pouches=5,
        nicotine_ceiling_mg=Decimal("30.00"),
    ))
    session.commit()
    return plan


@pytest.mark.parametrize("body", [None, [], "text", 3])
def test_parser_requires_one_json_object(body):
    """Accepting a non-object would bypass the exact request shape."""
    with pytest.raises(ApiValidationError) as error:
        parse_check_in_payload(body)

    assert error.value.field_errors == {"body": ["Send one JSON object."]}


def test_parser_rejects_every_unknown_field_including_authority_fields():
    """Client authority over owner, plan, or day must never reach persistence."""
    with pytest.raises(ApiValidationError) as error:
        parse_check_in_payload({
            "mood": 3,
            "user_id": 99,
            "plan_id": 88,
            "local_date": "2026-07-30",
            "extra": "not supported",
        })

    assert error.value.field_errors == {
        "extra": ["This field is not supported."],
        "local_date": ["This field is not supported."],
        "plan_id": ["This field is not supported."],
        "user_id": ["This field is not supported."],
    }


@pytest.mark.parametrize("field", ["mood", "confidence"])
@pytest.mark.parametrize("value", [True, False, 0, 6, 1.0, 3.5, "3", [], {}])
def test_parser_rejects_non_integer_or_out_of_range_ratings(field, value):
    """Coercion or bool-as-int must not broaden the stored 1–5 contract."""
    with pytest.raises(ApiValidationError) as error:
        parse_check_in_payload({field: value})

    assert error.value.field_errors == {
        field: ["Choose a whole number from 1 to 5, or leave it blank."]
    }


def test_parser_normalizes_optional_values_and_accepts_a_completely_empty_body():
    """Whitespace and omission must produce the same four canonical nulls."""
    empty = parse_check_in_payload({})
    normalized = parse_check_in_payload({
        "mood": None,
        "confidence": 4,
        "reflection": "  The afternoon was easier.  ",
        "context": " \n\t ",
    })

    assert (empty.mood, empty.confidence, empty.reflection, empty.context) == (
        None, None, None, None,
    )
    assert normalized.mood is None
    assert normalized.confidence == 4
    assert normalized.reflection == "The afternoon was easier."
    assert normalized.context is None


@pytest.mark.parametrize("field", ["reflection", "context"])
def test_parser_accepts_2000_trimmed_characters_and_rejects_2001(field):
    """Checking the raw rather than trimmed value would misapply the limit."""
    accepted = parse_check_in_payload({field: f"  {'x' * 2000}  "})
    assert getattr(accepted, field) == "x" * 2000

    with pytest.raises(ApiValidationError) as error:
        parse_check_in_payload({field: "x" * 2001})
    assert error.value.field_errors == {
        field: ["Enter up to 2,000 characters, or leave it blank."]
    }


@pytest.mark.parametrize("field", ["reflection", "context"])
@pytest.mark.parametrize("value", [1, True, [], {}])
def test_parser_rejects_non_string_text_values(field, value):
    with pytest.raises(ApiValidationError) as error:
        parse_check_in_payload({field: value})
    assert field in error.value.field_errors


def test_service_derives_local_day_at_both_sides_of_non_midnight_reset(
    db_session, test_user
):
    """Browser dates or calendar-midnight math must assign one side incorrectly."""
    test_user.timezone = "Asia/Riyadh"
    db_session.add(UserPreferences(
        user_id=test_user.id,
        daily_reset_time=time(4, 0),
    ))
    db_session.commit()
    payload = parse_check_in_payload({"mood": 3})

    before = CheckInService.upsert_for_today(
        test_user.id,
        payload,
        now=datetime(2026, 7, 30, 0, 59, 59, tzinfo=timezone.utc),
    )
    after = CheckInService.upsert_for_today(
        test_user.id,
        payload,
        now=datetime(2026, 7, 30, 1, 0, 0, tzinfo=timezone.utc),
    )

    assert before.local_date == date(2026, 7, 29)
    assert after.local_date == date(2026, 7, 30)
    assert DailyCheckIn.query.filter_by(user_id=test_user.id).count() == 2


def test_service_create_then_update_keeps_one_owned_row_and_resolves_own_plan(
    db_session, test_user
):
    """An update must not duplicate the daily timeline identity or cross owners."""
    selected = date(2026, 7, 30)
    plan = _plan_for_day(db_session, test_user, selected)

    first = CheckInService.upsert_for_today(
        test_user.id,
        parse_check_in_payload({"mood": 2, "reflection": "First"}),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )
    first_id = first.id
    second = CheckInService.upsert_for_today(
        test_user.id,
        parse_check_in_payload({"confidence": 5, "context": "Walk"}),
        now=datetime(2026, 7, 30, 13, tzinfo=timezone.utc),
    )

    assert second.id == first_id
    assert second.plan_id == plan.id
    assert second.mood is None
    assert second.confidence == 5
    assert second.reflection is None
    assert second.context == "Walk"
    assert DailyCheckIn.query.filter_by(
        user_id=test_user.id, local_date=selected
    ).count() == 1


def test_competing_insert_is_reloaded_and_deterministically_updated(
    db_session, test_user, monkeypatch
):
    """A unique race must return one canonical row rather than leak IntegrityError."""
    real_commit = db.session.commit
    raced = False

    def competing_commit():
        nonlocal raced
        if raced:
            return real_commit()
        raced = True
        pending = next(
            row for row in db.session.new if isinstance(row, DailyCheckIn)
        )
        local_date = pending.local_date
        db.session.expunge(pending)
        db.session.rollback()
        db.session.add(DailyCheckIn(
            user_id=test_user.id,
            local_date=local_date,
            mood=1,
            reflection="Competing value",
        ))
        real_commit()
        raise IntegrityError("INSERT daily_check_in", {}, Exception("race"))

    monkeypatch.setattr(db.session, "commit", competing_commit)
    result = CheckInService.upsert_for_today(
        test_user.id,
        parse_check_in_payload({"mood": 4, "reflection": "Requested value"}),
        now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
    )

    assert result.mood == 4
    assert result.reflection == "Requested value"
    assert DailyCheckIn.query.filter_by(
        user_id=test_user.id, local_date=date(2026, 7, 30)
    ).count() == 1


def test_precommit_persistence_failure_rolls_back_exactly_once(
    db_session, test_user, monkeypatch
):
    """Layered rollback handlers must not turn one failed write into two rollbacks."""
    real_rollback = db.session.rollback
    rollback_count = 0

    def count_rollback():
        nonlocal rollback_count
        rollback_count += 1
        return real_rollback()

    def fail_commit():
        raise RuntimeError("synthetic persistence failure")

    monkeypatch.setattr(db.session, "rollback", count_rollback)
    monkeypatch.setattr(db.session, "commit", fail_commit)

    with pytest.raises(CheckInPersistenceError):
        CheckInService.upsert_for_today(
            test_user.id,
            parse_check_in_payload({"mood": 3}),
            now=datetime(2026, 7, 30, 12, tzinfo=timezone.utc),
        )

    assert rollback_count == 1
    assert DailyCheckIn.query.filter_by(user_id=test_user.id).count() == 0
