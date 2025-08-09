from flask import Blueprint, render_template, jsonify, request, current_app, redirect, url_for
from datetime import date, datetime, timedelta
from models import User, Log, Pouch, Goal
from extensions import db
from routes.auth import login_required, get_current_user
from services import get_user_daily_intake, get_user_current_time_info
from services.timezone_service import get_current_user_time, get_user_day_boundaries, get_current_user_day
from sqlalchemy import func, desc
import json

from services.pouch_service import *

dashboard_bp = Blueprint('dashboard', __name__, template_folder="../templates/dashboard")

@dashboard_bp.route('/')
@login_required
def index():
    """Main dashboard page"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Dashboard error: No current user found')
            return redirect(url_for('auth.login'))
        
        # Use timezone-aware current day based on user's reset time
        if user.timezone:
            reset_time = None
            if user.preferences and user.preferences.daily_reset_time:
                reset_time = user.preferences.daily_reset_time
            today = get_current_user_day(user.timezone, reset_time)
        else:
            today = date.today()
        
        default_pouches, user_pouches = get_all_pouches(user.id)
        
        # Get today's summary with timezone support
        today_intake = get_user_daily_intake(user, None, use_timezone=True)
        
        # Get recent logs (last 7 days) - use timezone-aware date range
        week_ago = today - timedelta(days=7)
        recent_logs = Log.query.filter(
            Log.user_id == user.id,
            Log.log_date >= week_ago
        ).order_by(desc(Log.log_date), desc(Log.log_time)).limit(10).all()
        
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
            current_hour = datetime.now().hour
            if current_hour > 0:
                avg_pouches_per_hour = round(today_intake['total_pouches'] / current_hour, 1)
        
        # Get timezone-aware date and time for modal
        if user.timezone:
            _, user_today, user_current_time = get_current_user_time(user.timezone)
            today_str = user_today.isoformat()
            current_time_str = user_current_time.strftime('%H:%M')
        else:
            today_str = date.today().isoformat()
            current_time_str = datetime.now().time().strftime('%H:%M')
        
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
                             user=user)
        
    except Exception as e:
        current_app.logger.error(f'Dashboard error: {e}')
        user = get_current_user()
        return render_template('dashboard.html', error="Unable to load dashboard data", user=user)

@dashboard_bp.route('/api/daily_intake_chart')
@login_required
def daily_intake_chart():
    """API endpoint for daily intake chart data with timezone-aware daily boundaries"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Daily intake chart error: No current user found')
            return jsonify({'success': False, 'error': 'User not authenticated'})
        days = request.args.get('days', 30, type=int)
        
        # Use timezone-aware date range based on user's reset time
        if user.timezone:
            # Get user's current day and work backwards
            reset_time = None
            if user.preferences and user.preferences.daily_reset_time:
                reset_time = user.preferences.daily_reset_time
            
            end_date = get_current_user_day(user.timezone, reset_time)
            start_date = end_date - timedelta(days=days-1)
        else:
            # Fallback to simple date range
            end_date = date.today()
            start_date = end_date - timedelta(days=days-1)
        
        # Create complete date range using timezone-aware daily intake
        chart_data = []
        current_date = start_date
        
        while current_date <= end_date:
            # Get daily intake for this specific date using timezone boundaries
            daily_intake = get_user_daily_intake(user, current_date, use_timezone=True)
            
            chart_data.append({
                'date': current_date.strftime('%Y-%m-%d'),
                'pouches': daily_intake['total_pouches'],
                'mg': daily_intake['total_mg']
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
        weeks = request.args.get('weeks', 8, type=int)
        
        # Use timezone-aware date range based on user's reset time
        if user.timezone:
            # Get user's current day and work backwards
            reset_time = None
            if user.preferences and user.preferences.daily_reset_time:
                reset_time = user.preferences.daily_reset_time
            
            end_date = get_current_user_day(user.timezone, reset_time)
            start_date = end_date - timedelta(weeks=weeks)
        else:
            # Fallback to simple date range
            end_date = date.today()
            start_date = end_date - timedelta(weeks=weeks)
        
        # Get weekly data using timezone-aware daily intake
        weekly_data = []
        current_date = start_date
        
        while current_date <= end_date:
            week_end = min(current_date + timedelta(days=6), end_date)
            
            # Calculate weekly totals using timezone-aware daily intake
            total_pouches = 0
            total_mg = 0
            days_in_week = 0
            
            week_date = current_date
            while week_date <= week_end:
                daily_intake = get_user_daily_intake(user, week_date, use_timezone=True)
                total_pouches += daily_intake['total_pouches']
                total_mg += daily_intake['total_mg']
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
                'total_mg': total_mg
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
        days = request.args.get('days', 30, type=int)
        
        # Simple date range
        end_date = date.today()
        start_date = end_date - timedelta(days=days-1)
        
        hourly_data = db.session.query(
            func.extract('hour', Log.log_time).label('hour'),
            func.sum(Log.quantity).label('total_pouches')
        ).filter(
            Log.user_id == user.id,
            Log.log_date >= start_date,
            Log.log_date <= end_date,
            Log.log_time.isnot(None)
        ).group_by(func.extract('hour', Log.log_time)).all()
        
        distribution = [0] * 24
        for row in hourly_data:
            hour = int(row.hour)
            distribution[hour] = int(row.total_pouches)
        
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

@dashboard_bp.route('/api/insights')
@login_required
def insights():
    """API endpoint for usage insights and trends with timezone-aware calculations"""
    try:
        user = get_current_user()
        
        # Use timezone-aware date range based on user's reset time
        if user.timezone:
            # Get user's current day and work backwards
            reset_time = None
            if user.preferences and user.preferences.daily_reset_time:
                reset_time = user.preferences.daily_reset_time
            
            today = get_current_user_day(user.timezone, reset_time)
        else:
            today = date.today()
        
        # Get this week vs last week comparison using timezone-aware calculations
        this_week_start = today - timedelta(days=today.weekday())
        last_week_start = this_week_start - timedelta(days=7)
        last_week_end = this_week_start - timedelta(days=1)
        
        # Calculate weekly totals using timezone-aware daily intake
        this_week_pouches = 0
        this_week_mg = 0
        days_this_week = 0
        
        current_date = this_week_start
        while current_date <= today:
            daily_intake = get_user_daily_intake(user, current_date, use_timezone=True)
            this_week_pouches += daily_intake['total_pouches']
            this_week_mg += daily_intake['total_mg']
            days_this_week += 1
            current_date += timedelta(days=1)
        
        last_week_pouches = 0
        last_week_mg = 0
        
        current_date = last_week_start
        while current_date <= last_week_end:
            daily_intake = get_user_daily_intake(user, current_date, use_timezone=True)
            last_week_pouches += daily_intake['total_pouches']
            last_week_mg += daily_intake['total_mg']
            current_date += timedelta(days=1)
        
        insights = []
        
        # Weekly comparison
        if last_week_pouches > 0:
            change_percent = round(((this_week_pouches - last_week_pouches) / last_week_pouches) * 100, 1)
            if change_percent > 0:
                insights.append(f"Your intake is up {change_percent}% vs. last week")
            elif change_percent < 0:
                insights.append(f"Your intake is down {abs(change_percent)}% vs. last week")
            else:
                insights.append("Your intake is consistent with last week")
        
        # Daily average
        if days_this_week > 0:
            daily_avg = round(this_week_pouches / days_this_week, 1)
            insights.append(f"Your daily average this week: {daily_avg} pouches")
        
        # Most active hour (keep simple date filtering for hourly analysis)
        most_active_hour = db.session.query(
            func.extract('hour', Log.log_time).label('hour'),
            func.sum(Log.quantity).label('total_pouches')
        ).filter(
            Log.user_id == user.id,
            Log.log_date >= today - timedelta(days=30),
            Log.log_time.isnot(None)
        ).group_by(func.extract('hour', Log.log_time)).order_by(desc('total_pouches')).first()
        
        if most_active_hour:
            hour = int(most_active_hour.hour)
            insights.append(f"Your most active hour: {hour:02d}:00")
        
        return jsonify({
            'success': True,
            'insights': insights
        })
        
    except Exception as e:
        current_app.logger.error(f'Insights error: {e}')
        return jsonify({'success': False, 'error': 'Unable to load insights'})
