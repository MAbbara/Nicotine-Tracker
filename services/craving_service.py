"""Craving-related service functions.

These helpers encapsulate operations for creating, analyzing, and managing cravings.
"""
from dataclasses import dataclass
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional
import json
import re
from uuid import UUID
from sqlalchemy import func, desc, and_, update
from sqlalchemy.exc import IntegrityError
import pytz

from extensions import db
from models import Craving, Log, User
from services.timezone_service import (
    InvalidEventTimeError,
    parse_local_event_time,
    resolve_timezone,
    to_naive_utc,
)


@dataclass(frozen=True)
class CreateCravingInput:
    """Validated immutable input for one canonical craving event."""

    client_event_id: str
    intensity: int
    trigger: str | None
    occurred_at_utc: datetime
    occurred_at_local: datetime
    timezone: str


@dataclass(frozen=True)
class CreateCravingResult:
    craving: Craving
    created: bool


@dataclass(frozen=True)
class UpdateCravingInput:
    """Validated partial update with explicit field-presence tracking."""

    provided_fields: frozenset[str]
    outcome: str | None = None
    duration_minutes: int | None = None
    mood_before: int | None = None
    mood_after: int | None = None
    stress_level: int | None = None
    physical_symptoms: tuple[str, ...] | None = None
    situation_context: str | None = None
    notes: str | None = None
    outcome_notes: str | None = None

    def has(self, field: str) -> bool:
        return field in self.provided_fields


class CravingValidationError(ValueError):
    """Field-scoped validation failure at the mutation boundary."""

    def __init__(self, field_errors):
        super().__init__("Check the highlighted fields and try again.")
        self.field_errors = {
            field: list(messages)
            for field, messages in dict(field_errors).items()
        }


class CravingNotFoundError(LookupError):
    """Missing and cross-owner craving IDs intentionally share one result."""

    def __init__(self):
        super().__init__("That craving does not exist.")


class CravingOutcomeConflictError(RuntimeError):
    """A resolved craving cannot transition to a different outcome."""


_DETAIL_FIELDS = (
    "duration_minutes",
    "mood_before",
    "mood_after",
    "stress_level",
    "situation_context",
    "notes",
    "outcome_notes",
)
_UPDATE_FIELDS = frozenset({"outcome", "physical_symptoms", *_DETAIL_FIELDS})
_ALLOWED_OUTCOMES = frozenset({
    "resisted", "used_nicotine", "used_alternative"
})


def _canonical_uuid(value) -> bool:
    if not isinstance(value, str):
        return False
    try:
        return str(UUID(value)) == value
    except (ValueError, AttributeError, TypeError):
        return False


def _validate_create_payload(payload: CreateCravingInput) -> None:
    if not _canonical_uuid(payload.client_event_id):
        raise CravingValidationError({
            "client_event_id": ["Use a canonical hyphenated UUID."]
        })
    if (
        isinstance(payload.intensity, bool)
        or not isinstance(payload.intensity, int)
        or not 1 <= payload.intensity <= 10
    ):
        raise CravingValidationError({
            "intensity": ["Enter a whole number from 1 to 10."]
        })
    if payload.trigger is not None:
        if not isinstance(payload.trigger, str):
            raise CravingValidationError({
                "trigger": ["Enter up to 100 characters."]
            })
        normalized = re.sub(r"\s+", " ", payload.trigger.strip()).lower()
        if (
            not normalized
            or normalized != payload.trigger
            or len(normalized) > 100
        ):
            raise CravingValidationError({
                "trigger": ["Enter up to 100 normalized characters."]
            })
    if (
        not isinstance(payload.occurred_at_utc, datetime)
        or payload.occurred_at_utc.tzinfo is None
        or payload.occurred_at_utc.utcoffset() != timedelta(0)
        or not isinstance(payload.occurred_at_local, datetime)
        or payload.occurred_at_local.tzinfo is None
        or payload.occurred_at_local.utcoffset() is None
    ):
        raise CravingValidationError({
            "occurred_at_local": [
                "Enter a timezone-verified local event time."
            ]
        })
    try:
        verified_utc = parse_local_event_time(
            payload.timezone,
            payload.occurred_at_local.replace(tzinfo=None),
            payload.occurred_at_local.utcoffset(),
        )
    except (pytz.exceptions.UnknownTimeZoneError, InvalidEventTimeError):
        raise CravingValidationError({
            "occurred_at_local": [
                "Enter a timezone-verified local event time."
            ]
        }) from None
    if verified_utc != payload.occurred_at_utc.astimezone(pytz.UTC):
        raise CravingValidationError({
            "occurred_at_local": [
                "Enter a timezone-verified local event time."
            ]
        })


