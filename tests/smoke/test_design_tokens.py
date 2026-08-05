"""Source-of-truth contracts for the warm coaching visual system."""

from pathlib import Path
import re


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / 'static' / 'css' / 'tailwind.css'


def test_light_and_dark_semantic_tokens_exist():
    css = SOURCE.read_text()
    tokens = (
        '--color-canvas',
        '--color-surface',
        '--color-ink',
        '--color-text-muted',
        '--color-border',
        '--color-constructive',
        '--color-attention',
        '--color-milestone',
        '--color-focus',
        '--radius-control',
        '--radius-surface',
        '--space-section',
        '--duration-feedback',
        '--ease-out-expo',
    )
    for token in tokens:
        assert token in css
    assert '[data-theme="light"]' in css
    assert '[data-theme="dark"]' in css


def test_approved_palette_and_typography_are_source_tokens():
    css = SOURCE.read_text()
    for value in (
        '#F5F1E7', '#1E2A24', '#4B6B55', '#B76343', '#C5A05A',
        '#111915', '#1B2721', '#344139', '#EEE8D8', '#A7AEA7',
        '#94B29A', '#D38466',
    ):
        assert value.lower() in css.lower()
    assert "font-family: 'Newsreader'" in css
    assert "font-family: 'DM Sans'" in css
    assert 'clamp(' in css


def test_self_hosted_fonts_and_license_inventory_exist():
    font_dir = ROOT / 'static' / 'fonts'
    for filename in ('newsreader-variable.woff2', 'dm-sans-variable.woff2'):
        font = font_dir / filename
        assert font.exists()
        assert font.stat().st_size > 10_000
    readme = (font_dir / 'README.md').read_text()
    assert 'SIL Open Font License 1.1' in readme
    assert 'SHA-256' in readme
    assert 'Newsreader' in readme
    assert 'DM Sans' in readme


def test_accessibility_and_motion_foundations_are_explicit():
    css = SOURCE.read_text()
    assert 'min-height: 2.75rem' in css
    assert ':focus-visible' in css
    assert 'prefers-reduced-motion: reduce' in css
    assert 'color-scheme:' in css
    assert 'viewport-fit=cover' not in css  # markup concern, not CSS source


def test_two_point_n_wordmark_keeps_a_modest_raster_radius():
    css = SOURCE.read_text()
    rule_match = re.search(r'\.wordmark > img\s*\{(?P<body>[^}]*)\}', css)

    assert rule_match is not None
    rule = rule_match.group('body')
    radius_match = re.search(r'border-radius:\s*(?P<radius>[\d.]+)rem', rule)
    assert radius_match is not None
    assert 0.4 <= float(radius_match.group('radius')) <= 0.6
    for declaration in (
        'width: 2rem',
        'height: 2rem',
        'flex: 0 0 2rem',
        'object-fit: contain',
    ):
        assert declaration in rule
    for rejected in ('border:', 'border-radius: 50%', 'box-shadow:', 'transform:'):
        assert rejected not in rule


def test_source_has_no_rejected_visual_shortcuts():
    css = SOURCE.read_text().lower()
    for rejected in ('linear-gradient', 'radial-gradient', 'font-family: inter'):
        assert rejected not in css


def test_auth_alignment_is_mobile_first_and_landing_has_no_generated_step_number():
    css = SOURCE.read_text()
    auth_base_match = re.search(r'\.auth-content\s*\{(?P<body>[^}]*)\}', css)
    auth_desktop_match = re.search(
        r'@media \(min-width: 48rem\)\s*\{\s*'
        r'\.auth-content\s*\{(?P<body>[^}]*)\}',
        css,
    )

    assert auth_base_match is not None
    assert 'align-content: start' in auth_base_match.group('body')
    assert auth_desktop_match is not None
    assert 'place-items: center' in auth_desktop_match.group('body')
    assert '.landing-next::after' not in css
    assert re.search(r"content:\s*(['\"])01\1", css) is None


def test_icon_inventory_is_one_pinned_family():
    icon_dir = ROOT / 'static' / 'icons'
    readme = (icon_dir / 'README.md').read_text()
    assert 'Lucide' in readme
    assert 'ISC License' in readme
    assert '1.27.0' in readme
    assert 'SHA-256' in readme
    icons = sorted((icon_dir / 'lucide').glob('*.svg'))
    assert len(icons) >= 8
    assert (icon_dir / 'lucide' / 'sprite.svg').exists()
