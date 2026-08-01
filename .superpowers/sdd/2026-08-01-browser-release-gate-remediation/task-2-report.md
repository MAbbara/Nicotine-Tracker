# Task 2 report — resilient analytics rendering

## Status

Implemented and verified. Insights and Dashboard now render accessible analytics data before JavaScript, enhance it with the vendored ApexCharts 4.7.0 runtime when available, and expose named status fallbacks without uncaught errors when that runtime is unavailable. Today remains free of analytics assets.

## Implementation

- Added a shared ES-module chart runtime with `getEffectiveTheme`, `setChartFailure`, and guarded async `enhanceChart` behavior. Constructor, missing-target, missing-runtime, and rejected-render paths return `null` and reveal the adjacent fallback status.
- Server-rendered initial 30-day trend/distribution data through existing Insights and Dashboard service/query helpers.
- Added named chart regions and keyboard-focusable semantic tables for trend, time-of-day, day-of-week, brand, heatmap, and Dashboard hourly data.
- Extracted the large inline Insights initializer to `static/js/insights.js`; refactored Dashboard charts to the same shared guard.
- Range refreshes rebuild charts and their tables from the same response payload. Both initializers listen for the future `nicotine-tracker:theme-change` event without requiring Task 3 to exist.
- Added route-scoped `analytics_head` and `analytics_js` blocks. Both pages load only local `/static/css/apexcharts.css` and `/static/js/apexcharts.min.js`, with Apex before the module initializer.
- Removed the route-local Preline runtime from these two pages after it produced an uncaught mobile error; the single range menu on each page now has a small native toggle.
- Added contained chart/table overflow, visible focus, and reduced-motion CSS; rebuilt the tracked stylesheet.

## Files

- `routes/insights.py`
- `routes/dashboard.py`
- `templates/layouts/app.html` (route-asset blocks only)
- `templates/insights/insights.html`
- `templates/dashboard/dashboard.html`
- `static/js/analytics/runtime.js`
- `static/js/insights.js`
- `static/js/dashboard-charts.js`
- `static/css/tailwind.css`
- `static/css/style.css` (generated build output)
- `tests/js/insights.test.js`
- `tests/integration/test_analytics_pages.py`
- `tests/browser/analytics.spec.js`

No routes, models, branding, favicon, PWA assets, external dependencies, or production/user data were changed.

## RED evidence

### Rendered integration

Command:

```bash
.venv/bin/python -m pytest tests/integration/test_analytics_pages.py -q
```

Result: exit 1, `2 failed, 1 passed`. Both analytics responses failed at the expected missing `/static/css/apexcharts.css` lookup. The Today asset-isolation assertion already passed.

### Pure JavaScript

Command:

```bash
node --test tests/js/insights.test.js
```

Result: exit 1. The test file failed during import because `static/js/analytics/runtime.js` and `static/js/insights.js` did not exist.

### Real browser

Command:

```bash
npx playwright test tests/browser/analytics.spec.js --project=chromium-desktop
```

Result: exit 1, `4 failed`. Insights raised `ReferenceError: ApexCharts is not defined`; Dashboard had no `.analytics-chart .apexcharts-canvas`; neither page exposed a named `Chart unavailable` status or semantic consumption-trend table after an aborted Apex request.

The first sandboxed browser attempt could not bind the disposable local server (`PermissionError: Operation not permitted`); the identical command was rerun with approved local-server permission to obtain the behavioral RED evidence above.

## GREEN evidence

Fresh focused verification after final edits:

```text
node --test tests/js/insights.test.js
exit 0 — 1 test file passed (the file contains 5 behavior subtests)

.venv/bin/python -m pytest tests/integration/test_analytics_pages.py -q
exit 0 — 3 passed, 2 existing Flask-WTF deprecation warnings

npx playwright test tests/browser/analytics.spec.js --project=chromium-desktop
exit 0 — 4 passed

npx playwright test tests/browser/analytics.spec.js --project=chromium-mobile
exit 0 — 4 passed, with the analytics tests explicitly set to a 320px viewport

npm run build:css
exit 0 — Tailwind CSS v4.1.11 build completed
```

Adjacent regression verification:

```text
.venv/bin/python -m pytest tests/unit/test_insights.py tests/regression/test_task5_services_fixes.py tests/integration/test_today_page.py -q
exit 0 — 55 passed, 5 existing dependency/legacy warnings
```

Whitespace review:

```text
git -c core.whitespace=cr-at-eol diff --check
exit 0
```

`cr-at-eol` is used because the touched legacy Python/templates intentionally retain their existing CRLF/mixed line endings; no line-ending churn remains in the logical diff.

## Self-review

- Verified the local Apex version remains the already vendored 4.7.0 asset and no CDN/dependency was added.
- Verified every chart target has `role="img"` plus a resolvable `aria-labelledby`; every chart has a sibling `role="status"`; data alternatives are named, focusable regions containing real tables.
- Verified the abort path does not depend on a mock: Playwright aborts the real static request and asserts visible fallback values plus zero page errors.
- Verified regular desktop and explicit 320px mobile pages have visible canvases, visible semantic tables, no page/console errors, and no document-level horizontal overflow.
- Verified `/today/` contains no Apex, Dashboard chart, or Insights initializer asset.
- Verified response-driven refreshes update both the chart input and the corresponding table model from the same parsed payload.
- Verified the future theme event is consumed but not implemented here, preserving the Task 3 boundary.
- Reviewed the cached-target layout change as two empty base blocks only; wordmark/branding hunks are untouched.