def _validate_update_payload(patch: UpdateCravingInput) -> None:
    provided = patch.provided_fields
    if not isinstance(provided, frozenset) or not provided:
        raise CravingValidationError({
            "body": ["Provide at least one craving update field."]
        })
    unknown = sorted(provided - _UPDATE_FIELDS)
    if unknown:
        raise CravingValidationError({
            field: ["This field is not supported."] for field in unknown
        })
    if patch.has("outcome") and (
        not isinstance(patch.outcome, str)
        or patch.outcome not in _ALLOWED_OUTCOMES
    ):
        raise CravingValidationError({
            "outcome": [
                "Choose resisted, used nicotine, or used alternative."
            ]
        })
    if patch.has("duration_minutes"):
        value = patch.duration_minutes
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not 0 <= value <= 1440
        ):
            raise CravingValidationError({
                "duration_minutes": [
                    "Enter a whole number from 0 to 1,440, or null."
                ]
            })
    for field in ("mood_before", "mood_after", "stress_level"):
        if not patch.has(field):
            continue
        value = getattr(patch, field)
        if value is not None and (
            isinstance(value, bool)
            or not isinstance(value, int)
            or not 1 <= value <= 10
        ):
            raise CravingValidationError({
                field: ["Enter a whole number from 1 to 10, or null."]
            })
    for field in ("situation_context", "notes", "outcome_notes"):
        if not patch.has(field):
            continue
        value = getattr(patch, field)
        if value is not None and (
            not isinstance(value, str)
            or not value
            or value != value.strip()
            or len(value) > 2000
        ):
            raise CravingValidationError({
                field: ["Enter up to 2,000 normalized characters, or null."]
            })
    if patch.has("physical_symptoms"):
        symptoms = patch.physical_symptoms
        if symptoms is None:
            return
        if not isinstance(symptoms, tuple) or len(symptoms) > 20:
            raise CravingValidationError({
                "physical_symptoms": ["Enter normalized symptom labels."]
            })
        seen = set()
        for symptom in symptoms:
            identity = symptom.casefold() if isinstance(symptom, str) else None
            if (
                not isinstance(symptom, str)
                or not symptom
                or symptom != re.sub(r"\s+", " ", symptom.strip())
                or len(symptom) > 80
                or identity in seen
            ):
                raise CravingValidationError({
                    "physical_symptoms": ["Enter normalized symptom labels."]
                })
            seen.add(identity)


def _update_values(patch: UpdateCravingInput) -> dict:
    values = {
        field: getattr(patch, field)
        for field in _DETAIL_FIELDS
        if patch.has(field)
    }
    if patch.has("physical_symptoms"):
        values["physical_symptoms"] = (
            json.dumps(list(patch.physical_symptoms))
            if patch.physical_symptoms else None
        )
    return values


