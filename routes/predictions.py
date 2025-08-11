"""
Predictions Route
"""
from flask import Blueprint, render_template, jsonify
from services.predictive_service import get_risk_alerts
from routes.auth import login_required, get_current_user

predictions_bp = Blueprint('predictions', __name__, template_folder="../templates/predictions")

@predictions_bp.route('/alerts')
@login_required
def risk_alerts():
    """Get risk alerts for the user"""
    user = get_current_user()
    alerts = get_risk_alerts(user.id)
    return jsonify(alerts)
