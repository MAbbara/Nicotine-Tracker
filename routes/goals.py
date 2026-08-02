from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, jsonify
from datetime import date, datetime, time, timedelta
import pytz
from models import DailyCheckIn, User, Goal, Log
from services.goal_service import (
    ActiveGoalConflict,
    create_goal as create_goal_service,
    get_all_goals,
    get_goal_analytics,
    set_goal_active,
)

from services.timezone_service import (
    get_current_user_time, 
    get_user_date_boundaries, 
    get_user_week_boundaries,
    convert_utc_to_user_time,
    get_user_day_window,
    get_user_week_window,
    resolve_timezone,
)
from services.log_service import (
    group_logs_by_effective_day,
    logs_for_user_interval,
    logs_for_user_window,
    summarize_logs,
)
from extensions import db
from routes.auth import login_required, get_current_user
from sqlalchemy import desc, func

goals_bp = Blueprint('goals', __name__, template_folder="../templates/goals")


def _user_reset_time(user):
    preferences = user.preferences
    if preferences and preferences.daily_reset_time:
        return preferences.daily_reset_time
    return time.min


def _current_effective_day(user, resolved_timezone, now_utc=None):
    """Return the active reset-aware user day from one UTC instant."""
    now_utc = now_utc or datetime.now(pytz.UTC)
    if now_utc.tzinfo is None:
        now_utc = pytz.UTC.localize(now_utc)
    else:
        now_utc = now_utc.astimezone(pytz.UTC)
    reset_time = _user_reset_time(user)
    candidate = now_utc.astimezone(resolved_timezone).date()
    candidate_window = get_user_day_window(
        resolved_timezone.zone, candidate, reset_time
    )
    if now_utc < candidate_window.start_utc:
        candidate -= timedelta(days=1)
    return candidate


def _latest_completed_week(today):
    return today - timedelta(days=today.weekday() + 7)


def _daily_history_dates(goal, today):
    end_date = min(today - timedelta(days=1), goal.end_date or today)
    start_date = max(
        end_date - timedelta(days=29),
        goal.start_date or end_date - timedelta(days=29),
    )
    if end_date < start_date:
        return []
    return [
        start_date + timedelta(days=offset)
        for offset in range((end_date - start_date).days + 1)
    ]


def _weekly_history_dates(goal, today):
    horizon_end = min(today - timedelta(days=1), goal.end_date or today)
    horizon_start = max(
        horizon_end - timedelta(days=29),
        goal.start_date or horizon_end - timedelta(days=29),
    )
    first_week = horizon_start + timedelta(days=(-horizon_start.weekday()) % 7)
    latest_week = _latest_completed_week(today)
    dates = []
    week = first_week
    while week <= latest_week:
        week_end = week + timedelta(days=6)
        if week_end <= horizon_end:
            dates.append(week)
        week += timedelta(days=7)
    return dates


def _route_periods(goals, today, *, history):
    periods = {}
    for goal in goals:
        if goal.goal_type == 'weekly_reduction':
            candidates = (
                _weekly_history_dates(goal, today)
                if history else [_latest_completed_week(today)]
            )
            periods[goal.id] = [
                week for week in candidates
                if (goal.start_date is None or week >= goal.start_date)
                and (
                    goal.end_date is None
                    or week + timedelta(days=6) <= goal.end_date
                )
            ]
        else:
            periods[goal.id] = (
                _daily_history_dates(goal, today) if history else [today]
            )
    return periods


def _load_route_evidence(user, periods_by_goal, goals, resolved_timezone, today):
    reset_time = _user_reset_time(user)
    evidence_dates = []
    goals_by_id = {goal.id: goal for goal in goals}
    for goal_id, periods in periods_by_goal.items():
        goal = goals_by_id[goal_id]
        for period in periods:
            if goal.goal_type == 'weekly_reduction':
                evidence_dates.extend([
                    period - timedelta(days=7),
                    period + timedelta(days=6),
                ])
            else:
                evidence_dates.append(period)
    if not evidence_dates:
        evidence_dates = [today]
    start_date = min(evidence_dates)
    end_date = max(evidence_dates)
    start_window = get_user_day_window(
        resolved_timezone.zone, start_date, reset_time
    )
    end_window = get_user_day_window(
        resolved_timezone.zone, end_date, reset_time
    )
    logs = logs_for_user_interval(
        user.id, start_window.start_utc, end_window.end_utc
    )
    grouped_logs = group_logs_by_effective_day(
        logs, resolved_timezone, reset_time
    )
    check_in_dates = {
        row.local_date
        for row in DailyCheckIn.query.with_entities(DailyCheckIn.local_date).filter(
            DailyCheckIn.user_id == user.id,
            DailyCheckIn.local_date >= start_date,
            DailyCheckIn.local_date <= end_date,
        ).all()
    }
    return grouped_logs, check_in_dates


