from flask import Blueprint, jsonify, render_template

from routes.auth import login_required, get_current_user
from services.insights_service import get_all_insights

insights_bp = Blueprint('insights', __name__, template_folder="../templates/insights")

@insights_bp.route('/', methods=['GET'])
@login_required
def insights_page():
    """Renders the insights and analytics page."""
    return render_template('insights.html')


@insights_bp.route('/api/insights', methods=['GET'])
@login_required
def get_insights():
    """API endpoint to get all analytical insights."""
    insights = get_all_insights(get_current_user().id)
    if not insights:
        return jsonify(error="Could not generate insights."), 404
        
    return jsonify(insights)
