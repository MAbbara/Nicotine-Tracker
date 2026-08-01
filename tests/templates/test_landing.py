"""Rendered contract for the public landing trust surface."""

from bs4 import BeautifulSoup


def test_public_landing_uses_supported_product_language_and_actions(client):
    response = client.get('/')
    html = response.get_data(as_text=True)
    soup = BeautifulSoup(html, 'html.parser')

    assert response.status_code == 200
    assert len(soup.find_all('h1')) == 1
    assert soup.find('a', href='/auth/register') is not None
    assert soup.find('a', href='/auth/login') is not None

    for capability in (
        'Log quickly',
        'Respond to cravings',
        'Follow your plan',
        'Understand patterns',
    ):
        assert capability in html

    for forbidden in (
        'Join thousands', '📊', '🎯', '📱', '📈',
        'indigo', 'bg-gradient', 'from-[#', 'to-[#',
    ):
        assert forbidden not in html
