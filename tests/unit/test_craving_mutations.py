"""Canonical craving mutation service and request contracts."""

from datetime import datetime, timezone

import pytest
from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from models import Craving, User
from services.api_errors import ApiValidationError


NOW = datetime(2026, 7, 30, 16, 0, tzinfo=timezone.utc)


def _create_input(**changes):
    from services.craving_service import CreateCravingInput

    values = {
        "client_event_id": "018f3f5c-68af-7e4d-bf5d-0123456789ab",
        "intensity": 7,
        "trigger": "stress",
        "occurred_at_utc": datetime(
            2026, 7, 30, 15, 42, tzinfo=timezone.utc
        ),
        "occurred_at_local": datetime.fromisoformat(
            "2026-07-30T18:42:00+03:00"
        ),
        "timezone": "Asia/Riyadh",
    }
    values.update(changes)
    return CreateCravingInput(**values)


def _create_request(**changes):
    values = {
        "client_event_id": "018f3f5c-68af-7e4d-bf5d-0123456789ab",
        "intensity": 7,
        "trigger": "stress",
        "occurred_at_local": "2026-07-30T18:42:00+03:00",
        "timezone": "Asia/Riyadh",
    }
    values.update(changes)
    return values


def test_create_service_persists_one_initially_unresolved_craving(
    db_session,
    test_user,
):
    """Removing the canonical create service must break persistence."""
    from services.craving_service import CreateCravingInput, CravingService

    payload = _create_input()

    result = CravingService.create_idempotent(test_user.id, payload)

    assert result.created is True
    assert result.craving.client_event_id == payload.client_event_id
    assert result.craving.craving_time == datetime(2026, 7, 30, 15, 42)
    assert result.craving.intensity == 7
    assert result.craving.trigger == "stress"
    assert result.craving.outcome is None
    assert result.craving.linked_log_id is None
    assert result.craving.duration_minutes is None
    assert result.craving.get_physical_symptoms_list() == []
    assert result.craving.situation_context is None
    assert result.craving.outcome_notes is None
    assert result.craving.mood_before is None
    assert result.craving.mood_after is None
    assert result.craving.stress_level is None
    assert result.craving.notes is None


def test_exact_create_replay_returns_owned_winner_without_mutating_it(
    db_session,
    test_user,
):
    """Removing the scoped lookup must create or overwrite a replay row."""
    from services.craving_service import CravingService

    first = CravingService.create_idempotent(test_user.id, _create_input())
    replay = CravingService.create_idempotent(
        test_user.id,
        _create_input(intensity=2, trigger="different"),
    )

    assert first.created is True
    assert replay.created is False
    assert replay.craving.id == first.craving.id
    assert replay.craving.intensity == 7
    assert replay.craving.trigger == "stress"
    assert db_session.query(Craving).filter_by(user_id=test_user.id).count() == 1


def test_unique_create_race_rolls_back_and_recovers_owned_winner(
    db_session,
    test_user,
    monkeypatch,
):
    """Removing race recovery must leak a duplicate-key integrity failure."""
    from services.craving_service import CravingService

    event_id = "118f3f5c-68af-7e4d-bf5d-0123456789ab"
    payload = _create_input(client_event_id=event_id)
    original_commit = db_session.commit
    original_rollback = db_session.rollback
    calls = {"commit": 0, "rollback": 0, "winner_id": None}

    def racing_commit():
        calls["commit"] += 1
        raise IntegrityError(
            "INSERT INTO craving", {}, Exception("duplicate")
        )

    def rollback_then_publish_winner():
        calls["rollback"] += 1
        original_rollback()
        winner = Craving(
            user_id=test_user.id,
            client_event_id=event_id,
            craving_time=datetime(2026, 7, 30, 15, 42),
            intensity=9,
            trigger="winner",
        )
        db_session.add(winner)
        original_commit()
        calls["winner_id"] = winner.id

    monkeypatch.setattr(db_session, "commit", racing_commit)
    monkeypatch.setattr(db_session, "rollback", rollback_then_publish_winner)

    result = CravingService.create_idempotent(test_user.id, payload)

    assert result.created is False
    assert result.craving.id == calls["winner_id"]
    assert result.craving.intensity == 9
    assert result.craving.trigger == "winner"
    assert calls == {
        "commit": 1,
        "rollback": 1,
        "winner_id": result.craving.id,
    }


