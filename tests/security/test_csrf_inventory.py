"""Static inventory proving mutation surfaces participate in CSRF."""

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def test_every_post_form_renders_a_csrf_token():
    missing = []
    for path in sorted((ROOT / 'templates').rglob('*.html')):
        source = path.read_text()
        for match in re.finditer(r'<form\b[^>]*method=["\']POST["\'][^>]*>', source, re.I):
            close = source.find('</form>', match.end())
            form = source[match.end():close if close >= 0 else len(source)]
            if 'csrf_token()' not in form:
                missing.append(str(path.relative_to(ROOT)))
    assert missing == []


def test_mutation_fetches_send_standard_csrf_header():
    missing = []
    candidates = list((ROOT / 'static' / 'js').rglob('*.js')) + list(
        (ROOT / 'templates').rglob('*.html')
    )
    for path in sorted(candidates):
        source = path.read_text()
        if re.search(r"method:\s*['\"](?:POST|PATCH|PUT|DELETE)['\"]", source):
            if 'X-CSRFToken' not in source:
                missing.append(str(path.relative_to(ROOT)))
    assert missing == []


def test_csrf_is_enabled_by_default_and_initialized():
    config = (ROOT / 'config.py').read_text()
    extensions = (ROOT / 'extensions.py').read_text()
    app = (ROOT / 'app.py').read_text()
    assert 'WTF_CSRF_ENABLED = True' in config
    assert 'CSRFProtect' in extensions
    assert 'csrf.init_app(app)' in app
