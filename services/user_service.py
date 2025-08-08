from datetime import datetime, date
from extensions import db
from services.timezone_service import (
    convert_utc_to_user_time, 
    get_current_user_time, 
    get_user_date_boundaries,
    format_time_for_user
)

# Import the User model from the models package aggregator
from models import User, Log
from datetime import datetime as dt, time as dt_time

def filter_logs_by_datetime_range(query, start_utc, end_utc):
    """
    Database-agnostic helper to filter logs by datetime range.
    This avoids the SQLite vs MySQL datetime() function incompatibility.
    """
    # Get all logs from the query and filter in Python
    all_logs = query.all()
    filtered_logs = []
    
    for log in all_logs:
        # Combine log_date and log_time to create a datetime
        log_time = log.log_time if log.log_time else dt_time(12, 0, 0)  # Default to noon
        log_datetime = dt.combine(log.log_date, log_time)
        
        # Check if this log falls within the UTC boundaries
        if start_utc <= log_datetime <= end_utc:
            filtered_logs.append(log)
    
    return filtered_logs

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
        target_date = date.today()
    
    # Temporarily disable timezone functionality to avoid database compatibility issues
    # TODO: Implement proper database-agnostic datetime handling for MySQL/MariaDB compatibility
    # For now, fall back to simple date filtering to prevent production errors
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
