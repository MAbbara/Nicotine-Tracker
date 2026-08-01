"""Canonical log mutation API parsing, serialization, and route contracts."""

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from models import Craving, Log, Pouch, User
from services.api_errors import ApiValidationError
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
from services.serializers import (
    InvalidLocalTimeError,
    parse_create_log_request,
    serialize_canonical_log,
    serialize_today_summary,
)
from services.timezone_service import UserDayWindow


NOW = datetime(2026, 7, 30, 16, 0, tzinfo=timezone.utc)


def _valid_selected_payload(**changes):
    payload = {
        "client_event_id": "018f3f5c-68af-7e4d-bf5d-0123456789ab",
        "pouch_id": 12,
        "custom_product": None,
        "quantity": 1,
        "occurred_at_local": "2026-07-30T18:42:00+03:00",
        "timezone": "Asia/Riyadh",
        "notes": "",
        "craving_id": None,
    }
    payload.update(changes)
    return payload


def _assert_error_envelope(response, status, code, retryable=False):
    assert response.status_code == status
    assert response.get_json() == {
        "error": {
            "code": code,
            "message": response.get_json()["error"]["message"],
            "field_errors": response.get_json()["error"]["field_errors"],
            "retryable": retryable,
        }
    }
    return response.get_json()["error"]


def test_parser_rejects_boolean_quantity_as_non_integer():
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(quantity=True),
            now=NOW,
        )

    assert error.value.field_errors == {
        "quantity": ["Enter a whole number from 1 to 100."]
    }


def test_parser_returns_normalized_typed_selected_pouch_input():
    parsed = parse_create_log_request(_valid_selected_payload(), now=NOW)

    assert parsed.client_event_id == "018f3f5c-68af-7e4d-bf5d-0123456789ab"
    assert parsed.pouch_id == 12
    assert parsed.custom_product is None
    assert parsed.quantity == 1
    assert parsed.occurred_at_utc.isoformat() == "2026-07-30T15:42:00+00:00"
    assert parsed.occurred_at_local.isoformat() == "2026-07-30T18:42:00+03:00"
    assert parsed.timezone == "Asia/Riyadh"
    assert parsed.notes is None
    assert parsed.craving_id is None


@pytest.mark.parametrize("body", [None, [], "not-an-object", 7])
def test_parser_rejects_missing_and_non_object_json(body):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(body, now=NOW)

    assert error.value.field_errors == {
        "body": ["Send one JSON object."]
    }


def test_parser_rejects_unknown_fields_including_selected_pouch_strength():
    payload = _valid_selected_payload(
        nicotine_mg="99.00",
        unexpected="value",
    )

    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(payload, now=NOW)

    assert error.value.field_errors == {
        "nicotine_mg": ["This field is not supported."],
        "unexpected": ["This field is not supported."],
    }


@pytest.mark.parametrize(
    "event_id",
    [
        True,
        123,
        "",
        "not-a-uuid",
        "018f3f5c68af7e4dbf5d0123456789ab",
        "{018f3f5c-68af-7e4d-bf5d-0123456789ab}",
    ],
)
def test_parser_rejects_noncanonical_client_event_ids(event_id):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(client_event_id=event_id),
            now=NOW,
        )

    assert error.value.field_errors == {
        "client_event_id": ["Use a canonical hyphenated UUID."]
    }


def test_parser_normalizes_canonical_uuid_to_lowercase():
    parsed = parse_create_log_request(
        _valid_selected_payload(
            client_event_id="018F3F5C-68AF-7E4D-BF5D-0123456789AB"
        ),
        now=NOW,
    )

    assert parsed.client_event_id == "018f3f5c-68af-7e4d-bf5d-0123456789ab"


@pytest.mark.parametrize(
    "changes",
    [
        {
            "custom_product": {
                "brand": "Custom product",
                "nicotine_mg": "6.00",
            }
        },
        {"pouch_id": None, "custom_product": None},
    ],
)
def test_parser_requires_exactly_one_product_source(changes):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(**changes),
            now=NOW,
        )

    assert error.value.field_errors == {
        "product": ["Choose one pouch or enter one custom product."]
    }


@pytest.mark.parametrize("pouch_id", [True, False, 0, -1, 1.5, "12"])
def test_parser_requires_positive_integer_pouch_id(pouch_id):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(pouch_id=pouch_id),
            now=NOW,
        )

    assert error.value.field_errors == {
        "pouch_id": ["Choose a valid pouch."]
    }


def test_parser_normalizes_valid_custom_product():
    parsed = parse_create_log_request(
        _valid_selected_payload(
            pouch_id=None,
            custom_product={
                "brand": "  Calm custom  ",
                "nicotine_mg": "6.5",
            },
        ),
        now=NOW,
    )

    assert parsed.pouch_id is None
    assert parsed.custom_product.brand == "Calm custom"
    assert parsed.custom_product.nicotine_mg == Decimal("6.50")


