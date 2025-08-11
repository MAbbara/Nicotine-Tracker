from flask import Blueprint, render_template, request, jsonify, current_app, flash, redirect, url_for
from routes.auth import login_required, get_current_user
from services.flexible_goal_service import (
    create_flexible_goal,
    create_gradual_reduction_plan,
    get_goal_templates,
    get_user_flexible_goals,
    get_goal_recommendations,
    check_goal_progress,
    initialize_default_goal_templates
)
from services.user_service import get_user_daily_intake
from datetime import date, timedelta

flexible_goals_bp = Blueprint('flexible_goals', __name__, template_folder='../templates/flexible_goals')

@flexible_goals_bp.route('/')
@login_required
def index():
    """Flexible goals dashboard page."""
    try:
        user = get_current_user()
        
        # Get user's current goals
        user_goals = get_user_flexible_goals(user.id)
        
        # Get goal templates
        templates = get_goal_templates()
        
        # Get AI recommendations
        recommendations = get_goal_recommendations(user.id)
        
        return render_template('flexible_goals/dashboard.html',
                             user=user,
                             user_goals=user_goals,
                             templates=templates,
                             recommendations=recommendations)
    except Exception as e:
        current_app.logger.error(f'Flexible goals dashboard error: {e}')
        flash('Error loading goals dashboard.', 'error')
        return render_template('flexible_goals/dashboard.html',
                             user=get_current_user(),
                             user_goals=[],
                             templates=[],
                             recommendations=[])

@flexible_goals_bp.route('/create', methods=['GET', 'POST'])
@login_required
def create_goal():
    """Create a new flexible goal."""
    if request.method == 'POST':
        try:
            user = get_current_user()
            data = request.get_json() if request.is_json else request.form
            
            name = data.get('name', '').strip()
            goal_type = data.get('goal_type', '').strip()
            target_value = data.get('target_value', type=float)
            
            if not name or not goal_type or target_value is None:
                return jsonify(error="Name, goal type, and target value are required."), 400
            
            if target_value <= 0:
                return jsonify(error="Target value must be positive."), 400
            
            # Optional fields
            template_id = data.get('template_id', type=int)
            start_date_str = data.get('start_date')
            end_date_str = data.get('end_date')
            frequency = data.get('frequency', 'daily')
            initial_target = data.get('initial_target', type=float)
            reduction_rate = data.get('reduction_rate', type=float)
            reduction_frequency = data.get('reduction_frequency')
            
            # Parse dates
            start_date = None
            end_date = None
            
            if start_date_str:
                try:
                    start_date = date.fromisoformat(start_date_str)
                except ValueError:
                    return jsonify(error="Invalid start date format."), 400
            
            if end_date_str:
                try:
                    end_date = date.fromisoformat(end_date_str)
                except ValueError:
                    return jsonify(error="Invalid end date format."), 400
            
            if start_date and end_date and end_date <= start_date:
                return jsonify(error="End date must be after start date."), 400
            
            # Create goal
            goal = create_flexible_goal(
                user_id=user.id,
                name=name,
                goal_type=goal_type,
                target_value=target_value,
                template_id=template_id,
                start_date=start_date,
                end_date=end_date,
                frequency=frequency,
                initial_target=initial_target,
                reduction_rate=reduction_rate,
                reduction_frequency=reduction_frequency
            )
            
            current_app.logger.info(f'Flexible goal created for user {user.id}: {name}')
            
            if request.is_json:
                return jsonify(goal.to_dict()), 201
            else:
                flash(f'Goal "{name}" created successfully!', 'success')
                return redirect(url_for('flexible_goals.index'))
                
        except Exception as e:
            current_app.logger.error(f'Create flexible goal error: {e}')
            if request.is_json:
                return jsonify(error="Failed to create goal."), 500
            else:
                flash('Error creating goal.', 'error')
                return redirect(url_for('flexible_goals.index'))
    
    # GET request - show create form
    try:
        templates = get_goal_templates()
        return render_template('flexible_goals/create.html',
                             templates=templates,
                             user=get_current_user())
    except Exception as e:
        current_app.logger.error(f'Create goal form error: {e}')
        flash('Error loading create goal form.', 'error')
        return redirect(url_for('flexible_goals.index'))

