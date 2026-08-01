"""Strict JSON contracts for canonical Today and log mutations."""

from datetime import datetime, timedelta, timezone
from decimal import Decimal
import re
from uuid import UUID

import pytz

from models import Craving
from services.api_errors import ApiValidationError
from services.api_types import (
    CanonicalCheckIn,
    CanonicalCraving,
    CanonicalLog,
    TodaySummary,
)
from services.log_service import (
    CreateLogInput,
    CustomProductInput,
    parse_nicotine_strength,
)
from services.craving_service import CreateCravingInput, UpdateCravingInput
from services.timezone_service import (
    InvalidEventTimeError,
    parse_local_event_time,
    resolve_timezone,
)


_CREATE_LOG_KEYS = {
    "client_event_id",
    "pouch_id",
    "custom_product",
    "quantity",
    "occurred_at_local",
    "timezone",
    "notes",
    "craving_id",
}
_CREATE_CRAVING_KEYS = {
    "client_event_id",
    "intensity",
    "trigger",
    "occurred_at_local",
    "timezone",
}
_UPDATE_CRAVING_KEYS = {
    "outcome",
    "duration_minutes",
    "mood_before",
    "mood_after",
    "stress_level",
    "physical_symptoms",
    "situation_context",
    "notes",
    "outcome_notes",
}
_CANONICAL_UUID = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
_CUSTOM_PRODUCT_KEYS = {"brand", "nicotine_mg"}
_POSITIVE_DECIMAL_STRING = re.compile(r"^\d+(?:\.\d{1,2})?$")


class InvalidLocalTimeError(ApiValidationError):
    """Event time failures use a stable API code distinct from validation."""

    def __init__(self, field_errors):
        super().__init__(
            field_errors,
            message="Check the event time and timezone, then try again.",
        )


def _parse_client_event_id(value):
    if value is None:
        return None
    if not isinstance(value, str) or _CANONICAL_UUID.fullmatch(value) is None:
        raise ApiValidationError({
            "client_event_id": ["Use a canonical hyphenated UUID."]
        })
    return str(UUID(value))


def parse_create_craving_request(value, *, now=None):
    """Parse one canonical craving create request into service input."""
    if not isinstance(value, dict):
        raise ApiValidationError({"body": ["Send one JSON object."]})
    key_errors = {
        key: ["This field is not supported."]
        for key in sorted(set(value) - _CREATE_CRAVING_KEYS)
    }
    for key in sorted(_CREATE_CRAVING_KEYS - set(value)):
        key_errors[key] = ["This field is required."]
    if key_errors:
        raise ApiValidationError(key_errors)

    client_event_id = _parse_client_event_id(value["client_event_id"])
    if client_event_id is None:
        raise ApiValidationError({
            "client_event_id": ["Use a canonical hyphenated UUID."]
        })
    intensity = value["intensity"]
    if (
        isinstance(intensity, bool)
        or not isinstance(intensity, int)
        or not 1 <= intensity <= 10
    ):
        raise ApiValidationError({
            "intensity": ["Enter a whole number from 1 to 10."]
        })
    trigger_value = value["trigger"]
    if trigger_value is None:
        trigger = None
    elif not isinstance(trigger_value, str):
        raise ApiValidationError({
            "trigger": ["Enter up to 100 characters."]
        })
    else:
        trigger = re.sub(r"\s+", " ", trigger_value.strip()).lower() or None
        if trigger is not None and len(trigger) > 100:
            raise ApiValidationError({
                "trigger": ["Enter up to 100 characters."]
            })

    raw_local_time = value["occurred_at_local"]
    if not isinstance(raw_local_time, str):
        raise InvalidLocalTimeError({
            "occurred_at_local": ["Enter a local time with its UTC offset."]
        })
    try:
        occurred_at_local = datetime.fromisoformat(raw_local_time)
    except (ValueError, OverflowError):
        raise InvalidLocalTimeError({
            "occurred_at_local": ["Enter a local time with its UTC offset."]
        }) from None
    if (
        occurred_at_local.tzinfo is None
        or occurred_at_local.utcoffset() is None
    ):
        raise InvalidLocalTimeError({
            "occurred_at_local": ["Enter a local time with its UTC offset."]
        })
    timezone_name = value["timezone"]
    try:
        occurred_at_utc = parse_local_event_time(
            timezone_name,
            occurred_at_local.replace(tzinfo=None),
            occurred_at_local.utcoffset(),
        )
    except pytz.exceptions.UnknownTimeZoneError:
        raise InvalidLocalTimeError({
            "timezone": ["Choose a valid IANA timezone."]
        }) from None
    except InvalidEventTimeError:
        raise InvalidLocalTimeError({
            "occurred_at_local": [
                "Check that this time and offset match the timezone."
            ]
        }) from None
    instant = now if now is not None else datetime.now(timezone.utc)
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    instant = instant.astimezone(timezone.utc)
    if (
        occurred_at_utc < instant - timedelta(days=30)
        or occurred_at_utc > instant + timedelta(minutes=5)
    ):
        raise InvalidLocalTimeError({
            "occurred_at_local": [
                "Choose a time no more than 30 days ago or 5 minutes ahead."
            ]
        })
    return CreateCravingInput(
        client_event_id=client_event_id,
        intensity=intensity,
        trigger=trigger,
        occurred_at_utc=occurred_at_utc,
        occurred_at_local=occurred_at_local,
        timezone=timezone_name,
    )