@pytest.mark.parametrize(
    "custom_product, expected",
    [
        ("not-an-object", {"custom_product": ["Enter a custom product object."]}),
        (
            {"brand": "Calm", "nicotine_mg": "6.00", "extra": 1},
            {"custom_product.extra": ["This field is not supported."]},
        ),
        (
            {"nicotine_mg": "6.00"},
            {"custom_product.brand": ["This field is required."]},
        ),
        (
            {"brand": "Calm"},
            {"custom_product.nicotine_mg": ["This field is required."]},
        ),
    ],
)
def test_parser_requires_exact_custom_product_shape(custom_product, expected):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(
                pouch_id=None,
                custom_product=custom_product,
            ),
            now=NOW,
        )

    assert error.value.field_errors == expected


@pytest.mark.parametrize("brand", [None, 7, "", "   ", "x" * 81])
def test_parser_validates_trimmed_custom_brand_length(brand):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(
                pouch_id=None,
                custom_product={"brand": brand, "nicotine_mg": "6.00"},
            ),
            now=NOW,
        )

    assert error.value.field_errors == {
        "custom_product.brand": [
            "Enter a brand from 1 to 80 characters."
        ]
    }


@pytest.mark.parametrize(
    "strength",
    [
        None,
        True,
        6,
        6.0,
        "",
        "+6.00",
        "-1.00",
        "0",
        "0.00",
        ".50",
        "6.",
        "6.000",
        "1e1",
        "NaN",
        "Infinity",
        "1000000.00",
    ],
)
def test_parser_requires_strict_positive_two_decimal_custom_strength(strength):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(
                pouch_id=None,
                custom_product={
                    "brand": "Calm",
                    "nicotine_mg": strength,
                },
            ),
            now=NOW,
        )

    assert error.value.field_errors == {
        "custom_product.nicotine_mg": [
            "Enter a strength from 0.01 to 999999.99 with up to two decimals."
        ]
    }


@pytest.mark.parametrize("quantity", [None, "1", 1.0, 0, -1, 101])
def test_parser_requires_quantity_integer_from_one_to_one_hundred(quantity):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(quantity=quantity),
            now=NOW,
        )

    assert error.value.field_errors == {
        "quantity": ["Enter a whole number from 1 to 100."]
    }


@pytest.mark.parametrize("quantity", [1, 100])
def test_parser_accepts_quantity_boundaries(quantity):
    parsed = parse_create_log_request(
        _valid_selected_payload(quantity=quantity),
        now=NOW,
    )

    assert parsed.quantity == quantity


@pytest.mark.parametrize("craving_id", [True, False, 0, -1, "1", 1.0])
def test_parser_requires_positive_integer_optional_craving_id(craving_id):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(craving_id=craving_id),
            now=NOW,
        )

    assert error.value.field_errors == {
        "craving_id": ["Choose a valid craving."]
    }


@pytest.mark.parametrize("notes", [True, 7, [], "x" * 2001])
def test_parser_rejects_non_string_or_overlong_notes(notes):
    with pytest.raises(ApiValidationError) as error:
        parse_create_log_request(
            _valid_selected_payload(notes=notes),
            now=NOW,
        )

    assert error.value.field_errors == {
        "notes": ["Enter up to 2,000 characters."]
    }


def test_parser_trims_notes_and_preserves_two_thousand_characters():
    trimmed = parse_create_log_request(
        _valid_selected_payload(notes="  context  "),
        now=NOW,
    )
    boundary = parse_create_log_request(
        _valid_selected_payload(notes="x" * 2000),
        now=NOW,
    )

    assert trimmed.notes == "context"
    assert boundary.notes == "x" * 2000


@pytest.mark.parametrize(
    "changes, expected_fields",
    [
        (
            {"occurred_at_local": "not-a-time"},
            {"occurred_at_local": ["Enter a local time with its UTC offset."]},
        ),
        (
            {"occurred_at_local": "2026-07-30T18:42:00"},
            {"occurred_at_local": ["Enter a local time with its UTC offset."]},
        ),
        (
            {"timezone": "Not/A_Real_Zone"},
            {"timezone": ["Choose a valid IANA timezone."]},
        ),
        (
            {"occurred_at_local": "2026-07-30T18:42:00+04:00"},
            {
                "occurred_at_local": [
                    "Check that this time and offset match the timezone."
                ]
            },
        ),
        (
            {
                "occurred_at_local": "2026-03-08T02:30:00-05:00",
                "timezone": "America/New_York",
            },
            {
                "occurred_at_local": [
                    "Check that this time and offset match the timezone."
                ]
            },
        ),
    ],
)
def test_parser_maps_invalid_event_times_to_distinct_error(changes, expected_fields):
    with pytest.raises(InvalidLocalTimeError) as error:
        parse_create_log_request(
            _valid_selected_payload(**changes),
            now=NOW,
        )

    assert error.value.message == (
        "Check the event time and timezone, then try again."
    )
    assert error.value.field_errors == expected_fields


