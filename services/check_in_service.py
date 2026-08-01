"""Canonical daily check-in parsing and transactional upsert."""

from dataclasses import dataclass
from datetime import datetime, time, timezone

from sqlalchemy import case
from sqlalchemy.exc import IntegrityError

from extensions import db
from models import DailyCheckIn, ReductionPlan, User
from services.api_errors import ApiValidationError
from services.today_service import TodayService
from services.timezone_service import resolve_timezone, to_naive_utc


_CHECK_IN_FIELDS = frozenset({
    "mood", "confidence", "reflection", "context",
})


@dataclass(frozen=True)
class CheckInInput:
    """Normalized values for one full daily check-in replacement."""

    mood: int | None
    confidence: int | None
    reflection: str | None
    context: str | None


class CheckInPersistenceError(RuntimeError):
    """A check-in write did not commit and has already been rolled back."""


def _text_value(value, field, errors):
    if value is None:
        return None
    if not isinstance(value, str):
        errors[field] = [
            "Enter up to 2,000 characters, or leave it blank."
        ]
        return None
    normalized = value.strip()
    if len(normalized) > 2000:
        errors[field] = [
            "Enter up to 2,000 characters, or leave it blank."
        ]
        return None
    return normalized or None


def _rating_value(value, field, errors):
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 5:
        errors[field] = [
            "Choose a whole number from 1 to 5, or leave it blank."
        ]
        return None
    return value


def parse_check_in_payload(body) -> CheckInInput:
    """Validate an exact optional four-field JSON object without coercion."""
    if not isinstance(body, dict):
        raise ApiValidationError({"body": ["Send one JSON object."]})

    errors = {}
    for field in sorted(set(body) - _CHECK_IN_FIELDS):
        errors[field] = ["This field is not supported."]

    mood = _rating_value(body.get("mood"), "mood", errors)
    confidence = _rating_value(
        body.get("confidence"), "confidence", errors
    )
    reflection = _text_value(
        body.get("reflection"), "reflection", errors
    )
    context = _text_value(body.get("context"), "context", errors)
    if errors:
        raise ApiValidationError(errors)
    return CheckInInput(
        mood=mood,
        confidence=confidence,
        reflection=reflection,
        context=context,
    )


def serialize_check_in(row: DailyCheckIn) -> dict:
    """Return the exact public check-in shape and no persistence metadata."""
    return {
        "id": row.id,
        "local_date": row.local_date.isoformat(),
        "mood": row.mood,
        "confidence": row.confidence,
        "reflection": row.reflection,
        "context": row.context,
    }


class CheckInService:
    """Own one race-safe replacement row per authenticated user day."""

    @staticmethod
    def _applicable_plan(user_id: int) -> ReductionPlan | None:
        return (
            ReductionPlan.query.filter(
                ReductionPlan.user_id == user_id,
                ReductionPlan.status.in_(("active", "paused")),
            )
            .order_by(
                case((ReductionPlan.status == "active", 0), else_=1),
                ReductionPlan.updated_at.desc(),
                ReductionPlan.id.desc(),
            )
            .first()
        )

    @classmethod
    def upsert_for_today(
        cls,
        user_id: int,
        payload: CheckInInput,
        *,
        now: datetime | None = None,
    ) -> DailyCheckIn:
        instant = TodayService._normalize_now(now or datetime.now(timezone.utc))
        user = User.query.filter_by(id=user_id).one_or_none()
        if user is None:
            raise LookupError("user not found")
        user_timezone = resolve_timezone(user.timezone)
        reset_time = (
            user.preferences.daily_reset_time
            if user.preferences and user.preferences.daily_reset_time
            else time.min
        )
        local_date = TodayService._local_date_for_instant(
            instant, user_timezone.zone, reset_time
        )
        plan = cls._applicable_plan(user_id)
        row = DailyCheckIn.query.filter_by(
            user_id=user_id,
            local_date=local_date,
        ).one_or_none()
        created = row is None
        if created:
            row = DailyCheckIn(
                user_id=user_id,
                local_date=local_date,
                created_at=to_naive_utc(instant),
            )
            db.session.add(row)
        cls._apply(row, payload, plan, instant)

        try:
            db.session.commit()
        except IntegrityError as conflict:
            db.session.rollback()
            if not created:
                raise CheckInPersistenceError(
                    "check-in update did not commit"
                ) from conflict
            winner = DailyCheckIn.query.filter_by(
                user_id=user_id,
                local_date=local_date,
            ).one_or_none()
            if winner is None:
                raise CheckInPersistenceError(
                    "check-in persistence conflict could not be recovered"
                ) from conflict
            cls._apply(winner, payload, plan, instant)
            try:
                db.session.commit()
            except Exception as retry_failure:
                db.session.rollback()
                raise CheckInPersistenceError(
                    "check-in persistence retry did not commit"
                ) from retry_failure
            return winner
        except Exception as failure:
            db.session.rollback()
            raise CheckInPersistenceError(
                "check-in persistence did not commit"
            ) from failure
        return row

    @staticmethod
    def _apply(
        row: DailyCheckIn,
        payload: CheckInInput,
        plan: ReductionPlan | None,
        instant: datetime,
    ) -> None:
        row.plan_id = plan.id if plan is not None else None
        row.mood = payload.mood
        row.confidence = payload.confidence
        row.reflection = payload.reflection
        row.context = payload.context
        row.updated_at = to_naive_utc(instant)