def _progress_from_evidence(
        goal, target_date, grouped_logs, check_in_dates, *, provisional=False
):
    target = goal.target_value
    unknown_strength_count = 0
    reason = None
    if goal.goal_type in ('daily_pouches', 'daily_mg'):
        logs = grouped_logs.get(target_date, ())
        observed = bool(logs) or (
            not provisional and target_date in check_in_dates
        )
        if not observed:
            return {
                'achieved': None,
                'available': False,
                'provisional': provisional,
                'reason': 'no_evidence',
                'current': None,
                'target': target,
                'percentage': 0,
                'unknown_strength_count': 0,
            }
        summary = summarize_logs(logs)
        unknown_strength_count = summary['unknown_strength_count']
        if goal.goal_type == 'daily_mg' and unknown_strength_count:
            return {
                'achieved': None,
                'available': False,
                'provisional': provisional,
                'reason': 'unknown_strength',
                'current': None,
                'target': target,
                'percentage': 0,
                'unknown_strength_count': unknown_strength_count,
            }
        current = (
            float(summary['total_mg'])
            if goal.goal_type == 'daily_mg'
            else summary['total_pouches']
        )
        achieved = None if provisional else current <= target
        percentage = current / target * 100 if target > 0 else 0
    elif goal.goal_type == 'weekly_reduction':
        previous_pouches = sum(
            log.quantity or 0
            for offset in range(-7, 0)
            for log in grouped_logs.get(target_date + timedelta(days=offset), ())
        )
        current_pouches = sum(
            log.quantity or 0
            for offset in range(7)
            for log in grouped_logs.get(target_date + timedelta(days=offset), ())
        )
        if previous_pouches <= 0:
            return {
                'achieved': None,
                'available': False,
                'provisional': False,
                'reason': 'missing_baseline',
                'current': None,
                'target': target,
                'percentage': 0,
                'unknown_strength_count': 0,
            }
        current = (
            (previous_pouches - current_pouches) / previous_pouches * 100
        )
        achieved = current >= target
        percentage = current / target * 100 if target > 0 else 0
    else:
        return {
            'achieved': None,
            'available': False,
            'provisional': provisional,
            'reason': 'unsupported',
            'current': None,
            'target': target,
            'percentage': 0,
            'unknown_strength_count': 0,
        }
    return {
        'achieved': achieved,
        'available': True,
        'provisional': provisional,
        'reason': reason,
        'current': round(current, 1),
        'target': target,
        'percentage': min(percentage, 999),
        'unknown_strength_count': unknown_strength_count,
    }


def _batch_goal_progress(user, goals, today, resolved_timezone, *, history):
    periods_by_goal = _route_periods(goals, today, history=history)
    grouped_logs, check_in_dates = _load_route_evidence(
        user, periods_by_goal, goals, resolved_timezone, today
    )
    results = {}
    for goal in goals:
        results[goal.id] = [
            _progress_from_evidence(
                goal,
                period,
                grouped_logs,
                check_in_dates,
                provisional=(not history and goal.goal_type != 'weekly_reduction'),
            ) | {'date': period}
            for period in periods_by_goal[goal.id]
        ]
    return results


@goals_bp.route('/')
@login_required
def index():
    """Goals dashboard"""
    try:
        user = get_current_user()
        if not user:
            current_app.logger.error('Goals index error: No current user found')
            return redirect(url_for('auth.login'))
        
        # Get active goals
        active_goals = Goal.query.filter_by(user_id=user.id, is_active=True).order_by(desc(Goal.created_at)).all()
        
        # Get completed/inactive goals
        inactive_goals = Goal.query.filter_by(user_id=user.id, is_active=False).order_by(desc(Goal.updated_at)).limit(5).all()
        
        resolved_timezone = resolve_timezone(user.timezone)
        today = _current_effective_day(user, resolved_timezone)
        
        goal_progress = {}
        if active_goals:
            batched = _batch_goal_progress(
                user, active_goals, today, resolved_timezone, history=False
            )
            for goal in active_goals:
                goal_progress[goal.id] = (
                    batched[goal.id][0] if batched[goal.id] else {
                        'achieved': None,
                        'available': False,
                        'provisional': False,
                        'reason': 'no_completed_week',
                        'current': None,
                        'target': goal.target_value,
                        'percentage': 0,
                        'unknown_strength_count': 0,
                    }
                )
        
        return render_template('goals.html', 
                             active_goals=active_goals,
                             inactive_goals=inactive_goals,
                             goal_progress=goal_progress)
        
    except Exception as e:
        current_app.logger.error(f'Goals index error: {e}')
        flash('An error occurred while loading goals.', 'error')
        return render_template('goals.html', active_goals=[], inactive_goals=[], goal_progress={})

