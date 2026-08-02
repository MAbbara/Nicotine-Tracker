"""Page contract for the four server-rendered authentication pages.

Every auth page renders through layouts/auth.html with exactly one
.auth-panel and one H1, calm editorial styling with no legacy palette
utility classes, and no alert-based inline validation. The registration
page additionally loads the pure validation module and ships persistent
inline error nodes so client-side feedback never uses alert().
"""

import re

from bs4 import BeautifulSoup
import pytest

from services.password_reset_service import PasswordResetService


PALETTE_UTILITY = re.compile(r"(?:indigo|violet|purple|fuchsia|blue)-\d+")


def _document(response):
    assert response.status_code == 200
    return BeautifulSoup(response.data, "html.parser"), response.data.decode("utf-8")


def _assert_auth_page_contract(response):
    document, html = _document(response)
    assert len(document.select("h1")) == 1, "auth pages render exactly one H1"
    assert not PALETTE_UTILITY.search(html), (
        "legacy palette utility classes must not appear on auth pages"
    )
    assert document.select_one(".auth-panel") is not None, (
        "auth pages render a single .auth-panel container"
    )
    return document, html


def test_login_page_contract(client):
    _assert_auth_page_contract(client.get("/auth/login"))


def test_register_page_contract(client):
    _assert_auth_page_contract(client.get("/auth/register"))


def test_forgot_password_page_contract(client):
    _assert_auth_page_contract(client.get("/auth/forgot_password"))


def test_reset_password_page_contract(app, client, test_user):
    with app.app_context():
        token = PasswordResetService().create_reset_token(test_user.id).token

    _assert_auth_page_contract(client.get(f"/auth/reset_password/{token}"))


def test_register_page_loads_validation_module_with_inline_errors(client):
    document, html = _document(client.get("/auth/register"))

    module_scripts = [
        script.get("src", "")
        for script in document.select('script[type="module"]')
    ]
    assert any("js/auth/register_validation.js" in src for src in module_scripts), (
        "registration must load js/auth/register_validation.js as a module"
    )

    inline_scripts = [
        script for script in document.find_all("script") if not script.get("src")
    ]
    assert inline_scripts == [], "registration must not keep an inline script block"
    assert "alert(" not in html, "registration must not use alert() validation"

    error_nodes = document.select('[role="alert"]')
    assert error_nodes, "registration renders persistent inline error nodes"
    error_ids = {node.get("id") for node in error_nodes}
    assert "password-error" in error_ids
    assert "confirm_password-error" in error_ids


@pytest.mark.parametrize(
    "path", ["/auth/login", "/auth/register", "/auth/forgot_password"]
)
def test_auth_pages_preserve_csrf_and_post_forms(client, path):
    document, _ = _document(client.get(path))

    csrf = document.select_one('input[name="csrf_token"]')
    assert csrf is not None and csrf.get("value"), "CSRF hidden input is preserved"

    form = document.select_one(".auth-panel form")
    assert form is not None
    assert (form.get("method") or "").lower() == "post"
