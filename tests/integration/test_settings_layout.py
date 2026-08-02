"""Shared editorial Settings layout contracts."""

import re
from pathlib import Path

import pytest
from bs4 import BeautifulSoup


PROJECT_ROOT = Path(__file__).resolve().parents[2]
BANNED_PALETTE = re.compile(r"(?:indigo|violet|purple|fuchsia|blue)-\d+")
SETTINGS_PAGES = [
    ("/settings/profile", "Profile"),
    ("/settings/account", "Account"),
    ("/settings/preferences", "Preferences"),
    ("/settings/notifications", "Reminders"),
    ("/settings/data", "Data & privacy"),
    ("/settings/statistics", "Statistics"),
]


@pytest.mark.parametrize(("path", "heading"), SETTINGS_PAGES)
def test_each_settings_page_uses_one_shared_labelled_navigation(
        logged_in_client, path, heading):
    response = logged_in_client.get(path)
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, "html.parser")

    assert [item.get_text(" ", strip=True) for item in soup.select("main h1")] == [heading]
    navs = soup.select('nav[aria-label="Settings"]')
    assert len(navs) == 1
    nav = navs[0]
    assert nav.get("tabindex") == "0"
    assert [link.get_text(" ", strip=True) for link in nav.select("a")] == [
        "Profile", "Account", "Preferences", "Reminders", "Data & privacy", "Statistics",
    ]
    current = nav.select('a[aria-current="page"]')
    assert len(current) == 1
    assert current[0].get_text(" ", strip=True) == heading

    layout = soup.select_one(".settings-page")
    content = soup.select_one(".settings-content")
    assert layout is not None and content is not None
    assert list(layout.descendants).index(nav) < list(layout.descendants).index(content)


def test_shared_settings_templates_use_only_design_system_classes():
    sources = "\n".join((PROJECT_ROOT / path).read_text() for path in (
        "templates/settings/settings_layout.html",
        "templates/components/settings_nav.html",
    ))

    assert BANNED_PALETTE.search(sources) is None
    assert all(token in sources for token in (
        "settings-page", "settings-nav", "settings-content",
    ))


def test_settings_layout_css_keeps_actions_in_flow_with_mobile_clearance():
    source = (PROJECT_ROOT / "static/css/tailwind.css").read_text()

    assert ".settings-save-row" in source
    assert "env(safe-area-inset-bottom)" in source
    assert ".settings-nav" in source
    mobile_nav_rule = source.split(".settings-nav {", 1)[1].split("}", 1)[0]
    assert "position: sticky" not in mobile_nav_rule
