# Secondary Surfaces and Release Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate decision-relevant Insights, reorganize ownership/settings under You, align public/auth surfaces, retire the legacy navigation safely, and prove the complete rework is accessible, responsive, portable, secure, and fast.

**Architecture:** One portable `InsightService` produces chart-independent datasets and written summaries; an Insights-only adapter enhances accessible server content. The You blueprint composes existing ownership-checked settings without duplicating business logic. Compatibility routes redirect pages and adapt temporary API contracts. Final verification exercises migrated data and real browser journeys in both themes.

**Tech Stack:** Flask/Jinja, SQLAlchemy, Tailwind CSS, native ES modules, ApexCharts isolated behind an adapter, pytest, Playwright, axe-core.

## Global Constraints

Phases 1–3 must be green. Follow the [master plan](./2026-07-26-nicotine-tracker-ui-ux-rework.md). Every listed test matrix is a completion checklist implemented through repeated one-behavior red/green cycles. Do not invent savings or health claims. Every chart needs a written interpretation and non-canvas text alternative. Destructive account/data actions retain explicit confirmation and ownership checks. Legacy rows are never deleted by compatibility cleanup.

---

## Task 1: Consolidate Portable, Decision-Relevant Insight Data

**Files:**

- Rewrite: `services/insights_service.py`
- Reduce or adapt: `services/enhanced_insights_service.py`
- Create: `tests/unit/test_insight_service.py`
- Create: `tests/property/test_insight_invariants.py`
- Create: `tests/integration/test_insight_failure_isolation.py`

- [ ] **Step 1: Define chart-independent section contracts.**

```python
@dataclass(frozen=True)
class InsightSection:
    key: str
    title: str
    question: str
    series: tuple[dict, ...]
    summary: str
    sample_size: int
    empty_reason: str | None
```

`InsightReport` includes range, timezone, generated time, and these keys: `consumption`, `adherence`, `intervals`, `timing`, `cravings`, `strength`, and `avoided`.

- [ ] **Step 2: Write failing calculation tests.**

Cover pouches/mg by user day from immutable log snapshots, actual versus immutable `PlanDay`, paused intervals excluded from adherence via `PlanStatusEvent`, median event interval, local hour/weekday distribution, trigger counts and resolved outcome rates, unresolved cravings excluded from rate denominators, snapshot-based product-strength changes, and pouches/mg avoided versus confirmed baseline only. Test unknown-strength counts and insufficient-data requirements explicitly.

- [ ] **Step 3: Run and confirm current service divergence.**

Run: `.venv/bin/python -m pytest tests/unit/test_insight_service.py tests/property/test_insight_invariants.py -q`

Expected: missing contract or mismatched calculations between the two legacy services.

- [ ] **Step 4: Implement one portable service.**

Use bounded `log_time`/`craving_time` queries, immutable product/strength snapshots, and timezone conversion in Python; no MySQL or SQLite date functions and no Pandas requirement in request paths. Each section catches only its own recoverable insufficient-data case. Unexpected exceptions carry a correlation ID and omit that section rather than corrupting others.

- [ ] **Step 5: Make interpretations deterministic and candid.**

Summaries state the observed direction, range, and sample size without causal claims. `avoided` is available only for a confirmed baseline and compares completed days that contain at least one log; a day with no events remains unknown rather than being treated as zero use. Negative avoided values are labelled above-baseline use, not hidden.

- [ ] **Step 6: Verify failure isolation from Today.**

Run SQLite: `.venv/bin/python -m pytest tests/unit/test_insight_service.py tests/property/test_insight_invariants.py tests/integration/test_insight_failure_isolation.py -q`

Run portable aggregation cases on MySQL: `.venv/bin/python -m pytest tests/unit/test_insight_service.py -q --db=mysql`