def parse_update_craving_request(value):
    """Parse one partial canonical craving update."""
    if not isinstance(value, dict) or not value:
        raise ApiValidationError({
            "body": ["Send one nonempty JSON object."]
        })
    unknown = sorted(set(value) - _UPDATE_CRAVING_KEYS)
    if unknown:
        raise ApiValidationError({
            key: ["This field is not supported."] for key in unknown
        })
    raw_outcome = value.get("outcome")
    if (
        "outcome" in value
        and (
            not isinstance(raw_outcome, str)
            or raw_outcome not in {
                "resisted", "used_nicotine", "used_alternative"
            }
        )
    ):
        raise ApiValidationError({
            "outcome": [
                "Choose resisted, used nicotine, or used alternative."
            ]
        })
    if "duration_minutes" in value:
        duration = value["duration_minutes"]
        if duration is not None and (
            isinstance(duration, bool)
            or not isinstance(duration, int)
            or not 0 <= duration <= 1440
        ):
            raise ApiValidationError({
                "duration_minutes": [
                    "Enter a whole number from 0 to 1,440, or null."
                ]
            })
    for field in ("mood_before", "mood_after", "stress_level"):
        if field not in value:
            continue
        scale = value[field]
        if scale is not None and (
            isinstance(scale, bool)
            or not isinstance(scale, int)
            or not 1 <= scale <= 10
        ):
            raise ApiValidationError({
                field: ["Enter a whole number from 1 to 10, or null."]
            })
    normalized_text = {}
    for field in ("situation_context", "notes", "outcome_notes"):
        if field not in value:
            continue
        raw_text = value[field]
        if raw_text is None:
            normalized_text[field] = None
            continue
        if not isinstance(raw_text, str):
            raise ApiValidationError({
                field: ["Enter up to 2,000 characters, or null."]
            })
        text_value = raw_text.strip() or None
        if text_value is not None and len(text_value) > 2000:
            raise ApiValidationError({
                field: ["Enter up to 2,000 characters, or null."]
            })
        normalized_text[field] = text_value
    normalized_symptoms = None
    if "physical_symptoms" in value:
        raw_symptoms = value["physical_symptoms"]
        if raw_symptoms is None:
            normalized_symptoms = ()
        elif not isinstance(raw_symptoms, list):
            raise ApiValidationError({
                "physical_symptoms": [
                    "Enter up to 20 symptoms of at most 80 characters each, "
                    "or null."
                ]
            })
        else:
            symptoms = []
            seen = set()
            for raw_symptom in raw_symptoms:
                if not isinstance(raw_symptom, str):
                    raise ApiValidationError({
                        "physical_symptoms": [
                            "Enter up to 20 symptoms of at most 80 characters "
                            "each, or null."
                        ]
                    })
                symptom = re.sub(r"\s+", " ", raw_symptom.strip())
                if not symptom:
                    continue
                if len(symptom) > 80:
                    raise ApiValidationError({
                        "physical_symptoms": [
                            "Enter up to 20 symptoms of at most 80 characters "
                            "each, or null."
                        ]
                    })
                identity = symptom.casefold()
                if identity in seen:
                    continue
                seen.add(identity)
                symptoms.append(symptom)
            if len(symptoms) > 20:
                raise ApiValidationError({
                    "physical_symptoms": [
                        "Enter up to 20 symptoms of at most 80 characters each, "
                        "or null."
                    ]
                })
            normalized_symptoms = tuple(symptoms)
    return UpdateCravingInput(
        provided_fields=frozenset(value),
        outcome=value.get("outcome"),
        duration_minutes=value.get("duration_minutes"),
        mood_before=value.get("mood_before"),
        mood_after=value.get("mood_after"),
        stress_level=value.get("stress_level"),
        physical_symptoms=normalized_symptoms,
        situation_context=normalized_text.get("situation_context"),
        notes=normalized_text.get("notes"),
        outcome_notes=normalized_text.get("outcome_notes"),
    )


