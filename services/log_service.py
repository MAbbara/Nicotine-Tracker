"""Log-related service functions.

These helpers encapsulate operations for creating and processing log entries,
including bulk insertion. They abstract away database interactions from the
route handlers.
"""
from datetime import date, datetime, time
from typing import Iterable, Dict, Any, Optional

from extensions import db
from services.timezone_service import convert_user_time_to_utc

# Import the Log and Pouch models from the models package aggregator
from models import Log, Pouch

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
        # Values are already in UTC, use them directly
        utc_date = log_date
        utc_time = log_time or datetime.now().time()
    else:
        # Convert user's local time to UTC for storage
        if log_time is not None:
            utc_datetime, utc_date, utc_time = convert_user_time_to_utc(user_timezone, log_date, log_time)
        else:
            # If no time provided, use current time in user's timezone
            from services.timezone_service import get_current_user_time
            _, current_date, current_time = get_current_user_time(user_timezone)
            utc_datetime, utc_date, utc_time = convert_user_time_to_utc(user_timezone, log_date, current_time)
    
    log_entry = Log(
        user_id=user_id,
        log_date=utc_date,
        log_time=utc_time,
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
            utc_datetime, utc_date, utc_time = convert_user_time_to_utc(user_timezone, log_date, entry_time)
        else:
            # Use noon in user's timezone as default
            utc_datetime, utc_date, utc_time = convert_user_time_to_utc(user_timezone, log_date, time(12, 0))
        
        log_entry = Log(
            user_id=user_id,
            log_date=utc_date,
            log_time=utc_time,
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
