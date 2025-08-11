from flask import Blueprint, jsonify, request
from routes.auth import get_current_user, login_required
from app import db
from models import Pouch, Log

from services.log_service import get_daily_intake_for_user
from datetime import datetime, timedelta, time, timezone



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


@api_bp.route('/update-timezone', methods=['POST'])
@login_required
def update_timezone():
    data = request.get_json()
    if not data or 'timezone' not in data:
        return jsonify({'success': False, 'message': 'Timezone not provided'}), 400
    
    user = get_current_user()
    user.timezone = data['timezone']
    db.session.commit()
    
    return jsonify({'success': True, 'timezone': user.timezone})


@api_bp.route('/quick_add', methods=['POST'])
@login_required
def quick_add():
    data = request.get_json()
    pouch_id = data.get('pouch_id')
    quantity = data.get('quantity')

    if not pouch_id or not quantity:
        return jsonify({'success': False, 'message': 'Missing pouch_id or quantity'}), 400

    user = get_current_user()
    pouch = db.session.get(Pouch, pouch_id)
    if not pouch:
        return jsonify({'success': False, 'message': 'Pouch not found'}), 404

    log = Log(
        user_id=user.id,
        pouch_id=pouch_id,
        quantity=quantity,
        log_time=datetime.now(timezone.utc),
        notes="" # Quick add has no notes
    )
    db.session.add(log)
    db.session.commit()
    
    message = f"Added {quantity} {pouch.brand} ({pouch.nicotine_mg}mg)"
    return jsonify({'success': True, 'message': message})


@api_bp.route('/pouches', methods=['GET'])
@login_required
def get_pouches():
    pouches = db.session.execute(db.select(Pouch)).scalars().all()
    pouches_data = [p.to_dict() for p in pouches]

    return jsonify({'success': True, 'pouches': pouches_data})


@api_bp.route('/brands', methods=['GET'])
@login_required
def get_brands():
    brands_query = db.session.execute(db.select(Pouch.brand).distinct()).all()
    brands = [b[0] for b in brands_query]
    return jsonify({'success': True, 'brands': brands})


@api_bp.route('/strengths/<brand>', methods=['GET'])
@login_required
def get_strengths(brand):
    strengths_query = db.session.execute(db.select(Pouch.nicotine_mg).where(Pouch.brand == brand).distinct()).all()
    strengths = [s[0] for s in strengths_query]
    return jsonify({'success': True, 'strengths': strengths})