def test_create_parser_returns_normalized_typed_input():
    """Removing the canonical parser must break normalized request input."""
    from services.serializers import parse_create_craving_request

    parsed = parse_create_craving_request(
        {
            "client_event_id": "018F3F5C-68AF-7E4D-BF5D-0123456789AB",
            "intensity": 7,
            "trigger": "  Work\n  Pressure  ",
            "occurred_at_local": "2026-07-30T18:42:00+03:00",
            "timezone": "Asia/Riyadh",
        },
        now=NOW,
    )

    assert parsed.client_event_id == "018f3f5c-68af-7e4d-bf5d-0123456789ab"
    assert parsed.intensity == 7
    assert parsed.trigger == "work pressure"
    assert parsed.occurred_at_utc.isoformat() == "2026-07-30T15:42:00+00:00"
    assert parsed.occurred_at_local.isoformat() == "2026-07-30T18:42:00+03:00"
    assert parsed.timezone == "Asia/Riyadh"


@pytest.mark.parametrize("body", [None, [], "text", 8])
def test_create_parser_requires_one_json_object(body):
    """Removing the body-shape guard must leak type/index failures."""
    from services.serializers import parse_create_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_create_craving_request(body, now=NOW)

    assert error.value.field_errors == {"body": ["Send one JSON object."]}


def test_create_parser_rejects_missing_and_unknown_keys_together():
    """Removing the exact-key allowlist must accept ambiguous create input."""
    from services.serializers import parse_create_craving_request

    payload = _create_request(extra="no")
    del payload["trigger"]

    with pytest.raises(ApiValidationError) as error:
        parse_create_craving_request(payload, now=NOW)

    assert error.value.field_errors == {
        "extra": ["This field is not supported."],
        "trigger": ["This field is required."],
    }


@pytest.mark.parametrize(
    "event_id",
    [
        None,
        True,
        123,
        "",
        "not-a-uuid",
        "018f3f5c68af7e4dbf5d0123456789ab",
        "{018f3f5c-68af-7e4d-bf5d-0123456789ab}",
    ],
)
def test_create_parser_requires_canonical_nonnull_uuid(event_id):
    """Weak UUID parsing must not admit ambiguous idempotency keys."""
    from services.serializers import parse_create_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_create_craving_request(
            _create_request(client_event_id=event_id),
            now=NOW,
        )

    assert error.value.field_errors == {
        "client_event_id": ["Use a canonical hyphenated UUID."]
    }


@pytest.mark.parametrize("intensity", [True, False, 0, 11, "7", 7.0, None])
def test_create_parser_requires_integer_intensity_from_one_to_ten(intensity):
    """Removing strict integer checks must admit booleans or bad ranges."""
    from services.serializers import parse_create_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_create_craving_request(
            _create_request(intensity=intensity),
            now=NOW,
        )

    assert error.value.field_errors == {
        "intensity": ["Enter a whole number from 1 to 10."]
    }


@pytest.mark.parametrize("trigger", [True, 9, [], "x" * 101])
def test_create_parser_rejects_invalid_normalized_trigger(trigger):
    """Removing trigger validation must persist non-text or oversized labels."""
    from services.serializers import parse_create_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_create_craving_request(
            _create_request(trigger=trigger),
            now=NOW,
        )

    assert error.value.field_errors == {
        "trigger": ["Enter up to 100 characters."]
    }


@pytest.mark.parametrize("trigger", [None, "", " \n\t "])
def test_create_parser_normalizes_blank_trigger_to_null(trigger):
    from services.serializers import parse_create_craving_request

    parsed = parse_create_craving_request(
        _create_request(trigger=trigger),
        now=NOW,
    )

    assert parsed.trigger is None


@pytest.mark.parametrize(
    "occurred_at_local",
    [None, 7, "", "not-a-time", "2026-07-30T18:42:00"],
)
def test_create_parser_requires_valid_offset_local_time(occurred_at_local):
    """Removing offset syntax checks must accept unverifiable wall times."""
    from services.serializers import (
        InvalidLocalTimeError,
        parse_create_craving_request,
    )

    with pytest.raises(InvalidLocalTimeError) as error:
        parse_create_craving_request(
            _create_request(occurred_at_local=occurred_at_local),
            now=NOW,
        )

    assert error.value.field_errors == {
        "occurred_at_local": ["Enter a local time with its UTC offset."]
    }


