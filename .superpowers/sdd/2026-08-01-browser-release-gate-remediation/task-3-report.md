# Task 3 Report — Effective Theme Contract

## Status

Implemented one saved/effective theme contract from no-flash bootstrap through the runtime controller and analytics consumers. Work started from `4593494`.

## Implementation

- The theme controller now publishes the saved preference on `data-saved-theme` and only the resolved `light|dark` value on `data-theme`.
- Every controller application synchronizes the `.dark` class, inline `colorScheme`, the theme-color meta (`#F5F1E7` light / `#111915` dark), picker state, and `nicotine-tracker:theme-change` detail `{saved, effective}`.
- A single media-query listener remains installed. It reapplies only while the saved choice is `system`, so explicit Light and Dark choices stay stable across later OS changes.
- The pre-paint layout bootstrap performs the same saved/effective resolution and publishes the same DOM state before the stylesheet loads.
- Insights and Dashboard subscribe to the non-bubbling application event on its actual producer target, `document.documentElement`. Their palette helper continues to read only effective `data-theme` through `analytics/runtime.js`.
- Removed the obsolete `[data-theme="system"]` media-query token block. The generated stylesheet was rebuilt.
- Browser coverage now checks all contract surfaces and verifies an Insights chart palette refresh preserves its accessible data table.

## Files

- `static/js/shell/theme.js`
- `templates/layouts/app.html` (theme bootstrap hunk only; wordmark untouched)
- `static/js/dashboard-charts.js`
- `static/js/insights.js`
- `static/css/tailwind.css`
- `static/css/style.css` (generated)
- `tests/js/shell.test.js`
- `tests/browser/shell.spec.js`
- `tests/browser/analytics.spec.js`
- `.superpowers/sdd/2026-08-01-browser-release-gate-remediation/task-3-report.md`

`static/js/analytics/runtime.js` was reviewed but did not require a Task 3 edit: Task 2 had already made `getEffectiveTheme()` depend only on `documentElement.dataset.theme`.

## TDD Evidence

### RED

After replacing the prior bug-encoding assertions, the controller tests failed against the original production code:

```text
$ node tests/js/shell.test.js
✖ theme controller publishes saved and effective System state as the device changes
  AssertionError: false !== true
  at tests/js/shell.test.js:107
✖ explicit theme selections publish saved state and ignore later device changes
  AssertionError: 'system' !== 'dark'
  at tests/js/shell.test.js:171
7 passed, 2 failed
```

The new real-browser analytics case then exposed the producer/consumer boundary defect after the controller change:

```text
$ npx playwright test tests/browser/shell.spec.js tests/browser/analytics.spec.js --project=chromium-desktop --grep "theme"
1 passed, 1 failed
Expected chart axis fill rgb(238, 232, 216); received rgb(30, 42, 36)
```

Temporary diagnostics confirmed the root changed to dark while zero events reached `window`. The required `CustomEvent` is dispatched on `<html>` and does not bubble, while Task 2's chart listeners were on `window`. The production fix moved both consumers to `document.documentElement`.

### GREEN

```text
$ node --test --test-name-pattern="theme" tests/js/shell.test.js
1 passed, 0 failed

$ npx playwright test tests/browser/shell.spec.js tests/browser/analytics.spec.js --project=chromium-desktop --grep "theme"
2 passed

$ npx playwright test tests/browser/shell.spec.js tests/browser/analytics.spec.js --project=chromium-mobile --grep "theme"
2 passed

$ npm run build:css
tailwindcss v4.1.11 — Done in 117ms
```

## Adjacent Verification

```text
$ node --test tests/js/insights.test.js tests/js/shell.test.js
2 files passed, 0 failed

$ npx playwright test tests/browser/shell.spec.js tests/browser/analytics.spec.js --project=chromium-desktop
10 passed

$ npx playwright test tests/browser/shell.spec.js tests/browser/analytics.spec.js --project=chromium-mobile
10 passed

$ git diff --check
(no output)
```

The full browser specs cover normal enhancement, no-runtime-error/overflow behavior, local chart-library failure fallbacks, chart/table parity, navigation, offline state, and responsive shell behavior on both profiles.

## Self-review

- Confirmed local storage retains only the saved choice and the root always exposes a resolved effective value.
- Confirmed explicit choices do not dispatch/reapply on OS media changes; System does.
- Confirmed the bootstrap and controller use the same allowed choices, resolution rule, DOM attributes, class, color scheme, and exact theme colors.
- Confirmed chart code contains no local-storage, `.dark`, or saved-theme inference.
- Confirmed the event target and consumer listeners now match.
- Confirmed accessible tables are not destroyed or changed by chart palette refresh and chart-unavailable fallbacks still pass.
- Confirmed the app-layout wordmark hunk is untouched.
- Confirmed the obsolete unresolved-System CSS selector is absent from the source.
- Confirmed the diff contains only Task 3 implementation, tests, generated CSS, and this report.

## Concerns

None. The generated stylesheet remains intentionally tracked despite its `.gitignore` entry, consistent with the preceding analytics CSS commit.