@pytest.mark.parametrize(
    "occurred_at_local",
    [
        "2026-06-30T15:59:59Z",
        "2026-07-30T16:05:01Z",
    ],
)
def test_parser_rejects_events_outside_inclusive_age_policy(occurred_at_local):
    with pytest.raises(InvalidLocalTimeError) as error:
        parse_create_log_request(
            _valid_selected_payload(
                occurred_at_local=occurred_at_local,
                timezone="UTC",
            ),
            now=NOW,
        )

    assert error.value.field_errors == {
        "occurred_at_local": [
            "Choose a time no more than 30 days ago or 5 minutes ahead."
        ]
    }


@pytest.mark.parametrize(
    "occurred_at_local",
    [
        "2026-06-30T16:00:00Z",
        "2026-07-30T16:05:00Z",
    ],
)
def test_parser_accepts_inclusive_event_age_boundaries(occurred_at_local):
    parsed = parse_create_log_request(
        _valid_selected_payload(
            occurred_at_local=occurred_at_local,
            timezone="UTC",
        ),
        now=NOW,
    )

    assert parsed.occurred_at_utc.isoformat() in {
        "2026-06-30T16:00:00+00:00",
        "2026-07-30T16:05:00+00:00",
    }


def test_parser_uses_claimed_offset_to_select_each_dst_overlap_occurrence():
    overlap_now = datetime(2026, 11, 1, 12, 0, tzinfo=timezone.utc)

    daylight = parse_create_log_request(
        _valid_selected_payload(
            occurred_at_local="2026-11-01T01:30:00-04:00",
            timezone="America/New_York",
        ),
        now=overlap_now,
    )
    standard = parse_create_log_request(
        _valid_selected_payload(
            occurred_at_local="2026-11-01T01:30:00-05:00",
            timezone="America/New_York",
        ),
        now=overlap_now,
    )

    assert daylight.occurred_at_utc.isoformat() == "2026-11-01T05:30:00+00:00"
    assert standard.occurred_at_utc.isoformat() == "2026-11-01T06:30:00+00:00"


def test_canonical_log_serializer_emits_exact_keys_decimals_and_aware_times():
    local_zone = timezone(timedelta(hours=3))
    canonical = CanonicalLog(
        id=41,
        client_event_id="018f3f5c-68af-7e4d-bf5d-0123456789ab",
        occurred_at_utc=datetime(2026, 7, 30, 15, 42, tzinfo=timezone.utc),
        occurred_at_local=datetime(2026, 7, 30, 18, 42, tzinfo=local_zone),
        pouch_id=12,
        product_brand="Calm",
        nicotine_mg=Decimal("6.5"),
        quantity=2,
        total_nicotine_mg=Decimal("13"),
        notes=None,
        linked_craving_id=9,
    )

    serialized = serialize_canonical_log(canonical)

    assert serialized == {
        "id": 41,
        "client_event_id": "018f3f5c-68af-7e4d-bf5d-0123456789ab",
        "occurred_at_utc": "2026-07-30T15:42:00+00:00",
        "occurred_at_local": "2026-07-30T18:42:00+03:00",
        "pouch_id": 12,
        "product_brand": "Calm",
        "nicotine_mg": "6.50",
        "quantity": 2,
        "total_nicotine_mg": "13.00",
        "notes": None,
        "linked_craving_id": 9,
    }


