from flask import Blueprint, jsonify, request
from routes.auth import get_current_user, login_required

from services.log_service import get_daily_intake_for_user
from datetime import datetime, timedelta, time


api_bp = Blueprint('api', __name__)

@api_bp.route('/daily_intake', methods=['GET'])

@login_required
def daily_intake_data():
    today = datetime.utcnow().date()
    start_date_str = request.args.get('start_date')
    end_date_str = request.args.get('end_date')

    if start_date_str and end_date_str:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
    else:
        start_date = today - timedelta(days=29)
        end_date = today

    current_user = get_current_user()
    reset_time = time(0, 0)
    if hasattr(current_user, 'preferences') and current_user.preferences and current_user.preferences.daily_reset_time:
        reset_time = current_user.preferences.daily_reset_time

    daily_intake = get_daily_intake_for_user(
        user_id=current_user.id,
        start_date=start_date,
        end_date=end_date,
        reset_time=reset_time
    )



    # Convert keys to strings for JSON compatibility
    daily_intake_str_keys = {d.strftime('%Y-%m-%d'): v for d, v in daily_intake.items()}

    return jsonify(daily_intake_str_keys)
