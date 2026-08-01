# iOS Home-Screen App Behavior Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the complete server-rendered Nicotine Tracker site installable from iOS Safari and keep same-origin navigation inside the standalone home-screen app.

**Architecture:** Add a small root-level PWA blueprint that serves `/manifest.webmanifest`, reuse the existing Flask/Jinja layouts for shared iOS/browser metadata, and generate fixed-size PNG derivatives from the current application icon. Keep normal Flask navigation, authentication, and HTML responses unchanged; do not add a service worker or client-side router.

**Tech Stack:** Flask, Jinja templates, pytest, BeautifulSoup, PNG/ImageMagick, existing server-rendered route and layout structure.

## Global Constraints

- The manifest `start_url` and `scope` are exactly `/`.
- The manifest display mode is exactly `standalone`.
- The manifest URL is exactly `/manifest.webmanifest` with media type `application/manifest+json`.
- Marketing, authentication, and authenticated app layouts all include the same PWA metadata.
- No authenticated HTML or API response is cached; this change adds no service worker.
- Existing same-origin Flask navigation remains the source of truth.
- Production installation requires HTTPS; local development can use localhost.
- Preserve all current workspace changes; do not reset, merge, or overwrite them with `origin/main`.
- The workspace has no initialized Git repository, so use test/diff checkpoints instead of commit commands until Git is deliberately reconnected.

---

### Task 1: Add failing PWA contract tests

**Files:**
- Create: `tests/test_pwa.py`
- Modify: `tests/templates/test_layouts.py`

**Interfaces:**
- Consumes: the existing `app` and `client` pytest fixtures.
- Produces: failing tests that define the manifest response contract and shared layout metadata contract.

- [ ] **Step 1: Write the manifest and icon contract tests**

Create `tests/test_pwa.py` with these behaviors:

```python
import pytest


def test_manifest_is_root_scoped_standalone_json(client):
    response = client.get('/manifest.webmanifest')

    assert response.status_code == 200
    assert response.mimetype == 'application/manifest+json'

    manifest = response.get_json()
    assert manifest['id'] == '/'
    assert manifest['name'] == 'Nicotine Tracker'
    assert manifest['short_name'] == 'Nicotine Tracker'
    assert manifest['start_url'] == '/'
    assert manifest['scope'] == '/'
    assert manifest['display'] == 'standalone'
    assert manifest['theme_color'] == '#F5F1E7'
    assert manifest['background_color'] == '#F5F1E7'

    icons = {icon['sizes']: icon for icon in manifest['icons']}
    assert icons['192x192']['src'] == '/static/icons/pwa/icon-192.png'
    assert icons['512x512']['src'] == '/static/icons/pwa/icon-512.png'
    assert icons['512x512']['purpose'] == 'any maskable'


@pytest.mark.parametrize('path', [
    '/static/icons/pwa/icon-180.png',
    '/static/icons/pwa/icon-192.png',
    '/static/icons/pwa/icon-512.png',
])
def test_declared_pwa_icons_are_available(client, path):
    response = client.get(path)

    assert response.status_code == 200
    assert response.mimetype == 'image/png'
```

- [ ] **Step 2: Extend layout tests with the exact metadata contract**

Add a helper and one parametrized test to `tests/templates/test_layouts.py`:

```python
import pytest


def _assert_pwa_metadata(html):
    soup = BeautifulSoup(html, 'html.parser')
    assert soup.find('link', rel='manifest', href='/manifest.webmanifest')
    assert soup.find('link', rel='apple-touch-icon', href='/static/icons/pwa/icon-180.png')
    assert soup.find('meta', attrs={
        'name': 'apple-mobile-web-app-capable',
        'content': 'yes',
    })
    assert soup.find('meta', attrs={
        'name': 'apple-mobile-web-app-title',
        'content': 'Nicotine Tracker',
    })
    assert soup.find('meta', attrs={
        'name': 'apple-mobile-web-app-status-bar-style',
        'content': 'default',
    })
    assert soup.find('meta', attrs={
        'name': 'mobile-web-app-capable',
        'content': 'yes',
    })


@pytest.mark.parametrize('layout', ['app', 'auth', 'marketing'])
def test_all_user_facing_layouts_expose_pwa_metadata(app, layout):
    _assert_pwa_metadata(_render_layout(app, layout))
```

Keep the existing imports and tests; add the `pytest` import only once.

- [ ] **Step 3: Run the focused tests and verify they fail for the missing feature**

Run:

```bash
.venv/bin/python -m pytest tests/test_pwa.py tests/templates/test_layouts.py -q
```

Expected: FAIL because `/manifest.webmanifest` and the declared PWA metadata/assets do not exist yet. Do not change production code until this failure is observed.

---

### Task 2: Add the root-level manifest endpoint

**Files:**
- Create: `routes/pwa.py`
- Modify: `app.py`
- Test: `tests/test_pwa.py`

**Interfaces:**
- Consumes: Flask blueprint registration and the manifest contract from Task 1.
- Produces: `pwa.manifest` at `/manifest.webmanifest`, returning stable JSON with `application/manifest+json`.

- [ ] **Step 1: Create the PWA blueprint with the exact manifest payload**

Create `routes/pwa.py`:

```python
import json

from flask import Blueprint, Response


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
```

- [ ] **Step 2: Register the blueprint in the current application factory**

In `app.py`, import `pwa_bp` beside the existing blueprint imports and register it without a URL prefix:

```python
from routes.pwa import pwa_bp

app.register_blueprint(pwa_bp)
```

Place the registration with the other blueprints before the root `index` route. Do not alter existing route prefixes or error handling.