def _parse_custom_strength(value):
    message = (
        "Enter a strength from 0.01 to 999999.99 with up to two decimals."
    )
    if not isinstance(value, str):
        raise ApiValidationError({
            "custom_product.nicotine_mg": [message]
        })
    normalized = value.strip()
    if _POSITIVE_DECIMAL_STRING.fullmatch(normalized) is None:
        raise ApiValidationError({
            "custom_product.nicotine_mg": [message]
        })
    try:
        return parse_nicotine_strength(normalized)
    except ValueError:
        raise ApiValidationError({
            "custom_product.nicotine_mg": [message]
        }) from None


def parse_create_log_request(value, *, now=None):
    """Parse one canonical log request into its immutable service input."""
    if not isinstance(value, dict):
        raise ApiValidationError({"body": ["Send one JSON object."]})
    unknown = sorted(set(value) - _CREATE_LOG_KEYS)
    if unknown:
        raise ApiValidationError({
            key: ["This field is not supported."] for key in unknown
        })
    has_pouch = value.get("pouch_id") is not None
    has_custom_product = value.get("custom_product") is not None
    if has_pouch == has_custom_product:
        raise ApiValidationError({
            "product": ["Choose one pouch or enter one custom product."]
        })
    pouch_id = value.get("pouch_id")
    if has_pouch and (
        isinstance(pouch_id, bool)
        or not isinstance(pouch_id, int)
        or pouch_id <= 0
    ):
        raise ApiValidationError({
            "pouch_id": ["Choose a valid pouch."]
        })
    custom_product = None
    if has_custom_product:
        raw_custom = value["custom_product"]
        if not isinstance(raw_custom, dict):
            raise ApiValidationError({
                "custom_product": ["Enter a custom product object."]
            })
        custom_errors = {
            f"custom_product.{key}": ["This field is not supported."]
            for key in sorted(set(raw_custom) - _CUSTOM_PRODUCT_KEYS)
        }
        for key in sorted(_CUSTOM_PRODUCT_KEYS - set(raw_custom)):
            custom_errors[f"custom_product.{key}"] = [
                "This field is required."
            ]
        if custom_errors:
            raise ApiValidationError(custom_errors)
        brand_value = raw_custom["brand"]
        brand = brand_value.strip() if isinstance(brand_value, str) else ""
        if not brand or len(brand) > 80:
            raise ApiValidationError({
                "custom_product.brand": [
                    "Enter a brand from 1 to 80 characters."
                ]
            })
        custom_product = CustomProductInput(
            brand=brand,
            nicotine_mg=_parse_custom_strength(raw_custom["nicotine_mg"]),
        )
    quantity = value.get("quantity")
    if (
        isinstance(quantity, bool)
        or not isinstance(quantity, int)
        or not 1 <= quantity <= 100
    ):
        raise ApiValidationError({
            "quantity": ["Enter a whole number from 1 to 100."]
        })
    craving_id = value.get("craving_id")
    if craving_id is not None and (
        isinstance(craving_id, bool)
        or not isinstance(craving_id, int)
        or craving_id <= 0
    ):
        raise ApiValidationError({
            "craving_id": ["Choose a valid craving."]
        })
    raw_local_time = value.get("occurred_at_local")
    if not isinstance(raw_local_time, str):
        raise InvalidLocalTimeError({
            "occurred_at_local": ["Enter a local time with its UTC offset."]
        })
    try:
        occurred_at_local = datetime.fromisoformat(raw_local_time)
    except (ValueError, OverflowError):
        raise InvalidLocalTimeError({
            "occurred_at_local": ["Enter a local time with its UTC offset."]
        }) from None
    if (
        occurred_at_local.tzinfo is None
        or occurred_at_local.utcoffset() is None
    ):
        raise InvalidLocalTimeError({
            "occurred_at_local": ["Enter a local time with its UTC offset."]
        })
    timezone_name = value.get("timezone")
    try:
        occurred_at_utc = parse_local_event_time(
            timezone_name,
            occurred_at_local.replace(tzinfo=None),
            occurred_at_local.utcoffset(),
        )
    except pytz.exceptions.UnknownTimeZoneError:
        raise InvalidLocalTimeError({
            "timezone": ["Choose a valid IANA timezone."]
        }) from None
    except InvalidEventTimeError:
        raise InvalidLocalTimeError({
            "occurred_at_local": [
                "Check that this time and offset match the timezone."
            ]
        }) from None
    instant = now if now is not None else datetime.now(timezone.utc)
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError("now must be timezone-aware")
    instant = instant.astimezone(timezone.utc)
    if (
        occurred_at_utc < instant - timedelta(days=30)
        or occurred_at_utc > instant + timedelta(minutes=5)
    ):
        raise InvalidLocalTimeError({
            "occurred_at_local": [
                "Choose a time no more than 30 days ago or 5 minutes ahead."
            ]
        })
    raw_notes = value.get("notes")
    if raw_notes is None:
        notes = None
    elif not isinstance(raw_notes, str):
        raise ApiValidationError({
            "notes": ["Enter up to 2,000 characters."]
        })
    else:
        notes = raw_notes.strip() or None
        if notes is not None and len(notes) > 2000:
            raise ApiValidationError({
                "notes": ["Enter up to 2,000 characters."]
            })
    return CreateLogInput(
        client_event_id=_parse_client_event_id(value.get("client_event_id")),
        pouch_id=pouch_id,
        custom_product=custom_product,
        quantity=quantity,
        occurred_at_utc=occurred_at_utc,
        occurred_at_local=occurred_at_local,
        timezone=timezone_name,
        notes=notes,
        craving_id=craving_id,
    )


