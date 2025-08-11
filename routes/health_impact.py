from flask import Blueprint, render_template, request, jsonify, current_app, flash, redirect, url_for
from routes.auth import login_required, get_current_user
from services.health_impact_service import (
    get_comprehensive_health_impact,
    update_money_saved,
    set_quit_date
)
from datetime import date

health_impact_bp = Blueprint('health_impact', __name__, template_folder='../templates/health_impact')

@health_impact_bp.route('/')
@login_required
def index():
    """Health impact dashboard page."""
    try:
        user = get_current_user()
        health_data = get_comprehensive_health_impact(user.id)
        
        return render_template('health_impact/dashboard.html',
                             user=user,
                             health_data=health_data)
    except Exception as e:
        current_app.logger.error(f'Health impact dashboard error: {e}')
        flash('Error loading health impact data.', 'error')
        return render_template('health_impact/dashboard.html',
                             user=get_current_user(),
                             health_data={})

@health_impact_bp.route('/api/financial-data', methods=['GET'])
@login_required
def get_financial_data():
    """API endpoint for financial impact data."""
    try:
        user = get_current_user()
        financial_data = update_money_saved(user.id)
        return jsonify(financial_data)
    except Exception as e:
        current_app.logger.error(f'Financial data error: {e}')
        return jsonify(error="Failed to load financial data."), 500

@health_impact_bp.route('/api/health-timeline', methods=['GET'])
@login_required
def get_health_timeline():
    """API endpoint for health improvement timeline."""
    try:
        user = get_current_user()
        health_data = get_comprehensive_health_impact(user.id)
        return jsonify(health_data.get('timeline', []))
    except Exception as e:
        current_app.logger.error(f'Health timeline error: {e}')
        return jsonify(error="Failed to load health timeline."), 500

@health_impact_bp.route('/api/risk-reduction', methods=['GET'])
@login_required
def get_risk_reduction():
    """API endpoint for risk reduction metrics."""
    try:
        user = get_current_user()
        health_data = get_comprehensive_health_impact(user.id)
        return jsonify(health_data.get('risk_reduction', {}))
    except Exception as e:
        current_app.logger.error(f'Risk reduction error: {e}')
        return jsonify(error="Failed to load risk reduction data."), 500

@health_impact_bp.route('/set-quit-date', methods=['POST'])
@login_required
def set_user_quit_date():
    """Set the quit date for complete cessation tracking."""
    try:
        user = get_current_user()
        data = request.get_json()
        
        quit_date_str = data.get('quit_date')
        if not quit_date_str:
            return jsonify(error="Quit date is required."), 400
        
        try:
            quit_date = date.fromisoformat(quit_date_str)
        except ValueError:
            return jsonify(error="Invalid date format. Use YYYY-MM-DD."), 400
        
        # Don't allow future dates beyond today
        if quit_date > date.today():
            return jsonify(error="Quit date cannot be in the future."), 400
        
        health_impact = set_quit_date(user.id, quit_date)
        
        current_app.logger.info(f'Quit date set for user {user.id}: {quit_date}')
        return jsonify({
            'success': True,
            'quit_date': quit_date.isoformat(),
            'days_since_quit': health_impact.calculate_days_since_quit()
        })
        
    except Exception as e:
        current_app.logger.error(f'Set quit date error: {e}')
        return jsonify(error="Failed to set quit date."), 500
