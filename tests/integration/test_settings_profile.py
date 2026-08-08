"""Profile's privacy-first editorial form contract."""

from pathlib import Path

from bs4 import BeautifulSoup


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_profile_uses_optional_private_shared_fields(
        logged_in_client, db_session, test_user):
    test_user.age = 34
    test_user.gender = "prefer_not_to_say"
    test_user.weight = 78.5
    db_session.commit()

    response = logged_in_client.get("/settings/profile")
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, "html.parser")

    assert soup.select_one("main h1").get_text(" ", strip=True) == "Profile"
    assert soup.select_one(".profile-section .eyebrow").get_text(" ", strip=True) == "Your details"
    assert soup.select_one(".profile-section h2").get_text(" ", strip=True) == "About you"
    privacy_copy = soup.select_one(".profile-section__intro > p:last-child").get_text(" ", strip=True)
    assert "optional" in privacy_copy.casefold()
    assert "private" in privacy_copy.casefold()

    form = soup.select_one('form[action="/settings/profile"][method="POST"]')
    assert form is not None
    assert form.select_one('input[name="csrf_token"][type="hidden"]') is not None
    age = form.select_one('input.c-field__control[name="age"]')
    assert (age.get("type"), age.get("min"), age.get("max"), age.get("value")) == (
        "number", "18", "120", "34",
    )
    weight = form.select_one('input.c-field__control[name="weight"]')
    assert (weight.get("type"), weight.get("min"), weight.get("max"), weight.get("step")) == (
        "number", "30", "500", "0.1",
    )
    gender = form.select_one('select.c-field__control[name="gender"]')
    assert [option.get("value") for option in gender.select("option")] == [
        "", "male", "female", "other", "prefer_not_to_say",
    ]
    assert gender.select_one('option[value="prefer_not_to_say"][selected]') is not None
    assert form.select_one(".settings-save-row .c-button.c-button--primary") is not None


def test_profile_template_retires_legacy_card_and_palette_utilities():
    source = (PROJECT_ROOT / "templates/settings/profile.html").read_text()

    for token in (
        "bg-indigo-", "text-indigo-", "ring-indigo-", "bg-gray-", "dark:bg-gray-",
        "shadow rounded-lg",
    ):
        assert token not in source
    assert "field(" in source
    assert "select_field(" in source


def test_profile_rejects_malformed_and_nonfinite_scalars_without_partial_write(
        logged_in_client, db_session, test_user):
    test_user.age = 34
    test_user.weight = 78.5
    test_user.gender = 'female'
    db_session.commit()
    response = logged_in_client.post('/settings/profile', data={
        'age': '34.5', 'weight': 'NaN', 'gender': 'other',
    })
    assert response.status_code == 422
    db_session.refresh(test_user)
    assert (test_user.age, test_user.weight, test_user.gender) == (34, 78.5, 'female')
    soup = BeautifulSoup(response.data, 'html.parser')
    assert soup.select_one('#age[aria-invalid="true"]')['value'] == '34.5'
    assert soup.select_one('#weight[aria-invalid="true"]')['value'] == 'NaN'