## Concerns

- The focused Python runs retain existing Flask-WTF deprecation warnings, and adjacent regression tests retain existing SQLAlchemy legacy warnings; neither is introduced by Task 2.
- Dashboard's legacy custom-date UI maps the selected interval to a bounded day count because its canonical analytics APIs accept `days`, not arbitrary historical start/end dates. Preset ranges and the selected interval length remain authoritative, and chart/table values still come from the same API responses.

## Fix round 1 — semantic parity and binding coverage

### Findings addressed

1. Daily and weekly trend rendering now share one `buildTrendModel(data, trendType)` result. Both the Apex series and the accessible trend table consume the same `{label, value}` rows. Weekly grouping uses UTC date components, avoiding the prior Riyadh/local-midnight shift to Sunday.
2. Rendered integration checks now assert complete cells for deliberately distinctive quantities: Insights date/`13`, Dashboard date/`17`/`68.0`, and hourly `11:00`/`17`. Runtime-abort browser checks require an exact `2` value cell rather than any row.
3. A real browser binding test intercepts the 7-day API boundary with a complete controlled response, operates the actual range and weekly controls, and verifies exact table rows plus rendered Apex data-label values (`11`, `13`, then weekly `24`). This exercises `loadRange`, the real DOM table replacement, chart construction, and toggle rerendering together.
4. Heatmap alternatives retain the hourly dimension. The server table renders Day plus `00:00` through `23:00`; client modeling retains every `{day, hour, value}` cell and rebuilds the table from API responses without daily-total reduction.

### RED evidence

Pure JavaScript command:

```bash
node tests/js/insights.test.js
```

Result: exit 1, 5 passed and 2 failed. `buildTrendModel` was absent, and heatmap output returned one `{label, total}` row per day instead of individual day/hour/value cells.

Rendered integration command:

```bash
.venv/bin/python -m pytest tests/integration/test_analytics_pages.py -q
```

Result: exit 1, 2 passed and 1 failed. The rendered heatmap header was exactly `Day, Pouches`, not the required 24 hourly columns. The strengthened exact trend and hourly quantity assertions passed, demonstrating they now test real cells rather than date substrings.

Range binding command:

```bash
npx playwright test tests/browser/analytics.spec.js --project=chromium-desktop --grep "range response"
```

Result: exit 1. The controlled response updated the daily table to `2026-07-27/11` and `2026-07-28/13`, but the chart rendered no value labels, leaving chart-input parity unverifiable. After enabling rendered labels, the first GREEN attempt also exposed and then fixed timezone-dependent weekly labels (`2026-07-26` instead of Monday `2026-07-27`).

### GREEN evidence

Fresh final commands after the fix:

```text
node --test tests/js/insights.test.js
exit 0 — 1 test file passed (7 behavior subtests)

.venv/bin/python -m pytest tests/integration/test_analytics_pages.py -q
exit 0 — 3 passed, 2 existing Flask-WTF warnings

npx playwright test tests/browser/analytics.spec.js --project=chromium-desktop
exit 0 — 5 passed

npx playwright test tests/browser/analytics.spec.js --project=chromium-mobile
exit 0 — 5 passed

npm run build:css
exit 0 — Tailwind CSS v4.1.11 build completed

.venv/bin/python -m pytest tests/unit/test_insights.py tests/regression/test_task5_services_fixes.py tests/integration/test_today_page.py -q
exit 0 — 55 passed, 5 existing dependency/legacy warnings

git -c core.whitespace=cr-at-eol diff --check
exit 0
```

### Fix-round self-review

- Confirmed the weekly chart series and table rows are constructed from the identical model object in a single render pass.
- Confirmed weekly boundaries are Monday-based and timezone-stable through hand-derived literal fixtures.
- Confirmed heatmap server markup and client refresh output preserve hour labels and values, including zeros.
- Confirmed fallback tests inspect exact numeric cells and the range test inspects rendered chart text, not a mock call or implementation marker.
- Confirmed no route, model, dependency, theme-event producer, branding, favicon, or PWA scope was added.

### Fix-round concerns

- Apex may create an additional empty SVG text node for a single-point series; the browser assertion filters only empty nodes and compares every non-empty rendered data label exactly.

## Fix round 2 — mechanical whitespace hygiene

### Scope

Removed carriage-return-at-EOL artifacts only from branch-added lines in:

- `routes/dashboard.py`
- `routes/insights.py`
- `templates/dashboard/dashboard.html`
- `templates/insights/insights.html`

Unchanged legacy lines retained their existing line endings. No Python, template, JavaScript, CSS, generated asset, branding asset, screenshot, verification document, or runtime behavior was altered.

### Evidence

Before cleanup, `git diff --check e9b5a8d..HEAD` reported trailing whitespace on the Task 2 additions in exactly the four files above.

After the mechanical rewrite:

```text
git diff --check e9b5a8d
exit 0 — no output

git diff --check
exit 0 — no output

git diff --ignore-space-at-eol --exit-code HEAD -- routes/dashboard.py routes/insights.py templates/dashboard/dashboard.html templates/insights/insights.html
exit 0 — confirms the working changes contain no non-whitespace delta
```

The word-diff review showed only line-ending markers on the targeted lines. Because no non-whitespace application diff appeared, proportional analytics Python, browser, JavaScript, and CSS reruns were not required for this hygiene-only round.
