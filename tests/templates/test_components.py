"""Semantic rendering contracts for the shared Jinja component library."""

from bs4 import BeautifulSoup


def _render(app, imports, expression, **context):
    with app.test_request_context('/'):
        template = app.jinja_env.from_string(imports + expression)
        return BeautifulSoup(template.render(**context), 'html.parser')


def test_button_renders_one_native_interactive_element(app):
    imports = '{% from "components/button.html" import button %}'
    link = _render(
        app, imports,
        '{{ button("View journey", href="/journey/", variant="secondary") }}',
    )
    assert link.find('a')['href'] == '/journey/'
    assert link.find('button') is None
    assert 'c-button--secondary' in link.find('a')['class']

    native = _render(
        app, imports,
        '{{ button("Save changes", type="submit", variant="primary") }}',
    )
    assert native.find('button')['type'] == 'submit'
    assert native.find('a') is None


def test_field_connects_label_help_and_error(app):
    soup = _render(
        app,
        '{% from "components/field.html" import field %}',
        '{{ field("email", "Email address", type="email", '
        'description="Used for account recovery.", '
        'error="Enter an email address with an @ symbol.") }}',
    )
    field = soup.find('input')
    assert soup.find('label')['for'] == field['id'] == 'email'
    described_by = field['aria-describedby'].split()
    assert described_by == ['email-description', 'email-error']
    assert soup.find(id='email-description') is not None
    assert soup.find(id='email-error')['role'] == 'alert'
    assert field['aria-invalid'] == 'true'


def test_status_and_alert_include_visible_non_color_text(app):
    status = _render(
        app,
        '{% from "components/status.html" import status %}',
        '{{ status("On pace", tone="constructive") }}',
    )
    assert status.get_text(' ', strip=True) == 'On pace'
    assert 'c-status--constructive' in status.find()['class']

    alert = _render(
        app,
        '{% from "components/alert.html" import alert %}',
        '{{ alert("Strength missing", "Add the strength when you know it.", '
        'tone="attention") }}',
    )
    assert alert.find(role='status') is not None
    assert 'Strength missing' in alert.get_text(' ', strip=True)


def test_sheet_uses_native_dialog_and_labelled_title(app):
    soup = _render(
        app,
        '{% from "components/sheet.html" import sheet %}',
        '{% call sheet("quick-log", "Log nicotine") %}'
        '<p>Choose a pouch.</p>'
        '{% endcall %}',
    )
    dialog = soup.find('dialog')
    assert dialog['id'] == 'quick-log'
    assert dialog['aria-labelledby'] == 'quick-log-title'
    assert soup.find(id='quick-log-title').get_text(strip=True) == 'Log nicotine'


def test_empty_state_teaches_and_offers_one_action(app):
    soup = _render(
        app,
        '{% from "components/empty_state.html" import empty_state %}',
        '{{ empty_state("No plan yet", '
        '"Create a gentle starting point you can adjust anytime.", '
        'action_label="Create a plan", action_href="/journey/start") }}',
    )
    assert soup.find('h2').get_text(strip=True) == 'No plan yet'
    assert soup.find('a').get_text(' ', strip=True) == 'Create a plan'
    assert 'adjust anytime' in soup.get_text(' ', strip=True)


def test_timeline_uses_ordered_list_and_visible_status(app):
    items = [
        {'title': 'Started', 'detail': 'Baseline recorded', 'status': 'Complete'},
        {'title': 'This week', 'detail': 'Aim for eight or fewer', 'status': 'Current'},
    ]
    soup = _render(
        app,
        '{% from "components/timeline.html" import timeline %}',
        '{{ timeline(items) }}',
        items=items,
    )
    assert soup.find('ol') is not None
    assert len(soup.find_all('li')) == 2
    assert 'Current' in soup.get_text(' ', strip=True)


def test_chart_frame_always_renders_written_interpretation(app):
    soup = _render(
        app,
        '{% from "components/chart.html" import chart_frame %}',
        '{% call chart_frame("weekly-use", "Weekly use", '
        '"Your average is two pouches lower than last week.") %}'
        '<div data-chart></div>'
        '{% endcall %}',
    )
    figure = soup.find('figure')
    assert figure['aria-labelledby'] == 'weekly-use-title'
    assert figure['aria-describedby'] == 'weekly-use-summary'
    assert soup.find(id='weekly-use-summary').get_text(strip=True).startswith(
        'Your average'
    )
