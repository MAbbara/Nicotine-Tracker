from flask import Blueprint, render_template, jsonify, request, current_app, redirect, url_for
from datetime import date, datetime, time, timedelta

import pytz

from models import Log, Goal
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
    to_naive_utc,
)
from sqlalchemy import desc

from services.pouch_service import *

dashboard_bp = Blueprint('dashboard', __name__, template_folder="../templates/dashboard")


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
        today, local_now, now_utc = _current_user_day(
            resolved_timezone, reset_time
        )
        
        default_pouches, user_pouches = get_sorted_pouches(user)
        
        # Get today's summary with timezone support
        today_intake = _day_summary(
            user.id, resolved_timezone, today, reset_time
        )
        
        # Get recent logs (last 7 days) - use timezone-aware date range
        now_utc_naive = to_naive_utc(now_utc)
        week_ago = now_utc_naive - timedelta(days=7)
        recent_logs = Log.query.filter(
            Log.user_id == user.id,
            Log.log_time >= week_ago,
            Log.log_time < now_utc_naive,
        ).order_by(
            desc(Log.log_time), desc(Log.created_at), desc(Log.id)
        ).limit(10).all()
        
        # Get active goal
        active_goal = Goal.query.filter_by(user_id=user.id, is_active=True).first()
        goal_progress = None
        
        if active_goal:
            if active_goal.goal_type == 'daily_pouches':
                goal_progress = {
                    'current': today_intake['total_pouches'],
                    'target': active_goal.target_value,
                    'percentage': min(100, (today_intake['total_pouches'] / active_goal.target_value) * 100) if active_goal.target_value > 0 else 0,
                    'type': 'pouches'
                }
            elif active_goal.goal_type == 'daily_mg':
                goal_progress = {
                    'current': today_intake['total_mg'],
                    'target': active_goal.target_value,
                    'percentage': min(100, (today_intake['total_mg'] / active_goal.target_value) * 100) if active_goal.target_value > 0 else 0,
                    'type': 'mg'
                }
        
        # Calculate average pouches per hour (simple calculation)
        avg_pouches_per_hour = 0
        if today_intake['total_pouches'] > 0:
            current_hour = local_now.hour
            if current_hour > 0:
                avg_pouches_per_hour = round(today_intake['total_pouches'] / current_hour, 1)
        
        # Get timezone-aware date and time for modal
        today_str = local_now.date().isoformat()
        current_time_str = local_now.time().strftime('%H:%M')
        
        # Calculate 7-day stats
        total_mg_7_days = 0
        total_pouches_7_days = 0
        
        for i in range(7):
            d = today - timedelta(days=i)
            daily_intake = _day_summary(
                user.id, resolved_timezone, d, reset_time
            )
            total_mg_7_days += daily_intake['total_mg']
            total_pouches_7_days += daily_intake['total_pouches']

        # Calculate averages
        avg_mg_7_days = round(total_mg_7_days / 7, 1) if total_mg_7_days > 0 else 0
        avg_pouches_7_days = round(total_pouches_7_days / 7, 1) if total_pouches_7_days > 0 else 0
        
        insights = []

        # Daily average insight
        if total_pouches_7_days > 0:
            insights.append(f"Your 7-day average is {avg_pouches_7_days} pouches ({avg_mg_7_days}mg) per day.")

        # Categorize intake and provide messages
        health_risk_info = ""
        if avg_mg_7_days == 0:
            health_risk_info = "You haven't logged any intake recently. This is the best way to avoid health risks."
        elif avg_mg_7_days <= 20:
            health_risk_info = "This is a low intake level. Keep it up to minimize health risks!"
        elif avg_mg_7_days <= 50:
            health_risk_info = "This is a moderate intake level. Being mindful of your consumption helps manage health risks."
        elif avg_mg_7_days <= 100:
            health_risk_info = "This is a high intake level. Consider strategies to reduce consumption to lower long-term health risks."
        else:
            health_risk_info = "This is a very high intake level, associated with increased health risks. Setting reduction goals could be a valuable step."
        
        insights.append(health_risk_info)
        
        # Get this week vs last week comparison using timezone-aware calculations
        this_week_start = today - timedelta(days=today.weekday())
        last_week_start = this_week_start - timedelta(days=7)
        last_week_end = this_week_start - timedelta(days=1)
        
        # Calculate weekly totals using timezone-aware daily intake
        this_week_pouches = 0
        
        current_date = this_week_start
        while current_date <= today:
            daily_intake = _day_summary(
                user.id, resolved_timezone, current_date, reset_time
            )
            this_week_pouches += daily_intake['total_pouches']
            current_date += timedelta(days=1)
        
        last_week_pouches = 0
        
        current_date = last_week_start
        while current_date <= last_week_end:
            daily_intake = _day_summary(
                user.id, resolved_timezone, current_date, reset_time
            )
            last_week_pouches += daily_intake['total_pouches']
            current_date += timedelta(days=1)
        
        # Weekly comparison
        if last_week_pouches > 0 and this_week_pouches > 0:
            change_percent = round(((this_week_pouches - last_week_pouches) / last_week_pouches) * 100, 1)
            if change_percent > 5:
                insights.append(f"Your pouch intake is up {change_percent}% compared to last week.")
            elif change_percent < -5:
                insights.append(f"Great job! Your pouch intake is down {abs(change_percent)}% compared to last week.")
        
        hourly_totals = [0] * 24
        for log in _logs_for_local_days(
                user.id, resolved_timezone, today, 30, reset_time):
            hour = log_local_datetime(log, resolved_timezone).hour
            hourly_totals[hour] += log.quantity or 0

        analytics_start = today - timedelta(days=29)
        analytics_summaries = _summaries_for_date_range(
            user.id, resolved_timezone, analytics_start, today, reset_time
        )
        analytics_trend = [
            {
                'date': day.isoformat(),
                'pouches': summary['total_pouches'],
                'mg': summary['total_mg'],
            }
            for day, summary in analytics_summaries.items()
        ]
        analytics_hourly = [
            {'hour': f'{hour:02d}:00', 'pouches': total}
            for hour, total in enumerate(hourly_totals)
        ]

        if any(hourly_totals):
            hour = max(range(24), key=hourly_totals.__getitem__)
            insights.append(f"Your most active time for intake is around {hour:02d}:00.")
        
        return render_template('dashboard.html',
                             date=date,
                             today_intake=today_intake,
                             recent_logs=recent_logs,
                             active_goal=active_goal,
                             goal_progress=goal_progress,
                             avg_pouches_per_hour=avg_pouches_per_hour,
                             default_pouches=default_pouches,
                             user_pouches=user_pouches,
                             today=today_str,
                             current_time=current_time_str,
                             insights=insights,
                             analytics_trend=analytics_trend,
                             analytics_hourly=analytics_hourly,
                             user=user)

        
    except Exception as e:
        current_app.logger.error(f'Dashboard error: {e}')
        user = get_current_user()
        return render_template(
            'dashboard.html',
            error="Unable to load dashboard data",
            user=user,
            date=date,
            analytics_trend=[],
            analytics_hourly=[],
        )


@dashboard_bp.route('/api/daily_intake_chart')
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
