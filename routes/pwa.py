import json

from flask import Blueprint, Response, current_app, jsonify, render_template, request

from models import UserPreferences
from routes.auth import get_current_user, login_required
from services.pouch_service import get_all_pouches


pwa_bp = Blueprint('pwa', __name__)


MANIFEST = {
    'id': '/',
    'name': 'Nicotine Tracker',
    'short_name': 'Nicotine Tracker',
    'description': 'A calm, practical companion for reducing nicotine use.',
    'start_url': '/',
    'scope': '/',
    'display': 'standalone',
    'display_override': ['standalone'],
    'orientation': 'portrait-primary',
    'background_color': '#F5F1E7',
    'theme_color': '#F5F1E7',
    'icons': [
        {
            'src': '/static/icons/pwa/icon-192.png',
            'sizes': '192x192',
            'type': 'image/png',
            'purpose': 'any',
        },
        {
            'src': '/static/icons/pwa/icon-512.png',
            'sizes': '512x512',
            'type': 'image/png',
            'purpose': 'any maskable',
        },
    ],
}


@pwa_bp.get('/manifest.webmanifest')
def manifest():
    return Response(
        json.dumps(MANIFEST, separators=(',', ':')),
        mimetype='application/manifest+json',
    )


@pwa_bp.get('/service-worker.js')
def service_worker():
    response = current_app.send_static_file('service-worker.js')
    response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'
    response.headers['Service-Worker-Allowed'] = '/'
    return response


@pwa_bp.get('/offline')
def offline():
    return render_template('pages/offline.html')


@pwa_bp.get('/api/offline-context')
@login_required
def offline_context():
    user = get_current_user()
    preferences = user.preferences
    enabled = preferences and preferences.offline_queue_enabled
    return jsonify({
        'offline_queue_id': preferences.offline_queue_id if enabled else None,
        'pouches': [
            {'id': pouch.id, 'brand': pouch.brand,
             'nicotine_mg': str(pouch.nicotine_mg)}
            for pouch in get_all_pouches(user)
        ] if enabled else [],
    })


@pwa_bp.after_app_request
def offline_identity(response):
    """Tell the worker when private browser data no longer belongs to this session."""
    if request.endpoint in {'static', 'pwa.offline', 'pwa.manifest', 'pwa.service_worker'}:
        return response
    if response.mimetype != 'text/html' and request.path not in {
        '/api/offline-context', '/settings/privacy/offline-queue',
    }:
        return response
    # A failed server request is not evidence that the account changed.
    if response.status_code >= 500:
        return response
    user = get_current_user()
    preferences = UserPreferences.query.filter_by(user_id=user.id).first() if user else None
    response.headers['X-Offline-Queue-ID'] = (
        preferences.offline_queue_id
        if preferences and preferences.offline_queue_enabled else 'disabled'
    )
    response.headers['Cache-Control'] = 'no-store'
    return response