- [ ] **Step 3: Generate the declared PNG assets from the existing icon**

Create `static/icons/pwa/` and derive the exact files from `static/favicon.png`:

```bash
mkdir -p static/icons/pwa
convert static/favicon.png -resize 180x180 static/icons/pwa/icon-180.png
convert static/favicon.png -resize 192x192 static/icons/pwa/icon-192.png
convert static/favicon.png -resize 512x512 static/icons/pwa/icon-512.png
```

If the `convert` executable is unavailable, use the project’s available image tooling to produce the same three PNG dimensions; do not introduce a runtime image-processing dependency.

- [ ] **Step 4: Run the manifest tests and verify they pass**

Run:

```bash
.venv/bin/python -m pytest tests/test_pwa.py::test_manifest_is_root_scoped_standalone_json tests/test_pwa.py::test_declared_pwa_icons_are_available -q
```

Expected: all manifest and icon tests pass.

---

### Task 3: Add iOS metadata to every live HTML layout

**Files:**
- Modify: `templates/layouts/app.html`
- Modify: `templates/layouts/auth.html`
- Modify: `templates/layouts/marketing.html`
- Test: `tests/templates/test_layouts.py`

**Interfaces:**
- Consumes: the registered `pwa.manifest` endpoint and generated icon assets from Task 2.
- Produces: consistent install metadata on every user-facing layout.

- [ ] **Step 1: Add the shared PWA head tags to `layouts/app.html`**

Immediately after the existing favicon link, add:

```jinja
  <link rel="apple-touch-icon" sizes="180x180" href="{{ url_for('static', filename='icons/pwa/icon-180.png') }}">
  <link rel="manifest" href="{{ url_for('pwa.manifest') }}">
  <meta name="application-name" content="Nicotine Tracker">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="default">
  <meta name="apple-mobile-web-app-title" content="Nicotine Tracker">
  <meta name="mobile-web-app-capable" content="yes">
```

- [ ] **Step 2: Add the identical metadata to `layouts/auth.html` and `layouts/marketing.html`**

Use the same tags and `url_for` targets in both layouts. Keep their existing theme, viewport, favicon, title, and stylesheet tags unchanged.

- [ ] **Step 3: Run the layout metadata tests**

Run:

```bash
.venv/bin/python -m pytest tests/templates/test_layouts.py -q
```

Expected: all layout tests pass, including the new PWA metadata test.

---

### Task 4: Verify live route coverage and regression safety

**Files:**
- Modify: `tests/test_pwa.py`
- No production files unless a test exposes a real regression.

**Interfaces:**
- Consumes: the manifest endpoint and layout metadata from Tasks 2–3.
- Produces: evidence that public, auth, and authenticated pages all expose the install metadata and remain inside the root scope.

- [ ] **Step 1: Add live-route metadata coverage**

Add a test that requests the public landing page and login page with a fresh anonymous client and verifies the manifest link is present. Use the existing `logged_in_client` fixture for `/today/` so the authenticated app layout is exercised:

```python
from bs4 import BeautifulSoup


def test_public_auth_and_authenticated_pages_link_the_manifest(
    app, logged_in_client,
):
    public_client = app.test_client()
    for response in (
        public_client.get('/'),
        public_client.get('/auth/login'),
        logged_in_client.get('/today/'),
    ):
        assert response.status_code == 200
        soup = BeautifulSoup(response.data, 'html.parser')
        assert soup.find('link', rel='manifest', href='/manifest.webmanifest')
```

If the existing authenticated fixture’s Today page requires a seeded plan, create only the minimum test user state needed in this test; do not weaken the route or skip the assertion.

- [ ] **Step 2: Add a same-origin scope assertion without introducing a client router**

Assert the manifest’s `scope` is `/` and that the application’s primary navigation links are root-relative or same-origin paths. Keep this focused on the existing navigation, not every link in every page:

```python
def test_manifest_scope_covers_primary_navigation(logged_in_client):
    response = logged_in_client.get('/today/')
    soup = BeautifulSoup(response.data, 'html.parser')

    hrefs = [link.get('href', '') for link in soup.select('[data-primary-navigation] a')]
    assert hrefs
    assert all(href.startswith('/') for href in hrefs)
    assert all(not href.startswith('//') for href in hrefs)
```

- [ ] **Step 3: Run the full focused verification set**

Run:

```bash
.venv/bin/python -m pytest tests/test_pwa.py tests/templates/test_layouts.py -q
npm test
```

Expected: both commands exit 0 with no failures.

- [ ] **Step 4: Run the relevant browser checks**

Run:

```bash
npm run test:e2e -- --project=chromium-mobile tests/browser/today-states.spec.js
```

Expected: the existing mobile Today flows pass without navigation or console regressions.

- [ ] **Step 5: Inspect the final diff and record the platform limitation**

Run:

```bash
git -C /tmp/nicotine-tracker-remote-CLozGb/repo status --short
find static/icons/pwa -maxdepth 1 -type f -print
```

Review the current workspace changes directly because it has no initialized Git metadata. Final handoff must state that real iOS Safari verification is still required, production must use HTTPS, and an existing home-screen installation should be removed and re-added after deployment.

## Spec Coverage Self-Check

- Root-scoped manifest: Task 2.
- Standalone display and warm theme: Task 2.
- Apple metadata on marketing, auth, and app layouts: Task 3.
- Fixed PNG icon derivatives: Task 2.
- Existing server-rendered navigation preserved: Tasks 2–3 make no router or link changes.
- No service worker or private HTML caching: Global Constraints and Tasks 2–3.
- Manifest and route tests: Tasks 1 and 4.
- Browser and platform verification: Task 4.
