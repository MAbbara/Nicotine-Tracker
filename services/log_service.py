"""Log-related service functions.

These helpers encapsulate operations for creating and processing log entries,
including bulk insertion. They abstract away database interactions from the
route handlers.
"""
from collections import defaultdict
from datetime import date, datetime, time, timedelta
from typing import Iterable, Dict, Any, Optional


from extensions import db
from services.timezone_service import convert_user_time_to_utc, get_current_user_time

# Import the Log and Pouch models from the models package aggregator
from models import Log, Pouch, User


def add_log_entry(user_id: int,
                  log_date: date,
                  log_time: Optional[time],
                  quantity: int,
                  notes: str = "",
                  pouch_id: int = None,
                  custom_brand: str = None,
                  custom_nicotine_mg: int = None,
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
        # Convert user's local time to UTC for storage
        if log_time is not None:
            utc_datetime, _, _ = convert_user_time_to_utc(user_timezone, log_date, log_time)
        else:
            # If no time provided, use current time in user's timezone
            from services.timezone_service import get_current_user_time
            _, current_date, current_time = get_current_user_time(user_timezone)
            utc_datetime, _, _ = convert_user_time_to_utc(user_timezone, log_date, current_time)
    
    log_entry = Log(
        user_id=user_id,
        log_date=utc_datetime.date(),  # Keep for backward compatibility
        log_time=utc_datetime,  # Store complete UTC datetime
        quantity=quantity,
        notes=notes
    )
    
    if pouch_id:
        log_entry.pouch_id = pouch_id
    else:
        log_entry.custom_brand = custom_brand
        log_entry.custom_nicotine_mg = custom_nicotine_mg
    
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
    count = 0
    for entry in entries:
        # Convert time to UTC if provided
        entry_time = entry.get("time")
        if entry_time is not None:
            utc_datetime, _, _ = convert_user_time_to_utc(user_timezone, log_date, entry_time)
        else:
            # Use noon in user's timezone as default
            utc_datetime, _, _ = convert_user_time_to_utc(user_timezone, log_date, time(12, 0))
        
        log_entry = Log(
            user_id=user_id,
            log_date=utc_datetime.date(),  # Keep for backward compatibility
            log_time=utc_datetime,  # Store complete UTC datetime
            quantity=entry["quantity"]
        )
        
        if "brand" in entry and "nicotine_mg" in entry:
            pouch = Pouch.query.filter_by(
                brand=entry["brand"],
                nicotine_mg=entry["nicotine_mg"]
            ).first()
            if pouch:
                log_entry.pouch_id = pouch.id
            else:
                log_entry.custom_brand = entry.get("brand", "Unknown")
                log_entry.custom_nicotine_mg = entry.get("nicotine_mg", 0)
        
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
    user_timezone = user.timezone or 'UTC'

    # Determine the user's "current" time to adjust the end date if needed
    _, today_in_user_tz, time_in_user_tz = get_current_user_time(user_timezone)

    effective_end_date = end_date
    # If the request's end date is today, check if the user's day has rolled over yet
    if end_date == today_in_user_tz and time_in_user_tz < reset_time:
        effective_end_date -= timedelta(days=1)

    # Widen the query range to account for timezone and reset time offsets
    query_start_date = start_date - timedelta(days=1)
    query_end_date = end_date + timedelta(days=1)

    start_datetime = datetime.combine(query_start_date, time.min)
    end_datetime = datetime.combine(query_end_date, time.max)

    logs = Log.query.filter(
        Log.user_id == user_id,
        Log.log_time.between(start_datetime, end_datetime)
    ).order_by(Log.log_time).all()

    daily_intake = defaultdict(float)
    
    # Pre-fill the result with zeros for the dates that should be displayed
    result = {}
    current_date = start_date
    while current_date <= effective_end_date:
        result[current_date] = 0
        current_date += timedelta(days=1)

    if not logs:
        return result

    from services.timezone_service import convert_utc_to_user_time

    for log in logs:
        # log.log_time is a naive datetime in UTC, so we convert it to user's local time
        user_local_dt, _, _ = convert_utc_to_user_time(user_timezone, log.log_time)
        
        effective_date = user_local_dt.date()
        if user_local_dt.time() < reset_time:
            effective_date -= timedelta(days=1)

        total_nicotine = log.get_total_nicotine()
        # Only include intake for dates that exist as keys in our result dict
        if total_nicotine is not None and effective_date in result:
            daily_intake[effective_date] += total_nicotine
    
    # Populate the results dictionary with calculated totals
    for day, total in daily_intake.items():
        result[day] = total
        
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
        pouch_id=pouch_id,
        quantity=quantity,
        log_time=log_time,
        log_date=log_time.date(),
        notes=notes
    )
    db.session.add(log)
    db.session.commit()
    return log

def get_logs_by_date_range(user_id: int, start_date: date, end_date: date) -> Iterable[Log]:
    """Retrieve logs for a user within a specific date range."""
    return Log.query.filter(
        Log.user_id == user_id,
        Log.log_date >= start_date,
        Log.log_date <= end_date
    ).all()

def get_average_daily_usage(user_id: int) -> float:
    """Calculates the average daily pouch usage for a user."""
    logs = Log.query.filter_by(user_id=user_id).all()
    if not logs:
        return 0.0

    # Group by date and sum quantities
    daily_usage = defaultdict(int)
    for log in logs:
        daily_usage[log.log_date] += log.quantity

    if not daily_usage:
        return 0.0

    total_pouches = sum(daily_usage.values())
    num_days = len(daily_usage)
    return total_pouches / num_days if num_days > 0 else 0.0
