"""Rendered-page contracts for resilient, route-scoped analytics."""

from datetime import date, datetime, timedelta, timezone

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
    logged_at = (datetime.now(timezone.utc) - timedelta(days=1)).replace(
        hour=10, minute=0, second=0, microsecond=0
    )
    log = Log(
        user_id=test_user.id,
        quantity=13,
        log_time=logged_at,
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
    trend_rows = [
        [cell.get_text(strip=True) for cell in row.select("th, td")]
        for row in trend.select("tbody tr")
    ]
    assert [logged_at.date().isoformat(), "13"] in trend_rows
    assert trend.select_one("table caption").get_text(" ", strip=True) == "Consumption trend data"
    heatmap = soup.select_one("[role='region'][aria-label='Consumption heatmap data'] table")
    assert [cell.get_text(strip=True) for cell in heatmap.select("thead th")] == [
        "Day", *(f"{hour:02d}:00" for hour in range(24))
    ]
    weekday_row = next(
        row for row in heatmap.select("tbody tr")
        if row.select_one("th").get_text(strip=True) == logged_at.strftime("%A")
    )
    hourly_values = [cell.get_text(strip=True) for cell in weekday_row.select("td")]
    assert hourly_values[10] == "13"
    assert sum(map(int, hourly_values)) == 13


def test_dashboard_renders_local_enhancement_and_semantic_values(
        logged_in_client, db_session, test_user, test_pouch):
    logged_at = (datetime.now(timezone.utc) - timedelta(days=1)).replace(
        hour=11, minute=0, second=0, microsecond=0
    )
    log = Log(
        user_id=test_user.id,
        quantity=17,
        log_time=logged_at,
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
    trend_rows = [
        [cell.get_text(strip=True) for cell in row.select("th, td")]
        for row in trend.select("tbody tr")
    ]
    assert [logged_at.date().isoformat(), "17", "68.0"] in trend_rows
    hourly_rows = [
        [cell.get_text(strip=True) for cell in row.select("th, td")]
        for row in hourly.select("tbody tr")
    ]
    assert ["11:00", "17"] in hourly_rows
    assert trend.select_one("table caption").get_text(" ", strip=True) == "Consumption trend data"


def test_today_remains_free_of_analytics_assets(logged_in_client):
    soup = _soup(logged_in_client.get("/today/"))
    urls = " ".join(_asset_urls(soup)).casefold()

    assert "apexcharts" not in urls
    assert "dashboard-charts" not in urls
    assert "/static/js/insights.js" not in urls


def test_dashboard_analytics_apis_honor_exact_historical_boundaries(
        logged_in_client, db_session, test_user, test_pouch):
    start = date.today() - timedelta(days=20)
    end = start + timedelta(days=2)
    for day, hour, quantity in ((start, 10, 9), (end, 15, 4)):
        log = Log(
            user_id=test_user.id,
            quantity=quantity,
            log_time=datetime.combine(day, datetime.min.time()).replace(hour=hour),
        )
        log_service.assign_log_product(log, pouch_id=test_pouch.id)
        db_session.add(log)
    db_session.commit()

    query = f"start_date={start.isoformat()}&end_date={end.isoformat()}"
    trend_response = logged_in_client.get(f"/dashboard/api/daily_intake_chart?{query}")
    hourly_response = logged_in_client.get(f"/dashboard/api/hourly_distribution?{query}")

    assert trend_response.status_code == 200
    assert hourly_response.status_code == 200
    trend = trend_response.get_json()["data"]
    assert [row["date"] for row in trend] == [
        start.isoformat(),
        (start + timedelta(days=1)).isoformat(),
        end.isoformat(),
    ]
    assert [row["pouches"] for row in trend] == [9, 0, 4]
    hourly = hourly_response.get_json()["data"]
    assert hourly[10] == {"hour": "10:00", "pouches": 9}
    assert hourly[15] == {"hour": "15:00", "pouches": 4}
    assert sum(row["pouches"] for row in hourly) == 13


def test_dashboard_analytics_apis_reject_invalid_custom_boundaries(logged_in_client):
    for path in ("daily_intake_chart", "hourly_distribution"):
        missing = logged_in_client.get(
            f"/dashboard/api/{path}?start_date=2026-01-01"
        )
        reversed_range = logged_in_client.get(
            f"/dashboard/api/{path}?start_date=2026-01-03&end_date=2026-01-01"
        )
        malformed = logged_in_client.get(
            f"/dashboard/api/{path}?start_date=not-a-date&end_date=2026-01-03"
        )

        assert missing.status_code == 400
        assert reversed_range.status_code == 400
        assert malformed.status_code == 400
        assert reversed_range.get_json() == {
            "success": False,
            "error": "Start date must be on or before end date.",
        }
