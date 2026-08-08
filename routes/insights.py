from flask import Blueprint, jsonify, render_template, request, make_response
import csv
import io
from datetime import datetime

from routes.auth import login_required, get_current_user
from services.enhanced_insights_service import get_enhanced_insights
from services.insights_service import get_all_insights  # Keep for backward compatibility
from services.rate_limit_service import analytics_read_limit, export_limit

insights_bp = Blueprint('insights', __name__, template_folder="../templates/insights")
SUPPORTED_RANGES = frozenset({7, 30, 90, 365})


def _requested_range_days():
    days = request.args.get('days', 30, type=int)
    return days if days in SUPPORTED_RANGES else 30

@insights_bp.route('/', methods=['GET'])
@analytics_read_limit()
@login_required
def insights_page():
    """Renders the enhanced insights and analytics page."""
    initial_insights = get_enhanced_insights(
        get_current_user().id,
        _requested_range_days(),
    )
    return render_template(
        'insights.html',
        initial_insights=initial_insights or {},
    )

@insights_bp.route('/api/insights', methods=['GET'])
@analytics_read_limit()
@login_required
def get_insights():
    """API endpoint to get enhanced analytical insights."""
    days = _requested_range_days()
    
    insights = get_enhanced_insights(get_current_user().id, days)
    if not insights:
        return jsonify(error="Could not generate insights."), 404
        
    response = jsonify(insights)
    response.headers['Cache-Control'] = 'no-store'
    return response

@insights_bp.route('/api/export', methods=['GET'])
@export_limit()
@login_required
def export_insights_data():
    """Export insights data as CSV."""
    days = _requested_range_days()
    user = get_current_user()
    
    # Get the raw data for export
    from services.enhanced_insights_service import get_user_logs_df
    df = get_user_logs_df(user.id, user.timezone, days)
    
    if df.empty:
        return jsonify(error="No data to export."), 404
    
    # Create CSV output
    output = io.StringIO()
    writer = csv.writer(output)
    
    # Write headers
    writer.writerow(['Date', 'Time', 'Quantity', 'Brand', 'Nicotine (mg)', 'Total Nicotine (mg)'])
    
    # Write data
    for _, row in df.iterrows():
        writer.writerow([
            row['user_time'].strftime('%Y-%m-%d'),
            row['user_time'].strftime('%H:%M:%S'),
            row['quantity'],
            row['brand'] or 'Unknown',
            row['nicotine_mg'] or 0,
            (row['quantity'] * (row['nicotine_mg'] or 0))
        ])
    
    # Create response
    response = make_response(output.getvalue())
    response.headers['Content-Type'] = 'text/csv'
    response.headers['Content-Disposition'] = f'attachment; filename=nicotine_data_{datetime.now().strftime("%Y%m%d")}.csv'
    
    return response

# Legacy endpoint for backward compatibility
@insights_bp.route('/api/legacy-insights', methods=['GET'])
@analytics_read_limit()
@login_required
def get_legacy_insights():
    """Legacy API endpoint for backward compatibility."""
    insights = get_all_insights(get_current_user().id)
    if not insights:
        return jsonify(error="Could not generate insights."), 404
        
    return jsonify(insights)
