# Browser Release-Gate Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the two critical and seven high browser-audit findings with regression-tested, release-focused changes and fresh browser acceptance evidence.

**Architecture:** Repair each root cause inside a bounded subsystem: unambiguous settings commands, locally loaded analytics enhancement over server-rendered alternatives, one authoritative effective-theme contract, shared accessible overflow/contrast patterns, route-class indexing rules, an honest in-session-only offline contract, and a focused editorial landing surface. Existing routes and data models remain stable; cross-cutting code is introduced only where multiple findings consume the same contract.

**Tech Stack:** Python 3.11, Flask, SQLAlchemy, Jinja, JavaScript ES modules, ApexCharts 4.7.0 vendored locally, Tailwind CSS 4.1.11, pytest, Node test runner, Playwright 1.62, axe-core.

## Global Constraints

- Preserve all existing application routes and database models.
- Do not connect to or mutate production or user data during implementation or verification.
- Use disposable test databases and synthetic accounts for browser actions.
- Do not overwrite, discard, stage, or commit concurrent branding work in `static/favicon.png`, `static/icons/pwa/`, `static/brand/`, or the currently modified layout files except through a reviewed patch that preserves those changes.
- Keep the existing warm ivory, mineral-green, restrained-terracotta, editorial visual direction. Do not introduce purple-blue gradients, neon-on-dark styling, glassmorphism, emoji-led metric cards, repetitive dashboard grids, guilt language, or unsupported claims.
- Target WCAG 2.2 AA, including color-independent meaning, visible focus, keyboard access, comfortable mobile targets, and reduced-motion support.
- Follow test-driven development: each behavior change begins with a focused failing test that is observed failing for the intended reason.
- Keep dependencies local and version-pinned. No runtime dependency may rely on a third-party CDN.
- Run `git status --short` before every staging operation. For dirty layout files, stage only the remediation hunk with a reviewed cached patch; never stage the concurrent wordmark-image hunk.
- Before Task 6, invoke `i-frontend-design` and follow the approved design rather than inventing a new brand direction.

## File responsibility map

- `routes/settings.py`: validate one settings-data command before any mutation.
- `templates/settings/data.html`: submit the clicked command, collect explicit destructive confirmation, and label retention controls.
- `static/js/analytics/runtime.js`: shared chart-runtime guard, accessible failure status, theme lookup, and theme-change subscription.
- `static/js/insights.js`: Insights fetch, chart enhancement, semantic alternative updates, and range interaction.
- `static/js/dashboard-charts.js`: dashboard chart enhancement and semantic alternative updates.
- `routes/insights.py` and `routes/dashboard.py`: provide initial data for server-rendered alternatives.
- `templates/insights/insights.html` and `templates/dashboard/dashboard.html`: named chart regions, text/table alternatives, route-scoped local assets, and responsive containers.
- `static/js/shell/theme.js`: saved/effective theme state and one application theme-change event.
- `templates/layouts/app.html`: no-flash initial theme resolution, authenticated noindex metadata, and route-scoped asset blocks.
- `templates/layouts/auth.html` and `templates/auth/reset_password.html`: auth noindex and token referrer protection.
- `static/css/tailwind.css`: semantic landing, analytics, contrast, and focusable-scroll styles.
- `templates/pages/journey/_schedule.html`, `templates/logging/view_logs.html`, and `templates/errors/404.html`: audited focus/contrast corrections.
- `templates/index.html`: focused public landing rewrite without unsupported claims.
- Focused new test files isolate settings commands, analytics pages, indexing privacy, landing contracts, and browser analytics/landing behavior.

---

### Task 1: Make Data & Privacy commands unambiguous and accessible

**Files:**
- Create: `tests/integration/test_settings_data_actions.py`
- Modify: `routes/settings.py:310-366`
- Modify: `templates/settings/data.html:13-87`
- Modify: `tests/accessibility/accessibility.spec.js`

