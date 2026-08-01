"""You foundation destination."""

from flask import Blueprint, render_template

from routes.auth import get_current_user, login_required
from services.preference_service import PreferenceService


you_bp = Blueprint('you', __name__)


@you_bp.route('')
@you_bp.route('/')
@login_required
def index():
    user = get_current_user()
    service = PreferenceService()
    preferences = service.get_or_create_preferences(user.id)
    settings = service.get_or_create_settings(user.id)
    return render_template(
        'you/index.html', user=user, preferences=preferences, settings=settings
    )
