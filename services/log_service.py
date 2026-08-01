"""Log-related service functions.

These helpers encapsulate operations for creating and processing log entries,
including bulk insertion. They abstract away database interactions from the
route handlers.
"""
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from decimal import Decimal, InvalidOperation
from typing import Iterable, Dict, Any, Optional

import pytz
from sqlalchemy import delete, update
from sqlalchemy.exc import IntegrityError

from extensions import db
from services.timezone_service import (
    convert_user_time_to_utc,
    convert_utc_to_user_time,
    get_current_user_time,
    get_user_day_window,
    resolve_timezone,
    to_naive_utc,
)

# Import the Log and Pouch models from the models package aggregator
from models import Craving, Log, Pouch, User


# Maximum user-entered nicotine strength, matching the NUMERIC(8,2) storage.
MAX_NICOTINE_MG = Decimal('999999.99')
_CENT = Decimal('0.01')


@dataclass(frozen=True)
class CustomProductInput:
    brand: str
    nicotine_mg: Decimal


@dataclass(frozen=True)
class CreateLogInput:
    client_event_id: str | None
    pouch_id: int | None
    custom_product: CustomProductInput | None
    quantity: int
    occurred_at_utc: datetime
    occurred_at_local: datetime
    timezone: str
    notes: str | None
    craving_id: int | None


@dataclass(frozen=True)
class CreateLogResult:
    log: Log
    created: bool


class LogValidationError(ValueError):
    """Neutral, field-scoped validation failure at the mutation boundary."""

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


class CravingLinkConflictError(RuntimeError):
    """The craving already points at another canonical nicotine log."""


class LogNotFoundError(LookupError):
    """Missing and cross-owner log IDs intentionally share one result."""

    def __init__(self):
        super().__init__("That log does not exist.")


class LogService:
    """Transactional, ownership-scoped nicotine log mutations."""

    @classmethod
    def create_idempotent(
        cls, user_id: int, payload: CreateLogInput
    ) -> CreateLogResult:
        if payload.client_event_id is not None:
            existing = Log.query.filter_by(
                user_id=user_id,
                client_event_id=payload.client_event_id,
            ).one_or_none()
            if existing is not None:
                return CreateLogResult(log=existing, created=False)

        if (payload.pouch_id is None) == (payload.custom_product is None):
            raise LogValidationError({
                "product": [
                    "Choose one pouch or enter one custom product."
                ]
            })

        craving = None
        if payload.craving_id is not None:
            craving = Craving.query.filter_by(
                id=payload.craving_id,
                user_id=user_id,
            ).one_or_none()
            if craving is None:
                raise CravingNotFoundError()
            if craving.outcome != "used_nicotine":
                raise LogValidationError({
                    "craving_id": [
                        "Choose a craving marked as nicotine used."
                    ]
                })
            if craving.linked_log_id is not None:
                raise CravingLinkConflictError(
                    "That craving is already linked to another nicotine log."
                )

        occurred_at_utc = to_naive_utc(payload.occurred_at_utc)
        log = Log(
            user_id=user_id,
            client_event_id=payload.client_event_id,
            log_date=occurred_at_utc.date(),
            log_time=occurred_at_utc,
            quantity=payload.quantity,
            notes=payload.notes,
        )
        if payload.pouch_id is not None:
            pouch = Pouch.query.filter(
                Pouch.id == payload.pouch_id,
                db.or_(
                    Pouch.is_default.is_(True),
                    Pouch.created_by == user_id,
                ),
            ).one_or_none()
            if pouch is None:
                raise LogValidationError({
                    "pouch_id": ["Choose a pouch available to your account."]
                })
            assign_log_product(log, pouch_id=pouch.id)
        elif payload.custom_product is not None:
            assign_log_product(
                log,
                custom_brand=payload.custom_product.brand,
                custom_nicotine_mg=payload.custom_product.nicotine_mg,
            )

        try:
            db.session.add(log)
            if craving is not None:
                db.session.flush()
                claim = db.session.execute(
                    update(Craving)
                    .where(
                        Craving.id == craving.id,
                        Craving.user_id == user_id,
                        Craving.outcome == "used_nicotine",
                        Craving.linked_log_id.is_(None),
                    )
                    .values(linked_log_id=log.id)
                )
                if claim.rowcount != 1:
                    db.session.rollback()
                    raise CravingLinkConflictError(
                        "That craving is already linked to another nicotine log."
                    )
            db.session.commit()
        except IntegrityError:
            db.session.rollback()
            if payload.client_event_id is not None:
                winner = Log.query.filter_by(
                    user_id=user_id,
                    client_event_id=payload.client_event_id,
                ).one_or_none()
                if winner is not None:
                    return CreateLogResult(log=winner, created=False)
            raise
        return CreateLogResult(log=log, created=True)

    @classmethod
    def delete_owned(cls, user_id: int, log_id: int) -> None:
        db.session.execute(
            update(Craving)
            .where(
                Craving.user_id == user_id,
                Craving.linked_log_id == log_id,
            )
            .values(linked_log_id=None)
        )
        deleted = db.session.execute(
            delete(Log).where(
                Log.id == log_id,
                Log.user_id == user_id,
            )
        )
        if deleted.rowcount != 1:
            db.session.rollback()
            raise LogNotFoundError()
        db.session.commit()


