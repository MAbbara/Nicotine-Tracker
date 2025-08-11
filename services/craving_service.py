"""Craving-related service functions.

These helpers encapsulate operations for creating, analyzing, and managing cravings.
"""
from datetime import datetime, date, timedelta
from typing import List, Dict, Optional, Tuple
import json
from sqlalchemy import func, desc, and_
from extensions import db
from models import Craving, Log, User

def create_craving(user_id: int, intensity: int, trigger: str = None, notes: str = None,
                  duration_minutes: int = None, physical_symptoms: List[str] = None,
                  situation_context: str = None, outcome: str = None, outcome_notes: str = None,
                  mood_before: int = None, mood_after: int = None, stress_level: int = None) -> Craving:
    """Create and persist a craving entry for the user."""
    craving = Craving(
        user_id=user_id,
        intensity=intensity,
        trigger=trigger,
        notes=notes,
        duration_minutes=duration_minutes,
        situation_context=situation_context,
        outcome=outcome,
        outcome_notes=outcome_notes,
        mood_before=mood_before,
        mood_after=mood_after,
        stress_level=stress_level
    )
    
    # Set physical symptoms if provided
    if physical_symptoms:
        craving.set_physical_symptoms_list(physical_symptoms)
    
    db.session.add(craving)
    db.session.commit()
    return craving

def get_user_cravings(user_id: int, days: int = 30) -> List[Craving]:
    """Get user's cravings for the specified number of days."""
    start_date = datetime.utcnow() - timedelta(days=days)
    return Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date
    ).order_by(desc(Craving.craving_time)).all()

def get_craving_patterns_by_time_of_day(user_id: int, days: int = 30) -> Dict[str, int]:
    """Analyze craving patterns by time of day."""
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Query cravings with hour extraction
    cravings = db.session.query(
        func.extract('hour', Craving.craving_time).label('hour'),
        func.count(Craving.id).label('count')
    ).filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date
    ).group_by(func.extract('hour', Craving.craving_time)).all()
    
    # Define time periods
    time_periods = {
        'Night (12AM-6AM)': 0,
        'Morning (6AM-12PM)': 0,
        'Afternoon (12PM-6PM)': 0,
        'Evening (6PM-12AM)': 0
    }
    
    for craving in cravings:
        hour = int(craving.hour)
        if 0 <= hour < 6:
            time_periods['Night (12AM-6AM)'] += craving.count
        elif 6 <= hour < 12:
            time_periods['Morning (6AM-12PM)'] += craving.count
        elif 12 <= hour < 18:
            time_periods['Afternoon (12PM-6PM)'] += craving.count
        else:
            time_periods['Evening (6PM-12AM)'] += craving.count
    
    return time_periods

def get_craving_patterns_by_day_of_week(user_id: int, days: int = 30) -> Dict[str, int]:
    """Analyze craving patterns by day of week."""
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Query cravings with day of week extraction
    cravings = db.session.query(
        func.extract('dow', Craving.craving_time).label('dow'),
        func.count(Craving.id).label('count')
    ).filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date
    ).group_by(func.extract('dow', Craving.craving_time)).all()
    
    # Map day numbers to names (0=Sunday, 1=Monday, etc.)
    day_names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    day_counts = {day: 0 for day in day_names}
    
    for craving in cravings:
        day_index = int(craving.dow)
        day_counts[day_names[day_index]] += craving.count
    
    return day_counts

def get_trigger_analysis(user_id: int, days: int = 30) -> Dict[str, Dict]:
    """Analyze craving triggers and their effectiveness."""
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Query triggers with counts and average intensity
    triggers = db.session.query(
        Craving.trigger,
        func.count(Craving.id).label('count'),
        func.avg(Craving.intensity).label('avg_intensity'),
        func.avg(Craving.duration_minutes).label('avg_duration')
    ).filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.trigger.isnot(None)
    ).group_by(Craving.trigger).order_by(desc('count')).all()
    
    trigger_analysis = {}
    for trigger in triggers:
        trigger_analysis[trigger.trigger] = {
            'count': trigger.count,
            'avg_intensity': round(float(trigger.avg_intensity), 1) if trigger.avg_intensity else 0,
            'avg_duration': round(float(trigger.avg_duration), 1) if trigger.avg_duration else None
        }
    
    return trigger_analysis

