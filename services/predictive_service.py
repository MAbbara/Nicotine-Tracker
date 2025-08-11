"""Predictive Analytics service functions.

These helpers provide AI-powered predictions, pattern recognition, and risk assessments.
"""
from datetime import datetime, date, timedelta
from typing import Dict, List, Optional, Tuple
import json
from sqlalchemy import func, desc, and_, or_
from extensions import db
from models import Prediction, Craving, Log, User

def analyze_user_patterns(user_id: int, days_back: int = 60) -> List:
    """Analyze user patterns and store them in the database."""
    user = User.query.get(user_id)
    if not user:
        return []
    
    start_date = datetime.utcnow() - timedelta(days=days_back)
    patterns_found = []
    
    # Analyze hourly consumption patterns
    hourly_pattern = _analyze_hourly_pattern(user_id, start_date)
    if hourly_pattern:
        patterns_found.append(hourly_pattern)
    
    # Analyze daily patterns
    daily_pattern = _analyze_daily_pattern(user_id, start_date)
    if daily_pattern:
        patterns_found.append(daily_pattern)
    
    # Analyze craving trigger patterns
    trigger_pattern = _analyze_trigger_pattern(user_id, start_date)
    if trigger_pattern:
        patterns_found.append(trigger_pattern)
    
    # Analyze mood-consumption correlation
    mood_pattern = _analyze_mood_pattern(user_id, start_date)
    if mood_pattern:
        patterns_found.append(mood_pattern)
    
    # Store patterns in database
    for pattern_data in patterns_found:
        existing_pattern = UserPattern.query.filter_by(
            user_id=user_id,
            pattern_type=pattern_data['pattern_type'],
            pattern_name=pattern_data['pattern_name']
        ).first()
        
        if existing_pattern:
            existing_pattern.set_pattern_data(pattern_data['data'])
            existing_pattern.confidence_score = pattern_data['confidence']
            existing_pattern.sample_size = pattern_data['sample_size']
            existing_pattern.last_occurrence = datetime.utcnow()
            existing_pattern.updated_at = datetime.utcnow()
        else:
            pattern = UserPattern(
                user_id=user_id,
                pattern_type=pattern_data['pattern_type'],
                pattern_name=pattern_data['pattern_name'],
                confidence_score=pattern_data['confidence'],
                sample_size=pattern_data['sample_size'],
                last_occurrence=datetime.utcnow()
            )
            pattern.set_pattern_data(pattern_data['data'])
            db.session.add(pattern)
    
    db.session.commit()
    return UserPattern.query.filter_by(user_id=user_id, is_active=True).all()

def _analyze_hourly_pattern(user_id: int, start_date: datetime) -> Optional[Dict]:
    """Analyze hourly consumption patterns."""
    # Get consumption by hour
    hourly_consumption = db.session.query(
        func.extract('hour', Log.log_time).label('hour'),
        func.sum(Log.quantity).label('total_pouches'),
        func.count(Log.id).label('log_count')
    ).filter(
        Log.user_id == user_id,
        Log.log_time >= start_date
    ).group_by(func.extract('hour', Log.log_time)).all()
    
    if len(hourly_consumption) < 3:  # Need at least 3 different hours
        return None
    
    # Find peak hours
    hourly_data = {int(row.hour): row.total_pouches for row in hourly_consumption}
    total_consumption = sum(hourly_data.values())
    
    if total_consumption == 0:
        return None
    
    # Find hours with >20% of daily consumption
    peak_hours = []
    for hour, consumption in hourly_data.items():
        if consumption / total_consumption > 0.2:
            peak_hours.append(hour)
    
    if not peak_hours:
        return None
    
    confidence = min(0.9, len(hourly_consumption) / 24)  # More hours = higher confidence
    
    return {
        'pattern_type': 'hourly',
        'pattern_name': f'Peak consumption hours: {", ".join(f"{h}:00" for h in sorted(peak_hours))}',
        'data': {
            'peak_hours': peak_hours,
            'hourly_distribution': hourly_data,
            'total_logs': sum(row.log_count for row in hourly_consumption)
        },
        'confidence': confidence,
        'sample_size': len(hourly_consumption)
    }