def _resolve_user_zone(user) -> pytz.BaseTzInfo:
    """Resolve a persisted user timezone once for a public operation."""
    return resolve_timezone(user.timezone if user else None)


def _convert_local_with_resolved_zone(
    resolved_tz: pytz.BaseTzInfo,
    local_date: date,
    local_time: time,
) -> datetime:
    """Convert a user-local date/time to aware UTC with a pre-resolved zone.

    Identical semantics to ``convert_user_time_to_utc`` but reuses one
    resolved timezone, so a multi-entry operation resolves it exactly once.
    """
    naive_datetime = datetime.combine(local_date, local_time)
    return resolved_tz.localize(naive_datetime).astimezone(pytz.UTC)


def logs_for_user_interval(user_id: int, start_utc: datetime, end_utc: datetime) -> list:
    """Logs for ``user_id`` in the half-open UTC interval [start, end).

    Bounds may be timezone-aware or naive; they are normalized once to the
    database-naive UTC storage contract. Selection is by the authoritative
    ``Log.log_time`` only.
    """
    start = to_naive_utc(start_utc)
    end = to_naive_utc(end_utc)
    return Log.query.filter(
        Log.user_id == user_id,
        Log.log_time >= start,
        Log.log_time < end,
    ).order_by(Log.log_time).all()


def logs_for_user_window(user_id: int, window) -> list:
    """Logs for ``user_id`` inside a ``UserDayWindow``/``UserWeekWindow``."""
    return logs_for_user_interval(user_id, window.start_utc, window.end_utc)


def get_historical_brand(log: Log) -> Optional[str]:
    """Immutable product brand for a historical log.

    The snapshot is authoritative; ``custom_brand`` is used only for
    pre-snapshot custom rows. The live pouch is never consulted.
    """
    if log.product_brand_snapshot is not None:
        return log.product_brand_snapshot
    return log.custom_brand or None


def get_historical_nicotine_strength(log: Log) -> Optional[Decimal]:
    """Immutable nicotine strength for a historical log as ``Decimal``.

    A stored snapshot (including a known ``0.00``) is authoritative. When the
    snapshot is NULL, a non-NULL legacy ``custom_nicotine_mg`` is used for
    pre-snapshot custom rows; otherwise the strength is unknown (``None``).
    The live pouch is never consulted.
    """
    if log.nicotine_mg_snapshot is not None:
        return _normalize_stored_strength(log.nicotine_mg_snapshot)
    if log.custom_nicotine_mg is not None:
        return _normalize_stored_strength(log.custom_nicotine_mg)
    return None


def get_historical_total_nicotine(log: Log) -> Optional[Decimal]:
    """quantity × historical strength, or ``None`` when strength is unknown."""
    strength = get_historical_nicotine_strength(log)
    if strength is None:
        return None
    return Decimal(log.quantity or 0) * strength