@goals_bp.route('/create', methods=['GET', 'POST'])
@login_required
def create_goal():
    """Create a new goal"""
    try:
        user = get_current_user()

        if request.method == 'POST':
            resolved_timezone = resolve_timezone(user.timezone)
            effective_day = _current_effective_day(user, resolved_timezone)
            goal_type = request.form.get('goal_type', '').strip()
            target_value = request.form.get('target_value', type=int)
            end_date_str = request.form.get('end_date', '').strip()
            enable_notifications = request.form.get('enable_notifications') == 'on'
            notification_threshold = request.form.get('notification_threshold', 80, type=float) / 100

            # Validation
            if goal_type not in ['daily_pouches', 'daily_mg', 'weekly_reduction']:
                flash('Please select a valid goal type.', 'error')
                return render_template('create_goal.html')

            if not target_value or target_value <= 0:
                flash('Target value must be a positive number.', 'error')
                return render_template('create_goal.html')

            if target_value > 1000:
                flash('Target value seems too high. Please verify.', 'warning')

            # Parse end date (optional)
            end_date = None
            if end_date_str:
                try:
                    end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
                    if end_date <= effective_day:
                        flash('End date must be in the future.', 'error')
                        return render_template('create_goal.html')
                except ValueError:
                    flash('Invalid end date format.', 'error')
                    return render_template('create_goal.html')

            # Check for existing active goal of same type
            existing_goal = Goal.query.filter_by(
                user_id=user.id,
                goal_type=goal_type,
                is_active=True
            ).first()

            if existing_goal:
                flash(f'You already have an active {goal_type.replace("_", " ")} goal. '
                      'Please deactivate it first or modify the existing one.', 'warning')
                return redirect(url_for('goals.index'))

            # Create new goal via service layer. The Goal model defines default
            # start_date and is_active values, so we rely on those defaults.
            new_goal = create_goal_service(
                user_id=user.id,
                goal_type=goal_type,
                target_value=target_value,
                start_date=effective_day,
                end_date=end_date,
                enable_notifications=enable_notifications,
                notification_threshold=notification_threshold
            )


            current_app.logger.info(f'Goal created for user {user.email}: {goal_type} - {target_value}')
            flash(f'Goal created successfully! Target: {target_value} {goal_type.replace("_", " ")}', 'success')
            return redirect(url_for('goals.index'))

        return render_template('create_goal.html')

    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Create goal error: {e}')
        flash('An error occurred while creating the goal.', 'error')
        return render_template('create_goal.html')

@goals_bp.route('/edit/<int:goal_id>', methods=['GET', 'POST'])
@login_required
def edit_goal(goal_id):
    """Edit an existing goal"""
    try:
        user = get_current_user()
        goal = Goal.query.filter_by(id=goal_id, user_id=user.id).first()
        
        if not goal:
            flash('Goal not found.', 'error')
            return redirect(url_for('goals.index'))
        
        if request.method == 'POST':
            resolved_timezone = resolve_timezone(user.timezone)
            effective_day = _current_effective_day(user, resolved_timezone)
            target_value = request.form.get('target_value', type=int)
            end_date_str = request.form.get('end_date', '').strip()
            enable_notifications = request.form.get('enable_notifications') == 'on'
            notification_threshold = request.form.get('notification_threshold', 80, type=float) / 100
            is_active = request.form.get('is_active') == 'on'
            
            # Validation
            if not target_value or target_value <= 0:
                flash('Target value must be a positive number.', 'error')
                return render_template('edit_goal.html', goal=goal)
            
            # Parse end date (optional)
            end_date = None
            if end_date_str:
                try:
                    end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
                    if end_date <= effective_day:
                        flash('End date must be in the future.', 'error')
                        return render_template('edit_goal.html', goal=goal)
                except ValueError:
                    flash('Invalid end date format.', 'error')
                    return render_template('edit_goal.html', goal=goal)
            
            try:
                goal = set_goal_active(
                    user.id, goal.id, is_active, commit=False
                )
            except ActiveGoalConflict:
                db.session.rollback()
                flash(
                    f'You already have an active '
                    f'{goal.goal_type.replace("_", " ")} goal. Pause it '
                    'before activating this one.',
                    'warning',
                )
                return redirect(url_for('goals.index'))

            goal.target_value = target_value
            goal.end_date = end_date
            goal.enable_notifications = enable_notifications
            goal.notification_threshold = notification_threshold
            goal.updated_at = datetime.utcnow()

            db.session.commit()
            
            current_app.logger.info(f'Goal updated for user {user.email}: goal_id {goal_id}')
            flash('Goal updated successfully!', 'success')
            return redirect(url_for('goals.index'))
        
        return render_template('edit_goal.html', goal=goal)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Edit goal error: {e}')
        flash('An error occurred while editing the goal.', 'error')
        return render_template('edit_goal.html', goal=goal)


