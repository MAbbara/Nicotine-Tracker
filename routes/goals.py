from flask import Blueprint, render_template, request, redirect, url_for, flash, current_app, jsonify
from datetime import date, datetime, timedelta
from models import User, Goal, Log
from services import create_goal
from extensions import db
from routes.auth import login_required, get_current_user
from sqlalchemy import desc, func

goals_bp = Blueprint('goals', __name__, template_folder="../templates/goals")

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
        
        # Calculate progress for active goals
        today = date.today()
        goal_progress = {}
        
        for goal in active_goals:
            progress = calculate_goal_progress(user, goal, today)
            goal_progress[goal.id] = progress
        
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
                    if end_date <= date.today():
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
            new_goal = create_goal(
                user_id=user.id,
                goal_type=goal_type,
                target_value=target_value,
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
                    if end_date <= date.today():
                        flash('End date must be in the future.', 'error')
                        return render_template('edit_goal.html', goal=goal)
                except ValueError:
                    flash('Invalid end date format.', 'error')
                    return render_template('edit_goal.html', goal=goal)
            
            # Update goal
            goal.target_value = target_value
            goal.end_date = end_date
            goal.enable_notifications = enable_notifications
            goal.notification_threshold = notification_threshold
            goal.is_active = is_active
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
        return redirect(url_for('goals.index'))

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
        
        goal.is_active = not goal.is_active
        goal.updated_at = datetime.utcnow()
        
        db.session.commit()
        
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
        
        # Calculate detailed progress for each goal
        progress_data = {}
        today = date.today()
        
        for goal in active_goals:
            # Get last 30 days of progress
            progress_history = []
            for i in range(30):
                check_date = today - timedelta(days=i)
                daily_progress = calculate_goal_progress(user, goal, check_date)
                progress_history.append({
                    'date': check_date.isoformat(),
                    'achieved': daily_progress['achieved'],
                    'current': daily_progress['current'],
                    'target': daily_progress['target'],
                    'percentage': daily_progress['percentage']
                })
            
            progress_history.reverse()  # Show oldest to newest
            
            # Calculate streak information
            current_streak = 0
            best_streak = 0
            temp_streak = 0
            
            for day in progress_history:
                if day['achieved']:
                    temp_streak += 1
                    best_streak = max(best_streak, temp_streak)
                else:
                    temp_streak = 0
            
            # Current streak is the most recent consecutive achievements
            for day in reversed(progress_history):
                if day['achieved']:
                    current_streak += 1
                else:
                    break
            
            # Update goal streaks
            goal.current_streak = current_streak
            goal.best_streak = max(goal.best_streak, best_streak)
            
            progress_data[goal.id] = {
                'goal': goal,
                'history': progress_history,
                'current_streak': current_streak,
                'best_streak': best_streak,
                'success_rate': sum(1 for day in progress_history if day['achieved']) / len(progress_history) * 100
            }
        
        db.session.commit()
        
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
        today = date.today()
        notifications = []
        
        # Get active goals with notifications enabled
        active_goals = Goal.query.filter_by(
            user_id=user.id, 
            is_active=True, 
            enable_notifications=True
        ).all()
        
        for goal in active_goals:
            progress = calculate_goal_progress(user, goal, today)
            
            # Check if approaching threshold
            if progress['percentage'] >= (goal.notification_threshold * 100):
                notifications.append({
                    'type': 'warning',
                    'goal_id': goal.id,
                    'message': f'You\'re at {progress["percentage"]:.0f}% of your {goal.goal_type.replace("_", " ")} goal ({progress["current"]}/{progress["target"]})'
                })
            
            # Check if goal exceeded
            if progress['percentage'] > 100:
                notifications.append({
                    'type': 'danger',
                    'goal_id': goal.id,
                    'message': f'You\'ve exceeded your {goal.goal_type.replace("_", " ")} goal! ({progress["current"]}/{progress["target"]})'
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

def calculate_goal_progress(user, goal, target_date):
    """Calculate progress for a specific goal and date"""
    try:
        if goal.goal_type == 'daily_pouches':
            daily_intake = user.get_daily_intake(target_date)
            current = daily_intake['total_pouches']
            target = goal.target_value
            achieved = current <= target
            percentage = (current / target * 100) if target > 0 else 0
            
        elif goal.goal_type == 'daily_mg':
            daily_intake = user.get_daily_intake(target_date)
            current = daily_intake['total_mg']
            target = goal.target_value
            achieved = current <= target
            percentage = (current / target * 100) if target > 0 else 0
            
        elif goal.goal_type == 'weekly_reduction':
            # For weekly reduction, compare current week to previous week
            week_start = target_date - timedelta(days=target_date.weekday())
            week_end = week_start + timedelta(days=6)
            
            # Current week intake
            current_week_logs = Log.query.filter(
                Log.user_id == user.id,
                Log.log_date >= week_start,
                Log.log_date <= min(week_end, target_date)
            ).all()
            
            current_week_pouches = sum(log.quantity for log in current_week_logs)
            
            # Previous week intake
            prev_week_start = week_start - timedelta(days=7)
            prev_week_end = prev_week_start + timedelta(days=6)
            
            prev_week_logs = Log.query.filter(
                Log.user_id == user.id,
                Log.log_date >= prev_week_start,
                Log.log_date <= prev_week_end
            ).all()
            
            prev_week_pouches = sum(log.quantity for log in prev_week_logs)
            
            if prev_week_pouches > 0:
                reduction_percentage = ((prev_week_pouches - current_week_pouches) / prev_week_pouches) * 100
                achieved = reduction_percentage >= goal.target_value
                current = reduction_percentage
                target = goal.target_value
                percentage = (reduction_percentage / goal.target_value * 100) if goal.target_value > 0 else 0
            else:
                achieved = True
                current = 0
                target = goal.target_value
                percentage = 100
        
        else:
            achieved = False
            current = 0
            target = goal.target_value
            percentage = 0
        
        return {
            'achieved': achieved,
            'current': round(current, 1),
            'target': target,
            'percentage': min(percentage, 999)  # Cap at 999% for display
        }
        
    except Exception as e:
        current_app.logger.error(f'Calculate goal progress error: {e}')
        return {
            'achieved': False,
            'current': 0,
            'target': goal.target_value,
            'percentage': 0
        }
