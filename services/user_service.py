"""User-related service functions.

These helpers encapsulate the creation of users and any user-specific business
logic. By separating these functions into a service layer, your route handlers
can remain slim and focus on HTTP concerns.
"""
from datetime import datetime, date
from extensions import db
from services.timezone_service import (
    convert_utc_to_user_time, 
    get_current_user_time, 
    get_user_date_boundaries,
    format_time_for_user
)

# Import the User model from the models package aggregator
from models import User

def create_user(email: str, password: str, **profile_data) -> User:
    """Create a new user with the given email and password."""
    user = User(
        email=email,
        **{k: v for k, v in profile_data.items() if v is not None}
    )
    user.set_password(password)
    db.session.add(user)
    db.session.commit()
    return user

def get_user_daily_intake(user: User, target_date=None, use_timezone=True):
    """
    Get daily intake for a specific date with timezone support.
    
    Args:
        user: User instance
        target_date: Date to get intake for (defaults to today in user's timezone)
        use_timezone: Whether to use user's timezone for date boundaries
    
    Returns:
        Dict with total_mg, total_pouches, and sessions
    """
    if target_date is None:
        if use_timezone and user.timezone:
            _, target_date, _ = get_current_user_time(user.timezone)
        else:
            target_date = date.today()
    
    if use_timezone and user.timezone:
        # Get UTC boundaries for the target date in user's timezone
        start_utc, end_utc = get_user_date_boundaries(user.timezone, target_date)
        
        # Filter logs by UTC datetime boundaries
        daily_logs = user.logs.filter(
            db.and_(
                db.func.datetime(db.func.date(db.text('log_date')), db.func.coalesce(db.text('log_time'), '12:00:00')) >= start_utc,
                db.func.datetime(db.func.date(db.text('log_date')), db.func.coalesce(db.text('log_time'), '12:00:00')) <= end_utc
            )
        ).all()
    else:
        # Use simple date filtering (legacy behavior)
        daily_logs = user.logs.filter_by(log_date=target_date).all()
    
    total_mg = 0
    total_pouches = 0
    for log in daily_logs:
        if log.pouch:
            total_mg += log.quantity * log.pouch.nicotine_mg
        elif log.custom_nicotine_mg:
            total_mg += log.quantity * log.custom_nicotine_mg
        total_pouches += log.quantity
    
    return {
        'total_mg': total_mg,
        'total_pouches': total_pouches,
        'sessions': len(daily_logs)
    }

def get_user_current_time_info(user: User):
    """Get current time in user's timezone."""
    if user.timezone:
        return get_current_user_time(user.timezone)
    else:
        now = datetime.now()
        return now, now.date(), now.time()

def convert_user_datetime_to_timezone(user: User, utc_datetime):
    """Convert UTC datetime to user's timezone."""
    if user.timezone and utc_datetime:
        local_datetime, local_date, local_time = convert_utc_to_user_time(user.timezone, utc_datetime)
        return local_datetime
    return utc_datetime

def format_user_time_for_display(user: User, utc_datetime, format_str='%Y-%m-%d %H:%M'):
    """Format UTC datetime for display in user's timezone."""
    if user.timezone and utc_datetime:
        return format_time_for_user(user.timezone, utc_datetime, format_str)
    elif utc_datetime:
        return utc_datetime.strftime(format_str)
    return ''

def get_user_date_boundaries_utc(user: User, target_date):
    """Get UTC boundaries for a date in user's timezone."""
    if user.timezone:
        return get_user_date_boundaries(user.timezone, target_date)
    else:
        # Fallback to simple date boundaries
        start = datetime.combine(target_date, datetime.min.time())
        end = datetime.combine(target_date, datetime.max.time())
        return start, end