def _analyze_daily_pattern(user_id: int, start_date: datetime) -> Optional[Dict]:
    """Analyze daily consumption patterns (day of week)."""
    # Get consumption by day of week
    daily_consumption = db.session.query(
        func.extract('dow', Log.log_time).label('dow'),
        func.sum(Log.quantity).label('total_pouches'),
        func.count(Log.id).label('log_count')
    ).filter(
        Log.user_id == user_id,
        Log.log_time >= start_date
    ).group_by(func.extract('dow', Log.log_time)).all()
    
    if len(daily_consumption) < 3:
        return None
    
    # Map day numbers to names
    day_names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    daily_data = {}
    total_consumption = 0
    
    for row in daily_consumption:
        day_name = day_names[int(row.dow)]
        daily_data[day_name] = row.total_pouches
        total_consumption += row.total_pouches
    
    if total_consumption == 0:
        return None
    
    # Find high consumption days (>20% above average)
    avg_daily = total_consumption / len(daily_consumption)
    high_days = []
    
    for day, consumption in daily_data.items():
        if consumption > avg_daily * 1.2:
            high_days.append(day)
    
    if not high_days:
        return None
    
    confidence = min(0.8, len(daily_consumption) / 7)
    
    return {
        'pattern_type': 'daily',
        'pattern_name': f'Higher consumption on: {", ".join(high_days)}',
        'data': {
            'high_consumption_days': high_days,
            'daily_distribution': daily_data,
            'average_daily': avg_daily
        },
        'confidence': confidence,
        'sample_size': len(daily_consumption)
    }

def _analyze_trigger_pattern(user_id: int, start_date: datetime) -> Optional[Dict]:
    """Analyze craving trigger patterns."""
    # Get craving triggers
    triggers = db.session.query(
        Craving.trigger,
        func.count(Craving.id).label('count'),
        func.avg(Craving.intensity).label('avg_intensity')
    ).filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.trigger.isnot(None)
    ).group_by(Craving.trigger).having(func.count(Craving.id) >= 3).all()
    
    if not triggers:
        return None
    
    # Find most common triggers
    trigger_data = {}
    total_cravings = 0
    
    for trigger in triggers:
        trigger_data[trigger.trigger] = {
            'count': trigger.count,
            'avg_intensity': float(trigger.avg_intensity)
        }
        total_cravings += trigger.count
    
    # Find dominant triggers (>25% of cravings)
    dominant_triggers = []
    for trigger, data in trigger_data.items():
        if data['count'] / total_cravings > 0.25:
            dominant_triggers.append(trigger)
    
    if not dominant_triggers:
        return None
    
    confidence = min(0.7, total_cravings / 20)  # More cravings = higher confidence
    
    return {
        'pattern_type': 'trigger',
        'pattern_name': f'Common triggers: {", ".join(dominant_triggers)}',
        'data': {
            'dominant_triggers': dominant_triggers,
            'trigger_analysis': trigger_data,
            'total_cravings': total_cravings
        },
        'confidence': confidence,
        'sample_size': len(triggers)
    }

def _analyze_mood_pattern(user_id: int, start_date: datetime) -> Optional[Dict]:
    """Analyze mood-consumption correlation."""
    # Get cravings with mood data
    mood_cravings = Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= start_date,
        Craving.mood_before.isnot(None)
    ).all()
    
    if len(mood_cravings) < 5:
        return None
    
    # Analyze mood vs intensity correlation
    low_mood_cravings = [c for c in mood_cravings if c.mood_before <= 4]
    high_mood_cravings = [c for c in mood_cravings if c.mood_before >= 7]
    
    if not low_mood_cravings and not high_mood_cravings:
        return None
    
    pattern_description = ""
    correlation_strength = 0
    
    if low_mood_cravings:
        avg_intensity_low_mood = sum(c.intensity for c in low_mood_cravings) / len(low_mood_cravings)
        if avg_intensity_low_mood > 6:
            pattern_description = "Higher craving intensity during low mood periods"
            correlation_strength = 0.7
    
    if high_mood_cravings:
        avg_intensity_high_mood = sum(c.intensity for c in high_mood_cravings) / len(high_mood_cravings)
        if avg_intensity_high_mood < 4:
            if pattern_description:
                pattern_description += " and lower intensity during good mood"
            else:
                pattern_description = "Lower craving intensity during good mood periods"
            correlation_strength = max(correlation_strength, 0.6)
    
    if not pattern_description:
        return None
    
    return {
        'pattern_type': 'mood',
        'pattern_name': pattern_description,
        'data': {
            'low_mood_count': len(low_mood_cravings),
            'high_mood_count': len(high_mood_cravings),
            'total_mood_entries': len(mood_cravings),
            'correlation_strength': correlation_strength
        },
        'confidence': correlation_strength,
        'sample_size': len(mood_cravings)
    }