@goals_bp.route('/delete/<int:goal_id>', methods=['POST'])
@login_required
def delete_goal(goal_id):
    """Delete a goal"""
    try:
        user = get_current_user()
        goal = Goal.query.filter_by(id=goal_id, user_id=user.id).first()
        
        if not goal:
            flash('Goal not found.', 'error')
            return redirect(url_for('goals.index'))
        
        goal_type = goal.goal_type
        target_value = goal.target_value
        
        db.session.delete(goal)
        db.session.commit()
        
        current_app.logger.info(f'Goal deleted for user {user.email}: {goal_type} - {target_value}')
        flash('Goal deleted successfully.', 'success')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Delete goal error: {e}')
        flash('An error occurred while deleting the goal.', 'error')
    
    return redirect(url_for('goals.index'))

@goals_bp.route('/toggle/<int:goal_id>', methods=['POST'])
@login_required
def toggle_goal(goal_id):
    """Toggle goal active status"""
    try:
        user = get_current_user()
        goal = Goal.query.filter_by(id=goal_id, user_id=user.id).first()
        
        if not goal:
            flash('Goal not found.', 'error')
            return redirect(url_for('goals.index'))
        
        requested_state = not goal.is_active
        try:
            goal = set_goal_active(
                user.id, goal.id, requested_state, commit=True
            )
        except ActiveGoalConflict:
            db.session.rollback()
            flash(
                f'You already have an active '
                f'{goal.goal_type.replace("_", " ")} goal. Pause it '
                'before activating this one.',
                'warning',
            )
            return redirect(url_for('goals.index'))

        status = 'activated' if goal.is_active else 'deactivated'
        current_app.logger.info(f'Goal {status} for user {user.email}: goal_id {goal_id}')
        flash(f'Goal {status} successfully.', 'success')
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Toggle goal error: {e}')
        flash('An error occurred while updating the goal.', 'error')
    
    return redirect(url_for('goals.index'))

@goals_bp.route('/progress')
@login_required
def progress():
    """Detailed progress view"""
    try:
        user = get_current_user()
        
        # Get active goals
        active_goals = Goal.query.filter_by(user_id=user.id, is_active=True).all()
        
        if not active_goals:
            flash('No active goals found. Create a goal to track your progress!', 'info')
            return redirect(url_for('goals.create_goal'))
        
        progress_data = {}
        resolved_timezone = resolve_timezone(user.timezone)
        today = _current_effective_day(user, resolved_timezone)
        batched = _batch_goal_progress(
            user, active_goals, today, resolved_timezone, history=True
        )

        for goal in active_goals:
            progress_history = [
                {
                    **reading,
                    'date': reading['date'].isoformat(),
                    'period_end': (
                        reading['date'] + timedelta(days=6)
                        if goal.goal_type == 'weekly_reduction'
                        else reading['date']
                    ).isoformat(),
                }
                for reading in batched[goal.id]
            ]

            # Calculate streak information
            current_streak = 0
            best_streak = 0
            temp_streak = 0

            for period in progress_history:
                if period['available'] and period['achieved']:
                    temp_streak += 1
                    best_streak = max(best_streak, temp_streak)
                else:
                    temp_streak = 0

            # Current streak is the most recent consecutive achievements
            for period in reversed(progress_history):
                if period['available'] and period['achieved']:
                    current_streak += 1
                else:
                    break

            evaluated_periods = [
                period for period in progress_history if period['available']
            ]
            success_rate = (
                sum(1 for period in evaluated_periods if period['achieved'])
                / len(evaluated_periods) * 100
                if evaluated_periods else 0
            )

            progress_data[goal.id] = {
                'goal': goal,
                'history': progress_history,
                'current_streak': current_streak,
                'best_streak': best_streak,
                'success_rate': success_rate,
                'evaluated_periods': len(evaluated_periods),
                'period_unit': (
                    'week' if goal.goal_type == 'weekly_reduction' else 'day'
                ),
            }

        return render_template('progress.html', progress_data=progress_data)
        
    except Exception as e:
        db.session.rollback()
        current_app.logger.error(f'Progress view error: {e}')
        flash('An error occurred while loading progress data.', 'error')
        return redirect(url_for('goals.index'))

