"""Rendered accessibility contract for the shared icon macro."""

from bs4 import BeautifulSoup


def _render_icon(app, expression):
    with app.test_request_context('/'):
        template = app.jinja_env.from_string(
            '{% from "components/icon.html" import icon %}' + expression
        )
        return BeautifulSoup(template.render(), 'html.parser').find('svg')


def test_informative_icon_has_an_accessible_name(app):
    svg = _render_icon(
        app,
        '{{ icon("today", label="Today", class_name="nav-icon") }}',
    )
    assert svg['role'] == 'img'
    assert svg['aria-label'] == 'Today'
    assert svg['focusable'] == 'false'
    assert 'aria-hidden' not in svg.attrs
    assert 'nav-icon' in svg.get('class', [])
    assert svg.find('use')['href'].endswith('sprite.svg#today')


def test_decorative_icon_is_hidden_and_not_focusable(app):
    svg = _render_icon(app, '{{ icon("milestone") }}')
    assert svg['aria-hidden'] == 'true'
    assert svg['focusable'] == 'false'
    assert 'role' not in svg.attrs
    assert 'aria-label' not in svg.attrs


def test_icon_macro_uses_shared_stroke_contract(app):
    svg = _render_icon(app, '{{ icon("insights", label="Insights") }}')
    assert svg['stroke-width'] == '1.75'
    assert svg['fill'] == 'none'
    assert svg['stroke'] == 'currentColor'