Expected: all pass; forced insight exceptions do not affect `/today`.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add services/insights_service.py services/enhanced_insights_service.py tests && git commit -m "refactor: consolidate portable coaching insights"`. Otherwise record `phase4-task1`.

---

## Task 2: Build Accessible Insights with Lazy Chart Loading

**Files:**

- Rewrite: `routes/insights.py`
- Create: `templates/pages/insights/index.html`
- Create: `templates/pages/insights/_section.html`
- Create: `static/js/insights/chart_adapter.js`
- Create: `static/js/insights/filters.js`
- Modify: `templates/components/chart.html`
- Modify: `static/css/tailwind.css`
- Create: `tests/js/chart_adapter.test.js`
- Create: `tests/integration/test_insights_page.py`
- Create: `tests/browser/insights.spec.js`

- [ ] **Step 1: Write failing HTML/API/loader tests.**

Assert each populated section has question, chart frame, direct labels where possible, written interpretation, sample size, and text/table alternative; empty sections state exact data requirements. Verify only allowed ranges, field-safe JSON, independent section errors, and no ApexCharts request before the Insights page/module needs it.

- [ ] **Step 2: Run and confirm legacy page fails the contract.**

Run: `npm run test && .venv/bin/python -m pytest tests/integration/test_insights_page.py -q && npm run test:e2e -- tests/browser/insights.spec.js`

Expected: missing new template/adapter or accessibility assertions fail.

- [ ] **Step 3: Render complete accessible content on the server.**

`GET /insights/` calls `InsightService` and renders summaries plus data tables. `GET /insights/api/report?days=7|30|90|365` returns the same canonical sections. Filter changes progressively replace sections and preserve a non-JavaScript form fallback.

- [ ] **Step 4: Isolate ApexCharts behind an adapter.**

`chart_adapter.js` dynamically imports or injects `/static/js/apexcharts.min.js` only after an Insights chart frame intersects the viewport. It accepts semantic series data and tokens, owns teardown on filter changes, disables animation for reduced motion, and never exposes ApexCharts objects to page code. Lodash is not required.

- [ ] **Step 5: Verify chart-independent usability.**

Disable JavaScript and block the chart asset; summaries and data tables remain usable. Enable JavaScript; charts enhance the same content. Validate dark/light contrast and direct label readability.

- [ ] **Step 6: Run verification.**

Run:

```bash
npm run build
npm run test
.venv/bin/python -m pytest tests/integration/test_insights_page.py -q
npm run test:e2e -- tests/browser/insights.spec.js
```

Expected: all pass and network assertions show chart assets only on Insights.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add routes/insights.py templates/pages/insights templates/components/chart.html static/js/insights static/css tests && git commit -m "feat: add accessible decision-focused insights"`. Otherwise record `phase4-task2`.

---

## Task 3: Reorganize Personal Settings and Data Ownership under You

**Files:**

- Modify: `routes/you.py`
- Modify: `routes/__init__.py`
- Modify: `app.py`
- Create: `templates/pages/you/index.html`
- Create: `templates/pages/you/catalog.html`
- Create: `templates/pages/you/preferences.html`
- Create: `templates/pages/you/notifications.html`
- Create: `templates/pages/you/privacy.html`
- Create: `templates/pages/you/account.html`
- Refactor adapters: `routes/catalog.py`
- Refactor adapters: `routes/settings.py`
- Create: `services/data_ownership_service.py`
- Create: `tests/integration/test_you.py`
- Create: `tests/security/test_data_ownership.py`
- Create: `tests/browser/you.spec.js`

- [ ] **Step 1: Write failing ownership and composition tests.**

Cover catalog default/user-owned pouches, exact preferred products and transactional rank compaction after pouch deletion, reminder channels/times, theme, immediate/future-effective timezone and daily reset, offline queue privacy toggle/identity invalidation, complete export, complete anonymization, transactional deletion confirmation, password/account controls, cross-user access to every owned record type, webhook-secret masking, and long-value/error rendering.

- [ ] **Step 2: Run and confirm `/you` is missing.**

Run: `.venv/bin/python -m pytest tests/integration/test_you.py tests/security/test_data_ownership.py -q && npm run test:e2e -- tests/browser/you.spec.js`

Expected: the Phase 1 You foundation response fails the complete You composition and ownership contract until this task expands it.

- [ ] **Step 3: Implement one You blueprint over existing services.**

Use focused routes such as `/you`, `/you/catalog`, `/you/preferences`, `/you/notifications`, `/you/privacy`, and `/you/account`. Do not duplicate data mutation logic; extract service functions from oversized legacy settings/catalog routes where necessary, then have old and new routes call the same functions.

