"""Flexible Goal service functions.

These helpers manage advanced goal setting, templates, and gradual reduction plans.
"""
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional
from sqlalchemy import and_, or_
from extensions import db
from models import FlexibleGoal, GoalTemplate, User, Log

def create_goal_template(name: str, description: str, category: str, config: Dict) -> GoalTemplate:
    """Create a new goal template."""
    template = GoalTemplate(
        name=name,
        description=description,
        category=category
    )
    template.set_config(config)
    
    db.session.add(template)
    db.session.commit()
    return template

def get_goal_templates(category: str = None) -> List[GoalTemplate]:
    """Get available goal templates, optionally filtered by category."""
    query = GoalTemplate.query.filter_by(is_active=True)
    if category:
        query = query.filter_by(category=category)
    return query.order_by(GoalTemplate.name).all()

def create_flexible_goal(user_id: int, name: str, goal_type: str, target_value: float,
                        template_id: int = None, start_date: date = None, end_date: date = None,
                        frequency: str = 'daily', initial_target: float = None,
                        reduction_rate: float = None, reduction_frequency: str = None) -> FlexibleGoal:
    """Create a new flexible goal."""
    goal = FlexibleGoal(
        user_id=user_id,
        template_id=template_id,
        name=name,
        goal_type=goal_type,
        target_value=target_value,
        start_date=start_date or date.today(),
        end_date=end_date,
        frequency=frequency,
        initial_target=initial_target or target_value,
        reduction_rate=reduction_rate,
        reduction_frequency=reduction_frequency
    )
    
    db.session.add(goal)
    db.session.commit()
    return goal

def create_gradual_reduction_plan(user_id: int, current_daily_avg: float, target_daily: float,
                                 weeks_to_achieve: int, name: str = None) -> FlexibleGoal:
    """Create a gradual reduction plan based on current consumption."""
    if not name:
        name = f"Gradual Reduction: {current_daily_avg} to {target_daily} pouches"
    
    # Calculate weekly reduction rate
    total_reduction = current_daily_avg - target_daily
    weekly_reduction = total_reduction / weeks_to_achieve if weeks_to_achieve > 0 else 0
    
    goal = FlexibleGoal(
        user_id=user_id,
        name=name,
        goal_type='gradual_reduction',
        target_value=target_daily,
        initial_target=current_daily_avg,
        reduction_rate=weekly_reduction,
        reduction_frequency='weekly',
        start_date=date.today(),
        end_date=date.today() + timedelta(weeks=weeks_to_achieve)
    )
    
    db.session.add(goal)
    db.session.commit()
    return goal

def update_gradual_reduction_targets():
    """Update target values for all active gradual reduction goals."""
    gradual_goals = FlexibleGoal.query.filter(
        FlexibleGoal.goal_type == 'gradual_reduction',
        FlexibleGoal.is_active == True,
        FlexibleGoal.is_completed == False
    ).all()
    
    for goal in gradual_goals:
        goal.update_target_for_gradual_reduction()
    
    db.session.commit()

def check_goal_progress(goal_id: int, target_date: date = None) -> Dict[str, any]:
    """Check progress for a specific flexible goal."""
    goal = FlexibleGoal.query.get(goal_id)
    if not goal:
        return {'error': 'Goal not found'}
    
    if not target_date:
        target_date = date.today()
    
    user = User.query.get(goal.user_id)
    if not user:
        return {'error': 'User not found'}
    
    # Get consumption for the target date based on goal frequency
    if goal.frequency == 'daily':
        # Check daily consumption
        daily_intake = user.get_daily_intake(target_date)
        if goal.goal_type in ['daily_pouches', 'gradual_reduction']:
            current_value = daily_intake['total_pouches']
        else:  # daily_mg
            current_value = daily_intake['total_mg']
        
        achieved = current_value <= goal.target_value
        
    elif goal.frequency == 'weekly':
        # Check weekly consumption
        week_start = target_date - timedelta(days=target_date.weekday())
        week_end = week_start + timedelta(days=6)
        
        weekly_total = 0
        current_date = week_start
        while current_date <= min(week_end, target_date):
            daily_intake = user.get_daily_intake(current_date)
            if goal.goal_type in ['weekly_pouches', 'gradual_reduction']:
                weekly_total += daily_intake['total_pouches']
            else:  # weekly_mg
                weekly_total += daily_intake['total_mg']
            current_date += timedelta(days=1)
        
        current_value = weekly_total
        achieved = current_value <= goal.target_value
        
    elif goal.frequency == 'monthly':
        # Check monthly consumption
        month_start = target_date.replace(day=1)
        if target_date.month == 12:
            month_end = target_date.replace(year=target_date.year + 1, month=1, day=1) - timedelta(days=1)
        else:
            month_end = target_date.replace(month=target_date.month + 1, day=1) - timedelta(days=1)
        
        monthly_total = 0
        current_date = month_start
        while current_date <= min(month_end, target_date):
            daily_intake = user.get_daily_intake(current_date)
            if goal.goal_type in ['monthly_pouches', 'gradual_reduction']:
                monthly_total += daily_intake['total_pouches']
            else:  # monthly_mg
                monthly_total += daily_intake['total_mg']
            current_date += timedelta(days=1)
        
        current_value = monthly_total
        achieved = current_value <= goal.target_value
    
    else:
        return {'error': 'Unsupported frequency'}
    
    # Update goal progress
    goal.current_value = current_value
    goal.attempt_count += 1
    if achieved:
        goal.success_count += 1
        goal.current_streak += 1
        goal.best_streak = max(goal.best_streak, goal.current_streak)
    else:
        goal.current_streak = 0
    
    db.session.commit()
    
    return {
        'goal_id': goal.id,
        'achieved': achieved,
        'current_value': current_value,
        'target_value': goal.target_value,
        'progress_percentage': min(100, (current_value / goal.target_value) * 100) if goal.target_value > 0 else 0,
        'current_streak': goal.current_streak,
        'success_rate': goal.calculate_success_rate()
    }