def test_today_serializer_covers_complete_summary_and_discriminated_timeline():
    local_zone = timezone(timedelta(hours=3))
    log_utc = datetime(2026, 7, 30, 15, 42, tzinfo=timezone.utc)
    log_local = datetime(2026, 7, 30, 18, 42, tzinfo=local_zone)
    canonical_log = CanonicalLog(
        id=41,
        client_event_id="018f3f5c-68af-7e4d-bf5d-0123456789ab",
        occurred_at_utc=log_utc,
        occurred_at_local=log_local,
        pouch_id=12,
        product_brand="Calm",
        nicotine_mg=Decimal("6.50"),
        quantity=2,
        total_nicotine_mg=Decimal("13.00"),
        notes=None,
        linked_craving_id=9,
    )
    craving_utc = datetime(2026, 7, 30, 15, 30, tzinfo=timezone.utc)
    craving_local = datetime(2026, 7, 30, 18, 30, tzinfo=local_zone)
    canonical_craving = CanonicalCraving(
        id=9,
        client_event_id=None,
        occurred_at_utc=craving_utc,
        occurred_at_local=craving_local,
        intensity=7,
        trigger="stress",
        outcome="used_nicotine",
        linked_log_id=41,
        duration_minutes=3,
        physical_symptoms=("restless", "tense"),
        situation_context="After work",
        outcome_notes=None,
        mood_before=2,
        mood_after=3,
        stress_level=8,
        notes=None,
    )
    check_in = CanonicalCheckIn(
        id=5,
        local_date=date(2026, 7, 30),
        mood=3,
        confidence=4,
        reflection="Kept the next choice small.",
        context=None,
    )
    check_utc = datetime(2026, 7, 30, 17, 0, tzinfo=timezone.utc)
    check_local = datetime(2026, 7, 30, 20, 0, tzinfo=local_zone)
    summary = TodaySummary(
        local_date=date(2026, 7, 30),
        window=UserDayWindow(
            local_date=date(2026, 7, 30),
            start_utc=datetime(2026, 7, 29, 21, 0, tzinfo=timezone.utc),
            end_utc=datetime(2026, 7, 30, 21, 0, tzinfo=timezone.utc),
        ),
        plan=TodayPlan(
            id=3,
            mode="reduce",
            status="active",
            local_date=date(2026, 7, 30),
            day_number=8,
            target_pouches=5,
            nicotine_ceiling_mg=Decimal("30.00"),
            pace="steady",
            stage_label="Stage 2 of 4",
        ),
        actual_pouches=2,
        actual_nicotine_mg=Decimal("13.00"),
        known_nicotine_mg=Decimal("13.00"),
        unknown_strength_events=0,
        remaining_pouches=3,
        remaining_nicotine_mg=Decimal("17.00"),
        status="on_track",
        pouch_status="on_track",
        nicotine_state="on_track",
        timeline=(
            CravingTimelineItem(
                type="craving",
                id=9,
                occurred_at_utc=craving_utc,
                occurred_at_local=craving_local,
                state="used_nicotine",
                label="Craving · used nicotine",
                data=canonical_craving,
            ),
            LogTimelineItem(
                type="log",
                id=41,
                occurred_at_utc=log_utc,
                occurred_at_local=log_local,
                state="confirmed",
                label="Nicotine logged",
                data=canonical_log,
            ),
            CheckInTimelineItem(
                type="check_in",
                id=5,
                occurred_at_utc=check_utc,
                occurred_at_local=check_local,
                state="completed",
                label="Daily check-in",
                data=check_in,
            ),
        ),
        smart_default=SmartDefault(
            pouch_id=12,
            brand="Calm",
            nicotine_mg=Decimal("6.50"),
            source="preferred",
        ),
        check_in=check_in,
        coaching=CoachingMessage(
            key="early_on_track",
            headline="You are on pace.",
            body="Keep the next choice small.",
            actions=(
                CoachingAction(
                    key="keep_logging",
                    label="Keep logging",
                    href="/today#log-nicotine",
                ),
            ),
        ),
        check_in_eligible=True,
        review_recommended=False,
        milestones=("Next reduction in 3 days", "Stage 1 complete"),
        generated_at=datetime(2026, 7, 30, 16, 0, tzinfo=timezone.utc),
    )

    serialized = serialize_today_summary(summary)

    assert serialized == {
        "local_date": "2026-07-30",
        "window": {
            "start_utc": "2026-07-29T21:00:00+00:00",
            "end_utc": "2026-07-30T21:00:00+00:00",
        },
        "generated_at": "2026-07-30T16:00:00+00:00",
        "plan": {
            "id": 3,
            "mode": "reduce",
            "status": "active",
            "local_date": "2026-07-30",
            "day_number": 8,
            "target_pouches": 5,
            "nicotine_ceiling_mg": "30.00",
            "pace": "steady",
            "stage_label": "Stage 2 of 4",
        },
        "actuals": {
            "pouches": 2,
            "nicotine_mg": "13.00",
            "known_nicotine_mg": "13.00",
            "unknown_strength_events": 0,
        },
        "remaining": {"pouches": 3, "nicotine_mg": "17.00"},
        "status": "on_track",
        "pouch_status": "on_track",
        "nicotine_state": "on_track",
        "timeline": [
            {
                "type": "craving",
                "id": 9,
                "occurred_at_utc": "2026-07-30T15:30:00+00:00",
                "occurred_at_local": "2026-07-30T18:30:00+03:00",
                "state": "used_nicotine",
                "label": "Craving · used nicotine",
                "data": {
                    "id": 9,
                    "client_event_id": None,
                    "occurred_at_utc": "2026-07-30T15:30:00+00:00",
                    "occurred_at_local": "2026-07-30T18:30:00+03:00",
                    "intensity": 7,
                    "trigger": "stress",
                    "outcome": "used_nicotine",
                    "linked_log_id": 41,
                    "duration_minutes": 3,
                    "physical_symptoms": ["restless", "tense"],
                    "situation_context": "After work",
                    "outcome_notes": None,
                    "mood_before": 2,
                    "mood_after": 3,
                    "stress_level": 8,
                    "notes": None,
                },
            },
            {
                "type": "log",
                "id": 41,
                "occurred_at_utc": "2026-07-30T15:42:00+00:00",
                "occurred_at_local": "2026-07-30T18:42:00+03:00",
                "state": "confirmed",
                "label": "Nicotine logged",
                "data": {
                    "id": 41,
                    "client_event_id": "018f3f5c-68af-7e4d-bf5d-0123456789ab",
                    "occurred_at_utc": "2026-07-30T15:42:00+00:00",
                    "occurred_at_local": "2026-07-30T18:42:00+03:00",
                    "pouch_id": 12,
                    "product_brand": "Calm",
                    "nicotine_mg": "6.50",
                    "quantity": 2,
                    "total_nicotine_mg": "13.00",
                    "notes": None,
                    "linked_craving_id": 9,
                },
            },
            {
                "type": "check_in",
                "id": 5,
                "occurred_at_utc": "2026-07-30T17:00:00+00:00",
                "occurred_at_local": "2026-07-30T20:00:00+03:00",
                "state": "completed",
                "label": "Daily check-in",
                "data": {
                    "id": 5,
                    "local_date": "2026-07-30",
                    "mood": 3,
                    "confidence": 4,
                    "reflection": "Kept the next choice small.",
                    "context": None,
                },
            },
        ],
        "smart_default": {
            "pouch_id": 12,
            "brand": "Calm",
            "nicotine_mg": "6.50",
            "source": "preferred",
        },
        "check_in": {
            "id": 5,
            "local_date": "2026-07-30",
            "mood": 3,
            "confidence": 4,
            "reflection": "Kept the next choice small.",
            "context": None,
        },
        "coaching": {
            "key": "early_on_track",
            "headline": "You are on pace.",
            "body": "Keep the next choice small.",
            "actions": [
                {
                    "key": "keep_logging",
                    "label": "Keep logging",
                    "href": "/today#log-nicotine",
                }
            ],
        },
        "check_in_eligible": True,
        "review_recommended": False,
        "milestones": ["Next reduction in 3 days", "Stage 1 complete"],
    }