`DataOwnershipService.export_user(user_id)` includes User profile data, owned Pouch metadata, Log snapshots, Craving, Goal, ReductionPlan, PlanRevision, PlanDay, PlanStatusEvent, DailyCheckIn, OnboardingDraft, UserPreferredPouch, UserPreferences, UserSettings, UserActivity, NotificationQueue, and NotificationHistory. It uses stable schema/version metadata and UTC-offset timestamps. Password hashes and verification/reset tokens are never exported. `anonymize_user` clears every applicable free-text field, including log/craving notes/context, revision notes, check-in reflection/context, profile values, and webhook secrets. `delete_user` removes or cascades every owned row—including OnboardingDraft, PasswordReset, and EmailVerification tokens—in one transaction and invalidates the offline queue identity.

- [ ] **Step 4: Make destructive actions explicit and recoverable where possible.**

Export precedes anonymization/deletion options. Confirmation includes the exact scope, requires a fresh password where existing policy supports it, rejects cross-user IDs, and never performs deletion on GET. State whether each action can be reversed. Add exact pre/post row-count and free-text assertions on SQLite with foreign keys enabled and disposable MySQL 8.4.

- [ ] **Step 5: Verify.**

Run:

```bash
npm run build
.venv/bin/python -m pytest tests/integration/test_you.py tests/security/test_data_ownership.py tests/security/test_security.py -q
.venv/bin/python -m pytest tests/security/test_data_ownership.py -q --db=mysql
npm run test:e2e -- tests/browser/you.spec.js
```

Expected: all personal setup and ownership workflows pass.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add routes templates/pages/you services tests && git commit -m "feat: consolidate settings and ownership under you"`. Otherwise record `phase4-task3`.

---

## Task 4: Rework Marketing, Registration, and Authentication Surfaces

**Files:**

- Rewrite: `templates/index.html`
- Rewrite: `templates/auth/login.html`
- Rewrite: `templates/auth/register.html`
- Rewrite: `templates/auth/forgot_password.html`
- Rewrite: `templates/auth/reset_password.html`
- Modify: `routes/auth.py`
- Modify: `templates/layouts/auth.html`
- Modify: `templates/layouts/marketing.html`
- Create: `tests/integration/test_auth_journey.py`
- Create: `tests/browser/public-auth.spec.js`

- [ ] **Step 1: Write failing public/auth journey tests.**

Assert landing communicates reduction journey, daily coaching loop, and data ownership; primary CTA is clear; no unsupported medical claim; no placeholder legal/support link; auth errors preserve email but not password; password requirements are visible; new user goes to onboarding; returning user with plan goes to Today; returning user without plan sees a non-blocking plan prompt.

- [ ] **Step 2: Run and confirm legacy generic marketing fails.**

Run: `.venv/bin/python -m pytest tests/integration/test_auth_journey.py -q && npm run test:e2e -- tests/browser/public-auth.spec.js`

Expected: content or redirect assertions fail.

- [ ] **Step 3: Implement concise, honest public copy.**

Explain: see today's plan, log quickly, work through cravings, learn patterns, and retain control of data. Remove rather than stub unavailable legal/support destinations. Authentication shares typography/tokens but remains visually quieter than the app.

- [ ] **Step 4: Implement destination-aware redirects.**

After registration and verification, go to onboarding. After login, active-plan users go to Today; users with a saved onboarding draft resume it; users without plans go to Today with a Create Plan prompt. Sanitize any `next` parameter to local paths.

- [ ] **Step 5: Verify both themes and error states.**

Run: `.venv/bin/python -m pytest tests/integration/test_auth_journey.py -q && npm run test:e2e -- tests/browser/public-auth.spec.js`

Expected: all pass in light/dark, narrow/wide, validation/error/success states.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add templates/index.html templates/auth templates/layouts routes/auth.py tests && git commit -m "feat: align public and auth journeys with coaching product"`. Otherwise record `phase4-task4`.

---

## Task 5: Add Explicit Legacy Route and API Compatibility

**Files:**