**Interfaces:**
- Consumes: existing `settings.data` endpoint, CSRF handling, `logged_in_client`, `db_session`, `test_user`, `test_pouch`, and `test_goal` fixtures.
- Produces: `DATA_ACTIONS: frozenset[str]`, a one-value `action` request contract, `confirm_anonymize == "ANONYMIZE"`, `confirm_delete_logs == "DELETE LOGS"`, and a labelled `#days_to_keep` control.

- [ ] **Step 1: Write route regression tests for one-action dispatch**

Create tests that post every supported action and assert its exact state effect. The shared assertion helper must snapshot profile fields, logs, pouch IDs, and goal streaks before submission so unrelated branches are proven unchanged. Include these exact behavioral cases:

```python
SUPPORTED_ACTIONS = {
    'export_data', 'cleanup_duplicates', 'merge_custom_pouches',
    'recalculate_goals', 'anonymize_data', 'delete_old_logs',
}

def test_data_page_rejects_multiple_actions_without_mutation(
    logged_in_client, test_user, db_session,
):
    before = (test_user.age, test_user.gender, test_user.weight)
    response = logged_in_client.post(
        '/settings/data',
        data=MultiDict([
            ('action', 'anonymize_data'),
            ('action', 'delete_old_logs'),
            ('confirm_anonymize', 'ANONYMIZE'),
            ('confirm_delete_logs', 'DELETE LOGS'),
            ('days_to_keep', '30'),
        ]),
        follow_redirects=True,
    )
    db_session.refresh(test_user)
    assert response.status_code == 200
    assert b'Choose one data action and try again.' in response.data
    assert (test_user.age, test_user.gender, test_user.weight) == before
```

Add parallel tests for absent/unknown actions, each named operation, invalid anonymize confirmation, invalid delete confirmation, and the 30-day retention boundary. Assertions must inspect database rows, not only flash copy.

- [ ] **Step 2: Run the settings tests and verify RED**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_settings_data_actions.py -q
```

Expected: grouped-form dispatch tests show Merge/Recalculate selecting cleanup and Delete Logs selecting anonymize; invalid/multiple actions lack the specified safe rejection; confirmation tests show the route mutates without confirmation.

- [ ] **Step 3: Replace repeated hidden actions with clicked-button values**

In `templates/settings/data.html`, retain a separate export form and change each grouped operation button to this pattern:

```html
<button type="submit" name="action" value="cleanup_duplicates" class="...">
  Cleanup
</button>
```

Use corresponding values for merge and recalculate. Split anonymize and delete into separate forms so each contains only its own fields. Add server-submitted confirmation inputs:

```html
<label for="confirm_anonymize">Type ANONYMIZE to confirm</label>
<input id="confirm_anonymize" name="confirm_anonymize"
       autocomplete="off" required pattern="ANONYMIZE">

<label for="days_to_keep">Days to keep</label>
<input id="days_to_keep" name="days_to_keep" type="number" value="365"
       min="30" aria-describedby="days_to_keep_help">
<p id="days_to_keep_help">Logs newer than this many days will be kept.</p>
<label for="confirm_delete_logs">Type DELETE LOGS to confirm</label>
<input id="confirm_delete_logs" name="confirm_delete_logs"
       autocomplete="off" required pattern="DELETE LOGS">
```

- [ ] **Step 4: Validate the action before entering mutation branches**

Define the immutable allowlist near the route and reject anything other than one recognized action:

```python
DATA_ACTIONS = frozenset({
    'export_data', 'cleanup_duplicates', 'merge_custom_pouches',
    'recalculate_goals', 'anonymize_data', 'delete_old_logs',
})

actions = request.form.getlist('action')
if len(actions) != 1 or actions[0] not in DATA_ACTIONS:
    flash('Choose one data action and try again.', 'error')
    return redirect(url_for('settings.data'))
