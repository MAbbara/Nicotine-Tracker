from flask import Blueprint, render_template, request, jsonify, flash
from routes.auth import login_required, get_current_user

from extensions import db
from models import Craving

cravings_bp = Blueprint('cravings', __name__)

@cravings_bp.route('/cravings', methods=['GET'])
@login_required
def cravings_page():
    """Renders the craving tracker page."""
    return render_template('cravings/cravings.html')

@cravings_bp.route('/api/cravings', methods=['POST'])
@login_required
def add_craving():
    """API endpoint to add a new craving."""
    user = get_current_user()
    data = request.get_json()
    intensity = data.get('intensity')
    trigger = data.get('trigger')
    notes = data.get('notes')

    if not intensity:
        return jsonify(error="Intensity is required."), 400

    craving = Craving(
        user_id=user.id,
        intensity=intensity,
        trigger=trigger,
        notes=notes
    )

    db.session.add(craving)
    db.session.commit()

    flash('Craving logged successfully.', 'success')
    return jsonify(craving.to_dict()), 201

@cravings_bp.route('/api/cravings', methods=['GET'])
@login_required
def get_cravings():
    """API endpoint to get all cravings for the current user."""
    user = get_current_user()
    cravings = Craving.query.filter_by(user_id=user.id).order_by(Craving.craving_time.desc()).all()
    return jsonify([craving.to_dict() for craving in cravings])
