"""Rendered-page contracts for resilient, route-scoped analytics."""

import json
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from bs4 import BeautifulSoup
import pytest

from models import Craving, Log, PlanDay, PlanRevision, ReductionPlan
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


def _seed_insights_logs(db_session, user, pouch, *, profile="ready"):
    selected = (datetime.now(timezone.utc) - timedelta(days=1)).date()
    dates = tuple(selected - timedelta(days=offset) for offset in (2, 1, 0))
    if profile == "empty":
        return dates
    entries = (
        ((dates[-1], 9, 1),)
        if profile == "sparse"
        else (
            (dates[0], 8, 2),
            (dates[0], 10, 3),
            (dates[1], 8, 3),
            (dates[1], 10, 4),
            (dates[2], 9, 3),
        )
    )
    for local_date, hour, quantity in entries:
        log = Log(
            user_id=user.id,
            quantity=quantity,
            log_time=datetime.combine(local_date, datetime.min.time()).replace(
                hour=hour,
            ),
            notes="private integration log note",
        )
        log_service.assign_log_product(log, pouch_id=pouch.id)
        db_session.add(log)
    return dates


def _seed_insights_plan(db_session, user, dates, *, state):
    if state == "none":
        return
    observe = state == "observe"
    paused = state == "paused"
    targeted = not observe
    target_dates = dates[:2] if state == "targeted_insufficient" else dates
    plan = ReductionPlan(
        user_id=user.id,
        mode="observe" if observe else "reduce",
        status="draft",
        start_date=dates[0],
        target_date=dates[-1],
        baseline_pouches=Decimal("8.00") if targeted else None,
        baseline_mg=Decimal("32.00") if targeted else None,
        baseline_mg_per_pouch=Decimal("4.00") if targeted else None,
        baseline_source="manual" if targeted else "observe",
        pace="steady" if targeted else None,
        end_target_pouches=6 if targeted else None,
        end_target_mg=Decimal("24.00") if targeted else None,
    )
    db_session.add(plan)
    db_session.flush()
    revision = PlanRevision(
        plan_id=plan.id,
        effective_date=dates[0],
        pace=plan.pace,
        target_date=plan.target_date,
        end_target_pouches=plan.end_target_pouches,
        end_target_mg=plan.end_target_mg,
        generation_inputs={},
        preview_digest=(str(plan.id) * 64)[:64],
        reason="initial",
        note="private integration plan note",
    )
    db_session.add(revision)
    db_session.flush()
    plan.active_revision_id = revision.id
    plan.status = "paused" if paused else "active"
    plan.active_slot = None if paused else 1
    for local_date in target_dates:
        db_session.add(PlanDay(
            plan_id=plan.id,
            revision_id=revision.id,
            local_date=local_date,
            target_pouches=6 if targeted else None,
            nicotine_ceiling_mg=Decimal("24.00") if targeted else None,
        ))


def _seed_insights_cravings(db_session, user, dates, *, available):
    rows = [
        (dates[0], 11, "Stress", "resisted"),
        (dates[1], 11, " stress ", "used_alternative"),
    ]
    if available:
        rows.extend([
            (dates[2], 7, "Work", "used_nicotine"),
            (dates[2], 8, "Stress", None),
        ])
    for local_date, hour, trigger, outcome in rows:
        db_session.add(Craving(
            user_id=user.id,
            craving_time=datetime.combine(
                local_date, datetime.min.time(),
            ).replace(hour=hour),
            intensity=6,
            trigger=trigger,
            outcome=outcome,
            notes="private integration craving note",
            situation_context="private integration situation context",
            outcome_notes="private integration outcome note",
        ))


def _seed_insights_context(
        db_session, user, pouch, *, profile="ready", plan_state="none",
        cravings=None):
    dates = _seed_insights_logs(
        db_session, user, pouch, profile=profile,
    )
    _seed_insights_plan(db_session, user, dates, state=plan_state)
    if cravings is not None:
        _seed_insights_cravings(
            db_session, user, dates, available=cravings == "available",
        )
    db_session.commit()


