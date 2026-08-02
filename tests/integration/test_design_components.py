"""Semantic contract tests for the button and field component macros.

These tests render the Jinja macros directly through the application's Jinja
environment and assert the exact markup contract documented in the Task 2
brief: stable class names, connected descriptions and errors, preserved
accessible names, and no Tailwind palette utility leakage. They also pin the
generated-CSS contract for the component primitives so the Tailwind Forms
plugin cannot leak its hard-coded palette into the design system.
"""

import re
from pathlib import Path

from bs4 import BeautifulSoup
import pytest

GENERATED_CSS = Path(__file__).resolve().parents[2] / "static" / "css" / "style.css"


def _template_module(app, template_name):
    with app.test_request_context():
        return app.jinja_env.get_template(template_name).module


def render_component(app, name, **kwargs):
    module = _template_module(app, "components/button.html")
    return str(getattr(module, name)(**kwargs))


def render_field(app, macro="field", **kwargs):
    module = _template_module(app, "components/field.html")
    return str(getattr(module, macro)(**kwargs))


def _css_declarations_for(css, selector_prefix):
    """Concatenate declaration blocks whose selector starts with the prefix.

    Selectors are normalized by stripping quotes because the minified build
    drops quotes around attribute-selector values.
    """
    prefix = selector_prefix.replace('"', "")
    blocks = []
    for match in re.finditer(r"([^{}]+)\{([^{}]*)\}", css):
        selector = match.group(1).replace('"', "") + "{"
        if selector.startswith(prefix):
            blocks.append(match.group(2))
    return ";".join(blocks)


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


@pytest.mark.parametrize("variant", ["ghost", "outline", "link", "PRIMARY", ""])
def test_button_normalizes_unsupported_variants_to_primary(app, variant):
    html = render_component(app, "button", label="Continue", variant=variant)
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("button.c-button")
    assert control is not None
    assert control["class"] == ["c-button", "c-button--primary"]


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


def test_disabled_link_button_has_no_actionable_href(app):
    html = render_component(
        app, "button", label="View plan", href="/plan", disabled=True
    )
    soup = BeautifulSoup(html, "html.parser")
    link = soup.select_one("a.c-button")
    assert link is not None
    assert not link.has_attr("href")
    assert link["aria-disabled"] == "true"
    assert link["tabindex"] == "-1"
    assert link.get_text(strip=True) == "View plan"


def test_disabled_link_button_keeps_link_role(app):
    html = render_component(
        app, "button", label="View plan", href="/plan", disabled=True
    )
    soup = BeautifulSoup(html, "html.parser")
    link = soup.select_one("a.c-button")
    assert link is not None
    assert not link.has_attr("href")
    assert link["role"] == "link"
    assert link["aria-disabled"] == "true"
    assert link["tabindex"] == "-1"


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


def test_loading_link_button_keeps_link_role(app):
    html = render_component(
        app, "button", label="Saving changes", href="/save", loading=True
    )
    soup = BeautifulSoup(html, "html.parser")
    link = soup.select_one("a.c-button.is-loading")
    assert link is not None
    assert not link.has_attr("href")
    assert link["role"] == "link"
    assert link["aria-disabled"] == "true"
    assert link["tabindex"] == "-1"
    assert link["aria-busy"] == "true"


def test_loading_link_button_is_inert_and_announces_live_state(app):
    html = render_component(
        app, "button", label="Saving changes", href="/save", loading=True
    )
    soup = BeautifulSoup(html, "html.parser")
    link = soup.select_one("a.c-button.is-loading")
    assert link is not None
    assert not link.has_attr("href")
    assert link["aria-disabled"] == "true"
    assert link["tabindex"] == "-1"
    assert link["aria-busy"] == "true"
    assert link.select_one(".c-button__spinner[aria-hidden='true']") is not None
    assert "Saving changes" in link.get_text()
    live = link.select_one('[role="status"]')
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


def test_field_positional_signature_places_disabled_after_min_max_step(app):
    module = _template_module(app, "components/field.html")
    html = str(
        module.field(
            "daily_limit",
            "Daily limit",
            "number",
            "6",
            None,
            None,
            None,
            None,
            False,
            1,
            20,
            "0.5",
            True,
        )
    )
    soup = BeautifulSoup(html, "html.parser")
    control = soup.select_one("input#daily_limit")
    assert control is not None
    assert control["min"] == "1"
    assert control["max"] == "20"
    assert control["step"] == "0.5"
    assert control.has_attr("disabled")


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


