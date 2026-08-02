"""Editorial Statistics page contracts."""

from pathlib import Path

from bs4 import BeautifulSoup


PROJECT_ROOT = Path(__file__).resolve().parents[2]


def test_statistics_is_an_editorial_fact_list_with_insights_handoff(
        logged_in_client):
    response = logged_in_client.get('/settings/statistics')
    assert response.status_code == 200
    document = BeautifulSoup(response.data, 'html.parser')

    assert document.select_one('main h1').get_text(' ', strip=True) == 'Statistics'
    assert [heading.get_text(' ', strip=True) for heading in document.select(
        '.statistics-section h2'
    )] == ['Account record', 'Recent activity']

    account_facts = document.select_one('dl.statistics-facts')
    assert [term.get_text(' ', strip=True) for term in account_facts.select('dt')] == [
        'Total logs', 'Total pouches', 'Recorded nicotine', 'Daily average',
        'Most used product', 'Account age',
    ]
    recent = document.select_one('dl.statistics-periods')
    assert [term.get_text(' ', strip=True) for term in recent.select('dt')] == [
        'Logs · 7 days', 'Pouches · 7 days', 'Logs · 30 days',
        'Pouches · 30 days',
    ]
    completeness = document.select_one('.statistics-completeness')
    assert completeness is not None
    assert 'strength' in completeness.get_text(' ', strip=True).casefold()

    insights = document.select_one('a.c-button[href="/insights/"]')
    assert insights is not None
    assert insights.get_text(' ', strip=True) == 'Explore patterns in Insights'


def test_statistics_template_retires_dashboard_card_grid_and_palette():
    source = (PROJECT_ROOT / 'templates/settings/statistics.html').read_text().casefold()
    for token in (
        'grid-cols-', 'bg-indigo-', 'text-indigo-', 'ring-indigo-',
        'bg-violet-', 'bg-purple-', 'bg-blue-', 'bg-gray-', 'dark:bg-gray-',
        'shadow rounded-lg',
    ):
        assert token not in source