class CravingService:
    """Transactional, ownership-scoped craving mutations."""

    @classmethod
    def create_idempotent(
        cls, user_id: int, payload: CreateCravingInput
    ) -> CreateCravingResult:
        existing = Craving.query.filter_by(
            user_id=user_id,
            client_event_id=payload.client_event_id,
        ).one_or_none()
        if existing is not None:
            return CreateCravingResult(craving=existing, created=False)

        _validate_create_payload(payload)
        craving = Craving(
            user_id=user_id,
            client_event_id=payload.client_event_id,
            craving_time=to_naive_utc(payload.occurred_at_utc),
            intensity=payload.intensity,
            trigger=payload.trigger,
        )
        db.session.add(craving)
        try:
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            winner = Craving.query.filter_by(
                user_id=user_id,
                client_event_id=payload.client_event_id,
            ).one_or_none()
            if winner is not None:
                return CreateCravingResult(craving=winner, created=False)
            raise
        return CreateCravingResult(craving=craving, created=True)

    @classmethod
    def update_owned(
        cls, user_id: int, craving_id: int, patch: UpdateCravingInput
    ) -> Craving:
        _validate_update_payload(patch)
        craving = Craving.query.filter_by(
            id=craving_id,
            user_id=user_id,
        ).one_or_none()
        if craving is None:
            raise CravingNotFoundError()

        values = _update_values(patch)
        if not patch.has("outcome"):
            for field, value in values.items():
                setattr(craving, field, value)
            db.session.commit()
            return craving

        desired_outcome = patch.outcome
        if craving.outcome is None:
            claimed = db.session.execute(
                update(Craving)
                .where(
                    Craving.id == craving_id,
                    Craving.user_id == user_id,
                    Craving.outcome.is_(None),
                )
                .values(outcome=desired_outcome, **values)
            )
            if claimed.rowcount == 1:
                db.session.commit()
                db.session.expire_all()
                return Craving.query.filter_by(
                    id=craving_id,
                    user_id=user_id,
                ).one()

            db.session.rollback()
            db.session.expire_all()
            craving = Craving.query.filter_by(
                id=craving_id,
                user_id=user_id,
            ).one_or_none()
            if craving is None:
                raise CravingNotFoundError()

        if craving.outcome != desired_outcome:
            db.session.rollback()
            raise CravingOutcomeConflictError(
                "That craving already has a different outcome."
            )
        for field, value in values.items():
            setattr(craving, field, value)
        db.session.commit()
        return craving


def _rolling_bounds(days: int):
    """One half-open naive-UTC rolling window ``[now - days, now)``.

    ``now`` is captured once so every predicate in an operation compares
    against the same instant, and future-dated events are always excluded.
    """
    now = datetime.utcnow()
    return now - timedelta(days=days), now


def _load_localized_craving_datetimes(
    user_id: int,
    days: int,
    bounds=None,
) -> List[datetime]:
    """Load and localize this user's bounded cravings once."""
    start_date, now = bounds if bounds is not None else _rolling_bounds(days)
    user = User.query.get(user_id)
    resolved_tz = resolve_timezone(user.timezone if user else None)
    cravings = Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.craving_time < now,
    ).order_by(Craving.craving_time).all()

    return [
        pytz.UTC.localize(to_naive_utc(craving.craving_time)).astimezone(resolved_tz)
        for craving in cravings
    ]


def _reduce_cravings_by_time_of_day(
    localized_datetimes: List[datetime],
) -> Dict[str, int]:
    """Build zero-filled time-of-day buckets from localized datetimes."""
    time_periods = {
        'Night (12AM-6AM)': 0,
        'Morning (6AM-12PM)': 0,
        'Afternoon (12PM-6PM)': 0,
        'Evening (6PM-12AM)': 0
    }

    for local_datetime in localized_datetimes:
        hour = local_datetime.hour
        if 0 <= hour < 6:
            time_periods['Night (12AM-6AM)'] += 1
        elif 6 <= hour < 12:
            time_periods['Morning (6AM-12PM)'] += 1
        elif 12 <= hour < 18:
            time_periods['Afternoon (12PM-6PM)'] += 1
        else:
            time_periods['Evening (6PM-12AM)'] += 1

    return time_periods


