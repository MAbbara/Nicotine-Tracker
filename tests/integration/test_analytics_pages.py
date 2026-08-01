"""Rendered-page contracts for resilient, route-scoped analytics."""

from datetime import datetime, timedelta, timezone

from bs4 import BeautifulSoup

from models import Log
from services import log_service


def _soup(response):
    assert response.status_code == 200
    return BeautifulSoup(response.data, "html.parser")


def _asset_urls(soup):
    return [
        *(tag.get("href", "") for tag in soup.select("link[href]")),
        *(tag.get("src", "") for tag in soup.select("script[src]")),
    ]


def _assert_local_analytics_assets(soup, initializer):
    urls = _asset_urls(soup)
    apex_css = next(i for i, url in enumerate(urls) if url.endswith("/static/css/apexcharts.css"))
    apex_js = next(i for i, url in enumerate(urls) if url.endswith("/static/js/apexcharts.min.js"))
    init_js = next(i for i, url in enumerate(urls) if url.endswith(initializer))

    assert apex_css < apex_js < init_js
    analytics_urls = [url for url in urls if "apex" in url.casefold() or "chart" in url.casefold()]
    assert all(not url.startswith(("http://", "https://")) for url in analytics_urls)


def test_insights_renders_local_enhancement_and_semantic_values(
        logged_in_client, db_session, test_user, test_pouch):
    log = Log(
        user_id=test_user.id,
        quantity=3,
        log_time=datetime.now(timezone.utc) - timedelta(days=1),
    )
    log_service.assign_log_product(log, pouch_id=test_pouch.id)
    db_session.add(log)
    db_session.commit()

    soup = _soup(logged_in_client.get("/insights/"))

    _assert_local_analytics_assets(soup, "/static/js/insights.js")
    chart = soup.select_one("#consumption-trend-chart[role='img'][aria-labelledby]")
    assert chart is not None
    assert soup.select_one(f"#{chart['aria-labelledby']}").get_text(strip=True) == "Consumption Trend"
    trend = soup.select_one("[role='region'][aria-label='Consumption trend data']")
    assert trend is not None
    assert "3" in trend.get_text(" ", strip=True)
    assert trend.select_one("table caption").get_text(" ", strip=True) == "Consumption trend data"


def test_dashboard_renders_local_enhancement_and_semantic_values(
        logged_in_client, db_session, test_user, test_pouch):
    log = Log(
        user_id=test_user.id,
        quantity=2,
        log_time=datetime.now(timezone.utc) - timedelta(days=1),
    )
    log_service.assign_log_product(log, pouch_id=test_pouch.id)
    db_session.add(log)
    db_session.commit()

    soup = _soup(logged_in_client.get("/dashboard/"))

    _assert_local_analytics_assets(soup, "/static/js/dashboard-charts.js")
    chart = soup.select_one("#dailyIntakeChart[role='img'][aria-labelledby]")
    assert chart is not None
    assert soup.select_one(f"#{chart['aria-labelledby']}").get_text(strip=True) == "Daily Intake"
    trend = soup.select_one("[role='region'][aria-label='Consumption trend data']")
    hourly = soup.select_one("[role='region'][aria-label='Hourly distribution data']")
    assert trend is not None and hourly is not None
    assert "2" in trend.get_text(" ", strip=True)
    assert trend.select_one("table caption").get_text(" ", strip=True) == "Consumption trend data"


def test_today_remains_free_of_analytics_assets(logged_in_client):
    soup = _soup(logged_in_client.get("/today/"))
    urls = " ".join(_asset_urls(soup)).casefold()

    assert "apexcharts" not in urls
    assert "dashboard-charts" not in urls
    assert "/static/js/insights.js" not in urls