def test_optional_select_placeholder_is_clearable(app):
    html = render_field(
        app,
        macro="select_field",
        name="pace",
        label="Reduction pace",
        options=[("slow", "Slow"), ("steady", "Steady")],
        placeholder="No preference",
    )
    soup = BeautifulSoup(html, "html.parser")
    placeholder = soup.select_one('select#pace option[value=""]')
    assert placeholder is not None
    assert placeholder.get_text(strip=True) == "No preference"
    assert not placeholder.has_attr("disabled")


def test_required_select_placeholder_is_disabled(app):
    html = render_field(
        app,
        macro="select_field",
        name="pace",
        label="Reduction pace",
        options=[("slow", "Slow"), ("steady", "Steady")],
        placeholder="Choose a pace",
        required=True,
    )
    soup = BeautifulSoup(html, "html.parser")
    placeholder = soup.select_one('select#pace option[value=""]')
    assert placeholder is not None
    assert placeholder.has_attr("disabled")


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
    assert row.name == "label"
    control = row.select_one('input#data_sharing[type="checkbox"]')
    assert control is not None
    assert control.has_attr("checked")
    label = row.select_one(".c-field__check-label")
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


def test_checkbox_row_is_a_single_label_hit_target(app):
    html = render_field(
        app,
        macro="checkbox_field",
        name="coaching",
        label="Weekly coaching emails",
        description="One email per week, unsubscribe anytime.",
        error="Choose whether to receive coaching emails.",
    )
    soup = BeautifulSoup(html, "html.parser")
    row = soup.select_one(".c-field__check")
    assert row is not None
    assert row.name == "label"
    control = row.select_one('input#coaching[type="checkbox"]')
    assert control is not None
    text = row.select_one(".c-field__check-label")
    assert text is not None
    assert "Weekly coaching emails" in text.get_text()
    assert control["aria-describedby"] == "coaching-description coaching-error"
    assert control["aria-invalid"] == "true"
    assert soup.select_one("#coaching-description") is not None
    error = soup.select_one("#coaching-error")
    assert error is not None
    assert error.get("role") == "alert"


def test_checkbox_input_css_uses_tokens_not_plugin_palette():
    css = GENERATED_CSS.read_text()
    base = _css_declarations_for(css, ".c-field__check-input{")
    assert "appearance:auto" in base
    assert "accent-color:var(--color-constructive)" in base
    assert "background-color:var(--color-surface)" in base
    assert "border:1px solid var(--color-border-strong)" in base

    checked = _css_declarations_for(css, ".c-field__check-input:checked")
    assert "var(--color-constructive)" in checked

    focus = _css_declarations_for(css, ".c-field__check-input:focus{")
    assert "box-shadow:none" in focus

    focus_visible = _css_declarations_for(css, ".c-field__check-input:focus-visible")
    assert "outline:.1875rem solid var(--color-focus)" in focus_visible

    all_check_rules = _css_declarations_for(css, ".c-field__check-input")
    assert "oklch" not in all_check_rules
    assert "#fff" not in all_check_rules
    assert "#0000" not in all_check_rules


def test_button_css_interaction_guards_cover_anchors():
    css = GENERATED_CSS.read_text().replace('"', "")
    aria_disabled = _css_declarations_for(css, ".c-button[aria-disabled=true]{")
    assert "pointer-events:none" not in aria_disabled
    all_button_rules = _css_declarations_for(css, ".c-button")
    assert "pointer-events:none" not in all_button_rules
    assert ".c-button:active:not(:disabled):not([aria-disabled=true])" in css
    assert ".c-button:not(:disabled):not([aria-disabled=true]):hover" in css


def test_checkbox_row_cursor_follows_input_disabled_state():
    css = GENERATED_CSS.read_text().replace('"', "")
    row = _css_declarations_for(css, ".c-field__check{")
    assert "cursor:pointer" in row
    disabled_row = _css_declarations_for(
        css, ".c-field__check:has(.c-field__check-input:disabled){"
    )
    assert "cursor:not-allowed" in disabled_row