action = actions[0]
```

Before anonymization, require exact `ANONYMIZE`; before deletion, require exact `DELETE LOGS`. On mismatch, flash branch-specific guidance and return without calling `db.session.commit()`.

- [ ] **Step 5: Run focused Python tests and verify GREEN**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_settings_data_actions.py tests/regression/test_log_time_authority.py tests/regression/test_task5_final_review.py -q
```

Expected: all focused settings, export, and retention tests pass.

- [ ] **Step 6: Add authenticated label/axe browser coverage**

Extend the accessibility spec with a Data & Privacy case that logs in, visits `/settings/data`, resolves `getByLabel('Days to keep')`, asserts `aria-describedby="days_to_keep_help"`, and runs `expectNoWcagViolations(page)`.

- [ ] **Step 7: Verify the accessibility regression test**

Run:

```bash
npx playwright test tests/accessibility/accessibility.spec.js --project=chromium-desktop --grep "Data & Privacy"
```

Expected: the focused Data & Privacy accessibility case passes with no axe violations.

- [ ] **Step 8: Commit the command-safety unit**

Stage only the four Task 1 files and commit:

```bash
git commit -m "fix: make data privacy actions explicit"
```

---

### Task 2: Restore analytics with accessible, responsive fallbacks

**Files:**
- Create: `static/js/analytics/runtime.js`
- Create: `static/js/insights.js`
- Create: `tests/js/insights.test.js`
- Create: `tests/integration/test_analytics_pages.py`
- Create: `tests/browser/analytics.spec.js`
- Modify: `routes/insights.py:12-16`
- Modify: `routes/dashboard.py:112-268`
- Modify: `templates/insights/insights.html:140-694`
- Modify: `templates/dashboard/dashboard.html:156-205,224-280,328-331`
- Modify: `static/js/dashboard-charts.js:1-177`
- Modify: `static/css/tailwind.css`
- Modify with hunk-only staging: `templates/layouts/app.html` route asset blocks only

**Interfaces:**
- Consumes: local `/static/js/apexcharts.min.js` v4.7.0, `/static/css/apexcharts.css`, existing insights/dashboard APIs, and `data-theme` effective value.
- Produces: `getEffectiveTheme(root) -> 'light'|'dark'`, `enhanceChart({target, status, options, ApexChartsClass}) -> Promise<object|null>`, `setChartFailure(status, message)`, route-scoped `analytics_head`/`analytics_js` blocks, and server-rendered `.analytics-data` alternatives.

- [ ] **Step 1: Write failing analytics layout and browser tests**

In `tests/integration/test_analytics_pages.py`, assert both responses contain local Apex CSS/JS before their initializer, contain no `http://` or `https://` analytics dependency, provide named chart regions and visible semantic values, while `/today/` remains Apex-free.

In `tests/browser/analytics.spec.js`, log in with `today-targeted@example.com`, collect `pageerror` and console errors, visit `/insights/` and `/dashboard/`, and assert:

```javascript
expect(runtimeErrors).toEqual([]);
await expect(page.locator('.analytics-chart .apexcharts-canvas').first()).toBeVisible();
await expect(page.getByRole('table', { name: /consumption trend data/i })).toBeVisible();
expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
```

Add a context that aborts `**/static/js/apexcharts.min.js` and asserts a named status containing “Chart unavailable” plus still-visible alternative values.