@pytest.mark.parametrize("timezone_name", ["Mars/Olympus", None, True, 7, ""])
def test_create_parser_rejects_unknown_timezone_and_offset_mismatch(timezone_name):
    """Removing IANA checks must let the client invent timezone semantics."""
    from services.serializers import (
        InvalidLocalTimeError,
        parse_create_craving_request,
    )

    with pytest.raises(InvalidLocalTimeError) as unknown:
        parse_create_craving_request(
            _create_request(timezone=timezone_name),
            now=NOW,
        )
    with pytest.raises(InvalidLocalTimeError) as mismatch:
        parse_create_craving_request(
            _create_request(
                occurred_at_local="2026-07-30T18:42:00+02:00"
            ),
            now=NOW,
        )

    assert unknown.value.field_errors == {
        "timezone": ["Choose a valid IANA timezone."]
    }
    assert mismatch.value.field_errors == {
        "occurred_at_local": [
            "Check that this time and offset match the timezone."
        ]
    }


def test_create_parser_rejects_dst_gap_and_disambiguates_overlap_by_offset():
    """Removing DST validation must shift gaps or choose an arbitrary overlap."""
    from services.serializers import (
        InvalidLocalTimeError,
        parse_create_craving_request,
    )

    with pytest.raises(InvalidLocalTimeError):
        parse_create_craving_request(
            _create_request(
                occurred_at_local="2026-03-08T02:30:00-05:00",
                timezone="America/New_York",
            ),
            now=datetime(2026, 3, 8, 8, 0, tzinfo=timezone.utc),
        )
    daylight = parse_create_craving_request(
        _create_request(
            occurred_at_local="2026-11-01T01:30:00-04:00",
            timezone="America/New_York",
        ),
        now=datetime(2026, 11, 1, 7, 0, tzinfo=timezone.utc),
    )
    standard = parse_create_craving_request(
        _create_request(
            occurred_at_local="2026-11-01T01:30:00-05:00",
            timezone="America/New_York",
        ),
        now=datetime(2026, 11, 1, 7, 0, tzinfo=timezone.utc),
    )

    assert daylight.occurred_at_utc.isoformat() == "2026-11-01T05:30:00+00:00"
    assert standard.occurred_at_utc.isoformat() == "2026-11-01T06:30:00+00:00"


@pytest.mark.parametrize(
    "instant, accepted",
    [
        (datetime(2026, 6, 30, 16, 0, tzinfo=timezone.utc), True),
        (datetime(2026, 6, 30, 15, 59, 59, tzinfo=timezone.utc), False),
        (datetime(2026, 7, 30, 16, 5, tzinfo=timezone.utc), True),
        (datetime(2026, 7, 30, 16, 5, 1, tzinfo=timezone.utc), False),
    ],
)
def test_create_parser_enforces_inclusive_event_age_window(instant, accepted):
    """Removing age bounds must admit stale or implausibly future events."""
    from services.serializers import (
        InvalidLocalTimeError,
        parse_create_craving_request,
    )

    payload = _create_request(
        occurred_at_local=instant.isoformat(),
        timezone="UTC",
    )
    if accepted:
        assert parse_create_craving_request(payload, now=NOW).occurred_at_utc == instant
    else:
        with pytest.raises(InvalidLocalTimeError) as error:
            parse_create_craving_request(payload, now=NOW)
        assert error.value.field_errors == {
            "occurred_at_local": [
                "Choose a time no more than 30 days ago or 5 minutes ahead."
            ]
        }


def test_patch_parser_distinguishes_omitted_fields_from_explicit_null():
    """Collapsing omitted and null would make nullable details impossible to clear."""
    from services.serializers import parse_update_craving_request

    patch = parse_update_craving_request({"duration_minutes": None})

    assert patch.provided_fields == frozenset({"duration_minutes"})
    assert patch.duration_minutes is None
    assert patch.mood_before is None
    assert patch.has("duration_minutes") is True
    assert patch.has("mood_before") is False


@pytest.mark.parametrize("body", [None, [], "text", 8, {}])
def test_patch_parser_requires_one_nonempty_json_object(body):
    """Removing the body guard must admit a no-op or leak type failures."""
    from services.serializers import parse_update_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_update_craving_request(body)

    assert error.value.field_errors == {
        "body": ["Send one nonempty JSON object."]
    }


