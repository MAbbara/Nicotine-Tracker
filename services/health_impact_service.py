"""Health Impact service functions.

These helpers manage health impact tracking, financial calculations, and health milestones.
"""
from datetime import datetime, date, timedelta
from typing import Dict, Optional, List
from sqlalchemy import func
from extensions import db
from models import HealthImpact, Log, User

def get_or_create_health_impact(user_id: int) -> HealthImpact:
    """Get existing health impact record or create a new one."""
    health_impact = HealthImpact.query.filter_by(user_id=user_id).first()
    
    if not health_impact:
        health_impact = HealthImpact(user_id=user_id)
        db.session.add(health_impact)
        db.session.commit()
    
    return health_impact

def calculate_baseline_cost(user_id: int, baseline_days: int = 30) -> float:
    """Calculate baseline daily cost based on historical consumption."""
    # Get consumption from baseline period (e.g., first 30 days of tracking)
    user = User.query.get(user_id)
    if not user:
        return 0.0
    
    # Get earliest logs to establish baseline
    earliest_logs = user.logs.order_by(Log.log_date.asc()).limit(baseline_days * 5).all()  # Get more logs to ensure we have enough data
    
    if not earliest_logs:
        return 0.0
    
    # Calculate average daily consumption from early logs
    log_dates = {}
    for log in earliest_logs:
        log_date = log.log_date
        if log_date not in log_dates:
            log_dates[log_date] = {'pouches': 0, 'total_mg': 0}
        
        log_dates[log_date]['pouches'] += log.quantity
        log_dates[log_date]['total_mg'] += log.get_total_nicotine()
    
    if not log_dates:
        return 0.0
    
    # Calculate average daily pouches
    total_days = len(log_dates)
    total_pouches = sum(day_data['pouches'] for day_data in log_dates.values())
    avg_daily_pouches = total_pouches / total_days if total_days > 0 else 0
    
    # Estimate cost per pouch (average market price)
    # This could be made configurable per user in the future
    avg_cost_per_pouch = 0.50  # $0.50 per pouch average
    
    return avg_daily_pouches * avg_cost_per_pouch

def calculate_current_daily_cost(user_id: int, recent_days: int = 7) -> float:
    """Calculate current daily cost based on recent consumption."""
    user = User.query.get(user_id)
    if not user:
        return 0.0
    
    # Get recent consumption
    end_date = date.today()
    start_date = end_date - timedelta(days=recent_days)
    
    recent_logs = user.logs.filter(
        Log.log_date >= start_date,
        Log.log_date <= end_date
    ).all()
    
    if not recent_logs:
        return 0.0
    
    # Calculate daily consumption
    daily_consumption = {}
    for log in recent_logs:
        log_date = log.log_date
        if log_date not in daily_consumption:
            daily_consumption[log_date] = 0
        daily_consumption[log_date] += log.quantity
    
    # Calculate average
    total_days = len(daily_consumption)
    total_pouches = sum(daily_consumption.values())
    avg_daily_pouches = total_pouches / total_days if total_days > 0 else 0
    
    # Use same cost estimation
    avg_cost_per_pouch = 0.50
    
    return avg_daily_pouches * avg_cost_per_pouch

def update_money_saved(user_id: int) -> Dict[str, float]:
    """Update and calculate money saved based on consumption reduction."""
    health_impact = get_or_create_health_impact(user_id)
    
    # Calculate baseline if not set
    if health_impact.baseline_daily_cost == 0:
        health_impact.baseline_daily_cost = calculate_baseline_cost(user_id)
    
    # Calculate current cost
    current_cost = calculate_current_daily_cost(user_id)
    health_impact.current_daily_cost = current_cost
    
    # Calculate days since reduction started
    days_since_start = health_impact.calculate_days_since_reduction_start()
    
    # Calculate total savings
    daily_savings = max(0, health_impact.baseline_daily_cost - current_cost)
    total_savings = daily_savings * days_since_start
    health_impact.total_money_saved = total_savings
    
    # Update health milestones
    health_impact.update_health_milestones()
    
    db.session.commit()
    
    return {
        'baseline_daily_cost': health_impact.baseline_daily_cost,
        'current_daily_cost': current_cost,
        'daily_savings': daily_savings,
        'total_savings': total_savings,
        'days_since_start': days_since_start
    }

