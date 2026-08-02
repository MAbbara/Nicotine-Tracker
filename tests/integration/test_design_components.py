"""Semantic contract tests for the button and field component macros.

These tests render the Jinja macros directly through the application's Jinja
environment and assert the exact markup contract documented in the Task 2
brief: stable class names, connected descriptions and errors, preserved
accessible names, and no Tailwind palette utility leakage.
"""

from bs4 import BeautifulSoup
import pytest


def _template_module(app, template_name):
    with app.test_request_context():
        return app.jinja_env.get_template(template_name).module


def render_component(app, name, **kwargs):
    module = _template_module(app, "components/button.html")
    return str(getattr(module, name)(**kwargs))


def render_field(app, macro="field", **kwargs):
    module = _template_module(app, "components/field.html")
    return str(getattr(module, macro)(**kwargs))


def test_button_variants_have_stable_semantics(app):
    html = render_component(
        app, "button", label="Delete", variant="danger", type="submit"
    )
    assert 'class="c-button c-button--danger"' in html
    assert 'type="submit"' in html
    assert "bg-indigo-" not in html
    assert "daisy" not in html.lower()


@pytest.mark.parametrize("variant", ["primary", "secondary", "quiet", "danger"])
def test_button_supports_exactly_the_documented_variants(app, variant):
    html = render_component(app, "button", label="Continue", variant=variant)
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("button.c-button")
    assert control is not None
    assert control["class"] == ["c-button", f"c-button--{variant}"]


def test_button_renders_anchor_when_href_is_given(app):
    html = render_component(
        app, "button", label="View plan", href="/plan", variant="secondary"
    )
    soup = BeautifulSoup(html, "html.parser")
    link = soup.select_one("a.c-button.c-button--secondary")
    assert link is not None
    assert link["href"] == "/plan"
    assert link.get_text(strip=True) == "View plan"


def test_disabled_button_is_inert_and_announced(app):
    html = render_component(app, "button", label="Save", disabled=True)
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("button.c-button")
    assert control is not None
    assert control.has_attr("disabled")
    assert control["aria-disabled"] == "true"
    assert control.get_text(strip=True) == "Save"


def test_loading_button_keeps_accessible_name_and_announces_live_state(app):
    html = render_component(app, "button", label="Saving changes", loading=True)
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("button.c-button")
    assert control is not None
    assert control.has_attr("disabled")
    assert control["aria-disabled"] == "true"
    assert control["aria-busy"] == "true"
    assert "Saving changes" in control.get_text()
    live = control.select_one('[aria-live="polite"], [role="status"]')
    assert live is not None
    assert live.get_text(strip=True)


def test_field_connects_description_and_error(app):
    html = render_field(
        app,
        name="pouches_per_day",
        label="Pouches per day",
        type="number",
        value="8",
        description="Count every pouch, even partial ones.",
        error="Enter a whole number of pouches.",
        required=True,
    )
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("input#pouches_per_day")
    assert control is not None
    assert control["aria-describedby"] == (
        "pouches_per_day-description pouches_per_day-error"
    )
    assert control["aria-invalid"] == "true"
    assert control["required"] is not None
    assert control["value"] == "8"
    assert soup.select_one("#pouches_per_day-description") is not None
    error = soup.select_one("#pouches_per_day-error")
    assert error is not None
    assert error.get("role") == "alert"
    label = soup.select_one('label[for="pouches_per_day"]')
    assert label is not None


def test_select_field_connects_descriptions_and_errors(app):
    html = render_field(
        app,
        macro="select_field",
        name="gender",
        label="Gender",
        options=[("female", "Female"), ("male", "Male"), ("other", "Other")],
        value="male",
        description="Optional",
        error="Choose a supported value",
    )
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("select#gender")
    assert control is not None
    assert control["aria-describedby"] == "gender-description gender-error"
    assert control["aria-invalid"] == "true"
    assert soup.select_one('label[for="gender"]') is not None
    options = control.select("option")
    pairs = [(o["value"], o.get_text(strip=True)) for o in options]
    assert pairs == [
        ("female", "Female"),
        ("male", "Male"),
        ("other", "Other"),
    ]
    assert control.select_one('option[value="male"]').has_attr("selected")


def test_select_field_supports_required_disabled_and_autocomplete(app):
    html = render_field(
        app,
        macro="select_field",
        name="country",
        label="Country",
        options=[("sa", "Saudi Arabia")],
        required=True,
        disabled=True,
        autocomplete="country",
    )
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("select#country")
    assert control.has_attr("required")
    assert control.has_attr("disabled")
    assert control["autocomplete"] == "country"


def test_textarea_field_carries_server_value_and_states(app):
    html = render_field(
        app,
        macro="textarea_field",
        name="quit_reason",
        label="Why are you cutting back?",
        value="For my kids",
        description="Private to you.",
        error="Keep it under 500 characters.",
        required=True,
        rows=5,
    )
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("textarea#quit_reason")
    assert control is not None
    assert control.get_text() == "For my kids"
    assert control["aria-describedby"] == "quit_reason-description quit_reason-error"
    assert control["aria-invalid"] == "true"
    assert control.has_attr("required")
    assert control["rows"] == "5"
    assert soup.select_one('label[for="quit_reason"]') is not None


def test_checkbox_field_keeps_native_input_and_label_in_one_row(app):
    html = render_field(
        app,
        macro="checkbox_field",
        name="data_sharing",
        label="Share anonymized usage data",
        checked=True,
        description="Helps us improve pacing suggestions.",
    )
    soup = BeautifulSoup(html, "html.parser")
    row = soup.select_one(".c-field__check")
    assert row is not None
    control = row.select_one('input#data_sharing[type="checkbox"]')
    assert control is not None
    assert control.has_attr("checked")
    label = row.select_one('label[for="data_sharing"]')
    assert label is not None
    assert "Share anonymized usage data" in label.get_text()
    description = soup.select_one("#data_sharing-description")
    assert description is not None
    assert control["aria-describedby"] == "data_sharing-description"


def test_checkbox_field_unchecked_has_no_checked_attribute(app):
    html = render_field(
        app, macro="checkbox_field", name="reminders", label="Daily reminders"
    )
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one('input#reminders[type="checkbox"]')
    assert control is not None
    assert not control.has_attr("checked")
