"""Account and security settings contracts."""

from pathlib import Path

from bs4 import BeautifulSoup


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_account_uses_ordered_independent_security_forms(logged_in_client):
    response = logged_in_client.get("/settings/account")
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, "html.parser")

    assert soup.select_one("main h1").get_text(" ", strip=True) == "Account"
    assert [heading.get_text(" ", strip=True) for heading in soup.select(".account-section h2")] == [
        "Email", "Password", "Account access", "Delete account",
    ]
    forms = {
        form.select_one('input[name="action"]')["value"]: form
        for form in soup.select('form[action="/settings/account"][method="POST"]')
    }
    assert {"update_email", "change_password", "delete_account"} <= forms.keys()
    assert all(form.select_one('input[name="csrf_token"]') for form in forms.values())

    assert forms["update_email"].select_one('input[name="new_email"][type="email"][required]')
    assert forms["update_email"].select_one('input[name="password"][type="password"][required]')
    assert forms["change_password"].select_one('input[name="current_password"][type="password"][required]')
    assert forms["change_password"].select_one('input[name="new_password"][minlength="6"][required]')
    assert forms["change_password"].select_one('input[name="confirm_password"][type="password"][required]')
    assert forms["delete_account"].select_one('input[name="password"][type="password"][required]')
    assert forms["delete_account"].select_one('input[name="confirmation"][required]')

    danger_buttons = soup.select("button.c-button--danger")
    assert len(danger_buttons) == 1
    assert danger_buttons[0] in forms["delete_account"].descendants
    assert not soup.select("form:not(:has(input[value='delete_account'])) .c-button--danger")
    deletion_copy = forms["delete_account"].get_text(" ", strip=True).casefold()
    assert "permanent" in deletion_copy
    assert "cannot be recovered" in deletion_copy
    assert "delete my account" in deletion_copy


def test_account_validation_keeps_user_and_feedback(logged_in_client, test_user):
    original_email = test_user.email
    response = logged_in_client.post("/settings/account", data={
        "action": "update_email",
        "new_email": "changed@example.com",
        "password": "wrong-password",
    })
    assert response.status_code == 200
    assert b"Current password is incorrect." in response.data
    assert test_user.email == original_email


def test_account_template_retires_legacy_cards_and_palette():
    source = (PROJECT_ROOT / "templates/settings/account.html").read_text()
    for token in (
        "bg-indigo-", "text-indigo-", "ring-indigo-", "bg-gray-", "dark:bg-gray-",
        "shadow rounded-lg",
    ):
        assert token not in source
