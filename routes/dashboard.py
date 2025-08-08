from flask import Blueprint, render_template, jsonify, request, current_app, redirect, url_for
from datetime import date, datetime, timedelta
from models import User, Log, Pouch, Goal
from extensions import db
from routes.auth import login_required, get_current_user
from services.timezone_service import (
    get_current_user_time, 
    get_user_date_boundaries, 
    get_user_week_boundaries,
    convert_utc_to_user_time
)
from services import get_user_daily_intake, get_user_current_time_info
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
        today = date.today()
        
        default_pouches, user_pouches = get_all_pouches(user.id)
        
        # Get today's summary (using user's timezone)
        today_intake = get_user_daily_intake(user, today, use_timezone=True)
        
        # Get recent logs (last 7 days in user's timezone)
        if user.timezone:
            # Get 7 days ago in user's timezone
            _, user_today, _ = get_current_user_time(user.timezone)
            week_ago_date = user_today - timedelta(days=7)
            week_ago_utc, _ = get_user_date_boundaries(user.timezone, week_ago_date)
            
            recent_logs = Log.query.filter(
                Log.user_id == user.id,
                Log.created_at >= week_ago_utc
            ).order_by(desc(Log.log_date), desc(Log.log_time)).limit(10).all()
        else:
            # Fallback to server timezone
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
        
        # Calculate average pouches per hour (for today in user's timezone)
        avg_pouches_per_hour = 0
        if today_intake['total_pouches'] > 0:
            if user.timezone:
                _, _, current_time = get_current_user_time(user.timezone)
                current_hour = current_time.hour
            else:
                current_hour = datetime.now().hour
            
            if current_hour > 0:
                avg_pouches_per_hour = round(today_intake['total_pouches'] / current_hour, 1)
        
        return render_template('dashboard.html',
                             date=date,
                             today_intake=today_intake,
                             recent_logs=recent_logs,
                             active_goal=active_goal,
                             goal_progress=goal_progress,
                             avg_pouches_per_hour=avg_pouches_per_hour,
                             default_pouches=default_pouches,
                             user_pouches=user_pouches)
        
    except Exception as e:
        current_app.logger.error(f'Dashboard error: {e}')
        return render_template('dashboard.html', error="Unable to load dashboard data")