def test_patch_parser_rejects_unknown_fields():
    """Removing the patch allowlist must accept fields the service cannot own."""
    from services.serializers import parse_update_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_update_craving_request({"intensity": 8, "extra": True})

    assert error.value.field_errors == {
        "extra": ["This field is not supported."],
        "intensity": ["This field is not supported."],
    }


@pytest.mark.parametrize(
    "outcome",
    [None, "", " ", "Resisted", "used", True, 1, [], {}],
)
def test_patch_parser_rejects_invalid_supplied_outcomes(outcome):
    """Weak outcome parsing would invent or admit unsupported resolutions."""
    from services.serializers import parse_update_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_update_craving_request({"outcome": outcome})

    assert error.value.field_errors == {
        "outcome": [
            "Choose resisted, used nicotine, or used alternative."
        ]
    }


@pytest.mark.parametrize(
    "outcome", ["resisted", "used_nicotine", "used_alternative"]
)
def test_patch_parser_accepts_each_canonical_outcome(outcome):
    from services.serializers import parse_update_craving_request

    patch = parse_update_craving_request({"outcome": outcome})

    assert patch.outcome == outcome
    assert patch.provided_fields == frozenset({"outcome"})


@pytest.mark.parametrize("value", [True, False, -1, 1441, "5", 5.0, []])
def test_patch_parser_rejects_invalid_duration(value):
    """Removing duration guards must admit booleans, fractions, or bad ranges."""
    from services.serializers import parse_update_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_update_craving_request({"duration_minutes": value})

    assert error.value.field_errors == {
        "duration_minutes": [
            "Enter a whole number from 0 to 1,440, or null."
        ]
    }


@pytest.mark.parametrize("field", ["mood_before", "mood_after", "stress_level"])
@pytest.mark.parametrize("value", [True, False, 0, 11, "5", 5.0, []])
def test_patch_parser_rejects_invalid_scale_values(field, value):
    """Removing scale guards must admit booleans, fractions, or bad ranges."""
    from services.serializers import parse_update_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_update_craving_request({field: value})

    assert error.value.field_errors == {
        field: ["Enter a whole number from 1 to 10, or null."]
    }


def test_patch_parser_accepts_numeric_boundaries_and_explicit_nulls():
    from services.serializers import parse_update_craving_request

    patch = parse_update_craving_request({
        "duration_minutes": 0,
        "mood_before": 1,
        "mood_after": 10,
        "stress_level": None,
    })

    assert patch.duration_minutes == 0
    assert patch.mood_before == 1
    assert patch.mood_after == 10
    assert patch.stress_level is None


@pytest.mark.parametrize("field", ["situation_context", "notes", "outcome_notes"])
@pytest.mark.parametrize("value", [True, 8, [], "x" * 2001])
def test_patch_parser_rejects_invalid_detail_text(field, value):
    """Removing text guards must persist non-text or oversized private input."""
    from services.serializers import parse_update_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_update_craving_request({field: value})

    assert error.value.field_errors == {
        field: ["Enter up to 2,000 characters, or null."]
    }


def test_patch_parser_trims_text_edges_but_preserves_meaningful_interior():
    """Collapsing interior text would corrupt intentionally structured notes."""
    from services.serializers import parse_update_craving_request

    patch = parse_update_craving_request({
        "situation_context": "  After  work\nwith Sam  ",
        "notes": "  \n\t  ",
        "outcome_notes": None,
    })

    assert patch.situation_context == "After  work\nwith Sam"
    assert patch.notes is None
    assert patch.outcome_notes is None


@pytest.mark.parametrize(
    "symptoms",
    [
        "restless",
        {"restless": True},
        ["ok", 7],
        ["x" * 81],
        [f"symptom {index}" for index in range(21)],
    ],
)
def test_patch_parser_rejects_invalid_physical_symptoms(symptoms):
    """Removing symptom guards must persist malformed or unbounded JSON text."""
    from services.serializers import parse_update_craving_request

    with pytest.raises(ApiValidationError) as error:
        parse_update_craving_request({"physical_symptoms": symptoms})

    assert error.value.field_errors == {
        "physical_symptoms": [
            "Enter up to 20 symptoms of at most 80 characters each, or null."
        ]
    }