@goals_bp.route('/api/check_notifications')
@login_required
def check_notifications():
    """API endpoint to check for goal notifications"""
    try:
        user = get_current_user()
        resolved_timezone = resolve_timezone(user.timezone)
        today = _current_effective_day(user, resolved_timezone)
        notifications = []
        
        # Get active goals with notifications enabled
        active_goals = Goal.query.filter_by(
            user_id=user.id, 
            is_active=True, 
            enable_notifications=True
        ).all()
        batched = (
            _batch_goal_progress(
                user, active_goals, today, resolved_timezone, history=False
            )
            if active_goals else {}
        )

        for goal in active_goals:
            if not batched[goal.id]:
                continue
            progress = batched[goal.id][0]
            if not progress['available']:
                continue

            threshold = goal.notification_threshold * 100
            if progress['percentage'] < threshold:
                continue
            if goal.goal_type == 'weekly_reduction':
                notifications.append({
                    'type': 'success',
                    'goal_id': goal.id,
                    'message': (
                        f'The latest completed week reached a '
                        f'{progress["current"]:.0f}% reduction against your '
                        f'{progress["target"]:.0f}% guide.'
                    ),
                })
            else:
                label = (
                    'nicotine ceiling' if goal.goal_type == 'daily_mg'
                    else 'pouch ceiling'
                )
                notifications.append({
                    'type': 'warning',
                    'goal_id': goal.id,
                    'message': (
                        f'Today is at {progress["percentage"]:.0f}% of your '
                        f'{label} ({progress["current"]}/{progress["target"]}).'
                    ),
                })
        
        return jsonify({
            'success': True,
            'notifications': notifications
        })
        
    except Exception as e:
        current_app.logger.error(f'Check notifications error: {e}')
        return jsonify({
            'success': False,
            'error': 'Unable to check notifications'
        })

@goals_bp.route('/api/goals')
@login_required
def get_goals_api():
    """API endpoint to get all goals and analytics"""
    try:
        user = get_current_user()
        all_goals_data = get_all_goals(user.id)
        analytics_data = get_goal_analytics(user.id)

        goals_list = [goal.to_dict() for goal in all_goals_data]

        return jsonify({
            'success': True,
            'goals': {
                'traditional_goals': goals_list,
                'total_count': len(goals_list)
            },
            'analytics': analytics_data
        })
        
    except Exception as e:
        current_app.logger.error(f'Goals API error: {e}')
        return jsonify({
            'success': False,
            'error': 'Unable to fetch goals'
        })


def calculate_goal_progress(user, goal, target_date, resolved_timezone=None):
    """Compatibility wrapper for one canonical goal period."""
    try:
        if resolved_timezone is None:
            resolved_timezone = resolve_timezone(user.timezone)
        period_date = (
            target_date - timedelta(days=target_date.weekday())
            if goal.goal_type == 'weekly_reduction' else target_date
        )
        periods = {goal.id: [period_date]}
        grouped_logs, check_in_dates = _load_route_evidence(
            user, periods, [goal], resolved_timezone, period_date
        )
        result = _progress_from_evidence(
            goal, period_date, grouped_logs, check_in_dates
        )
        if result['reason'] == 'unknown_strength' and result['current'] is None:
            result = {**result, 'current': 0}
        return result
        
    except Exception as e:
        current_app.logger.error(f'Calculate goal progress error: {e}')
        return {
            'achieved': None,
            'available': False,
            'provisional': False,
            'reason': 'error',
            'current': None,
            'target': goal.target_value,
            'percentage': 0,
            'unknown_strength_count': 0,
        }