- [ ] **Step 2: Verify analytics tests fail for the audited reasons**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_analytics_pages.py -q
npx playwright test tests/browser/analytics.spec.js --project=chromium-desktop
```

Expected: no local runtime script is loaded, Insights reports `ApexCharts is not defined`, chart canvases and semantic alternatives are absent, and Insights exceeds 320px in the narrow test.

- [ ] **Step 3: Write pure runtime and alternative-rendering tests**

Test `enhanceChart` with a fake chart constructor that records options, a missing constructor, a missing target, and a `render()` rejection. Test Insights alternative generation from fixed API data so table labels and values match the chart series.

```javascript
test('chart render rejection exposes fallback without throwing', async () => {
  const status = { hidden: true, textContent: '' };
  const BrokenChart = class { render() { return Promise.reject(new Error('boom')); } };
  const result = await enhanceChart({
    target: {}, status, options: { series: [] }, ApexChartsClass: BrokenChart,
  });
  assert.equal(result, null);
  assert.equal(status.hidden, false);
  assert.match(status.textContent, /Chart unavailable/);
});
```

- [ ] **Step 4: Verify the JavaScript tests fail before implementation**

Run:

```bash
node --test tests/js/insights.test.js
```

Expected: imports fail because `static/js/analytics/runtime.js` and `static/js/insights.js` do not yet exist.

- [ ] **Step 5: Implement the shared chart enhancement guard**

Create `static/js/analytics/runtime.js` with the tested exports. `enhanceChart` must catch constructor and async render failures, call `setChartFailure`, and return `null`; successful rendering returns the chart object. `getEffectiveTheme` reads only `root.dataset.theme`. Subscribe chart refreshes to the `nicotine-tracker:theme-change` event defined in Task 3, while tolerating its absence until Task 3 lands.

- [ ] **Step 6: Server-render initial analytics alternatives**

Use the existing service/query helpers in `routes/insights.py` and `routes/dashboard.py` to pass initial 30-day trend and distribution values into their templates. Render concise summaries and named tables from those values before JavaScript runs. API range changes must update charts and alternatives from the same response object.

- [ ] **Step 7: Extract Insights initialization and guard both pages**

Move the inline Insights initializer into `static/js/insights.js`. Replace direct constructors with `enhanceChart`. Refactor `static/js/dashboard-charts.js` the same way. Every target receives `aria-labelledby` and a sibling status region such as:

```html
<div class="analytics-chart" id="consumption-trend-chart"
     role="img" aria-labelledby="consumption-trend-title"></div>
<p class="analytics-chart__status" role="status" hidden></p>
<div class="analytics-data" tabindex="0" role="region"
     aria-label="Consumption trend data">...</div>
```

- [ ] **Step 8: Load vendored Apex assets only on analytics routes**

Add empty route-asset blocks to `templates/layouts/app.html`, then override them in Insights and dashboard so `/static/css/apexcharts.css` loads in `<head>`, `/static/js/apexcharts.min.js` loads before the module/initializer, and no CDN URL is introduced. Preserve the concurrent wordmark hunk exactly and stage only route-asset hunks.

- [ ] **Step 9: Contain analytics at narrow widths**

Add `.analytics-chart` and `.analytics-data` styles with `min-width: 0`, `max-width: 100%`, contained overflow, visible focus, and reduced-motion behavior. Remove fixed/min-content combinations that create page-level overflow at 320px.

- [ ] **Step 10: Verify focused analytics behavior**

Run:

```bash
node --test tests/js/insights.test.js
.venv/bin/python -m pytest tests/integration/test_analytics_pages.py -q
npx playwright test tests/browser/analytics.spec.js --project=chromium-desktop
npx playwright test tests/browser/analytics.spec.js --project=chromium-mobile
npm run build:css
```

Expected: pure helpers, server alternatives, chart enhancement, runtime-failure fallback, and 320px containment all pass with no page/console errors.

- [ ] **Step 11: Commit the analytics unit**

Stage all Task 2 files except unrelated dirty hunks. Apply a reviewed cached patch for `templates/layouts/app.html`. Commit:

```bash
git commit -m "fix: restore resilient analytics rendering"
```

---

### Task 3: Establish one effective-theme contract

**Files:**
- Modify: `tests/js/shell.test.js`
- Modify: `tests/browser/shell.spec.js`
- Modify: `static/js/shell/theme.js`
- Modify with hunk-only staging: `templates/layouts/app.html:2-29`
- Modify: `static/js/analytics/runtime.js`
- Modify: `static/js/dashboard-charts.js`
- Modify: `static/js/insights.js`
- Modify: `static/css/tailwind.css:24-118`

**Interfaces:**
- Consumes: saved preference `light|dark|system` and `matchMedia('(prefers-color-scheme: dark)')`.
- Produces: `data-saved-theme` preference, `data-theme` effective value, synchronized `.dark`, `style.colorScheme`, effective `meta[name=theme-color]`, and `CustomEvent('nicotine-tracker:theme-change', {detail: {saved, effective}})`.

- [ ] **Step 1: Replace the bug-encoding unit assertions with effective-theme tests**

Update the fake root to implement `classList.toggle`, a style object, and a fake theme-color meta node. Assert System preserves `data-saved-theme="system"` while effective `data-theme` and `.dark` follow media changes; explicit Light and Dark ignore later OS changes; selection updates saved state; and each effective change emits one event with `{saved, effective}`.

- [ ] **Step 2: Run the unit theme tests and verify RED**

Run:

```bash
node --test --test-name-pattern="theme" tests/js/shell.test.js
```

Expected: current controller removes `.dark`, leaves saved state and theme-color stale, and emits no application theme event.

- [ ] **Step 3: Publish saved and effective theme from `apply()`**

Implement one `applyThemeState` path used by initialization and selection:

```javascript
const THEME_COLORS = { light: '#F5F1E7', dark: '#111915' };