def test_patch_parser_normalizes_and_casefold_deduplicates_symptoms():
    """Removing normalization must retain blanks and duplicate symptom labels."""
    from services.serializers import parse_update_craving_request

    patch = parse_update_craving_request({
        "physical_symptoms": [
            "  Jaw   tense  ",
            "jaw tense",
            " RESTLESS ",
            "restless",
            "  ",
        ]
    })
    cleared = parse_update_craving_request({"physical_symptoms": None})

    assert patch.physical_symptoms == ("Jaw tense", "RESTLESS")
    assert cleared.physical_symptoms == ()


def test_update_service_applies_only_provided_normalized_details(
    db_session,
    test_user,
):
    """Removing field-presence handling must overwrite omitted details."""
    from services.craving_service import CravingService
    from services.serializers import parse_update_craving_request

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=7,
        notes="old note",
        mood_before=3,
        duration_minutes=9,
    )
    craving.set_physical_symptoms_list(["old symptom"])
    db_session.add(craving)
    db_session.commit()
    patch = parse_update_craving_request({
        "notes": None,
        "duration_minutes": 0,
        "physical_symptoms": [" Jaw   tense ", "jaw tense"],
    })

    updated = CravingService.update_owned(test_user.id, craving.id, patch)

    assert updated.notes is None
    assert updated.duration_minutes == 0
    assert updated.mood_before == 3
    assert updated.get_physical_symptoms_list() == ["Jaw tense"]


@pytest.mark.parametrize(
    "outcome", ["resisted", "used_nicotine", "used_alternative"]
)
def test_update_service_claims_each_initial_outcome_with_details(
    db_session,
    test_user,
    outcome,
):
    """Removing the outcome claim must leave a user-confirmed craving unresolved."""
    from services.craving_service import CravingService
    from services.serializers import parse_update_craving_request

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=7,
    )
    db_session.add(craving)
    db_session.commit()

    updated = CravingService.update_owned(
        test_user.id,
        craving.id,
        parse_update_craving_request({
            "outcome": outcome,
            "notes": "  useful  ",
        }),
    )

    assert updated.outcome == outcome
    assert updated.notes == "useful"


def test_update_service_same_outcome_retry_updates_details_but_transition_conflicts(
    db_session,
    test_user,
):
    """Allowing a second outcome to overwrite the first breaks one-way resolution."""
    from services.craving_service import (
        CravingOutcomeConflictError,
        CravingService,
    )
    from services.serializers import parse_update_craving_request

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=7,
        outcome="resisted",
        notes="initial",
    )
    db_session.add(craving)
    db_session.commit()

    retried = CravingService.update_owned(
        test_user.id,
        craving.id,
        parse_update_craving_request({
            "outcome": "resisted",
            "notes": "same outcome retry",
        }),
    )
    with pytest.raises(CravingOutcomeConflictError):
        CravingService.update_owned(
            test_user.id,
            craving.id,
            parse_update_craving_request({
                "outcome": "used_nicotine",
                "notes": "must roll back",
            }),
        )

    db_session.expire_all()
    stored = db_session.get(Craving, craving.id)
    assert retried.outcome == "resisted"
    assert stored.outcome == "resisted"
    assert stored.notes == "same outcome retry"