@pytest.mark.parametrize(
    "profile, plan_state, expected_label, expected_href, expected_state",
    [
        ("empty", "none", "Log today", "/today/", "empty"),
        ("sparse", "none", "Log today", "/today/", "sparse"),
        (
            "ready", "none", "Plan for Morning (6AM-12PM)",
            "/journey/", "ready",
        ),
        (
            "ready", "observe", "Review your observations",
            "/journey/", "ready",
        ),
        (
            "ready", "paused", "Review or resume your plan",
            "/journey/", "ready",
        ),
        (
            "ready", "targeted_insufficient",
            "Plan for Morning (6AM-12PM)", "/journey/", "ready",
        ),
    ],
)
def test_insights_fallback_next_step_matches_live_payload_contract(
        logged_in_client, db_session, test_user, test_pouch, profile,
        plan_state, expected_label, expected_href, expected_state):
    _seed_insights_context(
        db_session, test_user, test_pouch,
        profile=profile, plan_state=plan_state,
    )

    soup = _soup(logged_in_client.get("/insights/?days=7"))
    initial = json.loads(soup.select_one("#initial-insights-data").string)
    next_step = soup.select_one("[data-insights-next-step]")

    assert soup.select_one("[data-insights-root]")["data-insights-state"] == (
        expected_state
    )
    assert next_step.get_text(" ", strip=True) == expected_label
    assert next_step["href"] == expected_href
    if profile == "ready":
        assert initial["data_sufficiency"]["time_pattern"] is True
        assert initial["consumption_by_time_of_day"] == {
            "Afternoon (12PM-6PM)": 0,
            "Evening (6PM-12AM)": 0,
            "Morning (6AM-12PM)": 15,
            "Night (12AM-6AM)": 0,
        }
    period_copy = " ".join([
        soup.select_one("[data-insights-headline]").get_text(" ", strip=True),
        soup.select_one("[data-insights-interpretation]").get_text(" ", strip=True),
    ])
    assert "your plan" not in period_copy.casefold()
    if plan_state == "targeted_insufficient":
        assert initial["plan_context"]["compared_days"] == 2
        assert initial["plan_context"]["adherence_available"] is False
        assert "2 matched plan days" in soup.select_one(
            "[data-insights-plan-context]",
        ).get_text(" ", strip=True)
    else:
        assert soup.select_one("[data-insights-plan-context][hidden]") is not None


def test_insights_live_chain_renders_exact_plan_and_craving_facts_without_private_text(
        logged_in_client, db_session, test_user, test_pouch):
    _seed_insights_context(
        db_session, test_user, test_pouch,
        plan_state="targeted", cravings="available",
    )

    response = logged_in_client.get("/insights/?days=7")
    soup = _soup(response)

    plan_copy = soup.select_one("[data-insights-plan-context]")
    assert plan_copy is not None
    assert not plan_copy.has_attr("hidden")
    assert plan_copy.get_text(" ", strip=True) == (
        "Across 3 matched plan days, you logged 15 pouches against a target "
        "of 18. 2 of 3 days were on or below target."
    )
    craving = soup.select_one("[data-craving-pattern]")
    assert craving is not None
    assert not craving.has_attr("hidden")
    assert craving.select_one("[data-insights-craving-copy]").get_text(
        " ", strip=True
    ) == (
        "Stress appeared in 2 of 3 resolved cravings. You chose a "
        "non-nicotine response 66.7% of the time."
    )
    assert [item.get_text(" ", strip=True) for item in craving.select("dt")] == [
        "Leading trigger", "Pattern frequency", "Non-nicotine response",
    ]
    assert craving.select_one("[data-craving-leading-trigger]").get_text(
        strip=True
    ) == "Stress"
    assert craving.select_one("[data-craving-resolved-pattern]").get_text(
        strip=True
    ) == "2 of 3 resolved"
    assert craving.select_one("[data-craving-non-nicotine-rate]").get_text(
        strip=True
    ) == "66.7%"
    api_response = logged_in_client.get("/insights/api/insights?days=7")
    assert api_response.status_code == 200
    payload = api_response.get_json()
    assert payload["plan_context"] == {
        "state": "active_targeted",
        "adherence_available": True,
        "mode": "reduce",
        "status": "active",
        "compared_days": 3,
        "days_on_or_below_target": 2,
        "actual_pouches": 15,
        "target_pouches": 18,
        "difference_pouches": -3,
        "adherence_rate": 66.7,
    }
    assert payload["craving_pattern"]["leading_trigger"] == "Stress"
    assert payload["craving_pattern"]["non_nicotine_rate"] == 66.7
    private_values = (
        "private integration log note",
        "private integration plan note",
        "private integration craving note",
        "private integration situation context",
        "private integration outcome note",
    )
    serialized_payload = json.dumps(payload)
    rendered_html = response.get_data(as_text=True)
    assert all(value not in serialized_payload for value in private_values)
    assert all(value not in rendered_html for value in private_values)


def test_insights_live_chain_hides_insufficient_craving_evidence(
        logged_in_client, db_session, test_user, test_pouch):
    _seed_insights_context(
        db_session, test_user, test_pouch, cravings="insufficient",
    )

    soup = _soup(logged_in_client.get("/insights/?days=7"))

    assert soup.select_one("[data-craving-pattern][hidden]") is not None
    payload = logged_in_client.get(
        "/insights/api/insights?days=7",
    ).get_json()
    assert payload["craving_pattern"]["available"] is False
    assert payload["craving_pattern"]["resolved_count"] == 2


