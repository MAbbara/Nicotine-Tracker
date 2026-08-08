from flask import Blueprint, render_template, jsonify, request, current_app, redirect, url_for
from datetime import date, datetime, time, timedelta

import pytz

from routes.auth import login_required, get_current_user
from services.log_service import (
    group_logs_by_effective_day,
    log_local_datetime,
    logs_for_user_interval,
    logs_for_user_window,
    summarize_logs,
)
from services.timezone_service import (
    get_user_day_window,
    resolve_timezone,
)
from services.rate_limit_service import analytics_read_limit

dashboard_bp = Blueprint('dashboard', __name__, template_folder="../templates/dashboard")
DASHBOARD_RANGE_PRESETS = (7, 30, 90, 365)


def _user_reset_time(user):
    preferences = user.preferences
    if preferences and preferences.daily_reset_time:
        return preferences.daily_reset_time
    return time.min


def _current_user_day(resolved_timezone, reset_time):
    """Return the effective user day and one retained current instant."""
    now_utc = datetime.now(pytz.UTC)
    local_now = now_utc.astimezone(resolved_timezone)
    candidate_date = local_now.date()
    candidate_window = get_user_day_window(
        resolved_timezone.zone, candidate_date, reset_time
    )
    if now_utc < candidate_window.start_utc:
        candidate_date -= timedelta(days=1)
    return candidate_date, local_now, now_utc


def _day_summary(user_id, resolved_timezone, target_date, reset_time):
    window = get_user_day_window(
        resolved_timezone.zone, target_date, reset_time
    )
    summary = summarize_logs(logs_for_user_window(user_id, window))
    return {
        'total_pouches': summary['total_pouches'],
        'total_mg': float(summary['total_mg']),
        'sessions': summary['total_logs'],
        'unknown_strength_count': summary['unknown_strength_count'],
    }


def _bounded_positive_int(value, default, maximum):
    """Normalize chart ranges without allowing empty or unbounded work."""
    if value is None or value < 1:
        return default
    return min(value, maximum)


def _requested_analytics_range(default_end, default_days, maximum_days=365):
    """Resolve a preset day count or an explicit inclusive local-date range."""
    start_value = request.args.get('start_date')
    end_value = request.args.get('end_date')
    if start_value is not None or end_value is not None:
        if not start_value or not end_value:
            return None, None, 'Choose both a start and end date.'
        try:
            start_date = date.fromisoformat(start_value)
            end_date = date.fromisoformat(end_value)
        except ValueError:
            return None, None, 'Dates must use YYYY-MM-DD.'
        if start_date > end_date:
            return None, None, 'Start date must be on or before end date.'
        if (end_date - start_date).days + 1 > maximum_days:
            return None, None, f'Choose a range of {maximum_days} days or fewer.'
        return start_date, end_date, None

    days = _bounded_positive_int(
        request.args.get('days', default_days, type=int), 1, maximum_days
    )
    return default_end - timedelta(days=days - 1), default_end, None


def _summaries_for_date_range(
        user_id, resolved_timezone, start_date, end_date, reset_time):
    """Fetch one canonical interval and summarize it by effective day."""
    start_window = get_user_day_window(
        resolved_timezone.zone, start_date, reset_time
    )
    end_window = get_user_day_window(
        resolved_timezone.zone, end_date, reset_time
    )
    logs = logs_for_user_interval(
        user_id, start_window.start_utc, end_window.end_utc
    )
    grouped = group_logs_by_effective_day(
        logs, resolved_timezone, reset_time
    )
    summaries = {}
    current_date = start_date
    while current_date <= end_date:
        summary = summarize_logs(grouped.get(current_date, ()))
        summaries[current_date] = {
            'total_pouches': summary['total_pouches'],
            'total_mg': float(summary['total_mg']),
            'sessions': summary['total_logs'],
            'unknown_strength_count': summary['unknown_strength_count'],
        }
        current_date += timedelta(days=1)
    return summaries


def _logs_for_local_days(
        user_id, resolved_timezone, end_date, days, reset_time):
    """Return logs in ``days`` canonical user days ending at ``end_date``."""
    start_date = end_date - timedelta(days=days - 1)
    start_window = get_user_day_window(
        resolved_timezone.zone, start_date, reset_time
    )
    end_window = get_user_day_window(
        resolved_timezone.zone, end_date, reset_time
    )
    return logs_for_user_interval(
        user_id, start_window.start_utc, end_window.end_utc
    )