def summarize_logs(logs) -> Dict[str, Any]:
    """Aggregate historical logs, retaining ``Decimal`` precision internally.

    ``unknown_strength_count`` counts log events whose strength is unknown
    (not their pouch quantity); those events are excluded from ``total_mg``.
    """
    total_pouches = 0
    total_mg = Decimal('0')
    total_logs = 0
    unknown_strength_count = 0
    for log in logs:
        total_logs += 1
        total_pouches += log.quantity or 0
        total = get_historical_total_nicotine(log)
        if total is None:
            unknown_strength_count += 1
        else:
            total_mg += total
    return {
        'total_pouches': total_pouches,
        'total_mg': total_mg,
        'total_logs': total_logs,
        'unknown_strength_count': unknown_strength_count,
    }


def log_local_datetime(log: Log, resolved_tz: pytz.BaseTzInfo) -> datetime:
    """The authoritative UTC ``log_time`` in the resolved user timezone."""
    authoritative_utc = pytz.UTC.localize(to_naive_utc(log.log_time))
    return authoritative_utc.astimezone(resolved_tz)


def log_effective_day(
    log: Log,
    resolved_tz: pytz.BaseTzInfo,
    reset_time: time = time.min,
) -> date:
    """Effective user-local calendar day of a log under the reset policy."""
    authoritative_utc = pytz.UTC.localize(to_naive_utc(log.log_time))
    local_datetime = authoritative_utc.astimezone(resolved_tz)
    candidate_date = local_datetime.date()
    candidate_window = get_user_day_window(
        resolved_tz.zone, candidate_date, reset_time
    )
    if authoritative_utc < candidate_window.start_utc:
        return candidate_date - timedelta(days=1)
    return candidate_date


def group_logs_by_effective_day(
    logs,
    resolved_tz: pytz.BaseTzInfo,
    reset_time: time = time.min,
) -> Dict[date, list]:
    """Group logs by effective local day without ever reading ``log_date``."""
    grouped = defaultdict(list)
    for log in logs:
        grouped[log_effective_day(log, resolved_tz, reset_time)].append(log)
    return grouped


def has_custom_product_input(custom_brand=None, custom_nicotine_mg=None) -> bool:
    """Whether a request supplied a meaningful custom product value.

    Browser forms submit empty custom controls alongside a selected pouch, so
    whitespace-only strings are absent. Numeric zero and every other nonblank
    value are meaningful and therefore contradictory with an existing pouch.
    """
    return any(
        value is not None and str(value).strip()
        for value in (custom_brand, custom_nicotine_mg)
    )


def parse_nicotine_strength(value) -> Optional[Decimal]:
    """Validate a user-entered nicotine strength.

    Returns the strength as a two-decimal ``Decimal`` (``'1.5'`` becomes
    ``Decimal('1.50')``), or ``None`` for absent/unquantified input. Raises
    ``ValueError`` for non-finite, non-positive, more-than-two-decimal-place,
    or overflowing values; such input is rejected, never rounded. Values pass
    through ``Decimal(str(value))`` so nicotine data never travels through
    binary float or integer conversion.
    """
    if value is None:
        return None
    if isinstance(value, str):
        value = value.strip()
        if not value:
            return None
    try:
        strength = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f'nicotine strength is not a number: {value!r}')
    if not strength.is_finite():
        raise ValueError(f'nicotine strength must be finite: {value!r}')
    if strength.as_tuple().exponent < -2:
        raise ValueError(
            f'nicotine strength allows at most two decimal places: {value!r}'
        )
    if strength <= 0:
        raise ValueError(f'nicotine strength must be greater than zero: {value!r}')
    if strength > MAX_NICOTINE_MG:
        raise ValueError(
            f'nicotine strength exceeds the {MAX_NICOTINE_MG}mg maximum: {value!r}'
        )
    quantized = strength.quantize(_CENT)
    return quantized