@dashboard_bp.route('/api/daily_intake_chart')
@login_required
def daily_intake_chart():
    """API endpoint for daily intake chart data"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Daily intake chart error: No current user found')
            return jsonify({'success': False, 'error': 'User not authenticated'})
        days = request.args.get('days', 30, type=int)
        
        # Use user's timezone for date boundaries
        if user.timezone:
            _, end_date, _ = get_current_user_time(user.timezone)
            start_date = end_date - timedelta(days=days-1)
            
            # Get UTC boundaries for the date range
            start_utc, _ = get_user_date_boundaries(user.timezone, start_date)
            _, end_utc = get_user_date_boundaries(user.timezone, end_date)
            
            # Query logs within UTC boundaries
            daily_data = db.session.query(
                Log.log_date,
                Log.log_time,
                func.sum(Log.quantity).label('total_pouches'),
                func.sum(Log.quantity * Pouch.nicotine_mg).label('total_mg_from_pouches'),
                func.sum(Log.quantity * Log.custom_nicotine_mg).label('total_mg_from_custom')
            ).outerjoin(Pouch).filter(
                Log.user_id == user.id,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) >= start_utc,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) <= end_utc
            ).group_by(Log.log_date).all()
        else:
            # Fallback to server timezone
            end_date = date.today()
            start_date = end_date - timedelta(days=days-1)
            
            daily_data = db.session.query(
                Log.log_date,
                func.sum(Log.quantity).label('total_pouches'),
                func.sum(Log.quantity * Pouch.nicotine_mg).label('total_mg_from_pouches'),
                func.sum(Log.quantity * Log.custom_nicotine_mg).label('total_mg_from_custom')
            ).outerjoin(Pouch).filter(
                Log.user_id == user.id,
                Log.log_date >= start_date,
                Log.log_date <= end_date
            ).group_by(Log.log_date).all()
        
        # Create complete date range and convert to user's timezone for display
        chart_data = []
        current_date = start_date
        
        # Convert query results to dict for easy lookup
        data_dict = {}
        for row in daily_data:
            # Convert UTC log date to user's date for proper grouping
            if user.timezone and hasattr(row, 'log_time') and row.log_time:
                log_datetime = datetime.combine(row.log_date, row.log_time)
                _, user_date, _ = convert_utc_to_user_time(user.timezone, log_datetime)
                date_key = user_date
            else:
                date_key = row.log_date
            
            total_mg = (row.total_mg_from_pouches or 0) + (row.total_mg_from_custom or 0)
            if date_key not in data_dict:
                data_dict[date_key] = {'pouches': 0, 'mg': 0}
            data_dict[date_key]['pouches'] += int(row.total_pouches or 0)
            data_dict[date_key]['mg'] += int(total_mg)
        
        while current_date <= end_date:
            day_data = data_dict.get(current_date, {'pouches': 0, 'mg': 0})
            chart_data.append({
                'date': current_date.strftime('%Y-%m-%d'),
                'pouches': day_data['pouches'],
                'mg': day_data['mg']
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
    """API endpoint for weekly averages chart"""
    try:
        user = get_current_user()
        weeks = request.args.get('weeks', 8, type=int)
        
        # Use user's timezone for week boundaries
        if user.timezone:
            _, end_date, _ = get_current_user_time(user.timezone)
            start_date = end_date - timedelta(weeks=weeks)
        else:
            end_date = date.today()
            start_date = end_date - timedelta(weeks=weeks)
        
        # Get weekly data
        weekly_data = []
        current_date = start_date
        
        while current_date <= end_date:
            week_end = min(current_date + timedelta(days=6), end_date)
            
            if user.timezone:
                # Get UTC boundaries for this week
                week_start_utc, _ = get_user_date_boundaries(user.timezone, current_date)
                _, week_end_utc = get_user_date_boundaries(user.timezone, week_end)
                
                # Get logs for this week using UTC boundaries
                week_logs = db.session.query(
                    func.sum(Log.quantity).label('total_pouches'),
                    func.sum(Log.quantity * Pouch.nicotine_mg).label('total_mg_from_pouches'),
                    func.sum(Log.quantity * Log.custom_nicotine_mg).label('total_mg_from_custom')
                ).outerjoin(Pouch).filter(
                    Log.user_id == user.id,
                    func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) >= week_start_utc,
                    func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) <= week_end_utc
                ).first()
            else:
                # Fallback to server timezone
                week_logs = db.session.query(
                    func.sum(Log.quantity).label('total_pouches'),
                    func.sum(Log.quantity * Pouch.nicotine_mg).label('total_mg_from_pouches'),
                    func.sum(Log.quantity * Log.custom_nicotine_mg).label('total_mg_from_custom')
                ).outerjoin(Pouch).filter(
                    Log.user_id == user.id,
                    Log.log_date >= current_date,
                    Log.log_date <= week_end
                ).first()
            
            total_pouches = int(week_logs.total_pouches or 0)
            total_mg = int((week_logs.total_mg_from_pouches or 0) + (week_logs.total_mg_from_custom or 0))
            
            # Calculate daily averages
            days_in_week = (week_end - current_date).days + 1
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
        
        # Use user's timezone for date boundaries
        if user.timezone:
            _, end_date, _ = get_current_user_time(user.timezone)
            start_date = end_date - timedelta(days=days-1)
            
            # Get UTC boundaries
            start_utc, _ = get_user_date_boundaries(user.timezone, start_date)
            _, end_utc = get_user_date_boundaries(user.timezone, end_date)
            
            # Get logs within date range
            logs = Log.query.filter(
                Log.user_id == user.id,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) >= start_utc,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) <= end_utc,
                Log.log_time.isnot(None)
            ).all()
            
            # Convert each log time to user's timezone and group by hour
            distribution = [0] * 24
            for log in logs:
                if log.log_time:
                    log_datetime = datetime.combine(log.log_date, log.log_time)
                    _, _, user_time = convert_utc_to_user_time(user.timezone, log_datetime)
                    hour = user_time.hour
                    distribution[hour] += log.quantity
        else:
            # Fallback to server timezone
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
    """API endpoint for usage insights and trends"""
    try:
        user = get_current_user()
        # Use user's timezone for week calculations
        if user.timezone:
            _, today, _ = get_current_user_time(user.timezone)
        else:
            today = date.today()
        
        # Get this week vs last week comparison using user's timezone
        this_week_start = today - timedelta(days=today.weekday())
        last_week_start = this_week_start - timedelta(days=7)
        last_week_end = this_week_start - timedelta(days=1)
        
        if user.timezone:
            # Get UTC boundaries for weeks
            this_week_start_utc, _ = get_user_date_boundaries(user.timezone, this_week_start)
            _, today_end_utc = get_user_date_boundaries(user.timezone, today)
            
            last_week_start_utc, _ = get_user_date_boundaries(user.timezone, last_week_start)
            _, last_week_end_utc = get_user_date_boundaries(user.timezone, last_week_end)
            
            # This week data
            this_week_data = db.session.query(
                func.sum(Log.quantity).label('total_pouches'),
                func.sum(Log.quantity * Pouch.nicotine_mg).label('total_mg_from_pouches'),
                func.sum(Log.quantity * Log.custom_nicotine_mg).label('total_mg_from_custom')
            ).outerjoin(Pouch).filter(
                Log.user_id == user.id,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) >= this_week_start_utc,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) <= today_end_utc
            ).first()
            
            # Last week data
            last_week_data = db.session.query(
                func.sum(Log.quantity).label('total_pouches'),
                func.sum(Log.quantity * Pouch.nicotine_mg).label('total_mg_from_pouches'),
                func.sum(Log.quantity * Log.custom_nicotine_mg).label('total_mg_from_custom')
            ).outerjoin(Pouch).filter(
                Log.user_id == user.id,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) >= last_week_start_utc,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) <= last_week_end_utc
            ).first()
        else:
            # Fallback to server timezone
            this_week_data = db.session.query(
                func.sum(Log.quantity).label('total_pouches'),
                func.sum(Log.quantity * Pouch.nicotine_mg).label('total_mg_from_pouches'),
                func.sum(Log.quantity * Log.custom_nicotine_mg).label('total_mg_from_custom')
            ).outerjoin(Pouch).filter(
                Log.user_id == user.id,
                Log.log_date >= this_week_start,
                Log.log_date <= today
            ).first()
            
            last_week_data = db.session.query(
                func.sum(Log.quantity).label('total_pouches'),
                func.sum(Log.quantity * Pouch.nicotine_mg).label('total_mg_from_pouches'),
                func.sum(Log.quantity * Log.custom_nicotine_mg).label('total_mg_from_custom')
            ).outerjoin(Pouch).filter(
                Log.user_id == user.id,
                Log.log_date >= last_week_start,
                Log.log_date <= last_week_end
            ).first()
        
        insights = []
        
        # Weekly comparison
        this_week_pouches = int(this_week_data.total_pouches or 0)
        last_week_pouches = int(last_week_data.total_pouches or 0)
        
        if last_week_pouches > 0:
            change_percent = round(((this_week_pouches - last_week_pouches) / last_week_pouches) * 100, 1)
            if change_percent > 0:
                insights.append(f"Your intake is up {change_percent}% vs. last week")
            elif change_percent < 0:
                insights.append(f"Your intake is down {abs(change_percent)}% vs. last week")
            else:
                insights.append("Your intake is consistent with last week")
        
        # Daily average
        days_this_week = (today - this_week_start).days + 1
        if days_this_week > 0:
            daily_avg = round(this_week_pouches / days_this_week, 1)
            insights.append(f"Your daily average this week: {daily_avg} pouches")
        
        # Most active hour (in user's timezone)
        if user.timezone:
            # Get logs from last 30 days
            thirty_days_ago = today - timedelta(days=30)
            start_utc, _ = get_user_date_boundaries(user.timezone, thirty_days_ago)
            _, end_utc = get_user_date_boundaries(user.timezone, today)
            
            logs = Log.query.filter(
                Log.user_id == user.id,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) >= start_utc,
                func.datetime(Log.log_date, func.coalesce(Log.log_time, '12:00:00')) <= end_utc,
                Log.log_time.isnot(None)
            ).all()
            
            # Convert to user timezone and find most active hour
            hourly_totals = {}
            for log in logs:
                if log.log_time:
                    log_datetime = datetime.combine(log.log_date, log.log_time)
                    _, _, user_time = convert_utc_to_user_time(user.timezone, log_datetime)
                    hour = user_time.hour
                    hourly_totals[hour] = hourly_totals.get(hour, 0) + log.quantity
            
            if hourly_totals:
                most_active_hour = max(hourly_totals.items(), key=lambda x: x[1])
                insights.append(f"Your most active hour: {most_active_hour[0]:02d}:00")
        else:
            # Fallback to server timezone
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
