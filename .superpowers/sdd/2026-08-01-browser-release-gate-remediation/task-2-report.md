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
