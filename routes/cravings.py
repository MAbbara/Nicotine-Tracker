from flask import Blueprint, render_template, request, jsonify, flash, current_app
from routes.auth import login_required, get_current_user
from extensions import db
from models import Craving
from services.craving_service import create_craving, get_comprehensive_craving_analytics
from services.predictive_service import get_risk_alerts, analyze_user_patterns

cravings_bp = Blueprint('cravings', __name__)

@cravings_bp.route('/cravings', methods=['GET'])
@login_required
def cravings_page():
    """Renders the enhanced craving tracker page with analytics."""
    try:
        user = get_current_user()
        
        # Get comprehensive analytics
        analytics = get_comprehensive_craving_analytics(user.id)
        
        # Get risk alerts for next 24 hours
        risk_alerts = get_risk_alerts(user.id, 24)
        
        # Analyze and update user patterns
        patterns = analyze_user_patterns(user.id)
        
        return render_template('cravings/cravings.html', 
                             analytics=analytics,
                             risk_alerts=risk_alerts,
                             patterns=patterns,
                             user=user)
    except Exception as e:
        current_app.logger.error(f'Cravings page error: {e}')
        return render_template('cravings/cravings.html', 
                             analytics={},
                             risk_alerts=[],
                             patterns=[],
                             user=get_current_user())

@cravings_bp.route('/api/cravings', methods=['POST'])
@login_required
def add_craving():
    """API endpoint to add a new enhanced craving entry."""
    try:
        user = get_current_user()
        data = request.get_json()
        
        # Required fields
        intensity = data.get('intensity')
        if not intensity or not (1 <= intensity <= 10):
            return jsonify(error="Intensity (1-10) is required."), 400
        
        # Optional enhanced fields
        trigger = data.get('trigger', '').strip() or None
        notes = data.get('notes', '').strip() or None
        duration_minutes = data.get('duration_minutes')
        physical_symptoms = data.get('physical_symptoms', [])
        situation_context = data.get('situation_context', '').strip() or None
        outcome = data.get('outcome', '').strip() or None
        outcome_notes = data.get('outcome_notes', '').strip() or None
        mood_before = data.get('mood_before')
        mood_after = data.get('mood_after')
        stress_level = data.get('stress_level')
        
        # Validate optional numeric fields
        if duration_minutes is not None and (duration_minutes < 0 or duration_minutes > 1440):
            return jsonify(error="Duration must be between 0 and 1440 minutes."), 400
        
        if mood_before is not None and not (1 <= mood_before <= 10):
            return jsonify(error="Mood before must be between 1 and 10."), 400
            
        if mood_after is not None and not (1 <= mood_after <= 10):
            return jsonify(error="Mood after must be between 1 and 10."), 400
            
        if stress_level is not None and not (1 <= stress_level <= 10):
            return jsonify(error="Stress level must be between 1 and 10."), 400
        
        if outcome and outcome not in ['resisted', 'used_nicotine', 'used_alternative']:
            return jsonify(error="Invalid outcome value."), 400
        
        # Create craving using service
        craving = create_craving(
            user_id=user.id,
            intensity=intensity,
            trigger=trigger,
            notes=notes,
            duration_minutes=duration_minutes,
            physical_symptoms=physical_symptoms,
            situation_context=situation_context,
            outcome=outcome,
            outcome_notes=outcome_notes,
            mood_before=mood_before,
            mood_after=mood_after,
            stress_level=stress_level
        )
        
        current_app.logger.info(f'Enhanced craving logged for user {user.id}')
        return jsonify(craving.to_dict()), 201
        
    except Exception as e:
        current_app.logger.error(f'Add craving error: {e}')
        return jsonify(error="Failed to log craving."), 500

@cravings_bp.route('/api/cravings', methods=['GET'])
@login_required
def get_cravings():
    """API endpoint to get all cravings for the current user."""
    try:
        user = get_current_user()
        days = request.args.get('days', 30, type=int)
        
        # Limit days to reasonable range
        days = max(1, min(365, days))
        
        cravings = Craving.query.filter_by(user_id=user.id).order_by(
            Craving.craving_time.desc()
        ).limit(days * 10).all()  # Reasonable limit
        
        return jsonify([craving.to_dict() for craving in cravings])
        
    except Exception as e:
        current_app.logger.error(f'Get cravings error: {e}')
        return jsonify(error="Failed to retrieve cravings."), 500

@cravings_bp.route('/api/analytics', methods=['GET'])
@login_required
def get_craving_analytics():
    """API endpoint for craving analytics data."""
    try:
        user = get_current_user()
        days = request.args.get('days', 30, type=int)
        days = max(7, min(365, days))  # Between 7 and 365 days
        
        analytics = get_comprehensive_craving_analytics(user.id, days)
        return jsonify(analytics)
        
    except Exception as e:
        current_app.logger.error(f'Craving analytics error: {e}')
        return jsonify(error="Failed to load analytics."), 500

@cravings_bp.route('/api/risk-alerts', methods=['GET'])
@login_required
def get_current_risk_alerts():
    """API endpoint for current risk alerts."""
    try:
        user = get_current_user()
        hours_ahead = request.args.get('hours', 24, type=int)
        hours_ahead = max(1, min(72, hours_ahead))  # Between 1 and 72 hours
        
        alerts = get_risk_alerts(user.id, hours_ahead)
        
        # Format alerts for JSON response
        formatted_alerts = []
        for alert in alerts:
            formatted_alerts.append({
                'time': alert['time'].isoformat(),
                'risk_level': alert['risk_level'],
                'risk_score': alert['risk_score'],
                'risk_factors': alert['risk_factors'],
                'recommendations': alert['recommendations']
            })
        
        return jsonify(formatted_alerts)
        
    except Exception as e:
        current_app.logger.error(f'Risk alerts error: {e}')
        return jsonify(error="Failed to load risk alerts."), 500

@cravings_bp.route('/api/patterns', methods=['GET'])
@login_required
def get_user_patterns():
    """API endpoint to get user patterns."""
    try:
        user = get_current_user()
        patterns = analyze_user_patterns(user.id)
        
        return jsonify([{
            'id': pattern.id,
            'pattern_type': pattern.pattern_type,
            'pattern_name': pattern.pattern_name,
            'confidence_score': pattern.confidence_score,
            'sample_size': pattern.sample_size,
            'last_occurrence': pattern.last_occurrence.isoformat() if pattern.last_occurrence else None,
            'pattern_data': pattern.get_pattern_data()
        } for pattern in patterns])
        
    except Exception as e:
        current_app.logger.error(f'User patterns error: {e}')
        return jsonify(error="Failed to load patterns."), 500
