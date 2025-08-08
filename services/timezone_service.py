"""Timezone handling service for NicotineTracker.

This service provides centralized timezone conversion functions to ensure
consistent handling of user timezones throughout the application.
"""
from datetime import datetime, date, time, timedelta
from typing import Optional, Tuple
import pytz
from pytz import timezone as pytz_timezone


def get_timezone_object(timezone_str: str) -> pytz.BaseTzInfo:
    """Get timezone object from timezone string."""
    try:
        return pytz_timezone(timezone_str)
    except pytz.exceptions.UnknownTimeZoneError:
        # Fallback to UTC if timezone is invalid
        return pytz.UTC


def convert_user_time_to_utc(user_timezone: str, local_date: date, local_time: Optional[time] = None) -> Tuple[datetime, date, Optional[time]]:
    """
    Convert user's local date/time to UTC datetime.
    
    Args:
        user_timezone: User's timezone string (e.g., 'America/New_York')
        local_date: Date in user's timezone
        local_time: Time in user's timezone (optional)
    
    Returns:
        Tuple of (utc_datetime, utc_date, utc_time)
    """
    if local_time is None:
        local_time = time(12, 0)  # Default to noon if no time provided
    
    # Create timezone objects
    user_tz = get_timezone_object(user_timezone)
    
    # Create naive datetime in user's timezone
    naive_datetime = datetime.combine(local_date, local_time)
    
    # Localize to user's timezone
    localized_datetime = user_tz.localize(naive_datetime)
    
    # Convert to UTC
    utc_datetime = localized_datetime.astimezone(pytz.UTC)
    
    return utc_datetime, utc_datetime.date(), utc_datetime.time()


def convert_utc_to_user_time(user_timezone: str, utc_datetime: datetime) -> Tuple[datetime, date, time]:
    """
    Convert UTC datetime to user's local time.
    
    Args:
        user_timezone: User's timezone string
        utc_datetime: UTC datetime
    
    Returns:
        Tuple of (local_datetime, local_date, local_time)
    """
    # Ensure UTC datetime is timezone-aware
    if utc_datetime.tzinfo is None:
        utc_datetime = pytz.UTC.localize(utc_datetime)
    elif utc_datetime.tzinfo != pytz.UTC:
        utc_datetime = utc_datetime.astimezone(pytz.UTC)
    
    # Convert to user's timezone
    user_tz = get_timezone_object(user_timezone)
    local_datetime = utc_datetime.astimezone(user_tz)
    
    return local_datetime, local_datetime.date(), local_datetime.time()


def get_user_date_boundaries(user_timezone: str, target_date: date) -> Tuple[datetime, datetime]:
    """
    Get the UTC datetime boundaries for a specific date in user's timezone.
    
    Args:
        user_timezone: User's timezone string
        target_date: The date in user's timezone
    
    Returns:
        Tuple of (start_utc_datetime, end_utc_datetime)
    """
    user_tz = get_timezone_object(user_timezone)
    
    # Start of day in user's timezone
    start_naive = datetime.combine(target_date, time.min)
    start_localized = user_tz.localize(start_naive)
    start_utc = start_localized.astimezone(pytz.UTC)
    
    # End of day in user's timezone
    end_naive = datetime.combine(target_date, time.max)
    end_localized = user_tz.localize(end_naive)
    end_utc = end_localized.astimezone(pytz.UTC)
    
    return start_utc, end_utc


def get_current_user_time(user_timezone: str) -> Tuple[datetime, date, time]:
    """
    Get current time in user's timezone.
    
    Args:
        user_timezone: User's timezone string
    
    Returns:
        Tuple of (local_datetime, local_date, local_time)
    """
    utc_now = datetime.now(pytz.UTC)
    return convert_utc_to_user_time(user_timezone, utc_now)


def get_user_week_boundaries(user_timezone: str, target_date: date) -> Tuple[datetime, datetime]:
    """
    Get the UTC datetime boundaries for the week containing target_date in user's timezone.
    
    Args:
        user_timezone: User's timezone string
        target_date: A date within the target week
    
    Returns:
        Tuple of (week_start_utc, week_end_utc)
    """
    # Find Monday of the week containing target_date
    days_since_monday = target_date.weekday()
    week_start_date = target_date - timedelta(days=days_since_monday)
    week_end_date = week_start_date + timedelta(days=6)
    
    # Get boundaries for the week
    week_start_utc, _ = get_user_date_boundaries(user_timezone, week_start_date)
    _, week_end_utc = get_user_date_boundaries(user_timezone, week_end_date)
    
    return week_start_utc, week_end_utc