def get_health_timeline(user_id: int) -> List[Dict]:
    """Get health improvement timeline based on reduction progress."""
    health_impact = get_or_create_health_impact(user_id)
    days_since_reduction = health_impact.calculate_days_since_reduction_start()
    days_since_quit = health_impact.calculate_days_since_quit()
    
    timeline = []
    
    # Immediate benefits (within hours/days)
    if days_since_reduction >= 1:
        timeline.append({
            'milestone': 'Reduced Daily Intake',
            'description': 'You\'ve started your reduction journey!',
            'achieved': True,
            'days_ago': days_since_reduction,
            'category': 'progress'
        })
    
    # 2 weeks - circulation improvement
    if days_since_reduction >= 14:
        timeline.append({
            'milestone': 'Circulation Improvement',
            'description': 'Blood circulation begins to improve with reduced nicotine intake',
            'achieved': health_impact.circulation_improved,
            'days_ago': max(0, days_since_reduction - 14),
            'category': 'health'
        })
    elif days_since_reduction >= 7:
        timeline.append({
            'milestone': 'Circulation Improvement',
            'description': 'Blood circulation will improve (in {} days)'.format(14 - days_since_reduction),
            'achieved': False,
            'days_remaining': 14 - days_since_reduction,
            'category': 'health'
        })
    
    # 1 month - taste and smell (if quit completely)
    if days_since_quit and days_since_quit >= 30:
        timeline.append({
            'milestone': 'Taste & Smell Enhancement',
            'description': 'Taste and smell senses are significantly improved',
            'achieved': health_impact.taste_smell_improved,
            'days_ago': max(0, days_since_quit - 30),
            'category': 'health'
        })
    elif days_since_quit and days_since_quit < 30:
        timeline.append({
            'milestone': 'Taste & Smell Enhancement',
            'description': 'Taste and smell will improve (in {} days)'.format(30 - days_since_quit),
            'achieved': False,
            'days_remaining': 30 - days_since_quit,
            'category': 'health'
        })
    
    # 3 months - lung function improvement
    if days_since_quit and days_since_quit >= 90:
        timeline.append({
            'milestone': 'Lung Function Improvement',
            'description': 'Lung function and overall respiratory health improved',
            'achieved': health_impact.lung_function_improved,
            'days_ago': max(0, days_since_quit - 90),
            'category': 'health'
        })
    elif days_since_quit and days_since_quit < 90:
        timeline.append({
            'milestone': 'Lung Function Improvement',
            'description': 'Lung function will improve (in {} days)'.format(90 - days_since_quit),
            'achieved': False,
            'days_remaining': 90 - days_since_quit,
            'category': 'health'
        })
    
    return timeline

def get_risk_reduction_metrics(user_id: int) -> Dict[str, any]:
    """Calculate health risk reduction based on consumption changes."""
    health_impact = get_or_create_health_impact(user_id)
    
    # Calculate consumption reduction percentage
    if health_impact.baseline_daily_cost > 0:
        cost_reduction_pct = ((health_impact.baseline_daily_cost - health_impact.current_daily_cost) / health_impact.baseline_daily_cost) * 100
    else:
        cost_reduction_pct = 0
    
    # Estimate risk reduction (simplified model)
    # These are rough estimates and should not be considered medical advice
    cardiovascular_risk_reduction = min(cost_reduction_pct * 0.3, 30)  # Up to 30% reduction
    addiction_risk_reduction = min(cost_reduction_pct * 0.5, 50)  # Up to 50% reduction
    oral_health_risk_reduction = min(cost_reduction_pct * 0.4, 40)  # Up to 40% reduction
    
    return {
        'consumption_reduction_pct': round(cost_reduction_pct, 1),
        'cardiovascular_risk_reduction': round(cardiovascular_risk_reduction, 1),
        'addiction_risk_reduction': round(addiction_risk_reduction, 1),
        'oral_health_risk_reduction': round(oral_health_risk_reduction, 1),
        'overall_health_improvement': round((cardiovascular_risk_reduction + addiction_risk_reduction + oral_health_risk_reduction) / 3, 1)
    }

def set_quit_date(user_id: int, quit_date: date = None) -> HealthImpact:
    """Set the quit date for complete cessation tracking."""
    health_impact = get_or_create_health_impact(user_id)
    health_impact.quit_date = quit_date or date.today()
    health_impact.update_health_milestones()
    db.session.commit()
    return health_impact

def get_comprehensive_health_impact(user_id: int) -> Dict[str, any]:
    """Get comprehensive health impact data for dashboard."""
    money_data = update_money_saved(user_id)
    timeline = get_health_timeline(user_id)
    risk_metrics = get_risk_reduction_metrics(user_id)
    health_impact = get_or_create_health_impact(user_id)
    
    return {
        'financial': money_data,
        'timeline': timeline,
        'risk_reduction': risk_metrics,
        'milestones': {
            'circulation_improved': health_impact.circulation_improved,
            'taste_smell_improved': health_impact.taste_smell_improved,
            'lung_function_improved': health_impact.lung_function_improved
        },
        'days_since_reduction_start': health_impact.calculate_days_since_reduction_start(),
        'days_since_quit': health_impact.calculate_days_since_quit()
    }