def test_update_service_treats_missing_and_foreign_ids_as_same_not_found(
    db_session,
    test_user,
):
    """Ownership errors must not reveal whether another user's row exists."""
    from services.craving_service import CravingNotFoundError, CravingService
    from services.serializers import parse_update_craving_request

    other = User(
        email="foreign-craving-update@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other.set_password("password123")
    db_session.add(other)
    db_session.flush()
    foreign = Craving(
        user_id=other.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=5,
    )
    db_session.add(foreign)
    db_session.commit()
    patch = parse_update_craving_request({"notes": "private"})

    messages = []
    for craving_id in (foreign.id, foreign.id + 1000):
        with pytest.raises(CravingNotFoundError) as error:
            CravingService.update_owned(test_user.id, craving_id, patch)
        messages.append(str(error.value))

    assert messages == ["That craving does not exist."] * 2
    db_session.refresh(foreign)
    assert foreign.notes is None


def test_competing_different_outcome_claim_rolls_back_losing_details(
    db_session,
    test_user,
    monkeypatch,
):
    """A lost outcome race must not last-writer-win or retain loser details."""
    from services.craving_service import (
        CravingOutcomeConflictError,
        CravingService,
    )
    from services.serializers import parse_update_craving_request

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=7,
    )
    db_session.add(craving)
    db_session.commit()
    original_execute = db_session.execute
    original_rollback = db_session.rollback
    original_commit = db_session.commit
    published = {"done": False}

    class LostClaim:
        rowcount = 0

    def lose_conditional_claim(statement, *args, **kwargs):
        if (
            getattr(statement, "is_update", False)
            and getattr(getattr(statement, "table", None), "name", None)
            == Craving.__tablename__
            and not published["done"]
        ):
            return LostClaim()
        return original_execute(statement, *args, **kwargs)

    def rollback_then_publish_winner():
        original_rollback()
        if published["done"]:
            return
        original_execute(
            update(Craving)
            .where(Craving.id == craving.id)
            .values(outcome="resisted", notes="winner details")
        )
        original_commit()
        published["done"] = True

    monkeypatch.setattr(db_session, "execute", lose_conditional_claim)
    monkeypatch.setattr(db_session, "rollback", rollback_then_publish_winner)

    with pytest.raises(CravingOutcomeConflictError):
        CravingService.update_owned(
            test_user.id,
            craving.id,
            parse_update_craving_request({
                "outcome": "used_nicotine",
                "notes": "loser details",
            }),
        )

    db_session.expire_all()
    stored = db_session.get(Craving, craving.id)
    assert stored.outcome == "resisted"
    assert stored.notes == "winner details"


def test_canonical_craving_serializer_uses_current_timezone_and_hides_user_id(
    db_session,
    test_user,
):
    """Using model to_dict would leak user_id and noncanonical legacy values."""
    from services.serializers import (
        canonical_craving_for_timezone,
        serialize_canonical_craving,
    )

    craving = Craving(
        user_id=test_user.id,
        client_event_id="218f3f5c-68af-7e4d-bf5d-0123456789ab",
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=8,
        trigger="  Work   PRESSURE  ",
        outcome="legacy_invalid",
        duration_minutes=4,
        situation_context="After work",
        outcome_notes=None,
        mood_before=3,
        mood_after=5,
        stress_level=7,
        notes="context",
    )
    craving.set_physical_symptoms_list(["restless", "jaw tense"])
    db_session.add(craving)
    db_session.commit()

    payload = serialize_canonical_craving(
        canonical_craving_for_timezone(craving, "Asia/Riyadh")
    )

    assert payload == {
        "id": craving.id,
        "client_event_id": "218f3f5c-68af-7e4d-bf5d-0123456789ab",
        "occurred_at_utc": "2026-07-30T15:42:00+00:00",
        "occurred_at_local": "2026-07-30T18:42:00+03:00",
        "intensity": 8,
        "trigger": "work pressure",
        "outcome": None,
        "linked_log_id": None,
        "duration_minutes": 4,
        "physical_symptoms": ["restless", "jaw tense"],
        "situation_context": "After work",
        "outcome_notes": None,
        "mood_before": 3,
        "mood_after": 5,
        "stress_level": 7,
        "notes": "context",
    }
    assert "user_id" not in payload


def test_create_service_rejects_invalid_typed_input_before_writing(
    db_session,
    test_user,
):
    """Bypassing the parser must not let a service caller persist bad invariants."""
    from services.craving_service import (
        CravingService,
        CravingValidationError,
    )

    with pytest.raises(CravingValidationError) as error:
        CravingService.create_idempotent(
            test_user.id,
            _create_input(intensity=0),
        )

    assert error.value.field_errors == {
        "intensity": ["Enter a whole number from 1 to 10."]
    }
    assert db_session.query(Craving).filter_by(user_id=test_user.id).count() == 0


def test_update_service_rejects_invalid_typed_outcome_before_writing(
    db_session,
    test_user,
):
    """Bypassing the parser must not let a service caller store a bad outcome."""
    from services.craving_service import (
        CravingService,
        CravingValidationError,
        UpdateCravingInput,
    )

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=7,
    )
    db_session.add(craving)
    db_session.commit()

    with pytest.raises(CravingValidationError) as error:
        CravingService.update_owned(
            test_user.id,
            craving.id,
            UpdateCravingInput(
                provided_fields=frozenset({"outcome"}),
                outcome="legacy_invalid",
            ),
        )

    assert error.value.field_errors == {
        "outcome": [
            "Choose resisted, used nicotine, or used alternative."
        ]
    }
    db_session.refresh(craving)
    assert craving.outcome is None


