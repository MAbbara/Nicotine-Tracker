from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, jsonify
from datetime import datetime, timedelta
from models import Goal
from services.goal_service import (
    ActiveGoalConflict,
    create_goal as create_goal_service,
    get_all_goals,
    get_goal_analytics,
    toggle_goal_active,
    update_goal as update_goal_service,
)
from services.goal_evaluation_service import (
    HISTORY_LIVE,
    HISTORY_UI,
    batch_goal_progress,
    effective_day_for_user,
    evaluate_goal_period,
    goal_threshold_notice,
    latest_completed_week,
)

from services.timezone_service import resolve_timezone
from extensions import db
from routes.auth import login_required, get_current_user
from services.rate_limit_service import (
    analytics_read_limit,
    authenticated_write_limit,
    destructive_limit,
)
from sqlalchemy import desc

goals_bp = Blueprint('goals', __name__, template_folder="../templates/goals")


@goals_bp.before_request
@authenticated_write_limit()
def _limit_authenticated_goal_writes():
    return None


def _current_effective_day(user, resolved_timezone, now_utc=None):
    return effective_day_for_user(
        user, now_utc=now_utc, resolved_timezone=resolved_timezone
    )


def _latest_completed_week(today):
    return latest_completed_week(today)


def _batch_goal_progress(user, goals, today, resolved_timezone, *, history):
    return batch_goal_progress(
        user,
        goals,
        today,
        resolved_timezone,
        history_mode=HISTORY_UI if history else HISTORY_LIVE,
    )


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

            try:
                new_goal = create_goal_service(
                    user_id=user.id,
                    goal_type=goal_type,
                    target_value=target_value,
                    start_date=effective_day,
                    end_date=end_date,
                    enable_notifications=enable_notifications,
                    notification_threshold=notification_threshold,
                )
            except ActiveGoalConflict:
                flash(
                    f'You already have an active '
                    f'{goal_type.replace("_", " ")} goal. Pause it before '
                    'creating another active goal of this type.',
                    'warning',
                )
                return redirect(url_for('goals.index'))


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
                goal = update_goal_service(
                    user.id,
                    goal.id,
                    target_value=target_value,
                    end_date=end_date,
                    enable_notifications=enable_notifications,
                    notification_threshold=notification_threshold,
                    is_active=is_active,
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
@destructive_limit(methods=['POST'])
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
        
        try:
            goal = toggle_goal_active(user.id, goal.id)
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
@analytics_read_limit()
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
@analytics_read_limit()
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
            notice = goal_threshold_notice(goal, progress)
            if notice is not None:
                notifications.append(notice)
        
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
@analytics_read_limit()
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
        result = evaluate_goal_period(
            user, goal, target_date, resolved_timezone
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
