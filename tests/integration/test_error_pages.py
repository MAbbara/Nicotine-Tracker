"""Page contract for the three server-rendered error pages.

Every error page renders through the shared app layout with exactly one
.error-page root and one H1, calm editorial styling with no legacy palette
utility classes, and exactly one .c-button--primary recovery action built
from the shared button macro. The 404 recovery destination follows the
visitor: authenticated users return to Today, anonymous visitors return to
the landing page. The 400 page preserves the existing refresh guidance and
the 500 page preserves a supplied request reference.
"""

import re

from bs4 import BeautifulSoup
from flask import render_template

from services.request_context import REQUEST_ID_HEADER


PALETTE_UTILITY = re.compile(
    r"(?:indigo|violet|purple|fuchsia|blue|sky|gray|slate|zinc|neutral|stone|red)-\d+"
)


def _assert_error_page_contract(html):
    document = BeautifulSoup(html, "html.parser")
    assert len(document.select("h1")) == 1, "error pages render exactly one H1"
    assert not PALETTE_UTILITY.search(html), (
        "legacy palette utility classes must not appear on error pages"
    )
    assert len(document.select(".error-page")) == 1, (
        "error pages render exactly one .error-page root"
    )
    primary_actions = document.select(".error-page .c-button--primary")
    assert len(primary_actions) == 1, (
        "error pages offer exactly one primary recovery action"
    )
    assert "c-button" in primary_actions[0].get("class", []), (
        "the recovery action is built from the shared button macro"
    )
    assert "alert(" not in html, "error pages never use inline alert() calls"
    return document


def _primary_action(document):
    return document.select_one(".error-page .c-button--primary")


def _login(client, test_user):
    response = client.post(
        "/auth/login",
        data={"email": test_user.email, "password": "password123"},
    )
    assert response.status_code == 302


def test_404_anonymous_contract_recovers_to_landing_page(client):
    response = client.get("/missing-integration-fixture")
    assert response.status_code == 404

    document = _assert_error_page_contract(response.data.decode("utf-8"))
    action = _primary_action(document)
    assert action.get("href") == "/", (
        "anonymous 404 recovery returns to the landing page"
    )


def test_404_authenticated_contract_recovers_to_today(client, test_user):
    _login(client, test_user)
    response = client.get("/missing-integration-fixture")
    assert response.status_code == 404

    document = _assert_error_page_contract(response.data.decode("utf-8"))
    action = _primary_action(document)
    assert action.get("href") == "/today/", (
        "authenticated 404 recovery returns to Today"
    )
    assert action.get_text(strip=True) == "Today"


def test_400_contract_preserves_handler_refresh_guidance(app, client):
    app.config["WTF_CSRF_ENABLED"] = True

    response = client.post(
        "/auth/login",
        data={"email": "nobody@example.com", "password": "wrong-password"},
    )
    assert response.status_code == 400

    html = response.data.decode("utf-8")
    _assert_error_page_contract(html)
    assert "This page was open for a while. Refresh it, then try again." in html, (
        "400 keeps the existing refresh guidance supplied by the CSRF handler"
    )


def test_400_default_copy_preserves_refresh_guidance(app):
    with app.test_request_context("/"):
        html = render_template("errors/400.html")

    _assert_error_page_contract(html)
    assert (
        "We could not verify that request. Refresh the page before trying again."
        in html
    ), "400 default copy keeps the existing refresh guidance"


def test_400_recovery_ignores_external_referer(app, client):
    app.config["WTF_CSRF_ENABLED"] = True

    response = client.post(
        "/auth/login",
        data={"email": "nobody@example.com", "password": "wrong-password"},
        headers={"Referer": "https://attacker.example/phish"},
    )
    assert response.status_code == 400

    html = response.data.decode("utf-8")
    document = _assert_error_page_contract(html)
    action = _primary_action(document)
    assert "attacker.example" not in html, (
        "400 recovery never renders an attacker-controlled external URL"
    )
    assert action.get("href") == "/", (
        "anonymous 400 recovery returns to the landing page, not the referer"
    )


def test_400_authenticated_recovery_points_to_today(app, client, test_user):
    _login(client, test_user)
    app.config["WTF_CSRF_ENABLED"] = True

    response = client.post(
        "/auth/login",
        data={"email": "nobody@example.com", "password": "wrong-password"},
        headers={"Referer": "https://attacker.example/phish"},
    )
    assert response.status_code == 400

    html = response.data.decode("utf-8")
    document = _assert_error_page_contract(html)
    action = _primary_action(document)
    assert "attacker.example" not in html
    assert action.get("href") == "/today/", (
        "authenticated 400 recovery returns to Today, not the referer"
    )


def test_500_anonymous_contract_recovers_to_landing_page(app):
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)

    @app.route("/explode-for-error-page-test")
    def _explode():
        raise RuntimeError("intentional test failure")

    response = app.test_client().get("/explode-for-error-page-test")
    assert response.status_code == 500

    html = response.data.decode("utf-8")
    document = _assert_error_page_contract(html)
    action = _primary_action(document)
    assert action.get("href") == "/", (
        "anonymous 500 recovery returns to the landing page"
    )
    assert response.headers.get(REQUEST_ID_HEADER), (
        "500 responses keep the request correlation header"
    )


def test_500_authenticated_recovery_points_to_today(app, test_user):
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)

    @app.route("/explode-for-error-page-test")
    def _explode():
        raise RuntimeError("intentional test failure")

    client = app.test_client()
    _login(client, test_user)
    response = client.get("/explode-for-error-page-test")
    assert response.status_code == 500

    document = _assert_error_page_contract(response.data.decode("utf-8"))
    action = _primary_action(document)
    assert action.get("href") == "/today/", (
        "authenticated 500 recovery returns to Today"
    )


def test_500_live_response_reference_matches_correlation_header(app):
    app.config.update(TESTING=False, PROPAGATE_EXCEPTIONS=False)

    @app.route("/explode-for-reference-test")
    def _explode():
        raise RuntimeError("intentional test failure")

    response = app.test_client().get("/explode-for-reference-test")
    assert response.status_code == 500

    header_request_id = response.headers.get(REQUEST_ID_HEADER)
    assert header_request_id, "500 responses keep the request correlation header"

    document = _assert_error_page_contract(response.data.decode("utf-8"))
    reference = document.select_one(".error-page__reference")
    assert reference is not None, (
        "live HTML 500 responses surface the visible request reference"
    )
    reference_code = reference.select_one("code")
    assert reference_code is not None
    assert reference_code.get_text(strip=True) == header_request_id, (
        "the visible reference is exactly the X-Request-ID response header value"
    )


def test_500_preserves_supplied_request_reference(app):
    with app.test_request_context("/"):
        html = render_template(
            "errors/500.html", request_id="req-2026-08-02-error-pages"
        )

    _assert_error_page_contract(html)
    assert "req-2026-08-02-error-pages" in html, (
        "500 surfaces the request reference when one is supplied"
    )