def test_get_today_requires_authentication(client):
    response = client.get("/api/today")

    _assert_error_envelope(response, 401, "authentication_required")


def test_get_today_composition_failure_returns_internal_error(
    logged_in_client, monkeypatch, caplog
):
    request_id = "523e4567-e89b-42d3-a456-426614174004"

    def fail_today(user_id):
        raise RuntimeError("synthetic get today failure")

    monkeypatch.setattr("routes.api.TodayService.get_summary", fail_today)
    caplog.set_level("ERROR", logger="routes.api")

    response = logged_in_client.get(
        "/api/today",
        headers={"X-Request-ID": request_id},
    )

    _assert_error_envelope(response, 500, "internal_error", retryable=True)
    errors = [record for record in caplog.records if record.name == "routes.api"]
    assert len(errors) == 1
    assert request_id in errors[0].getMessage()


def test_get_today_calls_service_once_and_returns_complete_summary(
    logged_in_client, test_user, monkeypatch
):
    from routes import api as api_module

    original = api_module.TodayService.get_summary
    calls = []

    def counted(user_id):
        calls.append(user_id)
        return original(user_id)

    monkeypatch.setattr(api_module.TodayService, "get_summary", counted)

    response = logged_in_client.get("/api/today")

    assert response.status_code == 200
    assert calls == [test_user.id]
    assert set(response.get_json()) == {"today"}
    assert set(response.get_json()["today"]) == {
        "local_date",
        "window",
        "generated_at",
        "plan",
        "actuals",
        "remaining",
        "status",
        "pouch_status",
        "nicotine_state",
        "timeline",
        "smart_default",
        "check_in",
        "coaching",
        "check_in_eligible",
        "review_recommended",
        "milestones",
    }


def test_post_logs_requires_authentication(client):
    response = client.post("/api/logs", json=_valid_selected_payload())

    _assert_error_envelope(response, 401, "authentication_required")


def test_post_logs_creates_canonical_log_and_refreshes_today(
    logged_in_client, db_session, test_user, test_pouch
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    payload = _valid_selected_payload(
        client_event_id="d18f3f5c-68af-7e4d-bf5d-0123456789ab",
        pouch_id=test_pouch.id,
        quantity=2,
        occurred_at_local=occurred.isoformat(),
        timezone="UTC",
        notes="  useful context  ",
    )

    response = logged_in_client.post("/api/logs", json=payload)

    assert response.status_code == 201
    body = response.get_json()
    assert set(body) == {"log", "today", "created", "warnings"}
    assert body["created"] is True
    assert body["warnings"] == []
    assert body["log"] == {
        "id": body["log"]["id"],
        "client_event_id": "d18f3f5c-68af-7e4d-bf5d-0123456789ab",
        "occurred_at_utc": occurred.isoformat(),
        "occurred_at_local": occurred.isoformat(),
        "pouch_id": test_pouch.id,
        "product_brand": "Test Brand",
        "nicotine_mg": "4.00",
        "quantity": 2,
        "total_nicotine_mg": "8.00",
        "notes": "useful context",
        "linked_craving_id": None,
    }
    assert body["today"]["actuals"]["pouches"] == 2
    assert body["today"]["actuals"]["nicotine_mg"] == "8.00"
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 1


def test_post_logs_persists_normalized_custom_product_snapshots(
    logged_in_client, db_session, test_user
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)

    response = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            client_event_id="918f4f5c-68af-7e4d-bf5d-0123456789ab",
            pouch_id=None,
            custom_product={
                "brand": "  Custom calm  ",
                "nicotine_mg": "1.5",
            },
            quantity=3,
            occurred_at_local=occurred.isoformat(),
            timezone="UTC",
        ),
    )

    assert response.status_code == 201
    assert response.get_json()["log"] == {
        "id": response.get_json()["log"]["id"],
        "client_event_id": "918f4f5c-68af-7e4d-bf5d-0123456789ab",
        "occurred_at_utc": occurred.isoformat(),
        "occurred_at_local": occurred.isoformat(),
        "pouch_id": None,
        "product_brand": "Custom calm",
        "nicotine_mg": "1.50",
        "quantity": 3,
        "total_nicotine_mg": "4.50",
        "notes": None,
        "linked_craving_id": None,
    }
    log = db_session.query(Log).filter_by(user_id=test_user.id).one()
    assert log.custom_brand == "Custom calm"
    assert str(log.custom_nicotine_mg) == "1.50"
    assert log.product_brand_snapshot == "Custom calm"
    assert str(log.nicotine_mg_snapshot) == "1.50"


