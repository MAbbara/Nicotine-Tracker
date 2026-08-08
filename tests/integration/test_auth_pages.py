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
    assert len(document.select(".auth-panel")) == 1, (
        "auth pages render exactly one .auth-panel container"
    )
    return document, html


def _control(document, name):
    control = document.select_one(f'[name="{name}"]')
    assert control is not None, f'form control "{name}" is preserved'
    return control


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


def test_login_page_preserves_fields_remember_me_and_autocomplete(client):
    document, _ = _assert_auth_page_contract(client.get("/auth/login"))

    email = _control(document, "email")
    assert email.get("type") == "email"
    assert email.get("autocomplete") == "email"

    password = _control(document, "password")
    assert password.get("type") == "password"
    assert password.get("autocomplete") == "current-password"

    remember = _control(document, "remember_me")
    assert remember.get("type") == "checkbox", "Remember me checkbox is preserved"
    remember_label = document.find("label", attrs={"for": "remember_me"}) or remember.find_parent("label")
    assert remember_label is not None
    assert "Remember me" in remember_label.get_text()


def test_register_page_preserves_fields_autocomplete_and_terms_copy(client):
    document, _ = _assert_auth_page_contract(client.get("/auth/register"))

    email = _control(document, "email")
    assert email.get("type") == "email"
    assert email.get("autocomplete") == "email"

    for name in ("password", "confirm_password"):
        control = _control(document, name)
        assert control.get("type") == "password"
        assert control.get("autocomplete") == "new-password"

    terms = _control(document, "terms")
    assert terms.get("type") == "checkbox"
    terms_label = document.find("label", attrs={"for": "terms"}) or terms.find_parent("label")
    assert terms_label is not None
    assert (
        "I understand this is a personal tracking tool, not medical advice."
        in terms_label.get_text()
    ), "exact terms acknowledgement copy is preserved"


def test_forgot_password_page_preserves_email_field(client):
    document, _ = _assert_auth_page_contract(client.get("/auth/forgot_password"))

    email = _control(document, "email")
    assert email.get("type") == "email"
    assert email.get("autocomplete") == "email"


def test_reset_password_page_preserves_minlength_and_no_referrer(app, client, test_user):
    with app.app_context():
        token = PasswordResetService().create_reset_token(test_user.id).token

    document, _ = _assert_auth_page_contract(client.get(f"/auth/reset_password/{token}"))

    referrer = document.select_one('meta[name="referrer"]')
    assert referrer is not None
    assert referrer.get("content") == "no-referrer", (
        "reset-password page keeps the no-referrer policy so tokens never leak"
    )

    for name in ("password", "confirm_password"):
        control = _control(document, name)
        assert control.get("type") == "password"
        assert control.get("autocomplete") == "new-password"
        assert control.get("minlength") == "8", (
            f'reset-password field "{name}" keeps minlength="8"'
        )
        assert control.get("maxlength") == "128"


def test_reset_password_page_externalizes_matching_validation(app, client, test_user):
    with app.app_context():
        token = PasswordResetService().create_reset_token(test_user.id).token

    document, _ = _document(client.get(f"/auth/reset_password/{token}"))

    module_scripts = [
        script.get("src", "")
        for script in document.select('script[type="module"]')
    ]
    assert any(
        "js/auth/reset_password_validation.js" in src for src in module_scripts
    ), "reset-password matching validation must load from its ES module"

    inline_scripts = [
        script for script in document.find_all("script") if not script.get("src")
    ]
    assert inline_scripts == [], (
        "reset-password must not keep executable inline script blocks"
    )


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