@pytest.mark.parametrize("outcome", [[], {}])
def test_update_service_rejects_unhashable_typed_outcomes(
    db_session,
    test_user,
    outcome,
):
    """Direct typed callers must receive validation, never a membership TypeError."""
    from services.craving_service import (
        CravingService,
        CravingValidationError,
        UpdateCravingInput,
    )

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=7,
    )
    db_session.add(craving)
    db_session.commit()

    with pytest.raises(CravingValidationError) as error:
        CravingService.update_owned(
            test_user.id,
            craving.id,
            UpdateCravingInput(
                provided_fields=frozenset({"outcome"}),
                outcome=outcome,
            ),
        )

    assert error.value.field_errors == {
        "outcome": [
            "Choose resisted, used nicotine, or used alternative."
        ]
    }
    db_session.refresh(craving)
    assert craving.outcome is None


def test_same_client_event_id_is_reusable_by_a_different_user(
    db_session,
    test_user,
):
    """Dropping ownership from idempotency would merge two users' events."""
    from services.craving_service import CravingService

    other = User(
        email="cross-user-craving-event@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other.set_password("password123")
    db_session.add(other)
    db_session.commit()
    event_id = "a18f3f5c-68af-7e4d-bf5d-0123456789ab"

    first = CravingService.create_idempotent(
        test_user.id, _create_input(client_event_id=event_id)
    )
    second = CravingService.create_idempotent(
        other.id, _create_input(client_event_id=event_id, intensity=4)
    )

    assert first.created is True
    assert second.created is True
    assert first.craving.id != second.craving.id
    assert db_session.query(Craving).filter_by(client_event_id=event_id).count() == 2


def test_create_service_reraises_unrelated_integrity_failure_without_owned_winner(
    db_session,
    test_user,
    monkeypatch,
):
    """Broad duplicate recovery must not hide unrelated integrity failures."""
    from services.craving_service import CravingService

    other = User(
        email="foreign-craving-race-winner@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other.set_password("password123")
    db_session.add(other)
    db_session.flush()
    event_id = "b18f3f5c-68af-7e4d-bf5d-0123456789ab"
    db_session.add(Craving(
        user_id=other.id,
        client_event_id=event_id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=5,
    ))
    db_session.commit()
    failure = IntegrityError(
        "INSERT INTO craving", {}, Exception("unrelated")
    )
    original_rollback = db_session.rollback

    def fail_commit():
        raise failure

    monkeypatch.setattr(db_session, "commit", fail_commit)
    monkeypatch.setattr(db_session, "rollback", original_rollback)

    with pytest.raises(IntegrityError) as error:
        CravingService.create_idempotent(
            test_user.id,
            _create_input(client_event_id=event_id),
        )

    assert error.value is failure
    assert db_session.query(Craving).filter_by(user_id=test_user.id).count() == 0


def test_competing_same_outcome_claim_becomes_idempotent_detail_retry(
    db_session,
    test_user,
    monkeypatch,
):
    """A same-outcome race must be retryable rather than a false conflict."""
    from services.craving_service import CravingService
    from services.serializers import parse_update_craving_request

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=7,
    )
    db_session.add(craving)
    db_session.commit()
    original_execute = db_session.execute
    original_rollback = db_session.rollback
    original_commit = db_session.commit
    published = {"done": False}

    class LostClaim:
        rowcount = 0

    def lose_conditional_claim(statement, *args, **kwargs):
        if (
            getattr(statement, "is_update", False)
            and getattr(getattr(statement, "table", None), "name", None)
            == Craving.__tablename__
            and not published["done"]
        ):
            return LostClaim()
        return original_execute(statement, *args, **kwargs)

    def rollback_then_publish_winner():
        original_rollback()
        if published["done"]:
            return
        original_execute(
            update(Craving)
            .where(Craving.id == craving.id)
            .values(outcome="used_alternative", notes="winner")
        )
        original_commit()
        published["done"] = True

    monkeypatch.setattr(db_session, "execute", lose_conditional_claim)
    monkeypatch.setattr(db_session, "rollback", rollback_then_publish_winner)

    updated = CravingService.update_owned(
        test_user.id,
        craving.id,
        parse_update_craving_request({
            "outcome": "used_alternative",
            "notes": "same outcome retry",
        }),
    )

    assert updated.outcome == "used_alternative"
    assert updated.notes == "same outcome retry"


def test_used_nicotine_link_and_delete_preserve_craving_outcome(
    db_session,
    test_user,
    test_pouch,
):
    """Deleting a linked log must clear only the link, never the outcome."""
    from services.craving_service import CravingService
    from services.log_service import CreateLogInput, LogService
    from services.serializers import parse_update_craving_request

    craving = CravingService.create_idempotent(
        test_user.id,
        _create_input(
            client_event_id="c18f3f5c-68af-7e4d-bf5d-0123456789ab"
        ),
    ).craving
    CravingService.update_owned(
        test_user.id,
        craving.id,
        parse_update_craving_request({"outcome": "used_nicotine"}),
    )
    occurred = datetime(2026, 7, 30, 15, 45, tzinfo=timezone.utc)
    log = LogService.create_idempotent(
        test_user.id,
        CreateLogInput(
            client_event_id="d18f3f5c-68af-7e4d-bf5d-0123456789ab",
            pouch_id=test_pouch.id,
            custom_product=None,
            quantity=1,
            occurred_at_utc=occurred,
            occurred_at_local=occurred,
            timezone="UTC",
            notes=None,
            craving_id=craving.id,
        ),
    ).log

    db_session.expire_all()
    linked = db_session.get(Craving, craving.id)
    assert linked.outcome == "used_nicotine"
    assert linked.linked_log_id == log.id

    LogService.delete_owned(test_user.id, log.id)

    db_session.expire_all()
    preserved = db_session.get(Craving, craving.id)
    assert preserved.outcome == "used_nicotine"
    assert preserved.linked_log_id is None


def test_canonical_serializer_treats_nonlist_legacy_symptoms_as_empty(
    db_session,
    test_user,
):
    """Malformed legacy JSON must not escape the canonical array contract."""
    from services.serializers import (
        canonical_craving_for_timezone,
        serialize_canonical_craving,
    )

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=5,
        physical_symptoms='{"unexpected": true}',
    )
    db_session.add(craving)
    db_session.commit()

    payload = serialize_canonical_craving(
        canonical_craving_for_timezone(craving, "UTC")
    )

    assert payload["physical_symptoms"] == []