def test_post_logs_exact_replay_returns_200_and_one_row(
    logged_in_client, db_session, test_user, test_pouch
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    payload = _valid_selected_payload(
        client_event_id="e18f3f5c-68af-7e4d-bf5d-0123456789ab",
        pouch_id=test_pouch.id,
        occurred_at_local=occurred.isoformat(),
        timezone="UTC",
    )

    first = logged_in_client.post("/api/logs", json=payload)
    replay = logged_in_client.post("/api/logs", json=payload)

    assert (first.status_code, replay.status_code) == (201, 200)
    assert first.get_json()["created"] is True
    assert replay.get_json()["created"] is False
    assert replay.get_json()["log"] == first.get_json()["log"]
    assert db_session.query(Log).filter_by(
        user_id=test_user.id,
        client_event_id=payload["client_event_id"],
    ).count() == 1


def test_post_logs_returns_shared_validation_envelope(
    logged_in_client, test_pouch
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)

    response = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            pouch_id=test_pouch.id,
            quantity=True,
            occurred_at_local=occurred.isoformat(),
            timezone="UTC",
        ),
    )

    error = _assert_error_envelope(response, 422, "validation_error")
    assert error["field_errors"] == {
        "quantity": ["Enter a whole number from 1 to 100."]
    }


def test_post_logs_returns_invalid_local_time_envelope(
    logged_in_client, test_pouch
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    mismatched = occurred.astimezone(timezone(timedelta(hours=1))).isoformat()

    response = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            pouch_id=test_pouch.id,
            occurred_at_local=mismatched,
            timezone="UTC",
        ),
    )

    error = _assert_error_envelope(response, 422, "invalid_local_time")
    assert error["retryable"] is False
    assert error["field_errors"] == {
        "occurred_at_local": [
            "Check that this time and offset match the timezone."
        ]
    }


@pytest.mark.parametrize(
    "method, path, json_body",
    [
        ("post", "/api/logs", {}),
        ("delete", "/api/logs/1", None),
    ],
)
def test_log_mutations_enforce_csrf(
    logged_in_client, method, path, json_body
):
    logged_in_client.application.config["WTF_CSRF_ENABLED"] = True
    try:
        response = getattr(logged_in_client, method)(path, json=json_body)
    finally:
        logged_in_client.application.config["WTF_CSRF_ENABLED"] = False

    _assert_error_envelope(response, 400, "csrf_failed")


