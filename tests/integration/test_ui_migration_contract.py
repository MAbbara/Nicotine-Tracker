"""Repository-level completion guard for the first-party UI migration."""

import re
from pathlib import Path

from bs4 import BeautifulSoup
from flask import render_template


PROJECT_ROOT = Path(__file__).resolve().parents[2]
TEMPLATES_ROOT = PROJECT_ROOT / "templates"
JAVASCRIPT_ROOT = PROJECT_ROOT / "static" / "js"

BANNED = re.compile(
    r"\b(?:bg|text|border|ring|outline|fill|stroke)-"
    r"(?:indigo|purple|violet|fuchsia|blue)-\d+\b"
)
EXTENDS = re.compile(r"{%\s*extends\s+['\"]([^'\"]+)['\"]\s*%}")
APPROVED_LAYOUTS = {
    "layouts/app.html",
    "layouts/auth.html",
    "layouts/marketing.html",
}

# These compatibility views have route handlers and remain part of the public
# first-party surface even when a fixture does not happen to navigate to them.
REQUIRED_ROUTE_TEMPLATES = {
    "catalog/search_results.html",
    "goals/progress.html",
}

NON_ROUTE_TEMPLATE_DIRECTORIES = {"components", "emails", "layouts"}
EXCLUDED_TEMPLATE_FILES = {
    "base.html",  # documented compatibility bridge, tested through descendants
    "settings/settings_layout.html",  # intermediate compatibility layout
}
THIRD_PARTY_JAVASCRIPT = {
    "preline.js",
    "apexcharts.min.js",
    "lodash.min.js",
    "helper-apexcharts.js",
}


def _relative(path):
    return path.relative_to(PROJECT_ROOT).as_posix()


def _first_party_templates():
    for path in sorted(TEMPLATES_ROOT.rglob("*.html")):
        relative = path.relative_to(TEMPLATES_ROOT)
        if relative.parts[0] == "emails":
            continue
        yield path


def _user_facing_templates():
    for path in sorted(TEMPLATES_ROOT.rglob("*.html")):
        relative = path.relative_to(TEMPLATES_ROOT)
        if relative.parts[0] in NON_ROUTE_TEMPLATE_DIRECTORIES:
            continue
        if relative.as_posix() in EXCLUDED_TEMPLATE_FILES:
            continue
        if path.name.startswith("_"):
            continue
        yield path


def _first_party_javascript():
    for path in sorted(JAVASCRIPT_ROOT.rglob("*.js")):
        if path.name.endswith(".min.js") or path.name in THIRD_PARTY_JAVASCRIPT:
            continue
        yield path


def _banned_matches(path):
    for line_number, line in enumerate(path.read_text().splitlines(), start=1):
        for match in BANNED.finditer(line):
            yield f"{_relative(path)}:{line_number}: {match.group(0)}"


def _ultimate_layout(template_name):
    visited = set()
    while template_name not in APPROVED_LAYOUTS:
        assert template_name not in visited, (
            f"templates/{template_name}: circular template inheritance"
        )
        visited.add(template_name)
        path = TEMPLATES_ROOT / template_name
        assert path.is_file(), f"templates/{template_name}: route template is missing"
        match = EXTENDS.search(path.read_text())
        assert match, f"templates/{template_name}: does not extend an approved layout"
        template_name = match.group(1)
    return template_name


def test_first_party_templates_and_generated_classes_have_no_banned_palette():
    failures = []
    for path in [*_first_party_templates(), *_first_party_javascript()]:
        failures.extend(_banned_matches(path))

    assert not failures, "Banned first-party color classes:\n" + "\n".join(failures)


def test_palette_scan_includes_shared_first_party_markup_but_excludes_email():
    scanned = {
        path.relative_to(TEMPLATES_ROOT).as_posix()
        for path in _first_party_templates()
    }

    assert "components/chart.html" in scanned
    assert "layouts/app.html" in scanned
    assert not any(name.startswith("emails/") for name in scanned)


def test_required_route_compatibility_views_exist():
    failures = [
        f"templates/{name}: route template is missing"
        for name in sorted(REQUIRED_ROUTE_TEMPLATES)
        if not (TEMPLATES_ROOT / name).is_file()
    ]
    assert not failures, "Missing compatibility views:\n" + "\n".join(failures)


def test_user_facing_route_templates_reach_an_approved_layout():
    template_names = {
        path.relative_to(TEMPLATES_ROOT).as_posix()
        for path in _user_facing_templates()
    } | REQUIRED_ROUTE_TEMPLATES

    failures = []
    for template_name in sorted(template_names):
        try:
            _ultimate_layout(template_name)
        except AssertionError as error:
            failures.append(str(error))

    assert not failures, "Invalid route template inheritance:\n" + "\n".join(failures)


def test_goals_progress_compatibility_view_renders_route_context(
        logged_in_client, test_goal):
    response = logged_in_client.get("/goals/progress")
    document = BeautifulSoup(response.data, "html.parser")

    assert response.status_code == 200
    assert [heading.get_text(" ", strip=True) for heading in document.select("main h1")] \
        == ["Goal progress"]
    assert document.select_one(
        f'article.goal-row[data-goal-id="{test_goal.id}"]'
    )
    assert document.select("[data-progress-period]") == []
    assert 'Not enough data yet' in document.get_text(' ', strip=True)
    assert document.select_one('a.c-button.c-button--secondary[href="/goals/"]')
    scripts = [script.get("src", "") for script in document.select("script[src]")]
    assert not any(source.endswith("/static/js/preline.js") for source in scripts)


def test_migrated_settings_and_error_pages_omit_legacy_preline_runtime(
        app, logged_in_client, test_log):
    for path in (
        "/settings/profile",
        "/settings/account",
        "/settings/preferences",
        "/settings/notifications",
        "/settings/data",
        "/settings/statistics",
        "/log/bulk",
        f"/log/edit/{test_log.id}",
    ):
        document = BeautifulSoup(logged_in_client.get(path).data, "html.parser")
        scripts = [script.get("src", "") for script in document.select("script[src]")]
        assert not any(source.endswith("/static/js/preline.js") for source in scripts), path

    with app.test_request_context("/"):
        for template_name, context in (
            ("errors/400.html", {}),
            ("errors/404.html", {}),
            ("errors/500.html", {"request_id": "migration-contract"}),
        ):
            document = BeautifulSoup(
                render_template(template_name, **context), "html.parser"
            )
            scripts = [script.get("src", "") for script in document.select("script[src]")]
            assert not any(
                source.endswith("/static/js/preline.js") for source in scripts
            ), template_name

        add_log = BeautifulSoup(
            render_template(
                "logging/add_log.html",
                user_timezone="UTC",
                today="2026-08-02",
                current_time="12:00",
                pouches=[],
            ),
            "html.parser",
        )
        add_log_scripts = [
            script.get("src", "") for script in add_log.select("script[src]")
        ]
        assert not any(
            source.endswith("/static/js/preline.js")
            for source in add_log_scripts
        ), "logging/add_log.html"