@dashboard_bp.route('/')
@analytics_read_limit()
@login_required
def index():
    """Main dashboard page"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Dashboard error: No current user found')
            return redirect(url_for('auth.login'))
        
        resolved_timezone = resolve_timezone(user.timezone)
        reset_time = _user_reset_time(user)
        today, _, _ = _current_user_day(
            resolved_timezone, reset_time
        )
        requested_days = request.args.get('days', 30, type=int)
        range_days = (
            requested_days
            if requested_days in DASHBOARD_RANGE_PRESETS
            else 30
        )
        analytics_start = today - timedelta(days=range_days - 1)
        analytics_summaries = _summaries_for_date_range(
            user.id, resolved_timezone, analytics_start, today, reset_time
        )
        today_intake = analytics_summaries[today]
        analytics_trend = [
            {
                'date': day.isoformat(),
                'pouches': summary['total_pouches'],
                'mg': summary['total_mg'],
            }
            for day, summary in analytics_summaries.items()
        ]
        return render_template('dashboard.html',
                             today_intake=today_intake,
                             analytics_trend=analytics_trend,
                             range_days=range_days,
                             range_presets=DASHBOARD_RANGE_PRESETS,
                             user=user)

        
    except Exception as e:
        current_app.logger.error(f'Dashboard error: {e}')
        user = get_current_user()
        return render_template(
            'dashboard.html',
            error="Unable to load dashboard data",
            user=user,
            analytics_trend=[],
            range_days=30,
            range_presets=DASHBOARD_RANGE_PRESETS,
        )


@dashboard_bp.route('/api/daily_intake_chart')
@analytics_read_limit()
@login_required
def daily_intake_chart():
    """API endpoint for daily intake chart data with timezone-aware daily boundaries"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Daily intake chart error: No current user found')
            return jsonify({'success': False, 'error': 'User not authenticated'})
        resolved_timezone = resolve_timezone(user.timezone)
        reset_time = _user_reset_time(user)
        end_date, _, _ = _current_user_day(resolved_timezone, reset_time)
        start_date, end_date, range_error = _requested_analytics_range(
            end_date, 30
        )
        if range_error:
            return jsonify({'success': False, 'error': range_error}), 400

        daily_summaries = _summaries_for_date_range(
            user.id, resolved_timezone, start_date, end_date, reset_time
        )
        
        # Create complete date range using timezone-aware daily intake
        chart_data = []
        current_date = start_date
        
        while current_date <= end_date:
            # Get daily intake for this specific date using timezone boundaries
            daily_intake = daily_summaries[current_date]
            
            chart_data.append({
                'date': current_date.strftime('%Y-%m-%d'),
                'pouches': daily_intake['total_pouches'],
                'mg': daily_intake['total_mg'],
                'unknown_strength_count': daily_intake['unknown_strength_count'],
            })
            current_date += timedelta(days=1)
        
        return jsonify({
            'success': True,
            'data': chart_data
        })
        
    except Exception as e:
        current_app.logger.error(f'Daily intake chart error: {e}')
        return jsonify({'success': False, 'error': 'Unable to load chart data'})

@dashboard_bp.route('/api/weekly_averages')
@analytics_read_limit()
@login_required
def weekly_averages():
    """API endpoint for weekly averages chart with timezone-aware calculations"""
    try:
        user = get_current_user()
        weeks = _bounded_positive_int(
            request.args.get('weeks', 8, type=int), 1, 52
        )
        
        resolved_timezone = resolve_timezone(user.timezone)
        reset_time = _user_reset_time(user)
        end_date, _, _ = _current_user_day(resolved_timezone, reset_time)
        start_date = end_date - timedelta(days=(weeks * 7) - 1)

        daily_summaries = _summaries_for_date_range(
            user.id, resolved_timezone, start_date, end_date, reset_time
        )
        
        # Get weekly data using timezone-aware daily intake
        weekly_data = []
        current_date = start_date
        
        while current_date <= end_date:
            week_end = min(current_date + timedelta(days=6), end_date)
            
            # Calculate weekly totals using timezone-aware daily intake
            total_pouches = 0
            total_mg = 0
            unknown_strength_count = 0
            days_in_week = 0
            
            week_date = current_date
            while week_date <= week_end:
                daily_intake = daily_summaries[week_date]
                total_pouches += daily_intake['total_pouches']
                total_mg += daily_intake['total_mg']
                unknown_strength_count += daily_intake['unknown_strength_count']
                days_in_week += 1
                week_date += timedelta(days=1)
            
            # Calculate daily averages
            avg_pouches = round(total_pouches / days_in_week, 1) if days_in_week > 0 else 0
            avg_mg = round(total_mg / days_in_week, 1) if days_in_week > 0 else 0
            
            weekly_data.append({
                'week_start': current_date.strftime('%Y-%m-%d'),
                'week_end': week_end.strftime('%Y-%m-%d'),
                'avg_pouches': avg_pouches,
                'avg_mg': avg_mg,
                'total_pouches': total_pouches,
                'total_mg': total_mg,
                'unknown_strength_count': unknown_strength_count,
            })
            
            current_date = week_end + timedelta(days=1)
        
        return jsonify({
            'success': True,
            'data': weekly_data
        })
        
    except Exception as e:
        current_app.logger.error(f'Weekly averages error: {e}')
        return jsonify({'success': False, 'error': 'Unable to load weekly data'})

@dashboard_bp.route('/api/hourly_distribution')
@analytics_read_limit()
@login_required
def hourly_distribution():
    """API endpoint for hourly usage distribution"""
    try:
        user = get_current_user()
        resolved_timezone = resolve_timezone(user.timezone)
        reset_time = _user_reset_time(user)
        end_date, _, _ = _current_user_day(resolved_timezone, reset_time)
        start_date, end_date, range_error = _requested_analytics_range(
            end_date, 30
        )
        if range_error:
            return jsonify({'success': False, 'error': range_error}), 400

        distribution = [0] * 24
        start_window = get_user_day_window(
            resolved_timezone.zone, start_date, reset_time
        )
        end_window = get_user_day_window(
            resolved_timezone.zone, end_date, reset_time
        )
        logs = logs_for_user_interval(
            user.id, start_window.start_utc, end_window.end_utc
        )
        for log in logs:
            hour = log_local_datetime(log, resolved_timezone).hour
            distribution[hour] += log.quantity or 0
        
        chart_data = []
        for hour in range(24):
            chart_data.append({
                'hour': f"{hour:02d}:00",
                'pouches': distribution[hour]
            })
        
        return jsonify({
            'success': True,
            'data': chart_data
        })
        
    except Exception as e:
        current_app.logger.error(f'Hourly distribution error: {e}')
        return jsonify({'success': False, 'error': 'Unable to load hourly data'})