def get_craving_vs_consumption_correlation(user_id: int, days: int = 30) -> Dict[str, any]:
    """Analyze correlation between cravings and actual nicotine consumption."""
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Get cravings with outcomes
    cravings_with_outcomes = Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.outcome.isnot(None)
    ).all()
    
    if not cravings_with_outcomes:
        return {
            'total_cravings': 0,
            'resisted_count': 0,
            'used_nicotine_count': 0,
            'used_alternative_count': 0,
            'resistance_rate': 0.0
        }
    
    outcome_counts = {'resisted': 0, 'used_nicotine': 0, 'used_alternative': 0}
    for craving in cravings_with_outcomes:
        if craving.outcome in outcome_counts:
            outcome_counts[craving.outcome] += 1
    
    total = len(cravings_with_outcomes)
    resistance_rate = (outcome_counts['resisted'] + outcome_counts['used_alternative']) / total * 100
    
    return {
        'total_cravings': total,
        'resisted_count': outcome_counts['resisted'],
        'used_nicotine_count': outcome_counts['used_nicotine'],
        'used_alternative_count': outcome_counts['used_alternative'],
        'resistance_rate': round(resistance_rate, 1)
    }

def get_intensity_trends(user_id: int, days: int = 30) -> Dict[str, any]:
    """Analyze craving intensity trends over time."""
    start_date = datetime.utcnow() - timedelta(days=days)
    
    # Get daily average intensity
    daily_intensities = db.session.query(
        func.date(Craving.craving_time).label('date'),
        func.avg(Craving.intensity).label('avg_intensity'),
        func.count(Craving.id).label('count')
    ).filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date
    ).group_by(func.date(Craving.craving_time)).order_by('date').all()
    
    if not daily_intensities:
        return {'trend': 'stable', 'current_avg': 0, 'change_percentage': 0}
    
    # Calculate trend
    intensities = [float(day.avg_intensity) for day in daily_intensities]
    if len(intensities) >= 2:
        first_half_avg = sum(intensities[:len(intensities)//2]) / (len(intensities)//2)
        second_half_avg = sum(intensities[len(intensities)//2:]) / (len(intensities) - len(intensities)//2)
        
        change_percentage = ((second_half_avg - first_half_avg) / first_half_avg) * 100 if first_half_avg > 0 else 0
        
        if change_percentage > 10:
            trend = 'increasing'
        elif change_percentage < -10:
            trend = 'decreasing'
        else:
            trend = 'stable'
    else:
        trend = 'stable'
        change_percentage = 0
    
    current_avg = round(sum(intensities) / len(intensities), 1) if intensities else 0
    
    return {
        'trend': trend,
        'current_avg': current_avg,
        'change_percentage': round(change_percentage, 1)
    }

def get_mood_correlation(user_id: int, days: int = 30) -> Dict[str, any]:
    """Analyze correlation between mood and cravings."""
    start_date = datetime.utcnow() - timedelta(days=days)
    
    cravings_with_mood = Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.mood_before.isnot(None)
    ).all()
    
    if not cravings_with_mood:
        return {'correlation': 'insufficient_data', 'avg_mood_before': 0, 'avg_intensity': 0}
    
    # Calculate correlation between mood_before and intensity
    moods = [craving.mood_before for craving in cravings_with_mood]
    intensities = [craving.intensity for craving in cravings_with_mood]
    
    avg_mood = sum(moods) / len(moods)
    avg_intensity = sum(intensities) / len(intensities)
    
    # Simple correlation analysis
    if avg_mood < 4:  # Low mood
        correlation = 'low_mood_high_cravings' if avg_intensity > 6 else 'low_mood_manageable_cravings'
    elif avg_mood > 7:  # High mood
        correlation = 'high_mood_low_cravings' if avg_intensity < 5 else 'high_mood_high_cravings'
    else:
        correlation = 'neutral_mood'
    
    return {
        'correlation': correlation,
        'avg_mood_before': round(avg_mood, 1),
        'avg_intensity': round(avg_intensity, 1)
    }

def get_comprehensive_craving_analytics(user_id: int, days: int = 30) -> Dict[str, any]:
    """Get comprehensive craving analytics for dashboard."""
    return {
        'time_patterns': get_craving_patterns_by_time_of_day(user_id, days),
        'day_patterns': get_craving_patterns_by_day_of_week(user_id, days),
        'trigger_analysis': get_trigger_analysis(user_id, days),
        'consumption_correlation': get_craving_vs_consumption_correlation(user_id, days),
        'intensity_trends': get_intensity_trends(user_id, days),
        'mood_correlation': get_mood_correlation(user_id, days)
    }