def _decimal_string(value):
    return None if value is None else format(value, ".2f")


def _aware_iso(value):
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("serialized datetimes must be timezone-aware")
    return value.isoformat()


def serialize_canonical_log(value: CanonicalLog) -> dict:
    """Serialize the typed canonical log without consulting model to_dict()."""
    return {
        "id": value.id,
        "client_event_id": value.client_event_id,
        "occurred_at_utc": _aware_iso(value.occurred_at_utc),
        "occurred_at_local": _aware_iso(value.occurred_at_local),
        "pouch_id": value.pouch_id,
        "product_brand": value.product_brand,
        "nicotine_mg": _decimal_string(value.nicotine_mg),
        "quantity": value.quantity,
        "total_nicotine_mg": _decimal_string(value.total_nicotine_mg),
        "notes": value.notes,
        "linked_craving_id": value.linked_craving_id,
    }


def canonical_log_for_mutation(log, request_input) -> CanonicalLog:
    """Build canonical response data from snapshots and the claimed offset."""
    occurred_at_utc = log.log_time
    if occurred_at_utc.tzinfo is None:
        occurred_at_utc = occurred_at_utc.replace(tzinfo=timezone.utc)
    else:
        occurred_at_utc = occurred_at_utc.astimezone(timezone.utc)
    occurred_at_local = occurred_at_utc.astimezone(
        request_input.occurred_at_local.tzinfo
    )
    strength = (
        Decimal(log.nicotine_mg_snapshot)
        if log.nicotine_mg_snapshot is not None else None
    )
    linked_craving_id = Craving.query.with_entities(Craving.id).filter_by(
        user_id=log.user_id,
        linked_log_id=log.id,
    ).scalar()
    return CanonicalLog(
        id=log.id,
        client_event_id=log.client_event_id,
        occurred_at_utc=occurred_at_utc,
        occurred_at_local=occurred_at_local,
        pouch_id=log.pouch_id,
        product_brand=log.product_brand_snapshot or log.custom_brand or None,
        nicotine_mg=strength,
        quantity=log.quantity,
        total_nicotine_mg=(
            Decimal(log.quantity) * strength if strength is not None else None
        ),
        notes=log.notes,
        linked_craving_id=linked_craving_id,
    )


def _serialize_check_in(value: CanonicalCheckIn | None):
    if value is None:
        return None
    return {
        "id": value.id,
        "local_date": value.local_date.isoformat(),
        "mood": value.mood,
        "confidence": value.confidence,
        "reflection": value.reflection,
        "context": value.context,
    }