def predict_craving_risk(user_id: int, prediction_date: date = None, prediction_hour: int = None):
    """Predict craving risk for a specific date and hour."""
    if not prediction_date:
        prediction_date = date.today()
    if prediction_hour is None:
        prediction_hour = datetime.now().hour
    
    # Get user patterns
    patterns = UserPattern.query.filter_by(user_id=user_id, is_active=True).all()
    
    # Calculate base risk score
    base_risk = 0.3  # Base 30% risk
    risk_factors = {}
    
    # Check hourly patterns
    hourly_pattern = next((p for p in patterns if p.pattern_type == 'hourly'), None)
    if hourly_pattern:
        pattern_data = hourly_pattern.get_pattern_data()
        peak_hours = pattern_data.get('peak_hours', [])
        if prediction_hour in peak_hours:
            base_risk += 0.3
            risk_factors['peak_hour'] = True
    
    # Check daily patterns
    daily_pattern = next((p for p in patterns if p.pattern_type == 'daily'), None)
    if daily_pattern:
        pattern_data = daily_pattern.get_pattern_data()
        high_days = pattern_data.get('high_consumption_days', [])
        day_name = prediction_date.strftime('%A')
        if day_name in high_days:
            base_risk += 0.2
            risk_factors['high_consumption_day'] = True
    
    # Check recent craving history
    recent_cravings = Craving.query.filter(
        Craving.user_id == user_id,
        Craving.craving_time >= datetime.combine(prediction_date - timedelta(days=1), datetime.min.time())
    ).count()
    
    if recent_cravings > 3:
        base_risk += 0.2
        risk_factors['recent_high_cravings'] = True
    
    # Check recent consumption
    user = User.query.get(user_id)
    if user:
        yesterday_intake = user.get_daily_intake(prediction_date - timedelta(days=1))
        if yesterday_intake['total_pouches'] == 0:  # No consumption yesterday
            base_risk += 0.3
            risk_factors['withdrawal_risk'] = True
        elif yesterday_intake['total_pouches'] > 10:  # High consumption yesterday
            base_risk += 0.1
            risk_factors['high_recent_consumption'] = True
    
    # Cap risk score at 1.0
    risk_score = min(1.0, base_risk)
    
    # Calculate confidence based on available data
    confidence = 0.5  # Base confidence
    if patterns:
        confidence += 0.2 * len(patterns) / 4  # Up to 0.2 more for patterns
    if recent_cravings > 0:
        confidence += 0.1
    confidence = min(0.9, confidence)
    
    # Create prediction record
    prediction = CravingPrediction(
        user_id=user_id,
        prediction_date=prediction_date,
        prediction_hour=prediction_hour,
        risk_score=risk_score,
        confidence_level=confidence
    )
    prediction.set_risk_factors(risk_factors)
    
    db.session.add(prediction)
    db.session.commit()
    
    return prediction