def test_post_logs_hides_missing_and_foreign_pouch_existence(
    logged_in_client, db_session, test_user
):
    other_user = User(
        email="api-foreign-pouch@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other_user.set_password("password123")
    db_session.add(other_user)
    db_session.flush()
    foreign_pouch = Pouch(
        brand="Private API pouch",
        nicotine_mg="12.00",
        is_default=False,
        created_by=other_user.id,
    )
    db_session.add(foreign_pouch)
    db_session.commit()
    occurred = datetime.now(timezone.utc).replace(microsecond=0)

    responses = [
        logged_in_client.post(
            "/api/logs",
            json=_valid_selected_payload(
                pouch_id=pouch_id,
                client_event_id=event_id,
                occurred_at_local=occurred.isoformat(),
                timezone="UTC",
            ),
        )
        for pouch_id, event_id in (
            (foreign_pouch.id, "f18f3f5c-68af-7e4d-bf5d-0123456789ab"),
            (foreign_pouch.id + 1000, "018f4f5c-68af-7e4d-bf5d-0123456789ab"),
        )
    ]

    errors = [
        _assert_error_envelope(response, 422, "validation_error")
        for response in responses
    ]
    assert errors[0] == errors[1]
    assert errors[0]["field_errors"] == {
        "pouch_id": ["Choose a pouch available to your account."]
    }
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_post_logs_hides_missing_and_foreign_craving_existence(
    logged_in_client, db_session, test_user, test_pouch
):
    other_user = User(
        email="api-foreign-craving@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other_user.set_password("password123")
    db_session.add(other_user)
    db_session.flush()
    foreign = Craving(
        user_id=other_user.id,
        craving_time=datetime.now(timezone.utc).replace(tzinfo=None),
        intensity=7,
        outcome="used_nicotine",
    )
    db_session.add(foreign)
    db_session.commit()
    occurred = datetime.now(timezone.utc).replace(microsecond=0)

    responses = [
        logged_in_client.post(
            "/api/logs",
            json=_valid_selected_payload(
                pouch_id=test_pouch.id,
                craving_id=craving_id,
                client_event_id=event_id,
                occurred_at_local=occurred.isoformat(),
                timezone="UTC",
            ),
        )
        for craving_id, event_id in (
            (foreign.id, "118f4f5c-68af-7e4d-bf5d-0123456789ab"),
            (foreign.id + 1000, "218f4f5c-68af-7e4d-bf5d-0123456789ab"),
        )
    ]

    errors = [
        _assert_error_envelope(response, 404, "not_found")
        for response in responses
    ]
    assert errors[0] == errors[1]
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_post_logs_requires_used_nicotine_craving_outcome(
    logged_in_client, db_session, test_user, test_pouch
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    craving = Craving(
        user_id=test_user.id,
        craving_time=occurred.replace(tzinfo=None),
        intensity=6,
        outcome="resisted",
    )
    db_session.add(craving)
    db_session.commit()

    response = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            pouch_id=test_pouch.id,
            craving_id=craving.id,
            client_event_id="a18f4f5c-68af-7e4d-bf5d-0123456789ab",
            occurred_at_local=occurred.isoformat(),
            timezone="UTC",
        ),
    )

    error = _assert_error_envelope(response, 422, "validation_error")
    assert error["field_errors"] == {
        "craving_id": ["Choose a craving marked as nicotine used."]
    }
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_post_logs_returns_conflict_when_craving_links_another_log(
    logged_in_client, db_session, test_user, test_pouch
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    prior_response = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            pouch_id=test_pouch.id,
            client_event_id="318f4f5c-68af-7e4d-bf5d-0123456789ab",
            occurred_at_local=occurred.isoformat(),
            timezone="UTC",
        ),
    )
    assert prior_response.status_code == 201
    prior_id = prior_response.get_json()["log"]["id"]
    craving = Craving(
        user_id=test_user.id,
        craving_time=occurred.replace(tzinfo=None),
        intensity=8,
        outcome="used_nicotine",
        linked_log_id=prior_id,
    )
    db_session.add(craving)
    db_session.commit()

    response = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            pouch_id=test_pouch.id,
            craving_id=craving.id,
            client_event_id="418f4f5c-68af-7e4d-bf5d-0123456789ab",
            occurred_at_local=occurred.isoformat(),
            timezone="UTC",
        ),
    )

    error = _assert_error_envelope(
        response, 409, "craving_link_conflict"
    )
    assert error["field_errors"] == {}
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 1
    db_session.refresh(craving)
    assert craving.linked_log_id == prior_id


def test_committed_create_and_replay_survive_today_refresh_failure(
    logged_in_client,
    db_session,
    test_user,
    test_pouch,
    monkeypatch,
    caplog,
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    event_id = "518f4f5c-68af-7e4d-bf5d-0123456789ab"
    request_id = "123e4567-e89b-42d3-a456-426614174000"
    payload = _valid_selected_payload(
        pouch_id=test_pouch.id,
        client_event_id=event_id,
        occurred_at_local=occurred.isoformat(),
        timezone="UTC",
    )

    def fail_today(user_id):
        raise RuntimeError("synthetic today refresh failure")

    monkeypatch.setattr("routes.api.TodayService.get_summary", fail_today)
    caplog.set_level("ERROR", logger="routes.api")

    created = logged_in_client.post(
        "/api/logs",
        json=payload,
        headers={"X-Request-ID": request_id},
    )
    replay = logged_in_client.post(
        "/api/logs",
        json=payload,
        headers={"X-Request-ID": request_id},
    )

    warning = [{"code": "today_refresh_unavailable", "retryable": True}]
    assert (created.status_code, replay.status_code) == (201, 200)
    assert created.get_json()["created"] is True
    assert replay.get_json()["created"] is False
    assert created.get_json()["today"] is None
    assert replay.get_json()["today"] is None
    assert created.get_json()["warnings"] == warning
    assert replay.get_json()["warnings"] == warning
    assert replay.get_json()["log"] == created.get_json()["log"]
    assert db_session.query(Log).filter_by(
        user_id=test_user.id,
        client_event_id=event_id,
    ).count() == 1
    errors = [record for record in caplog.records if record.name == "routes.api"]
    assert len(errors) == 2
    assert all(request_id in record.getMessage() for record in errors)


def test_precommit_failure_returns_internal_error_and_logs_correlation(
    logged_in_client, test_pouch, monkeypatch, caplog
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    request_id = "223e4567-e89b-42d3-a456-426614174001"

    def fail_create(user_id, payload):
        raise RuntimeError("synthetic precommit failure")

    monkeypatch.setattr(
        "routes.api.LogService.create_idempotent", fail_create
    )
    caplog.set_level("ERROR", logger="routes.api")

    response = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            pouch_id=test_pouch.id,
            client_event_id="618f4f5c-68af-7e4d-bf5d-0123456789ab",
            occurred_at_local=occurred.isoformat(),
            timezone="UTC",
        ),
        headers={"X-Request-ID": request_id},
    )

    _assert_error_envelope(response, 500, "internal_error", retryable=True)
    errors = [record for record in caplog.records if record.name == "routes.api"]
    assert len(errors) == 1
    assert request_id in errors[0].getMessage()