@pytest.mark.parametrize("intensity", [1, 10])
def test_create_parser_accepts_inclusive_intensity_boundaries(intensity):
    from services.serializers import parse_create_craving_request

    parsed = parse_create_craving_request(
        _create_request(intensity=intensity, trigger="x" * 100),
        now=NOW,
    )

    assert parsed.intensity == intensity
    assert parsed.trigger == "x" * 100


def test_patch_parser_accepts_inclusive_detail_boundaries():
    from services.serializers import parse_update_craving_request

    symptoms = [f"symptom {index}" for index in range(20)]
    patch = parse_update_craving_request({
        "duration_minutes": 1440,
        "mood_before": 1,
        "mood_after": 10,
        "stress_level": 10,
        "physical_symptoms": symptoms,
        "notes": "x" * 2000,
    })

    assert patch.duration_minutes == 1440
    assert patch.physical_symptoms == tuple(symptoms)
    assert patch.notes == "x" * 2000


def test_direct_typed_update_accepts_null_symptoms_clear_but_omission_preserves(
    db_session,
    test_user,
):
    """Explicit null is a clear command; an omitted symptom field is not."""
    from services.craving_service import (
        CravingService,
        UpdateCravingInput,
    )

    craving = Craving(
        user_id=test_user.id,
        craving_time=datetime(2026, 7, 30, 15, 42),
        intensity=5,
    )
    craving.set_physical_symptoms_list(["restless"])
    db_session.add(craving)
    db_session.commit()

    preserved = CravingService.update_owned(
        test_user.id,
        craving.id,
        UpdateCravingInput(
            provided_fields=frozenset({"notes"}),
            notes="still tracked",
        ),
    )
    assert preserved.get_physical_symptoms_list() == ["restless"]

    cleared = CravingService.update_owned(
        test_user.id,
        craving.id,
        UpdateCravingInput(
            provided_fields=frozenset({"physical_symptoms"}),
            physical_symptoms=None,
        ),
    )

    assert cleared.get_physical_symptoms_list() == []
    assert cleared.physical_symptoms is None