@flexible_goals_bp.route('/gradual-reduction', methods=['POST'])
@login_required
def create_gradual_reduction():
    """Create a gradual reduction plan."""
    try:
        user = get_current_user()
        data = request.get_json()
        
        current_daily_avg = data.get('current_daily_avg', type=float)
        target_daily = data.get('target_daily', type=float)
        weeks_to_achieve = data.get('weeks_to_achieve', type=int)
        name = data.get('name', '').strip()
        
        if current_daily_avg is None or target_daily is None or weeks_to_achieve is None:
            return jsonify(error="Current average, target, and weeks are required."), 400
        
        if current_daily_avg <= 0 or target_daily < 0 or weeks_to_achieve <= 0:
            return jsonify(error="Invalid values provided."), 400
        
        if target_daily >= current_daily_avg:
            return jsonify(error="Target must be less than current average."), 400
        
        if weeks_to_achieve > 52:
            return jsonify(error="Duration cannot exceed 52 weeks."), 400
        
        # Create gradual reduction plan
        goal = create_gradual_reduction_plan(
            user_id=user.id,
            current_daily_avg=current_daily_avg,
            target_daily=target_daily,
            weeks_to_achieve=weeks_to_achieve,
            name=name
        )
        
        current_app.logger.info(f'Gradual reduction plan created for user {user.id}')
        return jsonify(goal.to_dict()), 201
        
    except Exception as e:
        current_app.logger.error(f'Create gradual reduction error: {e}')
        return jsonify(error="Failed to create gradual reduction plan."), 500

@flexible_goals_bp.route('/api/templates', methods=['GET'])
@login_required
def get_templates():
    """API endpoint to get goal templates."""
    try:
        category = request.args.get('category')
        templates = get_goal_templates(category)
        
        return jsonify([template.to_dict() for template in templates])
        
    except Exception as e:
        current_app.logger.error(f'Get templates error: {e}')
        return jsonify(error="Failed to load templates."), 500

@flexible_goals_bp.route('/api/recommendations', methods=['GET'])
@login_required
def get_recommendations():
    """API endpoint to get AI-powered goal recommendations."""
    try:
        user = get_current_user()
        recommendations = get_goal_recommendations(user.id)
        
        return jsonify(recommendations)
        
    except Exception as e:
        current_app.logger.error(f'Get recommendations error: {e}')
        return jsonify(error="Failed to load recommendations."), 500

@flexible_goals_bp.route('/api/goals', methods=['GET'])
@login_required
def get_user_goals():
    """API endpoint to get user's flexible goals."""
    try:
        user = get_current_user()
        active_only = request.args.get('active_only', 'true').lower() == 'true'
        
        goals = get_user_flexible_goals(user.id, active_only)
        
        return jsonify([goal.to_dict() for goal in goals])
        
    except Exception as e:
        current_app.logger.error(f'Get user goals error: {e}')
        return jsonify(error="Failed to load goals."), 500

@flexible_goals_bp.route('/api/goals/<int:goal_id>/progress', methods=['GET'])
@login_required
def get_goal_progress(goal_id):
    """API endpoint to check goal progress."""
    try:
        target_date_str = request.args.get('date')
        target_date = None
        
        if target_date_str:
            try:
                target_date = date.fromisoformat(target_date_str)
            except ValueError:
                return jsonify(error="Invalid date format."), 400
        
        progress = check_goal_progress(goal_id, target_date)
        
        if 'error' in progress:
            return jsonify(progress), 404
        
        return jsonify(progress)
        
    except Exception as e:
        current_app.logger.error(f'Get goal progress error: {e}')
        return jsonify(error="Failed to check goal progress."), 500

@flexible_goals_bp.route('/initialize-templates', methods=['POST'])
@login_required
def initialize_templates():
    """Initialize default goal templates (admin function)."""
    try:
        # This could be restricted to admin users in the future
        initialize_default_goal_templates()
        
        current_app.logger.info('Default goal templates initialized')
        return jsonify({'success': True, 'message': 'Default templates initialized.'})
        
    except Exception as e:
        current_app.logger.error(f'Initialize templates error: {e}')
        return jsonify(error="Failed to initialize templates."), 500
