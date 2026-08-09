"""Preferences settings form and persistence contracts."""

from datetime import time
from decimal import Decimal
from pathlib import Path

from bs4 import BeautifulSoup

from models import Pouch, UserPreferences


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _seed_preferences(db_session, test_user):
    preferences = UserPreferences(
        user_id=test_user.id,
        units_preference="percentage",
        daily_reset_time=time(4, 30),
        preferred_brands=["Quiet Mint"],
    )
    db_session.add_all([
        preferences,
        Pouch(
            brand="Quiet Mint",
            nicotine_mg=Decimal("6.00"),
            is_default=False,
            created_by=test_user.id,
        ),
        Pouch(
            brand="Cedar Citrus",
            nicotine_mg=Decimal("4.00"),
            is_default=True,
        ),
    ])
    test_user.timezone = "Asia/Riyadh"
    db_session.commit()
    return preferences


def test_preferences_uses_native_described_controls_and_selected_values(
        logged_in_client, db_session, test_user):
    _seed_preferences(db_session, test_user)

    response = logged_in_client.get("/settings/preferences")
    assert response.status_code == 200
    soup = BeautifulSoup(response.data, "html.parser")

    assert soup.select_one("main h1").get_text(" ", strip=True) == "Preferences"
    assert soup.select_one(".preferences-section .eyebrow").get_text(
        " ", strip=True
    ) == "Your routine"
    assert [heading.get_text(" ", strip=True) for heading in soup.select(
        ".preferences-section h2"
    )] == ["Display and units", "Day boundary", "Preferred products"]

    form = soup.select_one('form[action="/settings/preferences"][method="POST"]')
    assert form is not None
    assert form.select_one('input[name="csrf_token"][type="hidden"]')

    units = form.select_one('select.c-field__control[name="units_preference"]')
    assert units is not None
    assert [option.get("value") for option in units.select("option")] == [
        "mg", "percentage",
    ]
    assert units.select_one('option[value="percentage"][selected]')
    assert "units_preference-description" in units.get("aria-describedby", "")

    timezone = form.select_one('select.c-field__control[name="timezone"]')
    assert timezone is not None
    assert "hidden" not in timezone.get("class", [])
    assert timezone.select_one('option[value="Asia/Riyadh"][selected]')
    assert "timezone-description" in timezone.get("aria-describedby", "")

    reset = form.select_one('input.c-field__control[name="daily_reset_time"]')
    assert reset is not None
    assert (reset.get("type"), reset.get("value")) == ("time", "04:30")
    assert "daily_reset_time-description" in reset.get("aria-describedby", "")

    fieldset = form.select_one("fieldset.preferences-brand-group")
    assert fieldset is not None
    assert fieldset.select_one("legend").get_text(" ", strip=True) == (
        "Preferred products"
    )
    checkboxes = fieldset.select('input[type="checkbox"][name="preferred_brands"]')
    assert {checkbox.get("value") for checkbox in checkboxes} == {
        "Quiet Mint", "Cedar Citrus",
    }
    selected = fieldset.select_one(
        'input[name="preferred_brands"][value="Quiet Mint"][checked]'
    )
    assert selected is not None
    assert "preferred-brands-description" in selected.get("aria-describedby", "")
    assert form.select_one(
        '.settings-save-row button.c-button.c-button--primary[type="submit"]'
    ).get_text(" ", strip=True) == "Save preferences"


def test_preferences_post_preserves_all_mutations(
        logged_in_client, db_session, test_user, test_pouch):
    second_pouch = Pouch(
        brand="Second Test Brand",
        nicotine_mg=Decimal("8.00"),
        is_default=False,
        created_by=test_user.id,
    )
    db_session.add(second_pouch)
    db_session.commit()
    response = logged_in_client.post("/settings/preferences", data={
        "units_preference": "percentage",
        "timezone": "Asia/Riyadh",
        "daily_reset_time": "04:30",
        "preferred_brands": ["Test Brand", "Second Test Brand"],
    })

    assert response.status_code == 302
    assert response.headers["Location"].endswith("/settings/preferences")
    preferences = UserPreferences.query.filter_by(user_id=test_user.id).one()
    db_session.refresh(test_user)
    assert preferences.units_preference == "percentage"
    assert preferences.daily_reset_time == time(4, 30)
    assert preferences.preferred_brands == ["Test Brand", "Second Test Brand"]
    assert test_user.timezone == "Asia/Riyadh"

    persisted = logged_in_client.get("/settings/preferences")
    soup = BeautifulSoup(persisted.data, "html.parser")
    assert soup.select_one(
        'select[name="units_preference"] option[value="percentage"][selected]'
    )
    assert soup.select_one(
        'select[name="timezone"] option[value="Asia/Riyadh"][selected]'
    )
    assert soup.select_one('input[name="daily_reset_time"][value="04:30"]')
    assert soup.select_one(
        'input[name="preferred_brands"][value="Test Brand"][checked]'
    )
    assert soup.select_one(
        'input[name="preferred_brands"][value="Second Test Brand"][checked]'
    )

    cleared = logged_in_client.post("/settings/preferences", data={
        "units_preference": "percentage",
        "timezone": "Asia/Riyadh",
        "daily_reset_time": "04:30",
    })
    assert cleared.status_code == 302
    db_session.refresh(preferences)
    assert preferences.preferred_brands == []
    cleared_page = BeautifulSoup(
        logged_in_client.get("/settings/preferences").data,
        "html.parser",
    )
    assert not cleared_page.select('input[name="preferred_brands"][checked]')


def test_preferences_template_retires_preline_and_legacy_palette():
    source = (PROJECT_ROOT / "templates/settings/preferences.html").read_text()
    lowered = source.casefold()
    for token in (
        "data-hs-", "hs-select", "bg-indigo-", "text-indigo-", "ring-indigo-",
        "bg-violet-", "bg-purple-", "bg-blue-", "bg-gray-", "dark:bg-gray-",
        "shadow rounded-lg",
    ):
        assert token not in lowered


def test_preferences_reject_invalid_boundary_and_unowned_brand_atomically(
        logged_in_client, db_session, test_user, test_pouch):
    preferences = UserPreferences(
        user_id=test_user.id, units_preference='mg',
        daily_reset_time=time(1, 0), preferred_brands=['Test Brand'],
    )
    test_user.timezone = 'UTC'
    db_session.add(preferences)
    db_session.commit()
    response = logged_in_client.post('/settings/preferences', data={
        'units_preference': 'percentage',
        'timezone': 'Not/A_Zone',
        'daily_reset_time': '25:00',
        'preferred_brands': ['Unowned Brand'],
    })
    assert response.status_code == 422
    db_session.refresh(test_user)
    db_session.refresh(preferences)
    assert test_user.timezone == 'UTC'
    assert preferences.units_preference == 'mg'
    assert preferences.daily_reset_time == time(1, 0)
    assert preferences.preferred_brands == ['Test Brand']
    soup = BeautifulSoup(response.data, 'html.parser')
    assert soup.select_one('#timezone[aria-invalid="true"]')
    assert soup.select_one('#daily_reset_time[aria-invalid="true"]')
    assert soup.select_one('#preferred_brands-error')
    brand_group = soup.select_one('fieldset.preferences-brand-group')
    assert brand_group.get('aria-invalid') == 'true'
    assert set(brand_group.get('aria-describedby', '').split()) == {
        'preferred-brands-description', 'preferred-brands-error',
    }
    for checkbox in brand_group.select('input[name="preferred_brands"]'):
        assert set(checkbox.get('aria-describedby', '').split()) == {
            'preferred-brands-description', 'preferred-brands-error',
        }