def _reduce_cravings_by_day_of_week(
    localized_datetimes: List[datetime],
) -> Dict[str, int]:
    """Build zero-filled weekday buckets from localized datetimes."""
    day_names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    day_counts = {day: 0 for day in day_names}

    for local_datetime in localized_datetimes:
        # Python weekday() is Mon=0; the bucket map is Sunday-first.
        day_index = (local_datetime.weekday() + 1) % 7
        day_counts[day_names[day_index]] += 1

    return day_counts

def get_user_cravings(user_id: int, days: int = 30) -> List[Craving]:
    """Get user's cravings for the specified number of days."""
    start_date, now = _rolling_bounds(days)
    return Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.craving_time < now,
    ).order_by(desc(Craving.craving_time)).all()

def get_craving_patterns_by_time_of_day(user_id: int, days: int = 30, bounds=None) -> Dict[str, int]:
    """Analyze craving patterns by user-local time of day.

    Buckets are half-open: [06:00, 12:00) is Morning, so an exact boundary
    opens the bucket starting at it. Aggregation happens in Python after one
    timezone conversion per event — no database-specific date/time function.
    """
    localized_datetimes = _load_localized_craving_datetimes(user_id, days, bounds)
    return _reduce_cravings_by_time_of_day(localized_datetimes)

def get_craving_patterns_by_day_of_week(user_id: int, days: int = 30, bounds=None) -> Dict[str, int]:
    """Analyze craving patterns by user-local day of week.

    Weekday membership is computed in Python after one timezone conversion
    per event, so results are portable across SQLite and MySQL/MariaDB.
    """
    localized_datetimes = _load_localized_craving_datetimes(user_id, days, bounds)
    return _reduce_cravings_by_day_of_week(localized_datetimes)

def get_trigger_analysis(user_id: int, days: int = 30, bounds=None) -> Dict[str, Dict]:
    """Analyze craving triggers and their effectiveness."""
    start_date, now = bounds if bounds is not None else _rolling_bounds(days)
    
    # Query triggers with counts and average intensity
    triggers = db.session.query(
        Craving.trigger,
        func.count(Craving.id).label('count'),
        func.avg(Craving.intensity).label('avg_intensity'),
        func.avg(Craving.duration_minutes).label('avg_duration')
    ).filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.craving_time < now,
        Craving.trigger.isnot(None)
    ).group_by(Craving.trigger).order_by(desc('count')).all()
    
    trigger_analysis = {}
    for trigger in triggers:
        trigger_analysis[trigger.trigger] = {
            'count': trigger.count,
            'avg_intensity': round(float(trigger.avg_intensity), 1) if trigger.avg_intensity else 0,
            'avg_duration': round(float(trigger.avg_duration), 1) if trigger.avg_duration else None
        }
    
    return trigger_analysis

def get_craving_vs_consumption_correlation(user_id: int, days: int = 30, bounds=None) -> Dict[str, any]:
    """Analyze correlation between cravings and actual nicotine consumption."""
    start_date, now = bounds if bounds is not None else _rolling_bounds(days)
    
    # Only resolved canonical outcomes belong in the denominator. Legacy null,
    # blank, and invalid values remain unresolved rather than counting as a
    # failed resistance attempt.
    cravings_with_outcomes = Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.craving_time < now,
        Craving.outcome.in_((
            'resisted', 'used_nicotine', 'used_alternative'
        )),
    ).all()
    
    if not cravings_with_outcomes:
        return {
            'total_cravings': 0,
            'resisted_count': 0,
            'used_nicotine_count': 0,
            'used_alternative_count': 0,
            'resistance_rate': 0.0
        }
    
    outcome_counts = {'resisted': 0, 'used_nicotine': 0, 'used_alternative': 0}
    for craving in cravings_with_outcomes:
        if craving.outcome in outcome_counts:
            outcome_counts[craving.outcome] += 1
    
    total = len(cravings_with_outcomes)
    resistance_rate = (outcome_counts['resisted'] + outcome_counts['used_alternative']) / total * 100
    
    return {
        'total_cravings': total,
        'resisted_count': outcome_counts['resisted'],
        'used_nicotine_count': outcome_counts['used_nicotine'],
        'used_alternative_count': outcome_counts['used_alternative'],
        'resistance_rate': round(resistance_rate, 1)
    }