@pytest.mark.parametrize(
    "known_strength, state_copies",
    [
        (Decimal("0.00"), ("add up to 0 mg", "add up to 0 mg")),
        (Decimal("4.00"), ("accounts for 4 mg", "accounts for 4 mg")),
    ],
)
def test_insights_server_fallback_keeps_mixed_strength_coverage_explicit(
        logged_in_client, db_session, test_user, known_strength, state_copies):
    logged_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.add_all([
        Log(
            user_id=test_user.id,
            quantity=1,
            log_time=logged_at,
            product_brand_snapshot="Known snapshot",
            nicotine_mg_snapshot=known_strength,
        ),
        Log(
            user_id=test_user.id,
            quantity=2,
            log_time=logged_at + timedelta(minutes=1),
            product_brand_snapshot="Unknown strength",
            nicotine_mg_snapshot=None,
        ),
    ])
    db_session.commit()

    soup = _soup(logged_in_client.get("/insights/?days=7"))

    for selector, state_copy in zip((
            "[data-insights-time-nicotine-copy]",
            "[data-insights-product-nicotine-copy]",
    ), state_copies):
        copy = soup.select_one(selector).get_text(" ", strip=True)
        assert state_copy in copy
        assert "incomplete" in copy.casefold()


def test_insights_json_and_fallback_table_preserve_distinct_snapshot_whitespace_labels(
        logged_in_client, db_session, test_user):
    logged_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.add_all([
        Log(
            user_id=test_user.id,
            quantity=1,
            log_time=logged_at,
            product_brand_snapshot=" Exact snapshot ",
            nicotine_mg_snapshot=Decimal("4.00"),
        ),
        Log(
            user_id=test_user.id,
            quantity=1,
            log_time=logged_at + timedelta(minutes=1),
            product_brand_snapshot="Exact snapshot",
            nicotine_mg_snapshot=Decimal("3.00"),
        ),
    ])
    db_session.commit()

    response = logged_in_client.get("/insights/?days=7")
    soup = _soup(response)
    payload = logged_in_client.get("/insights/api/insights?days=7").get_json()

    assert payload["nicotine_by_product"] == {
        " Exact snapshot ": "4.00",
        "Exact snapshot": "3.00",
    }
    labels = [cell.string for cell in soup.select(
        '[data-analytics-key="brands"] th[scope="row"]',
    )]
    assert labels == [" Exact snapshot ", "Exact snapshot"]


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
    assert "You have 1 day with logs." in soup.get_text(" ", strip=True)
    chart = soup.select_one("#consumption-trend-chart[role='img'][aria-labelledby]")
    assert chart is not None
    assert soup.select_one(f"#{chart['aria-labelledby']}").get_text(strip=True) == "Consumption Trend"
    trend = soup.select_one("[role='region'][aria-label='Consumption trend data']")
    assert trend is not None
    trend_rows = [
        [cell.get_text(strip=True) for cell in row.select("th, td")]
        for row in trend.select("tbody tr")
    ]
    assert [logged_at.date().isoformat(), "52.0"] in trend_rows
    assert [cell.get_text(" ", strip=True) for cell in trend.select("thead th")] == [
        "Date", "Nicotine (mg)",
    ]
    assert trend.select_one("table caption").get_text(" ", strip=True) == "Consumption trend data"
    assert [
        control.get_text(" ", strip=True)
        for control in soup.select(".trend-toggle")
    ] == ["Daily", "Weekly sums"]
    weekday_table = soup.select_one(
        "[role='region'][aria-label='Weekly pattern data'] table"
    )
    assert weekday_table.select_one("caption").get_text(" ", strip=True) == (
        "Average nicotine by weekday"
    )
    assert [
        cell.get_text(" ", strip=True)
        for cell in weekday_table.select("thead th")
    ] == ["Day", "Average per complete-strength logged day (mg)"]
    heatmap = soup.select_one("[role='region'][aria-label='Nicotine heatmap data'] table")
    assert [cell.get_text(strip=True) for cell in heatmap.select("thead th")] == [
        "Day", *(f"{hour:02d}:00" for hour in range(24))
    ]
    weekday_row = next(
        row for row in heatmap.select("tbody tr")
        if row.select_one("th").get_text(strip=True) == logged_at.strftime("%A")
    )
    hourly_values = [cell.get_text(strip=True) for cell in weekday_row.select("td")]
    assert hourly_values[10] == "52.0"
    assert sum(map(float, hourly_values)) == 52.0

    api_response = logged_in_client.get("/insights/api/insights?days=7")
    assert api_response.status_code == 200
    payload = api_response.get_json()
    assert {
        "range_days",
        "observed_days",
        "log_count",
        "comparison",
        "data_sufficiency",
        "plan_context",
        "craving_pattern",
        "total_pouches",
        "nicotine_trend",
        "nicotine_heatmap",
    } <= payload.keys()
    assert payload["range_days"] == 7
    assert "plan_adherence" in payload["data_sufficiency"]
    assert "craving_pattern" in payload["data_sufficiency"]