- Create: `routes/compat.py`
- Modify: `app.py`
- Modify: legacy route modules as adapters: `routes/dashboard.py`, `routes/logging.py`, `routes/goals.py`, `routes/cravings.py`, `routes/catalog.py`, `routes/settings.py`
- Create: `tests/integration/test_legacy_redirects.py`
- Create: `tests/api/test_legacy_adapters.py`

- [ ] **Step 1: Inventory and test concrete legacy URLs.**

Page redirects must include:

```text
/dashboard/            -> /today
/log/view              -> /today
/log/add               -> /today (quick-log intent marker allowed)
/cravings/cravings     -> /today (craving intent marker allowed)
/goals/                -> /journey/
/catalog/              -> /you/catalog
/settings/             -> /you
/settings/preferences  -> /you/preferences
/settings/notifications -> /you/notifications
/settings/data         -> /you/privacy
/settings/account      -> /you/account
```

Use `302` while compatibility is being observed; switch stable GET redirects to `308` only after method/caching behavior is verified. Preserve safe query intent, never arbitrary external `next` URLs.

- [ ] **Step 2: Write API adapter tests.**

Cover `/api/quick_add`, `/log/api/quick_add`, `/cravings/api/cravings`, `/cravings/api/analytics`, dashboard chart APIs, catalog APIs, and legacy Insights. Mutations must call canonical services, enforce CSRF/ownership, and return deprecation headers. Read adapters either map canonical data or return a documented `410` with a replacement link after all internal callers are removed.

- [ ] **Step 3: Run and confirm legacy inconsistencies.**

Run: `.venv/bin/python -m pytest tests/integration/test_legacy_redirects.py tests/api/test_legacy_adapters.py -q`

Expected: craving double-prefix and inconsistent payload/error behaviors fail.

- [ ] **Step 4: Implement the compatibility blueprint/adapters.**

Avoid duplicate URL rules. Where a legacy blueprint already owns a path, reduce its function to redirect/delegate. Add `Deprecation: true`, `Sunset`, and `Link: <canonical>; rel="successor-version"` headers to temporary API adapters. Do not delete the legacy model data or Goal history.

- [ ] **Step 5: Prove the application no longer links legacy pages.**

Run:

```bash
rg -n "url_for\('(dashboard|logging|goals|cravings|catalog|settings)\.|href=\"/(dashboard|log|goals|cravings|catalog|settings)" templates static/js routes --glob '!routes/compat.py'
```

Expected: no product-navigation/page links remain; intentional adapter internals are documented.

- [ ] **Step 6: Verify.**

Run: `.venv/bin/python -m pytest tests/integration/test_legacy_redirects.py tests/api/test_legacy_adapters.py tests/regression -q`

