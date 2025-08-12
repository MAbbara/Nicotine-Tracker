from flask import Blueprint, render_template, request, jsonify, flash, current_app
from routes.auth import login_required, get_current_user
from extensions import db
from models import Craving
from services.craving_service import create_craving, get_comprehensive_craving_analytics


cravings_bp = Blueprint('cravings', __name__)

@cravings_bp.route('/cravings', methods=['GET'])
@login_required
def cravings_page():
    """Renders the enhanced craving tracker page with analytics."""
    try:
        user = get_current_user()
        
        # Get comprehensive analytics
        analytics = get_comprehensive_craving_analytics(user.id)
        
        return render_template('cravings/cravings.html', 
                             analytics=analytics,
                             user=user)
    except Exception as e:
        current_app.logger.error(f'Cravings page error: {e}')
        return render_template('cravings/cravings.html', 
                             analytics={},
                             user=get_current_user())


@cravings_bp.route('/api/cravings', methods=['POST'])
@login_required
def add_craving():
    """API endpoint to add a new enhanced craving entry."""
    try:
        user = get_current_user()
        data = request.get_json()
        
        # Convert numeric fields and validate
        try:
            intensity = int(data.get('intensity')) if data.get('intensity') is not None and data.get('intensity') != '' else None
            duration_minutes = int(data.get('duration_minutes')) if data.get('duration_minutes') is not None and data.get('duration_minutes') != '' else None
            mood_before = int(data.get('mood_before')) if data.get('mood_before') is not None and data.get('mood_before') != '' else None
            mood_after = int(data.get('mood_after')) if data.get('mood_after') is not None and data.get('mood_after') != '' else None
            stress_level = int(data.get('stress_level')) if data.get('stress_level') is not None and data.get('stress_level') != '' else None
        except (ValueError, TypeError):
            return jsonify(error="Invalid numeric value for one of the fields."), 400

        # Required fields
        if intensity is None or not (1 <= intensity <= 10):
            return jsonify(error="Intensity (1-10) is required."), 400
        
        # Optional enhanced fields
        trigger = data.get('trigger', '').strip() or None
        notes = data.get('notes', '').strip() or None
        physical_symptoms = data.get('physical_symptoms', [])
        situation_context = data.get('situation_context', '').strip() or None
        outcome = data.get('outcome', '').strip() or None
        outcome_notes = data.get('outcome_notes', '').strip() or None
        
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