def _normalize_stored_strength(value) -> Optional[Decimal]:
    """Normalize an authoritative persisted strength without input rules.

    Stored catalog data may contain a known legacy zero, which remains
    semantically distinct from unknown. Positivity validation belongs only to
    new user input; authoritative Numeric values are merely normalized to the
    snapshot's two-decimal representation.
    """
    if value is None:
        return None
    try:
        strength = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise ValueError(f'stored nicotine strength is not numeric: {value!r}')
    if not strength.is_finite():
        raise ValueError(f'stored nicotine strength must be finite: {value!r}')
    return strength.quantize(_CENT)


def assign_log_product(log: Log,
                       pouch_id: int = None,
                       custom_brand: str = None,
                       custom_nicotine_mg=None) -> Log:
    """Canonical product assignment for a log entry, with immutable snapshots.

    Exactly one product source is allowed:

    - selected pouch: the authoritative pouch row is loaded server-side and
      its current brand and two-decimal strength become the snapshots. A
      client-supplied strength is never consulted for an existing pouch.
    - custom product: the trimmed brand and validated decimal strength are
      stored on the log and mirrored into the snapshots.
    - neither (legacy/unquantified input): every product field stays ``NULL``.
      Unknown is never turned into zero.

    Raises ``ValueError`` when an existing ``pouch_id`` is combined with any
    custom product field, when the pouch does not exist, or when a custom
    strength fails validation.

    Tenant scope: only a default pouch or a pouch created by the log's owner
    may be assigned; another user's custom pouch is rejected.
    """
    has_custom = custom_brand is not None or custom_nicotine_mg is not None
    if pouch_id is not None and has_custom:
        raise ValueError(
            'contradictory product input: an existing pouch cannot be '
            'combined with custom product fields'
        )

    if pouch_id is not None:
        pouch = db.session.get(Pouch, pouch_id)
        if pouch is None:
            raise ValueError(f'pouch {pouch_id} not found')
        if not pouch.is_default and pouch.created_by != log.user_id:
            raise ValueError(
                f'pouch {pouch_id} is not available to user {log.user_id}'
            )
        log.pouch_id = pouch.id
        log.product_brand_snapshot = pouch.brand
        log.nicotine_mg_snapshot = _normalize_stored_strength(pouch.nicotine_mg)
        return log

    brand = (custom_brand or '').strip() or None
    strength = parse_nicotine_strength(custom_nicotine_mg)
    log.custom_brand = brand
    log.custom_nicotine_mg = strength
    log.product_brand_snapshot = brand
    log.nicotine_mg_snapshot = strength
    return log


def add_log_entry(user_id: int,
                  log_date: date,
                  log_time: Optional[time],
                  quantity: int,
                  notes: str = "",
                  pouch_id: int = None,
                  custom_brand: str = None,
                  custom_nicotine_mg=None,
                  user_timezone: str = 'UTC') -> Log:
    """
    Create and persist a single log entry with timezone conversion.
    
    Args:
        user_id: ID of the user creating the log
        log_date: Date (UTC if user_timezone is None, user timezone otherwise)
        log_time: Time (UTC if user_timezone is None, user timezone otherwise)
        quantity: Number of pouches
        notes: Optional notes
        pouch_id: ID of existing pouch (optional)
        custom_brand: Custom brand name (optional)
        custom_nicotine_mg: Custom nicotine content (optional)
        user_timezone: User's timezone for conversion (None to skip conversion)
    
    Returns:
        Created Log entry
    """
    if user_timezone is None:
        # Values are already in UTC, create datetime directly
        if log_time is not None:
            utc_datetime = datetime.combine(log_date, log_time)
        else:
            utc_datetime = datetime.combine(log_date, datetime.now().time())
    else:
        # Resolve the user's timezone once and reuse it for this operation.
        resolved_tz = resolve_timezone(user_timezone)
        # Convert user's local time to UTC for storage
        if log_time is not None:
            utc_datetime = _convert_local_with_resolved_zone(
                resolved_tz, log_date, log_time
            )
        else:
            # If no time provided, use current time in user's timezone
            current_time = (
                datetime.now(pytz.UTC).astimezone(resolved_tz).time().replace(tzinfo=None)
            )
            utc_datetime = _convert_local_with_resolved_zone(
                resolved_tz, log_date, current_time
            )
    
    log_entry = Log(
        user_id=user_id,
        log_date=utc_datetime.date(),  # Keep for backward compatibility
        log_time=utc_datetime,  # Store complete UTC datetime
        quantity=quantity,
        notes=notes
    )

    assign_log_product(
        log_entry,
        pouch_id=pouch_id,
        custom_brand=custom_brand,
        custom_nicotine_mg=custom_nicotine_mg,
    )

    db.session.add(log_entry)
    db.session.commit()
    return log_entry