root.dataset.savedTheme = choice;
root.dataset.theme = resolved;
root.classList.toggle('dark', resolved === 'dark');
root.style.colorScheme = resolved;
themeColorMeta?.setAttribute('content', THEME_COLORS[resolved]);
root.dispatchEvent(new CustomEvent('nicotine-tracker:theme-change', {
  detail: { saved: choice, effective: resolved },
}));
```

Keep one media listener. The handler returns immediately unless `choice === 'system'`.

- [ ] **Step 4: Make the no-flash bootstrap match the controller**

Patch the app layout bootstrap to resolve local/server preference against the media query before first paint, set both data attributes, toggle `.dark`, set `colorScheme`, and update theme-color. Preserve the concurrent wordmark image exactly.

- [ ] **Step 5: Make charts consume only the effective theme**

Remove independent `.dark` and local-storage inference from analytics scripts. Palette helpers read `document.documentElement.dataset.theme`; existing charts update options after `nicotine-tracker:theme-change`.

- [ ] **Step 6: Remove the obsolete unresolved-System CSS branch**

Keep `[data-theme="light"]` and `[data-theme="dark"]` token blocks authoritative. Remove the media-query token branch for `[data-theme="system"]` because `data-theme` is never unresolved after bootstrap.

- [ ] **Step 7: Expand browser theme coverage and verify GREEN**

Assert Light, Dark, and System root attributes, `.dark`, computed `colorScheme`, theme-color, system media changes, explicit-choice stability, and chart palette refresh. Run:

```bash
node --test --test-name-pattern="theme" tests/js/shell.test.js
npx playwright test tests/browser/shell.spec.js tests/browser/analytics.spec.js --project=chromium-desktop --grep "theme"
npx playwright test tests/browser/shell.spec.js tests/browser/analytics.spec.js --project=chromium-mobile --grep "theme"
npm run build:css
```

Expected: all theme unit/browser cases and CSS build pass.

- [ ] **Step 8: Commit the theme unit**

Stage Task 3 files and a reviewed cached patch containing only the app-layout theme hunks. Commit:

```bash
git commit -m "fix: unify effective theme behavior"
```

---

### Task 4: Clear audited contrast and keyboard-scroll violations

**Files:**
- Modify: `tests/accessibility/accessibility.spec.js`
- Modify: `templates/pages/journey/_schedule.html:1-27`
- Modify: `templates/dashboard/dashboard.html:58-280`
- Modify: `templates/logging/view_logs.html:7-90`
- Modify: `templates/errors/404.html:5-28`
- Modify: `static/css/tailwind.css:24-118,772-800,1251-1401`

**Interfaces:**
- Consumes: shared semantic color tokens and `.horizontal-scroll-region` style.
- Produces: `.horizontal-scroll-region` with `tabindex="0"`, an accessible label, and visible `:focus-visible`; WCAG AA color pairs for audited states.

- [ ] **Step 1: Add populated-state accessibility regressions**

Add separate authenticated tests using `journey-review-<project>@example.com` for Journey and `today-targeted@example.com` for dashboard/logs/404. Run axe on each state. At mobile width, assert only demonstrably overflowing regions satisfy:

```javascript
expect(await region.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
await expect(region).toHaveAttribute('tabindex', '0');
await expect(region).toHaveAccessibleName(/schedule|recent logs|log history/i);
await region.focus();
expect(await region.evaluate((el) => {
  const style = getComputedStyle(el);
  return style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) >= 2;
})).toBe(true);
```

- [ ] **Step 2: Run authenticated axe cases and verify RED**

Run:

```bash
npx playwright test tests/accessibility/accessibility.spec.js --project=chromium-desktop
npx playwright test tests/accessibility/accessibility.spec.js --project=chromium-mobile
```

Expected: current populated Journey/dashboard/log/404 states reproduce `color-contrast` and mobile `scrollable-region-focusable` violations.

- [ ] **Step 3: Implement the shared focusable-scroll contract**

Apply `.horizontal-scroll-region`, `tabindex="0"`, and route-specific `aria-label` values to Journey schedule, dashboard Recent Logs, and any actually overflowing logs table. Add stable focus styles and a short visually available or screen-reader instruction that the region scrolls horizontally.

- [ ] **Step 4: Correct failing color pairs at the narrowest shared level**

Adjust the Journey constructive status/link token so normal text reaches at least 4.5:1 in both themes. Correct dashboard summary/table, detailed-log metadata, and 404 muted/link pairs locally when a shared-token edit would change unrelated surfaces. Do not rely on color alone for status meaning.

- [ ] **Step 5: Correct 404 landmark and destination while in scope**

Replace the nested `<main>` with a neutral container, preserve one layout main landmark, and change authenticated recovery from legacy Dashboard terminology to Today. Add assertions for one main and the Today link.

- [ ] **Step 6: Build CSS and verify authenticated accessibility GREEN**

Run:

```bash
npm run build:css
npx playwright test tests/accessibility/accessibility.spec.js --project=chromium-desktop
npx playwright test tests/accessibility/accessibility.spec.js --project=chromium-mobile
npx playwright test tests/browser/journey.spec.js --project=chromium-mobile
```

Expected: no WCAG A/AA violations in the scoped populated states; actual mobile overflow regions are named, focusable, and visibly focused.

- [ ] **Step 7: Commit the accessibility unit**

Stage only Task 4 files and commit:

```bash
git commit -m "fix: clear authenticated accessibility blockers"
```

---

### Task 5: Protect private indexing and state the real offline boundary

**Files:**
- Create: `tests/integration/test_indexing_privacy.py`
- Modify: `tests/test_pwa.py`
- Modify with hunk-only staging: `templates/layouts/app.html`
- Modify with hunk-only staging: `templates/layouts/auth.html`
- Modify: `templates/auth/reset_password.html`
- Modify: `docs/verification/2026-08-01-ui-ux-rework-release.md`

**Interfaces:**
- Consumes: layout inheritance, `PasswordResetService.create_reset_token(user_id)`, manifest endpoint, existing in-session offline queue.
- Produces: authenticated/auth `robots=noindex, nofollow`, reset-token `referrer=no-referrer`, public landing without noindex, and an explicit documented in-session-only replay boundary.

- [ ] **Step 1: Write rendered-response indexing tests**

Create public, auth, authenticated, and valid-reset-token cases. Parse responses with BeautifulSoup and assert exact metadata:

```python
def assert_noindex(response):
    soup = BeautifulSoup(response.data, 'html.parser')
    assert soup.find('meta', attrs={
        'name': 'robots', 'content': 'noindex, nofollow',
    })

