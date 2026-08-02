from datetime import datetime, timezone
import re
from uuid import uuid4

from flask import Blueprint, render_template, request, jsonify, current_app
from routes.auth import login_required, get_current_user
from extensions import db
from models import Craving
from services.api_errors import ApiValidationError
from services.craving_service import (
    CravingService,
    CravingValidationError,
    get_comprehensive_craving_analytics,
)
from services.serializers import (
    InvalidLocalTimeError,
    parse_create_craving_request,
    parse_update_craving_request,
)
from services.timezone_service import resolve_timezone


cravings_bp = Blueprint('cravings', __name__)

_LEGACY_PATCH_KEYS = {
    'outcome',
    'duration_minutes',
    'mood_before',
    'mood_after',
    'stress_level',
    'physical_symptoms',
    'situation_context',
    'notes',
    'outcome_notes',
}
_LEGACY_KEYS = {'intensity', 'trigger'} | _LEGACY_PATCH_KEYS
_LEGACY_INTEGER_FIELDS = {
    'intensity',
    'duration_minutes',
    'mood_before',
    'mood_after',
    'stress_level',
}


def _legacy_error(message, status=400):
    response = jsonify(error=message)
    response.status_code = status
    return _deprecate_craving_response(response)


def _deprecate_craving_response(response):
    response.headers['Deprecation'] = 'true'
    response.headers['Sunset'] = 'Thu, 31 Dec 2026 23:59:59 GMT'
    response.headers['Link'] = '</api/cravings>; rel="successor-version"'
    return response


def _legacy_integer(value):
    if not isinstance(value, str):
        return value
    normalized = value.strip()
    if not normalized:
        return None
    if re.fullmatch(r'[+-]?\d+', normalized) is None:
        return value
    return int(normalized)


def _first_validation_message(exc):
    for messages in exc.field_errors.values():
        if messages:
            return messages[0]
    return 'Check the provided craving details and try again.'

@cravings_bp.route('/cravings', methods=['GET'])
@login_required
def cravings_page():
    """Render the detailed craving-entry fallback and recent history."""
    try:
        user = get_current_user()
        recent_cravings = Craving.query.filter_by(user_id=user.id).order_by(
            Craving.craving_time.desc(), Craving.id.desc()
        ).limit(20).all()
        return render_template(
            'cravings/cravings.html',
            recent_cravings=recent_cravings,
            user=user,
            user_timezone=resolve_timezone(user.timezone).zone,
        )
    except Exception as e:
        current_app.logger.error(f'Cravings page error: {e}')
        user = get_current_user()
        return render_template(
            'cravings/cravings.html',
            recent_cravings=[],
            user=user,
            user_timezone=resolve_timezone(
                user.timezone if user else None
            ).zone,
        )


@cravings_bp.route('/api/cravings', methods=['POST'])
@login_required
def add_craving():
    """Deprecated adapter over the canonical create and update services."""
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return _legacy_error('Send one JSON object.')

    unknown = sorted(set(data) - _LEGACY_KEYS)
    if unknown:
        return _legacy_error('This field is not supported.')

    user = get_current_user()
    instant = datetime.now(timezone.utc)
    resolved_timezone = resolve_timezone(user.timezone)
    raw_intensity = _legacy_integer(data.get('intensity'))
    create_body = {
        'client_event_id': str(uuid4()),
        'intensity': raw_intensity,
        'trigger': data.get('trigger'),
        'occurred_at_local': instant.astimezone(
            resolved_timezone
        ).isoformat(),
        'timezone': resolved_timezone.zone,
    }
    patch_body = {}
    for field in _LEGACY_PATCH_KEYS:
        if field not in data:
            continue
        value = data[field]
        if field in _LEGACY_INTEGER_FIELDS:
            value = _legacy_integer(value)
        if field == 'outcome' and isinstance(value, str) and not value.strip():
            continue
        patch_body[field] = value

    try:
        create_input = parse_create_craving_request(create_body, now=instant)
        patch_input = (
            parse_update_craving_request(patch_body) if patch_body else None
        )
    except (ApiValidationError, InvalidLocalTimeError) as exc:
        return _legacy_error(_first_validation_message(exc))

    try:
        result = CravingService.create_idempotent(user.id, create_input)
        craving = result.craving
        if patch_input is not None:
            craving = CravingService.update_owned(
                user.id, craving.id, patch_input
            )
    except CravingValidationError as exc:
        return _legacy_error(_first_validation_message(exc))
    except Exception:
        db.session.rollback()
        current_app.logger.exception('Legacy craving adapter failed')
        return _legacy_error('Failed to log craving.', status=500)

    response = jsonify(craving.to_dict())
    response.status_code = 201
    return _deprecate_craving_response(response)

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