def add_bulk_logs(user_id: int, entries: Iterable[Dict[str, Any]], log_date: date, user_timezone: str = 'UTC') -> int:
    """
    Create multiple log entries from a list of parsed entries with timezone conversion.
    
    Args:
        user_id: ID of the user creating the logs
        entries: List of entry dictionaries
        log_date: Date in user's timezone
        user_timezone: User's timezone for conversion
    
    Returns:
        Number of entries created
    """
    # Resolve the user's timezone once and reuse it for every entry.
    resolved_tz = resolve_timezone(user_timezone)
    count = 0
    for entry in entries:
        # Convert time to UTC if provided
        entry_time = entry.get("time")
        if entry_time is not None:
            utc_datetime = _convert_local_with_resolved_zone(
                resolved_tz, log_date, entry_time
            )
        else:
            # Use noon in user's timezone as default
            utc_datetime = _convert_local_with_resolved_zone(
                resolved_tz, log_date, time(12, 0)
            )
        
        log_entry = Log(
            user_id=user_id,
            log_date=utc_datetime.date(),  # Keep for backward compatibility
            log_time=utc_datetime,  # Store complete UTC datetime
            quantity=entry["quantity"]
        )

        brand = entry.get("brand")
        raw_strength = entry.get("nicotine_mg")
        if brand is not None and raw_strength is not None:
            strength = parse_nicotine_strength(raw_strength)
            # Bulk matching uses the same tenant scope as canonical
            # assignment: default pouches or the current user's own.
            pouch = Pouch.query.filter(
                Pouch.brand == brand,
                Pouch.nicotine_mg == strength,
                db.or_(Pouch.is_default, Pouch.created_by == user_id),
            ).first()
            if pouch:
                # Existing catalog entry: authoritative server-side values.
                assign_log_product(log_entry, pouch_id=pouch.id)
            else:
                assign_log_product(
                    log_entry, custom_brand=brand, custom_nicotine_mg=strength
                )
        elif brand is not None or raw_strength is not None:
            # Preserve whichever custom field is known. A strength-only or
            # brand-only entry is partially quantified, not wholly unknown.
            assign_log_product(
                log_entry,
                custom_brand=brand,
                custom_nicotine_mg=raw_strength,
            )

        db.session.add(log_entry)
        count += 1
    
    db.session.commit()
    return count