def get_risk_alerts(user_id: int, hours_ahead: int = 24) -> List[Dict]:
    """Get risk alerts for upcoming high-risk periods."""
    alerts = []
    current_time = datetime.now()
    
    # Check next 24 hours in 4-hour intervals
    for i in range(0, hours_ahead, 4):
        check_time = current_time + timedelta(hours=i)
        prediction = predict_craving_risk(user_id, check_time.date(), check_time.hour)
        
        if prediction.risk_score >= 0.7:  # High risk threshold
            alerts.append({
                'time': check_time,
                'risk_level': prediction.get_risk_level(),
                'risk_score': prediction.risk_score,
                'risk_factors': prediction.get_risk_factors(),
                'recommendations': _get_risk_recommendations(prediction.get_risk_factors())
            })
    
    return alerts

def _get_risk_recommendations(risk_factors: Dict) -> List[str]:
    """Get recommendations based on risk factors."""
    recommendations = []
    
    if risk_factors.get('peak_hour'):
        recommendations.append("This is typically a high-craving time for you. Consider having a distraction ready.")
    
    if risk_factors.get('high_consumption_day'):
        recommendations.append("You tend to consume more on this day of the week. Set a specific daily limit.")
    
    if risk_factors.get('withdrawal_risk'):
        recommendations.append("You didn't use nicotine yesterday. Withdrawal cravings may be stronger today.")
    
    if risk_factors.get('recent_high_cravings'):
        recommendations.append("You've had several cravings recently. Consider stress management techniques.")
    
    if not recommendations:
        recommendations.append("Stay mindful of your consumption and use coping strategies if cravings arise.")
    
    return recommendations

def update_prediction_accuracy(prediction_id: int, actual_craving_occurred: bool, actual_intensity: int = None):
    """Update prediction accuracy after the predicted time has passed."""
    prediction = CravingPrediction.query.get(prediction_id)
    if not prediction:
        return
    
    prediction.actual_craving_occurred = actual_craving_occurred
    prediction.actual_craving_intensity = actual_intensity
    
    # Calculate accuracy
    if actual_craving_occurred:
        # If craving occurred, accuracy is based on how well we predicted the risk
        if prediction.risk_score >= 0.7:  # We predicted high risk
            prediction.prediction_accuracy = 0.9
        elif prediction.risk_score >= 0.4:  # We predicted medium risk
            prediction.prediction_accuracy = 0.7
        else:  # We predicted low risk but craving occurred
            prediction.prediction_accuracy = 0.3
    else:
        # If no craving occurred, accuracy is inverse of risk score
        prediction.prediction_accuracy = 1.0 - prediction.risk_score
    
    db.session.commit()

def get_prediction_analytics(user_id: int, days_back: int = 30) -> Dict[str, any]:
    """Get analytics on prediction accuracy and patterns."""
    start_date = date.today() - timedelta(days=days_back)
    
    predictions = CravingPrediction.query.filter(
        CravingPrediction.user_id == user_id,
        CravingPrediction.prediction_date >= start_date,
        CravingPrediction.prediction_accuracy.isnot(None)
    ).all()
    
    if not predictions:
        return {'status': 'insufficient_data'}
    
    # Calculate overall accuracy
    total_accuracy = sum(p.prediction_accuracy for p in predictions)
    avg_accuracy = total_accuracy / len(predictions)
    
    # Calculate accuracy by risk level
    high_risk_predictions = [p for p in predictions if p.risk_score >= 0.7]
    medium_risk_predictions = [p for p in predictions if 0.4 <= p.risk_score < 0.7]
    low_risk_predictions = [p for p in predictions if p.risk_score < 0.4]
    
    return {
        'total_predictions': len(predictions),
        'overall_accuracy': round(avg_accuracy, 2),
        'high_risk_accuracy': round(sum(p.prediction_accuracy for p in high_risk_predictions) / len(high_risk_predictions), 2) if high_risk_predictions else 0,
        'medium_risk_accuracy': round(sum(p.prediction_accuracy for p in medium_risk_predictions) / len(medium_risk_predictions), 2) if medium_risk_predictions else 0,
        'low_risk_accuracy': round(sum(p.prediction_accuracy for p in low_risk_predictions) / len(low_risk_predictions), 2) if low_risk_predictions else 0,
        'high_risk_count': len(high_risk_predictions),
        'medium_risk_count': len(medium_risk_predictions),
        'low_risk_count': len(low_risk_predictions)
    }