def test_public_landing_remains_indexable(client):
    soup = BeautifulSoup(client.get('/').data, 'html.parser')
    assert soup.find('meta', attrs={'name': 'robots'}) is None
```

For reset, create a real synthetic token through `PasswordResetService`, GET its URL, assert noindex and `<meta name="referrer" content="no-referrer">`.

- [ ] **Step 2: Run indexing tests and verify RED**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_indexing_privacy.py -q
```

Expected: auth, authenticated, and reset responses lack robots metadata; reset lacks referrer protection.

- [ ] **Step 3: Add route-class metadata without affecting public indexing**

Add `noindex, nofollow` to app and auth layouts. Add this explicit reset-password head override so the token page emits the stricter referrer rule while retaining auth metadata:

```jinja2
{% block head %}
  {{ super() }}
  <meta name="referrer" content="no-referrer">
{% endblock %}
```

Do not add noindex to marketing layout.

- [ ] **Step 4: Add the durable offline-capability contract**

Extend `tests/test_pwa.py` to assert the manifest stays locally scoped and contains no cold/full-offline claim, `/service-worker.js` remains 404, and rendered source has no service-worker registration. Preserve existing browser replay tests as the positive contract for an already-loaded session.

Update the release record with this exact distinction: queued mutations can replay after connectivity returns in an already loaded session; cold offline launch and an offline application shell are unsupported and require a separate service-worker project.