def get_user_flexible_goals(user_id: int, active_only: bool = True) -> List[FlexibleGoal]:
    """Get user's flexible goals."""
    query = FlexibleGoal.query.filter_by(user_id=user_id)
    if active_only:
        query = query.filter_by(is_active=True, is_completed=False)
    return query.order_by(FlexibleGoal.created_at.desc()).all()

def get_goal_recommendations(user_id: int) -> List[Dict]:
    """Get AI-powered goal recommendations based on user's consumption patterns."""
    user = User.query.get(user_id)
    if not user:
        return []
    
    # Analyze recent consumption patterns
    recent_days = 14
    daily_intakes = []
    
    for i in range(recent_days):
        check_date = date.today() - timedelta(days=i)
        intake = user.get_daily_intake(check_date)
        daily_intakes.append(intake['total_pouches'])
    
    if not daily_intakes or all(intake == 0 for intake in daily_intakes):
        return []
    
    avg_daily = sum(daily_intakes) / len(daily_intakes)
    max_daily = max(daily_intakes)
    min_daily = min(daily_intakes)
    
    recommendations = []
    
    # Gradual reduction recommendation
    if avg_daily > 5:
        target_reduction = max(1, avg_daily * 0.8)  # 20% reduction
        recommendations.append({
            'type': 'gradual_reduction',
            'name': f'Gradual Reduction Plan',
            'description': f'Reduce from {avg_daily:.1f} to {target_reduction:.1f} pouches per day over 4 weeks',
            'target_value': target_reduction,
            'initial_target': avg_daily,
            'reduction_rate': (avg_daily - target_reduction) / 4,  # 4 weeks
            'confidence': 0.8
        })
    
    # Consistency goal
    if max_daily - min_daily > 3:
        consistency_target = avg_daily
        recommendations.append({
            'type': 'daily_consistency',
            'name': 'Daily Consistency Goal',
            'description': f'Maintain consistent daily intake around {consistency_target:.1f} pouches',
            'target_value': consistency_target + 1,  # Allow small buffer
            'confidence': 0.7
        })
    
    # Weekend moderation (if weekends are higher)
    weekend_avg = 0
    weekday_avg = 0
    weekend_count = 0
    weekday_count = 0
    
    for i, intake in enumerate(daily_intakes):
        check_date = date.today() - timedelta(days=i)
        if check_date.weekday() >= 5:  # Weekend
            weekend_avg += intake
            weekend_count += 1
        else:  # Weekday
            weekday_avg += intake
            weekday_count += 1
    
    if weekend_count > 0 and weekday_count > 0:
        weekend_avg /= weekend_count
        weekday_avg /= weekday_count
        
        if weekend_avg > weekday_avg * 1.3:  # 30% higher on weekends
            recommendations.append({
                'type': 'weekend_moderation',
                'name': 'Weekend Moderation Goal',
                'description': f'Keep weekend intake similar to weekdays (max {weekday_avg + 1:.1f} pouches)',
                'target_value': weekday_avg + 1,
                'confidence': 0.6
            })
    
    return recommendations

def initialize_default_goal_templates():
    """Initialize default goal templates in the database."""
    default_templates = [
        {
            'name': 'Gradual Reduction - Conservative',
            'description': '20% reduction over 8 weeks',
            'category': 'gradual_reduction',
            'config': {
                'reduction_percentage': 20,
                'duration_weeks': 8,
                'frequency': 'weekly'
            }
        },
        {
            'name': 'Gradual Reduction - Moderate',
            'description': '40% reduction over 6 weeks',
            'category': 'gradual_reduction',
            'config': {
                'reduction_percentage': 40,
                'duration_weeks': 6,
                'frequency': 'weekly'
            }
        },
        {
            'name': 'Gradual Reduction - Aggressive',
            'description': '60% reduction over 4 weeks',
            'category': 'gradual_reduction',
            'config': {
                'reduction_percentage': 60,
                'duration_weeks': 4,
                'frequency': 'weekly'
            }
        },
        {
            'name': 'Daily Limit - Light User',
            'description': 'Maximum 3 pouches per day',
            'category': 'maintenance',
            'config': {
                'daily_limit': 3,
                'goal_type': 'daily_pouches'
            }
        },
        {
            'name': 'Daily Limit - Moderate User',
            'description': 'Maximum 6 pouches per day',
            'category': 'maintenance',
            'config': {
                'daily_limit': 6,
                'goal_type': 'daily_pouches'
            }
        },
        {
            'name': 'Weekend Moderation',
            'description': 'Limit weekend consumption to weekday levels',
            'category': 'situational',
            'config': {
                'weekend_multiplier': 1.0,
                'goal_type': 'situational'
            }
        }
    ]
    
    for template_data in default_templates:
        existing = GoalTemplate.query.filter_by(name=template_data['name']).first()
        if not existing:
            template = GoalTemplate(
                name=template_data['name'],
                description=template_data['description'],
                category=template_data['category']
            )
            template.set_config(template_data['config'])
            db.session.add(template)
    
    try:
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        print(f"Error initializing goal templates: {e}")