def get_daily_intake_for_user(user_id: int, start_date: date, end_date: date, reset_time: time = time(0, 0)) -> Dict[date, float]:
    """
    Calculates daily nicotine intake for a user over a date range, considering the user's daily reset time.

    Args:
        user_id: The ID of the user.
        start_date: The start of the date range (inclusive).
        end_date: The end of the date range (inclusive).
        reset_time: The user's daily reset time. Logs before this time are counted for the previous day.

    Returns:
        A dictionary where keys are dates and values are the total nicotine for that day.
    """
    user = User.query.get(user_id)
    if not user:
        return {}
    resolved_tz = _resolve_user_zone(user)

    # Determine the current local calendar date from one aware UTC instant,
    # then classify it against that date's canonical reset window. Wall-clock
    # time comparisons are invalid across spring gaps and fall-back overlaps.
    now_utc = datetime.now(pytz.UTC)
    current_local_date = now_utc.astimezone(resolved_tz).date()
    current_window = get_user_day_window(
        resolved_tz.zone, current_local_date, reset_time
    )
    before_current_reset = now_utc < current_window.start_utc

    effective_end_date = end_date
    # Preserve the existing cutoff: only an end_date equal to the current
    # local calendar date is reduced before that date's canonical reset.
    if end_date == current_local_date and before_current_reset:
        effective_end_date -= timedelta(days=1)

    # Canonical reset-aware local-day windows: the union of the first
    # requested day window through the effective end day window, half-open,
    # selected solely by the authoritative UTC log_time.
    start_window = get_user_day_window(resolved_tz.zone, start_date, reset_time)
    end_window = get_user_day_window(resolved_tz.zone, end_date, reset_time)
    logs = logs_for_user_interval(
        user_id, start_window.start_utc, end_window.end_utc
    )

    # Totals accumulate as Decimal; they are converted to float for the
    # JSON-facing result.
    daily_intake = defaultdict(lambda: Decimal('0'))
    
    # Pre-fill the result with zeros for the dates that should be displayed
    result = {}
    current_date = start_date
    while current_date <= effective_end_date:
        result[current_date] = 0
        current_date += timedelta(days=1)

    if not logs:
        return result

    for log in logs:
        effective_date = log_effective_day(log, resolved_tz, reset_time)

        # Historical aggregates resolve the immutable snapshot/custom
        # strength; a NULL legacy strength is unknown and excluded, never
        # back-filled from the live pouch or treated as zero.
        total_nicotine = get_historical_total_nicotine(log)
        # Only include intake for dates that exist as keys in our result dict
        if total_nicotine is not None and effective_date in result:
            daily_intake[effective_date] += total_nicotine
    
    # Populate the results dictionary with calculated totals
    for day, total in daily_intake.items():
        result[day] = float(total)
        
    return result

def get_user_logs(user_id: int) -> Iterable[Log]:
    """Retrieve all logs for a given user, ordered by most recent."""
    return Log.query.filter_by(user_id=user_id).order_by(Log.log_time.desc()).all()

def create_log_entry(user_id: int, pouch_id: int, quantity: int, log_time: datetime, notes: str = "") -> Log:
    """
    Creates a log entry. Simplified for testing.
    """
    log = Log(
        user_id=user_id,
        quantity=quantity,
        log_time=log_time,
        log_date=log_time.date(),
        notes=notes
    )
    assign_log_product(log, pouch_id=pouch_id)
    db.session.add(log)
    db.session.commit()
    return log

def get_logs_by_date_range(user_id: int, start_date: date, end_date: date) -> Iterable[Log]:
    """Retrieve logs for a user within a user-local calendar date range.

    ``start_date``/``end_date`` are inclusive calendar dates in the user's
    persisted timezone. The bounds become canonical day windows and the
    selection uses only the authoritative UTC ``log_time``; the deprecated
    legacy ``log_date`` column is never consulted.
    """
    user = User.query.get(user_id)
    if not user:
        return []
    resolved_tz = _resolve_user_zone(user)
    start_window = get_user_day_window(resolved_tz.zone, start_date)
    end_window = get_user_day_window(resolved_tz.zone, end_date)
    return logs_for_user_interval(
        user_id, start_window.start_utc, end_window.end_utc
    )

def get_average_daily_usage(user_id: int) -> float:
    """Calculates the average daily pouch usage for a user.

    Quantities are grouped by the effective user-local date derived from the
    authoritative ``log_time``, never by UTC date or legacy ``log_date``.
    """
    user = User.query.get(user_id)
    if not user:
        return 0.0
    resolved_tz = _resolve_user_zone(user)
    logs = Log.query.filter_by(user_id=user_id).all()
    if not logs:
        return 0.0

    # Group by date and sum quantities
    daily_usage = defaultdict(int)
    for log in logs:
        daily_usage[log_effective_day(log, resolved_tz)] += log.quantity

    if not daily_usage:
        return 0.0

    total_pouches = sum(daily_usage.values())
    num_days = len(daily_usage)
    return total_pouches / num_days if num_days > 0 else 0.0