Expected: all redirects/adapters and historical-data checks pass.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add routes app.py templates static/js tests && git commit -m "refactor: route legacy workflows into guided coach"`. Otherwise record `phase4-task5`.

---

## Task 6: Prove Responsive, Accessible, and Visual Quality

**Files:**

- Replace: `tests/accessibility/test_accessibility.py` with `tests/accessibility/accessibility.spec.js`
- Create: `tests/browser/responsive-navigation.spec.js`
- Create: `tests/browser/keyboard-flows.spec.js`
- Create: `tests/browser/text-scaling.spec.js`
- Create: `tests/browser/reduced-motion.spec.js`
- Create: `tests/visual/visual-regression.spec.js`
- Create: `tests/visual/visual-cases.js`
- Modify as defects require: `templates/**`, `static/css/tailwind.css`, `static/js/**`

- [ ] **Step 1: Replace Selenium/Axe-Selenium tests with Playwright/axe-core.**

Use authenticated test state and deterministic fixtures. Run axe on landing, login, onboarding steps, Today empty/normal/over-target/error, Journey, Insights populated/empty, and You. Automated checks supplement, not replace, keyboard/screen-reader assertions.

- [ ] **Step 2: Add the required viewport/theme/state matrix.**

Capture at 360×800, 390×844, 768×1024, 1280×800, and 1440×900 in light and dark for: Today, onboarding, Journey, Insights, You, authentication, empty states, over-target recovery, and errors. Mask timestamps only; do not mask broken dynamic content.

- [ ] **Step 3: Add interaction accessibility tests.**

Verify skip link, landmark/heading order, keyboard-only completion, dialog labelling, focus trap/Escape/return, live announcements, 44×44 targets, non-color states, chart alternatives, 200% zoom, long translated-like strings, high contrast where testable, and reduced motion.

- [ ] **Step 4: Run and capture initial failures.**

Run:

```bash
npm run test:e2e -- tests/accessibility tests/browser tests/visual
```

Expected: initial visual snapshots are created only after semantic/accessibility assertions pass; actual defects fail before baselines are accepted.

- [ ] **Step 5: Fix defects at their source.**

Prefer component/token fixes over page-specific patches. Do not lower axe rules, widen screenshot thresholds, hide overflow globally, or remove content merely to pass snapshots. Record manual screen-reader results for the main journeys in the final verification document.

- [ ] **Step 6: Re-run until clean.**

Run: `npm run test:e2e`

Expected: all browser, accessibility, and visual projects pass in Chromium. Record any browser coverage limitation explicitly; do not claim unrun engines.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add tests templates static && git commit -m "test: verify responsive and accessible coaching ui"`. Otherwise record `phase4-task6`.

---

## Task 7: Verify Performance, Security, Migration Preservation, and Cleanup

**Files:**

- Rewrite: `tests/performance/test_performance.py`
- Expand: `tests/security/test_security.py`
- Expand: `tests/security/test_data_ownership.py`
- Expand: `tests/migrations/test_migrations.py`
- Create: `tests/regression/test_history_preservation.py`
- Create: `tests/browser/asset-loading.spec.js`
- Modify as defects require: application source files

- [ ] **Step 1: Define measurable budgets.**

On the deterministic local test server and seeded fixture, warm the application, run at least 30 measured requests, discard setup/warm-up samples, and calculate p95 from the retained durations:

- Today HTML response p95 below 500ms for 365 days/5,000 events.
- Today performs no more than 12 SQL statements.
- Today loads no ApexCharts, Lodash, or Insights module requests.
- Initial Today JavaScript authored modules total below 75KB uncompressed, excluding shared vendor assets.
- No unhandled console errors or rejected promises in primary flows.

These are regression budgets, not production network claims.

- [ ] **Step 2: Add security and ownership matrices.**

Verify CSRF, session cookie flags by environment, open-redirect rejection, user ownership for every object route/API, webhook masking, reflected/stored text escaping, JSON content-type validation, mass-assignment allowlists, rate-limit hooks or documented deployment control for auth, and no stack/database details in errors.

- [ ] **Step 3: Add preservation migration assertions.**

Upgrade both the `9a3...` synthetic fixture and separately drifted/stamped `684...` fixture through dynamic head. Assert exact row counts and representative values for User, Pouch, Log snapshots/fractional strength, Craving, Goal, ReductionPlan drafts, PlanRevision, PlanDay, PlanStatusEvent, DailyCheckIn, UserPreferredPouch, UserPreferences, UserSettings, NotificationQueue, and NotificationHistory. Assert compatible-goal drafts are migration-created, inactive, idempotent, fingerprinted, and leave every Goal row unchanged.

- [ ] **Step 4: Run and fix root causes.**

Run:

```bash
.venv/bin/python -m pytest tests/performance tests/security tests/migrations tests/regression/test_history_preservation.py -q
.venv/bin/python -m pytest tests/security/test_data_ownership.py tests/migrations tests/regression/test_history_preservation.py -q --db=mysql
npm run test:e2e -- tests/browser/asset-loading.spec.js
```

Expected: all pass. Optimize queries with bounded eager loading and indexes, not cache layers that risk user-data leakage.

- [ ] **Step 5: Remove obsolete runtime coupling after compatibility passes.**

Delete unused inline scripts, duplicate global handlers, forced-dark code, global chart imports, and unreferenced legacy page templates only when `rg` and compatibility tests prove no runtime caller. Keep legacy API/page adapters scheduled for deprecation. Do not delete archives or historical database rows.

- [ ] **Step 6: Scan for forbidden leftovers.**

Run:

```bash
rg -ni "TBD|TODO|FIXME|placeholder|implement later|broken streak|you failed" app.py routes services models templates static/js static/css
rg -n "<html[^>]*class=\"dark|apexcharts|min.js.*lodash|dashboard-charts" templates/layouts templates/pages/today
.venv/bin/python -m pytest tests/static/test_no_log_date_reads.py -q
rg -n "Log\.log_date|func\.dayofweek" routes services models
```

Expected: no shipping unfinished marker/forbidden copy, forced dark/global chart coupling, dialect-specific weekday query, or AST-detected `Log.log_date` query read. The inventory may contain only documented compatibility assignments/serialization and migration code; list every allowed match in verification evidence. Legitimate HTML `placeholder` attributes must have accessible labels and be reviewed manually rather than deleted blindly.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add app.py routes services models templates static tests && git commit -m "chore: harden and clean up ui rework"`. Otherwise record `phase4-task7`.

---

## Task 8: Execute Final Acceptance and Record Evidence

**Files:**

- Create: `docs/verification/2026-07-26-ui-ux-rework.md`
- Update: `README.md`
- Update: `docs/superpowers/specs/2026-07-26-nicotine-tracker-ui-ux-rework-design.md`

- [ ] **Step 1: Run the complete automated suite from a clean process.**

```bash
.venv/bin/python -m pytest -q
npm run build
npm run test
npm run test:e2e
```

Expected: all commands exit `0`. Record exact versions, commands, test counts, elapsed times, and exit status.

Run the required MySQL 8.4 release matrix separately:

```bash
.venv/bin/python -m pytest tests/migrations tests/regression/test_log_product_history.py tests/integration/test_plan_revisions.py tests/unit/test_idempotent_log_service.py tests/api/test_log_mutations.py tests/unit/test_craving_mutations.py tests/api/test_craving_mutations.py tests/unit/test_portable_aggregations.py tests/unit/test_insight_service.py tests/security/test_data_ownership.py -q --db=mysql
```

Expected: exit `0`. A missing or unsafe `TEST_MYSQL_URL` is a release failure, not a skipped pass.

- [ ] **Step 2: Test a copied legacy database through migration and core journeys.**

Never mutate `instance/nicotine_tracker.db` directly. Copy it to a temporary path, upgrade the copy, start the app against the copy, and verify an existing user's logs, cravings, products, goals, settings, and timezone remain visible. Do not include private values in evidence.

- [ ] **Step 3: Execute every acceptance criterion manually.**

Walk Section 15 of the authoritative design. For each criterion, record `PASS` plus the automated test or manual evidence. Include new registration → onboarding → Today, two-tap log, duplicate replay, all craving outcomes, revision history, over-target language, responsive parity, themes, analytics failure isolation, schema parity, and absence of legacy shell dependencies.

- [ ] **Step 4: Record manual accessibility review.**

This is a named human acceptance gate. The implementation agent records automated evidence and a ready-to-run script, but must mark release verification `BLOCKED — human screen-reader review required` until a named reviewer supplies a keyboard-only and screen-reader walkthrough for landing/login, onboarding, quick log, craving support, Journey revision, Insights alternatives, and destructive You actions. Record reviewer, browser, OS, screen reader, date, results, and known limitations. Never claim final acceptance from axe alone.

- [ ] **Step 5: Update operational documentation.**

README must include supported Python/Node versions, environment creation, dependency install, migration, CSS build/watch, test commands, dev server, CSRF expectations, and the temporary compatibility/sunset policy. It must not imply Git history exists in this checkout.

- [ ] **Step 6: Final placeholder and artifact review.**

Confirm no temporary audit server, copied database, screenshots containing private data, test credentials, build temp files, or `.superpowers/` artifacts are staged. When Git is restored, add `.superpowers/` to `.gitignore` unless the user explicitly wants the visual companion versioned.

- [ ] **Step 7: Final checkpoint.**

If Git is available: `git add README.md docs/verification docs/superpowers/specs && git commit -m "docs: record ui rework acceptance evidence"`. Otherwise record `phase4-task8`, exact verification commands/results, and remaining Git integration work in the final handoff.
