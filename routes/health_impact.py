"""
Health Impact Route
"""
from flask import Blueprint, render_template, request, redirect, url_for, flash, jsonify
from services.health_impact_service import HealthImpactService
from routes.auth import login_required, get_current_user

health_impact_bp = Blueprint('health_impact', __name__, template_folder="../templates/health_impact")
health_impact_service = HealthImpactService()

@health_impact_bp.route('/dashboard')
@login_required
def dashboard():
    """Health impact dashboard"""
    return render_template('dashboard.html')

@health_impact_bp.route('/add', methods=['POST'])
@login_required
def add_health_impact():
    user = get_current_user()
    data = request.get_json()
    health_impact_service.add_health_impact(user.id, data)
    flash('Health impact recorded successfully!', 'success')
    return jsonify({'success': True})

@health_impact_bp.route('/data')
@login_required
def get_health_data():
    user = get_current_user()
    impacts = health_impact_service.get_health_impacts(user.id)
    return jsonify([impact.to_dict() for impact in impacts])
