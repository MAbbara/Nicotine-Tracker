"""Landmark and global-dependency contracts for the three page layouts."""

from pathlib import Path

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


@pytest.mark.parametrize('layout', ['app', 'auth', 'marketing'])
def test_all_layouts_use_the_two_point_n_brand_home(app, layout):
    soup = BeautifulSoup(_render_layout(app, layout), 'html.parser')
    brand_home = soup.select_one('a.wordmark[aria-label="Nicotine Tracker home"]')

    assert brand_home is not None
    assert brand_home.find('img', attrs={
        'src': '/static/brand/nicotine-tracker-two-point-n-symbol.png',
        'alt': '',
        'aria-hidden': 'true',
    }) is not None
    assert 'N/T' not in brand_home.get_text(' ', strip=True)
    assert Path('static/brand/nicotine-tracker-two-point-n-symbol.png').is_file()
    assert Path('static/brand/nicotine-tracker-two-point-n-lockup.png').is_file()
    if layout == 'auth':
        assert brand_home.parent.name == 'header'
        assert 'auth-brand' in brand_home.parent.get('class', [])


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


@pytest.mark.parametrize('layout', ['app', 'auth', 'marketing'])
def test_all_layouts_load_one_shared_theme_bootstrap_before_css(app, layout):
    html = _render_layout(app, layout)
    soup = BeautifulSoup(html, 'html.parser')
    root = soup.find('html')
    bootstrap = soup.find(
        'script',
        src='/static/js/shell/theme_bootstrap.js',
    )
    stylesheet = soup.find(
        'link',
        rel='stylesheet',
        href='/static/css/style.css',
    )
    controller = soup.find('script', src='/static/js/shell/theme.js')

    assert root.get('data-saved-theme') in {'light', 'dark', 'system'}
    assert bootstrap is not None and bootstrap.find_parent('head') is soup.head
    assert stylesheet is not None and stylesheet.find_parent('head') is soup.head
    head_elements = soup.head.find_all(recursive=False)
    assert head_elements.index(bootstrap) < head_elements.index(stylesheet)
    assert controller is not None, 'every layout starts the shared live theme controller'
    assert bootstrap.string is None, 'pre-paint behavior stays in the shared static asset'


def test_base_is_a_small_compatibility_bridge():
    from pathlib import Path

    source = Path('templates/base.html').read_text()
    assert '{% extends "layouts/app.html" %}' in source
    assert len(source.splitlines()) <= 12
