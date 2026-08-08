"""Strongly typed immutable service contracts for the progressive API."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from typing import Literal

from services.timezone_service import UserDayWindow


TodayStatus = Literal[
    "neutral", "unknown", "on_track", "approaching", "met", "exceeded"
]
GuardrailStatus = Literal["neutral", "on_track", "approaching", "met", "exceeded"]
NicotineStatus = TodayStatus
JourneyProgressStatus = Literal[
    "below_ceiling",
    "at_ceiling",
    "above_ceiling",
    "no_ceiling",
    "nicotine_total_incomplete",
]
JourneyNextChangeKind = Literal[
    "ceiling_change", "first_ceiling", "resume_required"
]


def _require_aware(name: str, value: datetime) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be timezone-aware")
    if name.endswith("_utc") and value.utcoffset() != timedelta(0):
        raise ValueError(f"{name} must be UTC and timezone-aware")


@dataclass(frozen=True)
class TodayPlan:
    """The active plan and target matched to one canonical user day."""

    id: int
    mode: Literal["reduce", "quit_by_date", "observe"]
    status: Literal["active", "paused", "completed", "archived"]
    local_date: date
    day_number: int
    target_pouches: int | None
    nicotine_ceiling_mg: Decimal | None
    pace: Literal["gentle", "steady", "focused"] | None
    stage_label: str


@dataclass(frozen=True)
class SmartDefault:
    pouch_id: int
    brand: str
    nicotine_mg: Decimal
    source: Literal["preferred", "recent"]


@dataclass(frozen=True)
class CanonicalLog:
    id: int
    client_event_id: str | None
    occurred_at_utc: datetime
    occurred_at_local: datetime
    pouch_id: int | None
    product_brand: str | None
    nicotine_mg: Decimal | None
    quantity: int
    total_nicotine_mg: Decimal | None
    notes: str | None
    linked_craving_id: int | None

    def __post_init__(self) -> None:
        _require_aware("occurred_at_utc", self.occurred_at_utc)
        _require_aware("occurred_at_local", self.occurred_at_local)


@dataclass(frozen=True)
class CanonicalCraving:
    id: int
    client_event_id: str | None
    occurred_at_utc: datetime
    occurred_at_local: datetime
    intensity: int
    trigger: str | None
    outcome: Literal["resisted", "used_nicotine", "used_alternative"] | None
    linked_log_id: int | None
    duration_minutes: int | None
    physical_symptoms: tuple[str, ...]
    situation_context: str | None
    outcome_notes: str | None
    mood_before: int | None
    mood_after: int | None
    stress_level: int | None
    notes: str | None

    def __post_init__(self) -> None:
        _require_aware("occurred_at_utc", self.occurred_at_utc)
        _require_aware("occurred_at_local", self.occurred_at_local)


@dataclass(frozen=True)
class CanonicalCheckIn:
    id: int
    local_date: date
    mood: int | None
    confidence: int | None
    reflection: str | None
    context: str | None


@dataclass(frozen=True)
class MutationWarning:
    code: str
    retryable: bool


@dataclass(frozen=True)
class LogTimelineItem:
    type: Literal["log"]
    id: int
    occurred_at_utc: datetime
    occurred_at_local: datetime
    state: Literal["confirmed"]
    label: str
    data: CanonicalLog

    def __post_init__(self) -> None:
        _require_aware("occurred_at_utc", self.occurred_at_utc)
        _require_aware("occurred_at_local", self.occurred_at_local)


@dataclass(frozen=True)
class CravingTimelineItem:
    type: Literal["craving"]
    id: int
    occurred_at_utc: datetime
    occurred_at_local: datetime
    state: Literal["unresolved", "resisted", "used_nicotine", "used_alternative"]
    label: str
    data: CanonicalCraving

    def __post_init__(self) -> None:
        _require_aware("occurred_at_utc", self.occurred_at_utc)
        _require_aware("occurred_at_local", self.occurred_at_local)


@dataclass(frozen=True)
class CheckInTimelineItem:
    type: Literal["check_in"]
    id: int
    occurred_at_utc: datetime
    occurred_at_local: datetime
    state: Literal["completed"]
    label: str
    data: CanonicalCheckIn

    def __post_init__(self) -> None:
        _require_aware("occurred_at_utc", self.occurred_at_utc)
        _require_aware("occurred_at_local", self.occurred_at_local)


TimelineItem = LogTimelineItem | CravingTimelineItem | CheckInTimelineItem


@dataclass(frozen=True)
class CoachingAction:
    """One allowlisted internal action attached to coaching copy."""

    key: str
    label: str
    href: str

    def __post_init__(self) -> None:
        allowed_roots = ("/today", "/journey")
        if not any(
            self.href == root
            or self.href.startswith(f"{root}#")
            or self.href.startswith(f"{root}?")
            for root in allowed_roots
        ):
            raise ValueError("coaching href must use an allowlisted internal path")


@dataclass(frozen=True)
class CoachingMessage:
    """Deterministic coaching content; never an untyped payload."""

    key: str
    headline: str
    body: str
    actions: tuple[CoachingAction, ...]


@dataclass(frozen=True)
class TodaySummary:
    """One canonical local-day view model shared by HTML and JSON callers."""

    local_date: date
    window: UserDayWindow
    plan: TodayPlan | None
    actual_pouches: int
    actual_nicotine_mg: Decimal | None
    known_nicotine_mg: Decimal
    unknown_strength_events: int
    remaining_pouches: int | None
    remaining_nicotine_mg: Decimal | None
    status: TodayStatus
    pouch_status: GuardrailStatus
    nicotine_state: NicotineStatus
    timeline: tuple[TimelineItem, ...]
    smart_default: SmartDefault | None
    check_in: CanonicalCheckIn | None
    coaching: CoachingMessage | None
    check_in_eligible: bool
    review_recommended: bool
    milestones: tuple[str, ...]
    generated_at: datetime

    def __post_init__(self) -> None:
        if (
            self.generated_at.tzinfo is None
            or self.generated_at.utcoffset() != timedelta(0)
        ):
            raise ValueError("generated_at must be UTC and timezone-aware")


@dataclass(frozen=True)
class JourneyNextChange:
    """The next user-meaningful transition in the plan schedule."""

    kind: JourneyNextChangeKind
    local_date: date | None
    ceiling_mg: Decimal | None
    change_mg: Decimal | None


@dataclass(frozen=True)
class JourneyProgress:
    """Nicotine-first Journey facts derived from the canonical Today summary."""

    known_mg: Decimal
    total_complete: bool
    ceiling_mg: Decimal | None
    remaining_mg: Decimal | None
    status: JourneyProgressStatus
    pouches_logged: int
    next_change: JourneyNextChange | None