- [ ] **Step 5: Verify privacy and PWA contracts**

Run:

```bash
.venv/bin/python -m pytest tests/integration/test_indexing_privacy.py tests/test_pwa.py tests/templates/test_layouts.py -q
node --test tests/js/shell.test.js tests/js/offline_queue.test.js
npx playwright test tests/browser/offline-replay.spec.js --project=chromium-desktop
```

Expected: private indexing/referrer assertions pass, public remains indexable, manifest/layout tests pass, and in-session offline replay stays green.

- [ ] **Step 6: Commit the privacy/PWA unit**

Stage reset/test/docs files normally. Stage only metadata hunks from dirty app/auth layouts; exclude both wordmark hunks. Commit:

```bash
git commit -m "fix: protect private routes from indexing"
```

---

### Task 6: Align the public landing page with the approved trust surface

**Files:**
- Create: `tests/templates/test_landing.py`
- Create: `tests/browser/landing.spec.js`
- Modify: `templates/index.html:1-181`
- Modify: `static/css/tailwind.css` near marketing-shell components

**Interfaces:**
- Consumes: `layouts/marketing.html`, `components/icon.html`, existing `c-button` primitives, semantic visual tokens.
- Produces: `.landing-*` editorial components, one H1, supported capability copy, public Sign in/Create account actions, and authenticated Today/Add Log actions.

- [ ] **Step 1: Invoke the frontend-design skill and write the landing contract test**

The test must assert status 200, exactly one H1, register/login links, the supported capabilities “Log quickly”, “Respond to cravings”, “Follow your plan”, and “Understand patterns”, and absence of the retired patterns:

```python
for forbidden in (
    'Join thousands', '📊', '🎯', '📱', '📈',
    'indigo', 'bg-gradient', 'from-[#', 'to-[#',
):
    assert forbidden not in response.get_data(as_text=True)
```

- [ ] **Step 2: Run the landing contract and verify RED**

Run:

```bash
.venv/bin/python -m pytest tests/templates/test_landing.py -q
```

Expected: unsupported claim, emoji, indigo, and gradient assertions fail while one-H1 and public-action assertions pass.

- [ ] **Step 3: Replace the legacy landing composition**

Rewrite `templates/index.html` using an editorial hero led by today's next useful action, a restrained proof section describing only implemented capabilities, and one closing CTA. Import the icon macro and use the existing `today`, `journey`, `insights`, and `pouch` symbols. Remove the temporary zeroed authenticated-statistics JavaScript and route authenticated users toward Today and Quick Log rather than legacy Dashboard language.