def test_insights_zero_weekday_pattern_is_sufficient_without_a_leader(
        logged_in_client, monkeypatch):
    import routes.insights as insights_routes

    original = insights_routes.get_enhanced_insights

    def zero_weekday_pattern(user_id, days):
        payload = original(user_id, days)
        payload["data_sufficiency"]["weekday_pattern"] = True
        payload["nicotine_by_day_of_week"] = {
            "Monday": 0,
            "Tuesday": 0,
            "Wednesday": 0,
        }
        return payload

    monkeypatch.setattr(
        insights_routes,
        "get_enhanced_insights",
        zero_weekday_pattern,
    )

    soup = _soup(logged_in_client.get("/insights/"))

    copy = soup.select_one("[data-insights-weekly-copy]").get_text(" ", strip=True)
    assert "averaged 0 mg" in copy
    assert "more complete days" not in copy


def test_insights_uses_editorial_structure_and_retired_legacy_dashboard(
        logged_in_client):
    soup = _soup(logged_in_client.get("/insights/"))

    assert len(soup.select("main h1")) == 1
    assert soup.select_one("main h1").get_text(" ", strip=True) == "Insights"
    assert soup.select_one(".insights-intro .eyebrow").get_text(" ", strip=True) == "Your patterns"
    headings = [
        heading.get_text(" ", strip=True)
        for heading in soup.select("main h1, main h2")
    ]
    assert headings == [
        "Insights",
        "What changed",
        "When it happens",
        "What you reach for",
        "Cravings and response",
        "Detailed data",
    ]
    assert [control["data-days"] for control in soup.select("[data-days]")] == [
        "7", "30", "90", "365",
    ]
    export = soup.select_one("#export-data.c-button--quiet")
    assert export is not None
    assert export.get_text(" ", strip=True) == "Export CSV"
    assert soup.select_one("[data-insights-root][data-initial-insights]") is not None
    assert soup.select_one("[data-insights-headline]") is not None
    assert soup.select_one("[data-insights-interpretation]") is not None
    assert soup.select_one("[data-insights-weekly-copy]") is not None
    assert soup.select_one("[data-insights-hourly-copy]") is not None
    assert soup.select_one("[data-insights-state]") is not None
    assert soup.select_one("[data-craving-pattern][hidden]") is not None
    assert all(
        region.get("tabindex") == "0"
        and region.get("role") == "region"
        and region.get("aria-label")
        for region in soup.select(".analytics-data")
    )

    markup = str(soup)
    assert "Advanced Analytics &amp; Insights" not in markup
    assert "Advanced Analytics & Insights" not in soup.get_text(" ", strip=True)
    assert "bg-indigo-" not in markup
    assert "grid-cols-4" not in markup
    assert not soup.find(string=lambda value: value and any(
        emoji in value for emoji in ("📊", "📈", "⚡", "⏱️", "📅", "🤖")
    ))


def test_insights_page_honors_supported_direct_ranges_and_defaults_invalid_values(
        logged_in_client):
    seven_day = _soup(logged_in_client.get("/insights/?days=7"))
    seven_payload = seven_day.select_one("#initial-insights-data")
    assert '"range_days": 7' in seven_payload.get_text()
    assert seven_day.select_one('[data-days="7"]').get("aria-current") == "true"
    assert seven_day.select_one('[data-days="30"]').get("aria-current") is None

    invalid = _soup(logged_in_client.get("/insights/?days=13"))
    invalid_payload = invalid.select_one("#initial-insights-data")
    assert '"range_days": 30' in invalid_payload.get_text()
    assert invalid.select_one('[data-days="30"]').get("aria-current") == "true"


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
    chart = soup.select_one("#dashboard-trend-chart[role='img'][aria-labelledby][hidden]")
    assert chart is not None
    assert soup.select_one(f"#{chart['aria-labelledby']}").get_text(strip=True) == "Recent daily intake"
    trend = soup.select_one("[role='region'][aria-label='Recent daily intake data']")
    assert trend is not None
    trend_rows = [
        [cell.get_text(strip=True) for cell in row.select("th, td")]
        for row in trend.select("tbody tr")
    ]
    assert [logged_at.date().isoformat(), "17", "68.0"] in trend_rows
    assert trend.select_one("table caption").get_text(" ", strip=True) == "Recent daily intake data"
    assert soup.select_one("[role='region'][aria-label='Hourly distribution data']") is None
    assert trend.find_parent("details").find_next_sibling(class_="analytics-chart") == chart


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
