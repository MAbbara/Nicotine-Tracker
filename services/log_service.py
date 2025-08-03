"""Log-related service functions.

These helpers encapsulate operations for creating and processing log entries,
including bulk insertion. They abstract away database interactions from the
route handlers.
"""
from datetime import date
from typing import Iterable, Dict, Any

from extensions import db

# Import the Log and Pouch models from the models package aggregator
from models import Log, Pouch

def add_log_entry(user_id: int,
                  log_date: date,
                  log_time,
                  quantity: int,
                  notes: str = "",
                  pouch_id: int = None,
                  custom_brand: str = None,
                  custom_nicotine_mg: int = None) -> Log:
    """Create and persist a single log entry."""
    log_entry = Log(
        user_id=user_id,
        log_date=log_date,
        log_time=log_time,
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

def add_bulk_logs(user_id: int, entries: Iterable[Dict[str, Any]], log_date: date) -> int:
    """Create multiple log entries from a list of parsed entries."""
    count = 0
    for entry in entries:
        log_entry = Log(
            user_id=user_id,
            log_date=log_date,
            log_time=entry.get("time"),
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
