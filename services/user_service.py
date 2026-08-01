from datetime import datetime, date, time
from extensions import db
from services.timezone_service import (
    convert_utc_to_user_time,
    get_current_user_time,
    get_current_user_day,
    get_user_day_window,
    format_time_for_user,
    resolve_timezone,
    to_naive_utc,
)

# Import the User model from the models package aggregator
from models import User, Log, UserPreferences
from datetime import datetime as dt, time as dt_time


def create_user(email: str, password: str, **profile_data) -> User:
    """Create a new user with the given email and password."""
    user_profile_data = {
        key: value for key, value in profile_data.items()
        if key not in ['units_preference', 'preferred_brands'] and value is not None
    }
    user = User(
        email=email,
        **user_profile_data
    )
    user.set_password(password)
    db.session.add(user)
    db.session.flush()

    # Create default preferences for the new user
    preferences = UserPreferences(user_id=user.id)
    db.session.add(preferences)

    db.session.commit()
    return user


def get_user_daily_intake(user: User, target_date=None, use_timezone=True):
    """
    Get daily intake for a user day with timezone and reset time support.

    The user day is the canonical half-open window from
    :func:`services.timezone_service.get_user_day_window`; reads filter
    ``Log.log_time >= start_utc`` and ``Log.log_time < end_utc`` with
    database-naive UTC bounds normalized at the boundary. An event at
    exactly ``end_utc`` belongs to the next user day. The deprecated
    ``Log.log_date`` column is never read.

    Args:
        user: User instance
        target_date: Date to get intake for (defaults to current user day)
        use_timezone: Whether to use the user's timezone and custom reset
            time; when False the UTC calendar day is used

    Returns:
        Dict with total_mg, total_pouches, and sessions
    """
    if use_timezone:
        # User.timezone is persisted data and may contain an invalid legacy
        # value; opt into the correlated UTC fallback before calling the
        # strict canonical window constructor.
        timezone_name = resolve_timezone(user.timezone).zone
        reset_time = time.min
        if user.preferences and user.preferences.daily_reset_time:
            reset_time = user.preferences.daily_reset_time
    else:
        timezone_name = 'UTC'
        reset_time = time.min

    if target_date is None:
        target_date = get_current_user_day(timezone_name, reset_time)

    window = get_user_day_window(timezone_name, target_date, reset_time)
    daily_logs = user.logs.filter(
        Log.log_time >= to_naive_utc(window.start_utc),
        Log.log_time < to_naive_utc(window.end_utc),
    ).all()

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
    """Get the half-open UTC boundaries for a date in the user's timezone.

    Returns the aware ``(start_utc, end_utc_exclusive)`` pair from the
    canonical window; users without a timezone resolve to the UTC day.
    """
    timezone_name = resolve_timezone(user.timezone).zone
    window = get_user_day_window(timezone_name, target_date)
    return window.start_utc, window.end_utc
