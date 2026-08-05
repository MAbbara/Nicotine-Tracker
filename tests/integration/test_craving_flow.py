"""Server-rendered contract for the progressively enhanced Today craving flow."""

from dataclasses import replace
import re

from bs4 import BeautifulSoup

from services.api_types import SmartDefault
from services.today_service import TodayService

from .test_today_page import _summary, _timeline_items


def test_today_renders_one_native_craving_dialog_while_preserving_the_no_js_link(
    logged_in_client,
    monkeypatch,
):
    smart_default = SmartDefault(
        pouch_id=12,
        brand="Steady Mint",
        nicotine_mg="6.00",
        source="recent",
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(smart_default=smart_default)),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    trigger = soup.select_one("button#today-craving-action[data-action-enhanced]")
    fallback = soup.select_one("[data-craving-action-slot] a[data-action-fallback]")
    dialog = soup.select_one("dialog#today-craving-flow[data-craving-flow-dialog]")

    assert response.status_code == 200
    assert trigger is not None
    assert fallback is not None
    assert fallback["href"] == "/cravings/cravings"
    assert dialog is not None
    assert "c-dialog" in dialog.get("class", [])
    assert dialog.select_one("[data-dialog-panel].c-dialog__panel")
    assert dialog.select_one(".c-dialog__header")
    assert dialog.select_one(".c-dialog__body")
    assert dialog.select_one(".c-dialog__actions")
    assert dialog.select_one(".c-dialog__close[aria-label]")
    assert dialog["aria-labelledby"] == "today-craving-flow-title"
    assert len(soup.select("dialog[data-craving-flow-dialog]")) == 1
    scripts = [script.get("src", "") for script in soup.select("script[type='module']")]
    assert any(src.endswith("/static/js/today/craving_flow.js") for src in scripts)


def test_server_rendered_craving_rows_expose_the_scoped_client_event_identity(
    logged_in_client,
    monkeypatch,
):
    items = list(_timeline_items())
    craving_item = items[1]
    items[1] = replace(
        craving_item,
        data=replace(
            craving_item.data,
            client_event_id="2ab514e1-63d5-4f4d-b065-5dbf3e6ec353",
        ),
    )
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(timeline=tuple(items))),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    craving = soup.select_one("[data-timeline-type='craving'][data-timeline-id='42']")

    assert response.status_code == 200
    assert craving is not None
    assert craving["data-client-event-id"] == "2ab514e1-63d5-4f4d-b065-5dbf3e6ec353"
    assert "Outcome not recorded" in craving.get_text(" ", strip=True)


def test_craving_dialog_keeps_accessible_hooks_and_no_smart_default_fallback(
    logged_in_client,
    monkeypatch,
):
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: _summary(smart_default=None)),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")
    dialog = soup.select_one("[data-craving-flow-dialog]")
    text = dialog.get_text(" ", strip=True)

    assert dialog is not None
    assert soup.select_one("[data-quick-log-dialog]") is None
    assert soup.select_one("[data-craving-detailed-log][href='/log/add']")
    assert len(dialog.select("[data-craving-step]")) == 6
    assert len(dialog.select("input[name='intensity']")) == 10
    assert [item.get("value") for item in dialog.select("input[name='outcome']")] == [
        "resisted",
        "used_nicotine",
        "used_alternative",
    ]
    assert dialog.select_one("[aria-live]") is None
    assert soup.select_one("[data-craving-live][aria-live='polite'][aria-atomic='true']")
    assert "What would help right now?" in text
    assert "Skip for now" in text
    assert not re.search(r"\bFailed\b|broken streak|cheated", text, re.IGNORECASE)
    sources = " ".join(script.get("src", "") for script in soup.select("script"))
    assert not re.search(r"preline|apexcharts|lodash|dashboard-charts", sources, re.IGNORECASE)


def test_today_summary_failure_still_keeps_guided_craving_support_available(
    logged_in_client,
    monkeypatch,
):
    monkeypatch.setattr(
        TodayService,
        "get_summary",
        classmethod(lambda cls, user_id: (_ for _ in ()).throw(RuntimeError("unavailable"))),
    )

    response = logged_in_client.get("/today/")
    soup = BeautifulSoup(response.data, "html.parser")

    assert response.status_code == 200
    assert soup.select_one("button#today-craving-action")
    assert soup.select_one(
        "[data-craving-action-slot] a[data-action-fallback][href='/cravings/cravings']"
    )
    assert soup.select_one("dialog[data-craving-flow-dialog]")
    assert soup.select_one("script[src$='/static/js/today/craving_flow.js']")
