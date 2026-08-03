import json

from flask import Blueprint, Response, current_app


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