def canonical_craving_for_timezone(craving, timezone_name) -> CanonicalCraving:
    """Build canonical craving data in the user's currently resolved zone."""
    occurred_at_utc = craving.craving_time
    if occurred_at_utc.tzinfo is None:
        occurred_at_utc = occurred_at_utc.replace(tzinfo=timezone.utc)
    else:
        occurred_at_utc = occurred_at_utc.astimezone(timezone.utc)
    resolved_timezone = resolve_timezone(timezone_name)
    outcome = (
        craving.outcome
        if craving.outcome in {"resisted", "used_nicotine", "used_alternative"}
        else None
    )
    trigger = (
        re.sub(r"\s+", " ", craving.trigger.strip()).lower() or None
        if isinstance(craving.trigger, str)
        else None
    )
    return CanonicalCraving(
        id=craving.id,
        client_event_id=craving.client_event_id,
        occurred_at_utc=occurred_at_utc,
        occurred_at_local=occurred_at_utc.astimezone(resolved_timezone),
        intensity=craving.intensity,
        trigger=trigger,
        outcome=outcome,
        linked_log_id=craving.linked_log_id,
        duration_minutes=craving.duration_minutes,
        physical_symptoms=tuple(craving.get_physical_symptoms_list()),
        situation_context=craving.situation_context,
        outcome_notes=craving.outcome_notes,
        mood_before=craving.mood_before,
        mood_after=craving.mood_after,
        stress_level=craving.stress_level,
        notes=craving.notes,
    )


def serialize_canonical_craving(value: CanonicalCraving) -> dict:
    return {
        "id": value.id,
        "client_event_id": value.client_event_id,
        "occurred_at_utc": _aware_iso(value.occurred_at_utc),
        "occurred_at_local": _aware_iso(value.occurred_at_local),
        "intensity": value.intensity,
        "trigger": value.trigger,
        "outcome": value.outcome,
        "linked_log_id": value.linked_log_id,
        "duration_minutes": value.duration_minutes,
        "physical_symptoms": list(value.physical_symptoms),
        "situation_context": value.situation_context,
        "outcome_notes": value.outcome_notes,
        "mood_before": value.mood_before,
        "mood_after": value.mood_after,
        "stress_level": value.stress_level,
        "notes": value.notes,
    }


def _serialize_timeline_item(item) -> dict:
    if item.type == "log":
        data = serialize_canonical_log(item.data)
    elif item.type == "craving":
        data = serialize_canonical_craving(item.data)
    elif item.type == "check_in":
        data = _serialize_check_in(item.data)
    else:
        raise ValueError(f"unsupported timeline discriminator: {item.type!r}")
    return {
        "type": item.type,
        "id": item.id,
        "occurred_at_utc": _aware_iso(item.occurred_at_utc),
        "occurred_at_local": _aware_iso(item.occurred_at_local),
        "state": item.state,
        "label": item.label,
        "data": data,
    }


def serialize_today_summary(value: TodaySummary) -> dict:
    """Serialize every field of the immutable Task 1 Today contract."""
    plan = None
    if value.plan is not None:
        plan = {
            "id": value.plan.id,
            "mode": value.plan.mode,
            "status": value.plan.status,
            "local_date": value.plan.local_date.isoformat(),
            "day_number": value.plan.day_number,
            "target_pouches": value.plan.target_pouches,
            "nicotine_ceiling_mg": _decimal_string(
                value.plan.nicotine_ceiling_mg
            ),
            "pace": value.plan.pace,
            "stage_label": value.plan.stage_label,
        }

    smart_default = None
    if value.smart_default is not None:
        smart_default = {
            "pouch_id": value.smart_default.pouch_id,
            "brand": value.smart_default.brand,
            "nicotine_mg": _decimal_string(value.smart_default.nicotine_mg),
            "source": value.smart_default.source,
        }

    coaching = None
    if value.coaching is not None:
        coaching = {
            "key": value.coaching.key,
            "headline": value.coaching.headline,
            "body": value.coaching.body,
            "actions": [
                {
                    "key": action.key,
                    "label": action.label,
                    "href": action.href,
                }
                for action in value.coaching.actions
            ],
        }

    return {
        "local_date": value.local_date.isoformat(),
        "window": {
            "start_utc": _aware_iso(value.window.start_utc),
            "end_utc": _aware_iso(value.window.end_utc),
        },
        "generated_at": _aware_iso(value.generated_at),
        "plan": plan,
        "actuals": {
            "pouches": value.actual_pouches,
            "nicotine_mg": _decimal_string(value.actual_nicotine_mg),
            "known_nicotine_mg": _decimal_string(value.known_nicotine_mg),
            "unknown_strength_events": value.unknown_strength_events,
        },
        "remaining": {
            "pouches": value.remaining_pouches,
            "nicotine_mg": _decimal_string(value.remaining_nicotine_mg),
        },
        "status": value.status,
        "pouch_status": value.pouch_status,
        "nicotine_state": value.nicotine_state,
        "timeline": [
            _serialize_timeline_item(item) for item in value.timeline
        ],
        "smart_default": smart_default,
        "check_in": _serialize_check_in(value.check_in),
        "coaching": coaching,
        "check_in_eligible": value.check_in_eligible,
        "review_recommended": value.review_recommended,
        "milestones": list(value.milestones),
    }