def test_delete_log_requires_authentication(client):
    response = client.delete("/api/logs/1")

    _assert_error_envelope(response, 401, "authentication_required")


def test_delete_log_preserves_and_clears_linked_craving_then_refreshes_today(
    logged_in_client, db_session, test_user, test_pouch
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    craving = Craving(
        user_id=test_user.id,
        craving_time=occurred.replace(tzinfo=None),
        intensity=8,
        outcome="used_nicotine",
    )
    db_session.add(craving)
    db_session.commit()
    created = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            pouch_id=test_pouch.id,
            craving_id=craving.id,
            client_event_id="718f4f5c-68af-7e4d-bf5d-0123456789ab",
            occurred_at_local=occurred.isoformat(),
            timezone="UTC",
        ),
    )
    assert created.status_code == 201
    log_id = created.get_json()["log"]["id"]

    response = logged_in_client.delete(f"/api/logs/{log_id}")

    assert response.status_code == 200
    assert response.get_json() == {
        "deleted_log_id": log_id,
        "today": response.get_json()["today"],
        "warnings": [],
    }
    assert response.get_json()["today"]["actuals"]["pouches"] == 0
    assert db_session.get(Log, log_id) is None
    db_session.expire_all()
    preserved = db_session.get(Craving, craving.id)
    assert preserved is not None
    assert preserved.outcome == "used_nicotine"
    assert preserved.linked_log_id is None


def test_delete_log_hides_missing_and_foreign_ownership(
    logged_in_client, db_session, test_user
):
    other_user = User(
        email="api-foreign-log-delete@example.com",
        email_verified=True,
        timezone="UTC",
    )
    other_user.set_password("password123")
    db_session.add(other_user)
    db_session.flush()
    foreign_log = Log(
        user_id=other_user.id,
        log_date=datetime.now(timezone.utc).date(),
        log_time=datetime.now(timezone.utc).replace(tzinfo=None),
        quantity=1,
    )
    db_session.add(foreign_log)
    db_session.commit()

    responses = [
        logged_in_client.delete(f"/api/logs/{log_id}")
        for log_id in (foreign_log.id, foreign_log.id + 1000)
    ]

    errors = [
        _assert_error_envelope(response, 404, "not_found")
        for response in responses
    ]
    assert errors[0] == errors[1]
    assert db_session.get(Log, foreign_log.id) is not None
    assert db_session.query(Log).filter_by(user_id=test_user.id).count() == 0


def test_committed_delete_survives_today_refresh_failure(
    logged_in_client,
    db_session,
    test_user,
    test_pouch,
    monkeypatch,
    caplog,
):
    occurred = datetime.now(timezone.utc).replace(microsecond=0)
    created = logged_in_client.post(
        "/api/logs",
        json=_valid_selected_payload(
            pouch_id=test_pouch.id,
            client_event_id="818f4f5c-68af-7e4d-bf5d-0123456789ab",
            occurred_at_local=occurred.isoformat(),
            timezone="UTC",
        ),
    )
    assert created.status_code == 201
    log_id = created.get_json()["log"]["id"]
    request_id = "323e4567-e89b-42d3-a456-426614174002"

    def fail_today(user_id):
        raise RuntimeError("synthetic delete refresh failure")

    monkeypatch.setattr("routes.api.TodayService.get_summary", fail_today)
    caplog.set_level("ERROR", logger="routes.api")

    response = logged_in_client.delete(
        f"/api/logs/{log_id}",
        headers={"X-Request-ID": request_id},
    )

    assert response.status_code == 200
    assert response.get_json() == {
        "deleted_log_id": log_id,
        "today": None,
        "warnings": [
            {"code": "today_refresh_unavailable", "retryable": True}
        ],
    }
    assert db_session.get(Log, log_id) is None
    errors = [record for record in caplog.records if record.name == "routes.api"]
    assert len(errors) == 1
    assert request_id in errors[0].getMessage()


def test_delete_precommit_failure_returns_internal_error(
    logged_in_client, monkeypatch, caplog
):
    request_id = "423e4567-e89b-42d3-a456-426614174003"

    def fail_delete(user_id, log_id):
        raise RuntimeError("synthetic delete failure")

    monkeypatch.setattr("routes.api.LogService.delete_owned", fail_delete)
    caplog.set_level("ERROR", logger="routes.api")

    response = logged_in_client.delete(
        "/api/logs/1",
        headers={"X-Request-ID": request_id},
    )

    _assert_error_envelope(response, 500, "internal_error", retryable=True)
    errors = [record for record in caplog.records if record.name == "routes.api"]
    assert len(errors) == 1
    assert request_id in errors[0].getMessage()