def get_intensity_trends(user_id: int, days: int = 30, bounds=None) -> Dict[str, any]:
    """Analyze craving intensity trends over time."""
    start_date, now = bounds if bounds is not None else _rolling_bounds(days)
    
    # Get daily average intensity
    daily_intensities = db.session.query(
        func.date(Craving.craving_time).label('date'),
        func.avg(Craving.intensity).label('avg_intensity'),
        func.count(Craving.id).label('count')
    ).filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.craving_time < now,
    ).group_by(func.date(Craving.craving_time)).order_by('date').all()
    
    if not daily_intensities:
        return {'trend': 'stable', 'current_avg': 0, 'change_percentage': 0}
    
    # Calculate trend
    intensities = [float(day.avg_intensity) for day in daily_intensities]
    if len(intensities) >= 2:
        first_half_avg = sum(intensities[:len(intensities)//2]) / (len(intensities)//2)
        second_half_avg = sum(intensities[len(intensities)//2:]) / (len(intensities) - len(intensities)//2)
        
        change_percentage = ((second_half_avg - first_half_avg) / first_half_avg) * 100 if first_half_avg > 0 else 0
        
        if change_percentage > 10:
            trend = 'increasing'
        elif change_percentage < -10:
            trend = 'decreasing'
        else:
            trend = 'stable'
    else:
        trend = 'stable'
        change_percentage = 0
    
    current_avg = round(sum(intensities) / len(intensities), 1) if intensities else 0
    
    return {
        'trend': trend,
        'current_avg': current_avg,
        'change_percentage': round(change_percentage, 1)
    }

def get_mood_correlation(user_id: int, days: int = 30, bounds=None) -> Dict[str, any]:
    """Analyze correlation between mood and cravings."""
    start_date, now = bounds if bounds is not None else _rolling_bounds(days)
    
    cravings_with_mood = Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.craving_time < now,
        Craving.mood_before.isnot(None)
    ).all()
    
    if not cravings_with_mood:
        return {'correlation': 'insufficient_data', 'avg_mood_before': 0, 'avg_intensity': 0}
    
    # Calculate correlation between mood_before and intensity
    moods = [craving.mood_before for craving in cravings_with_mood]
    intensities = [craving.intensity for craving in cravings_with_mood]
    
    avg_mood = sum(moods) / len(moods)
    avg_intensity = sum(intensities) / len(intensities)
    
    # Simple correlation analysis
    if avg_mood < 4:  # Low mood
        correlation = 'low_mood_high_cravings' if avg_intensity > 6 else 'low_mood_manageable_cravings'
    elif avg_mood > 7:  # High mood
        correlation = 'high_mood_low_cravings' if avg_intensity < 5 else 'high_mood_high_cravings'
    else:
        correlation = 'neutral_mood'
    
    return {
        'correlation': correlation,
        'avg_mood_before': round(avg_mood, 1),
        'avg_intensity': round(avg_intensity, 1)
    }

def get_comprehensive_craving_analytics(user_id: int, days: int = 30) -> Dict[str, any]:
    """Get comprehensive craving analytics for dashboard."""
    # One now/bounds pair shared by every rolling analytic in this operation.
    bounds = _rolling_bounds(days)
    localized_datetimes = _load_localized_craving_datetimes(user_id, days, bounds)
    return {
        'time_patterns': _reduce_cravings_by_time_of_day(localized_datetimes),
        'day_patterns': _reduce_cravings_by_day_of_week(localized_datetimes),
        'trigger_analysis': get_trigger_analysis(user_id, days, bounds),
        'consumption_correlation': get_craving_vs_consumption_correlation(user_id, days, bounds),
        'intensity_trends': get_intensity_trends(user_id, days, bounds),
        'mood_correlation': get_mood_correlation(user_id, days, bounds)
    }
