"""Landmark and global-dependency contracts for the three page layouts."""

from bs4 import BeautifulSoup
import pytest


def _render_layout(app, layout, body='<h1>Example</h1>'):
    with app.test_request_context('/'):
        template = app.jinja_env.from_string(
            '{% extends "layouts/' + layout + '.html" %}'
            '{% block title %}Layout test{% endblock %}'
            '{% block content %}' + body + '{% endblock %}'
        )
        return template.render()


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


def test_app_layout_has_one_main_skip_link_and_flash_region(app):
    html = _render_layout(app, 'app')
    soup = BeautifulSoup(html, 'html.parser')
    assert len(soup.find_all('main')) == 1
    assert soup.find('main')['id'] == 'main-content'
    assert soup.find('a', href='#main-content').get_text(strip=True) == 'Skip to main content'
    assert soup.find(id='flash-messages')['aria-live'] == 'polite'
    assert soup.find('meta', attrs={'name': 'viewport'})['content'].endswith(
        'viewport-fit=cover'
    )


def test_auth_layout_has_one_main_and_no_application_navigation(app):
    html = _render_layout(app, 'auth')
    soup = BeautifulSoup(html, 'html.parser')
    assert len(soup.find_all('main')) == 1
    assert 'auth-shell' in soup.find('body')['class']
    assert soup.find('nav', attrs={'aria-label': 'Primary'}) is None


def test_marketing_layout_has_header_main_and_footer(app):
    html = _render_layout(app, 'marketing')
    soup = BeautifulSoup(html, 'html.parser')
    assert len(soup.find_all('header')) == 1
    assert len(soup.find_all('main')) == 1
    assert len(soup.find_all('footer')) == 1


def test_global_layouts_do_not_load_page_specific_dependencies(app):
    combined = ''.join(
        _render_layout(app, layout) for layout in ('app', 'auth', 'marketing')
    ).lower()
    for forbidden in ('apexcharts', 'lodash', 'timezone-modal', 'fonts.googleapis.com'):
        assert forbidden not in combined


def test_base_is_a_small_compatibility_bridge():
    from pathlib import Path

    source = Path('templates/base.html').read_text()
    assert '{% extends "layouts/app.html" %}' in source
    assert len(source.splitlines()) <= 12