- [ ] **Step 4: Add semantic landing styles**

Add `.landing-hero`, `.landing-kicker`, `.landing-actions`, `.landing-capabilities`, `.landing-capability`, and `.landing-cta` styles using existing canvas/surface/ink/constructive/attention/milestone tokens. Preserve visible focus and reduced motion. Do not touch marketing layout, logos, favicon, or PWA icons.

- [ ] **Step 5: Write browser layout/focus/reduced-motion tests**

Assert one visible H1, public actions, keyboard-visible focus, no page overflow at 320px, and reduced-motion transition/animation durations no greater than `0.01s` for landing components.

- [ ] **Step 6: Verify landing behavior and visual-system contracts**

Run:

```bash
.venv/bin/python -m pytest tests/templates/test_landing.py tests/smoke/test_design_tokens.py -q
npm run build:css
npx playwright test tests/browser/landing.spec.js --project=chromium-desktop
npx playwright test tests/browser/landing.spec.js --project=chromium-mobile
```

Expected: landing contract, token smoke checks, CSS build, responsive containment, focus, and reduced-motion cases pass.

- [ ] **Step 7: Commit the landing unit**

Stage only `templates/index.html`, `static/css/tailwind.css`, and the two landing tests. Commit:

```bash
git commit -m "fix: align landing page with product direction"
```

---

### Task 7: Run full release verification and refresh evidence

**Files:**
- Modify: `docs/verification/2026-08-01-full-browser-audit.md`
- Modify: `docs/verification/2026-08-01-ui-ux-rework-release.md`

**Interfaces:**
- Consumes: Tasks 1–6 and all configured test suites.
- Produces: fresh command evidence, a finding-by-finding closure table, remaining medium/low findings, and an accurate release verdict.

- [ ] **Step 1: Review the complete scoped diff before tests**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Confirm no concurrent branding asset is staged and every dirty layout still contains the user's wordmark image change.

- [ ] **Step 2: Run focused regression groups once more**

Run the Task 1–6 focused Python, Node, build, accessibility, analytics, theme, offline, Journey, and landing commands. Stop and diagnose any failure before the complete suites.

- [ ] **Step 3: Run the complete automated verification matrix**

Run fresh:

```bash
.venv/bin/python -m pytest -q
npm test
npm run build
npm run test:e2e
```

Record exact pass/fail/skip counts, warnings, durations, and exit codes. A prior run is not evidence for this task.

- [ ] **Step 4: Repeat the expanded browser acceptance scan**

Using the disposable browser test app and synthetic accounts, verify Data & Privacy exact actions, Insights/dashboard runtime and fallbacks, Light/Dark/System, all scoped axe states, 320px Insights containment, route metadata, offline messaging, and landing visuals. Confirm zero C1/C2/H1–H7 reproduction.

- [ ] **Step 5: Update the two verification records**

For each of C1, C2, and H1–H7, record the fixing commit, regression test, manual evidence, and status. Keep the eight medium and three low findings listed. Keep named human accessibility, real-iPhone Safari/PWA, and HTTPS staging gates explicit; do not infer them from Chromium.

- [ ] **Step 6: Verify documentation and staged scope**

Run:

```bash
git diff --check
git diff --cached --check
git status --short
```

Confirm the documentation states the actual evidence and no concurrent branding file is staged.

- [ ] **Step 7: Commit verification evidence**

Stage only the two verification documents and commit:

```bash
git commit -m "docs: verify browser release gate fixes"
```

- [ ] **Step 8: Perform the completion gate**

Read the final plan checklist, `git log --oneline`, `git status --short`, and the fresh test outputs. Claim only the status proven by those outputs. If all technical browser findings clear but external gates remain, report that distinction rather than declaring an unconditional GO.