def format_time_for_user(user_timezone: str, utc_datetime: datetime, format_str: str = '%Y-%m-%d %H:%M') -> str:
    """
    Format UTC datetime for display in user's timezone.
    
    Args:
        user_timezone: User's timezone string
        utc_datetime: UTC datetime to format
        format_str: Format string for datetime formatting
    
    Returns:
        Formatted datetime string in user's timezone
    """
    local_datetime, _, _ = convert_utc_to_user_time(user_timezone, utc_datetime)
    return local_datetime.strftime(format_str)


def get_timezone_offset(user_timezone: str) -> str:
    """
    Get timezone offset string for display (e.g., '-05:00', '+02:00').
    
    Args:
        user_timezone: User's timezone string
    
    Returns:
        Timezone offset string
    """
    user_tz = get_timezone_object(user_timezone)
    now = datetime.now(user_tz)
    offset = now.strftime('%z')
    
    # Format as +/-HH:MM
    if len(offset) == 5:
        return f"{offset[:3]}:{offset[3:]}"
    return offset


def validate_timezone(timezone_str: str) -> bool:
    """
    Validate if timezone string is valid.
    
    Args:
        timezone_str: Timezone string to validate
    
    Returns:
        True if valid, False otherwise
    """
    try:
        pytz_timezone(timezone_str)
        return True
    except pytz.exceptions.UnknownTimeZoneError:
        return False


def get_common_timezones() -> list:
    """
    Get list of common timezone choices for forms.
    
    Returns:
        List of (timezone_id, display_name) tuples
    """
    common_timezones = [
        ('UTC', 'UTC (Coordinated Universal Time)'),
        ('US/Eastern', 'US Eastern Time'),
        ('US/Central', 'US Central Time'),
        ('US/Mountain', 'US Mountain Time'),
        ('US/Pacific', 'US Pacific Time'),
        ('Europe/London', 'London (GMT/BST)'),
        ('Europe/Paris', 'Paris (CET/CEST)'),
        ('Europe/Berlin', 'Berlin (CET/CEST)'),
        ('Europe/Rome', 'Rome (CET/CEST)'),
        ('Europe/Madrid', 'Madrid (CET/CEST)'),
        ('Asia/Tokyo', 'Tokyo (JST)'),
        ('Asia/Shanghai', 'Shanghai (CST)'),
        ('Asia/Kolkata', 'India (IST)'),
        ('Australia/Sydney', 'Sydney (AEST/AEDT)'),
        ('Australia/Melbourne', 'Melbourne (AEST/AEDT)'),
        ('Canada/Eastern', 'Canada Eastern'),
        ('Canada/Central', 'Canada Central'),
        ('Canada/Mountain', 'Canada Mountain'),
        ('Canada/Pacific', 'Canada Pacific'),
    ]
    
    return common_timezones


def get_all_timezones_for_dropdown() -> list:
    """
    Get all available timezones formatted for dropdown selection.
    
    Returns:
        List of dictionaries with 'value', 'label', and 'group' keys
    """
    timezones = []
    
    # Get all timezone names and sort them
    all_timezones = sorted(pytz.all_timezones)
    
    for tz_name in all_timezones:
        try:
            tz = pytz_timezone(tz_name)
            # Get current time to show offset
            now = datetime.now(tz)
            offset = now.strftime('%z')
            
            # Format offset for display (e.g., +0500 -> +05:00)
            if len(offset) == 5:
                offset = f"{offset[:3]}:{offset[3:]}"
            elif len(offset) == 0:
                offset = "+00:00"
            
            # Create display name with offset
            display_name = f"{tz_name} (UTC{offset})"
            
            # Group by region
            if '/' in tz_name:
                group = tz_name.split('/')[0]
            else:
                group = 'Other'
            
            timezones.append({
                'value': tz_name,
                'label': display_name,
                'group': group
            })
        except Exception:
            # Skip invalid timezones
            continue
    
    return timezones
