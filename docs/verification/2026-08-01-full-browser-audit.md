# Full browser acceptance audit — 2026-08-01

## Release verdict

**TECHNICAL BROWSER PASS / RELEASE REMAINS CONDITIONAL NO-GO.** The two critical
and seven high browser findings have been remediated and passed fresh focused,
complete, and manual Chromium verification at `d6419a6`. The eight medium and
three low findings remain tracked below. They are not newly promoted release
blockers, but they are also not represented as fixed.

This is not an unconditional GO. A named human accessibility review, a real
iPhone Safari/installed-PWA review, and production-configured HTTPS staging
verification remain required external release gates.

The original finding pass was a read-only product audit; no application fixes
were made during that pass. The later remediation commits are listed below,
and the resumed Task 7 verification changed only these evidence records. All
account, log, profile, plan, notification, password-reset, and deletion actions
used a disposable in-memory test application and synthetic accounts. No
production or user database was connected or changed.

## Anti-pattern verdict

**The release-critical landing-page mismatch is remediated.** The landing now
uses the warm ivory, mineral-green, and restrained terracotta editorial system,
native line symbols, candid copy, and no unsupported social-proof claim. Legacy
surface fragmentation remains recorded as medium finding M8 rather than being
silently treated as complete design-system migration.

## Executive summary

| Measure | Result |
| --- | --- |
| Browser acceptance | **TECHNICAL PASS** |
| Quality score | Prior 58 / 100 score retained as historical baseline; not rescored |
| Critical findings | **2 remediated / 0 open** |
| High findings | **7 remediated / 0 open** |
| Medium findings | **8** |
| Low findings | **3** |
| Complete Playwright suite | **174 passed, 2 intentional desktop skips for mobile-only assertions in 3.3 minutes** |
| Browser projects exercised | Desktop Chromium and Pixel 7 Chromium |
| Historical original-audit viewport | 320 × 720 CSS pixels |
| Historical original-audit inventory | 30 page/viewport combinations |
| Fresh Task 7 targeted viewport | 320 × 800 CSS pixels for repaired authenticated overflow/containment states; 320 × 760 for landing |

The expanded automated suite now asserts analytics runtime and fallback
behavior, exact destructive-action dispatch, explicit theme state,
accessibility across repaired routes, indexing privacy, the supported offline
boundary, and the rebuilt landing page. It complements rather than replaces
the external human, real-device, and HTTPS staging gates.

## Scope and evidence

### Automated evidence

| Check | Evidence | Result |
| --- | --- | --- |
| Complete Python suite | `.venv/bin/python -m pytest -q` | 1,201 passed, 2 skipped, 31 warnings in 293.01s / exit 0 |
| Complete JavaScript suite | `npm test` | 8 passed, 0 failed, 0 skipped in 400.599ms / exit 0 |
| Production CSS build | `npm run build` | Tailwind CSS 4.1.11 completed in 133ms / exit 0 |
| Complete end-to-end suite | `npm run test:e2e` | 174 passed, 2 intentional desktop skips for mobile-only assertions in 3.3m / exit 0 |
| Fresh manual Chromium scan | Repository-pinned Playwright Chromium against the disposable Flask app | PASS; exact actions, runtime/fallback, themes, axe, keyboard scrolling, 320px, metadata/referrer behavior, offline status, and landing visuals |

### Manual action coverage

| Area | Actions exercised | Result |
| --- | --- | --- |
| Marketing/authentication | Landing, Sign in link, invalid login, valid login | Navigation and validation worked |
| Password recovery/privacy | Forgot-password request, token reset/login from the original audit; fresh valid-token metadata and outgoing navigation | Original flow passed; fresh reset page rendered `noindex, nofollow` and `no-referrer`, and navigation away sent no `Referer` header or destination `document.referrer` |
| Primary navigation | Today, Journey, Insights, You | Passed; one active destination and working Insights |
| Today / Quick Log | Open advanced fields, choose product/strength, quantity, notes, submit | Passed; timeline and progress updated |
| Journey | Mobile layout, pause, resume preview, confirm resume | Passed; state and history persisted |
| Profile | Change age, gender, and weight; save and reload | Passed |
| Preferences | Change units, timezone, and reset time; save and reload | Passed |
| Notifications | Enable channels/schedules, save, queue weekly report | Persistence passed; pre-save behavior is contradictory |
| Data & Privacy | Button payloads; cleanup, merge, recalculate, anonymize, and delete logs | Passed in the disposable app; exact success branch observed for each action |
| Account lifecycle | Delete synthetic account; reject subsequent login | Deletion worked; confirmation was lost after redirect |
| Responsive behavior | 320px landing, Insights, dashboard, and Data & Privacy checks | Passed; document width remained 320px |
| Keyboard scroll | Journey schedule, dashboard recent logs, and log history at 320px | Tab reached each named `tabindex="0"` region; ArrowRight increased scroll offsets and visible 2px outlines remained |
| Error handling | Unknown authenticated route | Correct 404 status, one main landmark, Today recovery link, and no scoped axe violations; M5 remains retained for explicit medium-finding disposition |
| Themes | Select Light, Dark, and System across modern and legacy pages | Passed; saved/effective theme, `.dark`, `color-scheme`, metadata, and charts agree |

## Remediation closure record

Historical finding descriptions below are retained so the audit trail remains
reviewable. This table is the current status record.

| Finding | Fix commit(s) | Regression evidence | Fresh manual evidence | Status |
| --- | --- | --- | --- | --- |
| C1 — Data action dispatch | `6a1365a`, `e22b0f0` | `tests/integration/test_settings_data_actions.py`, log-time authority, and final-review regressions; 55 focused Python tests plus Data & Privacy axe passed | Inspected unique submitted values and exercised cleanup, merge, recalculate, anonymize, and delete logs; each reached its named branch | **Remediated** |
| C2 — analytics runtime | `b2df5b8`, `4593494` | Analytics unit, rendered-page, desktop/mobile browser, and adjacent Python gates passed | Insights and dashboard rendered charts and named tables without runtime errors; aborted ApexCharts produced the visible table fallback on both routes | **Remediated** |
| H1 — retention label | `6a1365a`, `e22b0f0` | Data & Privacy axe and integration coverage passed | “Days to keep” was visible, required, and associated with `days_to_keep_help`; scoped axe returned no A/AA violations | **Remediated** |
| H2 — theme contract | `af9e926`, `30b61aa`, `f92b3c0` | Shell/analytics unit and desktop/mobile browser gates passed | Explicit Dark, System, and Light produced matching saved/effective state, `.dark`, and `color-scheme`; analytics remained usable | **Remediated** |
| H3 — contrast and keyboard scroll | `09ec541`, `f92b3c0`, `d6419a6` | Complete desktop/mobile accessibility suite passed; the desktop project had two intentional skips for mobile-only assertions | Fresh axe scans returned no A/AA violations. At 320px, Tab focused the named Journey schedule, dashboard recent-logs, and log-history regions; ArrowRight moved scroll offsets from 0 to 296, 245, and 320px respectively while each retained a visible 2px outline | **Remediated** |
| H4 — analytics alternatives/320px | `b2df5b8`, `4593494` | Analytics browser tests cover named tables, runtime failure, and 320px containment | At 320px Insights showed chart plus named table with no page overflow; the runtime-failure state retained the table and visible status | **Remediated** |
| H5 — indexing privacy | `a0b7c3e` | Indexing/privacy integration gate passed | Login/authenticated pages exposed `noindex, nofollow`. A fresh valid reset-token page rendered `noindex, nofollow` plus `no-referrer`; clicking its sign-in link sent no `Referer` request header and left destination `document.referrer` empty | **Remediated** |
| H6 — install/offline contract | `a0b7c3e` | Offline shell/unit/browser and indexing/PWA/layout gates passed | Offline and back-online live-region messages were visible; cold offline launch remains explicitly unsupported rather than promised | **Remediated by narrowing the contract** |
| H7 — landing brand/trust | `2491e52`, `d6419a6` | Landing design-token, desktop/mobile browser, focused accessibility, CSS build, and complete browser gates passed | Desktop and 320px visual inspection confirmed the editorial palette/layout, working actions, contained width, and no unsupported social proof | **Remediated** |

The preferred Playwright CLI wrapper was attempted first, but its packaged CLI
hardcoded `/opt/google/chrome/chrome`, which is absent in this environment. The
manual scan therefore used the repository's installed, pinned Playwright
Chromium runtime. Screenshots and other disposable artifacts remain under
`output/playwright/` and are not release-source evidence.

## Original critical findings — remediated

### C1. Grouped Data & Privacy forms dispatch the wrong action

- **Location:** `templates/settings/data.html:31`,
  `templates/settings/data.html:68`, `routes/settings.py:318`
- **Category:** Functionality / destructive action safety
- **Evidence:** Clicking **Recalculate** returned the cleanup result “No
  duplicate entries found.” Clicking **Delete Logs** returned “Your personal
  data has been anonymized successfully.” Each grouped form contains several
  hidden inputs named `action`; `request.form.get('action')` reads the first
  value, not the action associated with the clicked submit button.
- **Impact:** A user can request one maintenance or destructive operation and
  receive a different one. This violates user intent and makes destructive data
  controls unsafe to release.
- **Recommendation:** Give each submit button a single submitted action value
  (or separate forms), require explicit confirmation for each destructive
  branch, and add route-level tests that click every button and assert the
  exact mutation—not only the response message.
- **Suggested workflow:** `superpowers:systematic-debugging`, then
  `superpowers:test-driven-development`.

### C2. Analytics pages fail because ApexCharts is absent

- **Location:** `templates/insights/insights.html:151`,
  `templates/insights/insights.html:631`, `static/js/dashboard-charts.js:35`,
  `templates/layouts/app.html:84`
- **Category:** Functionality / analytics
- **Evidence:** Insights and dashboard both raise
  `ReferenceError: ApexCharts is not defined`; their chart regions remain
  blank. The app layout loads Preline, main, and shell scripts, but no
  ApexCharts runtime.
- **Impact:** The product's deeper review and analytics experience is unusable,
  despite both pages returning HTTP 200.
- **Recommendation:** Load and pin the chart runtime before page initializers,
  add a graceful textual fallback, and make browser tests fail on uncaught page
  errors and missing chart output.
- **Suggested workflow:** `superpowers:systematic-debugging`, then
  `superpowers:test-driven-development`.

## Original high findings — remediated

### H1. Data retention input has no programmatic label

- **Location:** `templates/settings/data.html:83`
- **Category:** Accessibility
- **Evidence:** axe reports a critical `label` violation for the
  `days_to_keep` number input.
- **Impact:** Screen-reader and voice-input users cannot reliably identify the
  control. This fails WCAG 2.2 success criteria 1.3.1 and 3.3.2.
- **Recommendation:** Bind a visible `<label>` to the input and keep supporting
  help text associated with `aria-describedby`.
- **Suggested workflow:** `i-harden`.

### H2. Theme state conflicts with legacy dark-mode utilities

- **Location:** `static/js/shell/theme.js:41`,
  `templates/layouts/app.html:1`, legacy templates using `dark:` utilities
- **Category:** Theming / visual consistency
- **Evidence:** The new controller sets `data-theme` and removes the `.dark`
  class, while legacy Tailwind dark variants continue to follow the operating
  system. With Light selected on a dark OS, Profile still rendered as a dark
  blue card. Chart code also reads `.dark`, which the controller removes.
- **Impact:** User theme preference is not authoritative; adjacent surfaces can
  disagree, and chart colors can select the wrong palette.
- **Recommendation:** Adopt one theme contract across CSS, templates, and chart
  code, then test explicit Light, Dark, and System states independently.
- **Suggested workflow:** `i-normalize`.

### H3. Verified contrast and keyboard-scroll failures remain

- **Location:** Journey status/link styling, dashboard summary/table styling,
  detailed log metadata, and `templates/errors/404.html`
- **Category:** Accessibility
- **Evidence:** Serious axe contrast failures ranged from 4.02–4.28:1 where
  normal text requires 4.5:1. Journey's table wrapper and the mobile dashboard
  scroll region were also reported as scrollable but not keyboard focusable.
- **Impact:** Low-vision and keyboard-only users can miss status content or be
  unable to operate horizontally scrollable information. This conflicts with
  WCAG 1.4.3 and keyboard operability expectations.
- **Recommendation:** Increase token contrast, add an intentional focusable
  scroll-container pattern with visible focus, and cover these authenticated
  routes in axe tests.
- **Suggested workflow:** `i-audit`, then `i-harden`.

### H4. Analytics lacks resilient and accessible alternatives

- **Location:** `templates/insights/insights.html:151`,
  `static/js/dashboard-charts.js`
- **Category:** Accessibility / responsive design
- **Evidence:** Chart containers are empty unlabeled divisions with no data
  table or equivalent summary. Insights also causes horizontal page overflow at
  320px.
- **Impact:** Screen-reader users cannot access chart meaning, users without
  JavaScript receive no useful equivalent, and narrow-screen users must pan the
  page.
- **Recommendation:** Add concise insight text and accessible tables, label
  visualizations, contain their responsive width, and treat charts as an
  enhancement rather than the only representation.
- **Suggested workflow:** `data-analytics:visualize-data` and `i-adapt`.

### H5. Private and token-bearing pages are not explicitly excluded from indexing

- **Location:** `templates/layouts/app.html`, `templates/layouts/auth.html`,
  `routes/auth.py:315`
- **Category:** SEO / privacy
- **Evidence:** Authenticated pages, login, and reset-token responses have no
  `noindex` directive. Login can also produce many `next` URL variants.
- **Impact:** Crawlers may index low-value auth variants or sensitive reset URL
  shapes. A reset token should not become a discoverable URL.
- **Recommendation:** Add `noindex, nofollow` to authenticated, auth, and
  token-bearing pages; use an appropriate referrer policy; and keep token pages
  out of discovery files.
- **Suggested workflow:** `i-harden`.

### H6. The installable/offline contract is incomplete

- **Location:** `static/manifest.webmanifest`, application layouts
- **Category:** PWA / resilience
- **Evidence:** The manifest is valid and advertises standalone behavior with
  192px and 512px icons, and the product has an offline action queue. However,
  `/service-worker.js` returns 404 and no service-worker registration exists.
- **Impact:** A cold offline launch has no application shell, so installed-app
  and offline expectations exceed actual capability.
- **Recommendation:** Either implement and test the service-worker lifecycle
  and offline shell or narrow the install/offline promise until that support is
  ready.
- **Suggested workflow:** `i-harden`.

### H7. The public landing page conflicts with the product brand and trust model

- **Location:** `templates/index.html:40`, `templates/index.html:60`,
  `templates/index.html:158`
- **Category:** Visual design / content integrity
- **Evidence:** The page uses a purple gradient, indigo controls, emoji feature
  cards, and a generic centered SaaS composition. “Join thousands of people” is
  presented without supporting evidence.
- **Impact:** The first impression conflicts with the warm, calm coaching
  system and introduces an avoidable credibility claim.
- **Recommendation:** Rebuild the landing content using the established ivory,
  mineral-green, and terracotta system; replace emoji with purposeful native
  visual language; and remove or substantiate the social-proof claim.
- **Suggested workflow:** `i-frontend-design`, then `i-clarify`.

## Medium findings

### M1. Settings pages lack page headings and comfortable touch targets

- **Location:** Profile, Account, Preferences, Statistics, Notifications, and
  Data & Privacy templates
- **Category:** Accessibility / information architecture
- **Evidence:** The expanded scan found no `<h1>` on those pages. Six controls
  per common settings page, and twelve on Notifications, were below 44 × 44 CSS
  pixels at 320px.
- **Impact:** Page purpose is less clear to assistive technology and repeated
  mobile settings actions are harder to use reliably with one hand.
- **Recommendation:** Restore one descriptive H1 per page and enlarge interactive
  hit areas without inflating visual density.
- **Suggested workflow:** `i-adapt` and `i-arrange`.

### M2. Weekly-report action reads persisted state while the form shows unsaved state

- **Location:** Notifications settings form and manual weekly-report action
- **Category:** UX / state management
- **Evidence:** Checking weekly reports immediately enabled **Send Weekly
  Report**, but clicking it before saving returned “Enable weekly reports before
  sending…” After saving, the action queued successfully.
- **Impact:** The interface advertises an available action that the server will
  reject, creating contradictory feedback.
- **Recommendation:** Disable the action until changes are saved, autosave the
  prerequisite, or submit the current form state with the action.
- **Suggested workflow:** `i-clarify` and `superpowers:test-driven-development`.

### M3. Successful account deletion loses its confirmation

- **Location:** Account deletion redirect/session-clearing flow
- **Category:** UX / destructive action feedback
- **Evidence:** The synthetic account was deleted and subsequent login was
  rejected, but no success confirmation appeared after redirect. The session
  and site-data cleanup likely removes the flash carrying that message.
- **Impact:** After an irreversible action, the user receives no visible proof
  that the requested deletion succeeded.
- **Recommendation:** Deliver confirmation in a way that survives secure session
  teardown, without retaining the deleted account's session.
- **Suggested workflow:** `i-clarify`.

### M4. Public SEO discovery and sharing metadata is incomplete

- **Location:** `templates/layouts/marketing.html`, public routes
- **Category:** SEO
- **Evidence:** The landing page has a description but no canonical URL, Open
  Graph tags, Twitter card, or share image. `/robots.txt` and `/sitemap.xml`
  return 404.
- **Impact:** Search engines receive weaker canonical/discovery signals and
  shared links render without controlled title, summary, or image.
- **Recommendation:** Add environment-aware canonical and social metadata plus
  production-safe robots and sitemap endpoints.
- **Suggested workflow:** `i-harden`.

### M5. The 404 page retains legacy styling — partially remediated

- **Location:** `templates/errors/404.html:8`,
  `templates/errors/404.html:20`
- **Category:** Accessibility / navigation / visual consistency
- **Evidence:** The original audit found a nested second `<main>`, a 4.28:1
  contrast failure, a stale “Dashboard” link, and legacy purple styling. Fresh
  verification confirms one main landmark, clean scoped axe results, and a
  Today recovery link. The legacy visual styling remains.
- **Impact:** Landmark, contrast, and recovery terminology are repaired, but
  the error surface still looks like an older product era.
- **Recommendation:** Migrate the remaining visual styling to current shared
  tokens/components, then explicitly close this retained medium finding.
- **Suggested workflow:** `i-normalize` and `i-clarify`.

### M6. Branding and legacy JavaScript payloads are disproportionate

- **Location:** `static/favicon.png`, current header logo asset,
  `static/js/preline.js`
- **Category:** Performance
- **Evidence:** The favicon is 587,873 bytes, the current header logo is 831,505
  bytes while displayed around 32px, and the 340,727-byte Preline script is
  eagerly loaded on many legacy routes. Intrinsic image dimensions are absent.
- **Impact:** Unnecessary transfer, decode, and script work can delay mobile
  rendering and increase layout instability risk.
- **Recommendation:** Produce appropriately sized optimized assets with
  intrinsic dimensions and load only the legacy modules each route needs.
- **Suggested workflow:** `i-optimize`.

### M7. Theme metadata and layout support are hardcoded to light

- **Location:** `templates/layouts/app.html:13`,
  `templates/layouts/auth.html:2`, `templates/layouts/marketing.html:2`
- **Category:** Theming / browser integration
- **Evidence:** All layouts publish the light ivory theme color; auth and
  marketing surfaces are permanently light even though the app advertises a
  dark theme.
- **Impact:** Browser chrome can visibly disagree with the selected theme, and
  cross-surface transitions feel unfinished.
- **Recommendation:** Define whether dark mode is app-only or product-wide, then
  make `color-scheme` and `theme-color` follow that explicit contract.
- **Suggested workflow:** `i-normalize`.

### M8. Legacy and modern interface systems remain fragmented

- **Location:** Landing, auth, dashboard, Insights, settings, and error templates
- **Category:** Design system / accessibility
- **Evidence:** Repeated generic card grids, indigo/gray tokens, emoji-led
  content, legacy validation patterns, and inconsistent toast semantics coexist
  with the modern editorial shell.
- **Impact:** Visual hierarchy, behavior, and accessibility expectations change
  by route, increasing user confusion and maintenance cost.
- **Recommendation:** Inventory legacy primitives, migrate routes to shared
  tokens/components in user-value order, and retire parallel validation and
  notification patterns.
- **Suggested workflow:** `i-extract`, then `i-normalize`.

## Low findings

### L1. Public metadata is too generic for rich discovery

- **Location:** Marketing layout and manifest
- **Category:** SEO / PWA
- **Evidence:** The title is generic, there is no structured data, and the
  manifest lacks richer optional presentation metadata such as screenshots.
- **Impact:** Search snippets and installation surfaces miss opportunities to
  explain the product clearly.
- **Recommendation:** Add specific page titles and only defensible structured
  data; add manifest presentation metadata after screenshots are intentionally
  produced and maintained.

### L2. Global error/toast handling has overlapping semantics

- **Location:** Shared frontend initialization and legacy notification code
- **Category:** Resilience / maintainability
- **Evidence:** Duplicate global rejection handling and differing toast patterns
  are present across the old and new UI systems.
- **Impact:** One failure can produce inconsistent or duplicated feedback.
- **Recommendation:** Consolidate error normalization and announcement behavior
  into one accessible shared primitive.

### L3. Browser coverage is deep in core flows but uneven elsewhere

- **Location:** `tests/browser/`
- **Category:** Test quality
- **Evidence:** Today, Quick Log, cravings, offline replay, Journey, and major
  responsive states are strong. Authentication errors/reset, settings and
  destructive actions, Insights runtime behavior, primary navigation clicks,
  advanced Quick Log fields, and WebKit/iOS behavior are partial or absent.
- **Impact:** A green total can hide route-specific failures such as C1 and C2.
- **Recommendation:** Add risk-based assertions for every destructive action,
  uncaught page errors, route-specific script initialization, and cross-browser
  behavior; avoid duplicating low-value happy-path coverage merely to increase
  test count.

## Systemic patterns

- **HTTP 200 had been mistaken for a working page.** Analytics regression tests
  now assert runtime initialization, visible output, named alternatives, and
  failure behavior.
- **Grouped form markup had obscured user intent.** Exact-action integration
  coverage and fresh disposable-browser actions now verify the repaired
  dispatch contract.
- **Two interface eras coexist.** Theme control, palette, components,
  validation, toasts, and accessibility behavior differ by route.
- **Accessibility scope was expanded.** Authenticated settings, analytics,
  detailed records, error routes, both explicit themes, and mobile overflow
  states now participate in maintained coverage.
- **The offline contract is intentionally bounded.** In-session queue/recovery
  is supported; cold offline launch and an offline shell remain unsupported.

## Positive findings

- All 174 runnable maintained Playwright tests pass across desktop and mobile
  Chromium, with 2 intentional desktop skips for mobile-only assertions.
- Today supports focused one-handed logging, advanced log fields, progress, and
  timeline feedback.
- Journey pause and preview/confirm resume behavior works and preserves history.
- Profile, preferences, and saved notification settings persist correctly.
- Password recovery and account deletion complete correctly in the disposable
  environment.
- Exact Data & Privacy actions dispatch independently in disposable state.
- Most audited pages do not cause page-level horizontal overflow at 320px.
- Landing, login, Today, Journey, Insights, You, Data & Privacy, dashboard, log
  history, and authenticated 404 were clean in the fresh axe scan.
- The web manifest parses successfully and has appropriate 192px and 512px
  standalone icons.

## Limitations

- Chromium was exercised; Safari/WebKit, Firefox, real iPhone behavior, and an
  installed PWA were not tested.
- No human screen-reader session or named end-to-end keyboard-only review was
  performed. The targeted Chromium Tab/Arrow checks above do not replace that
  external human gate.
- SMTP and Discord delivery were not sent to external systems; local queueing
  behavior was tested only in the disposable app.
- Local development response sizes and timings are recorded only as diagnostic
  evidence, not as production Core Web Vitals.
- No production or public staging crawl, indexing check, TLS/security-header
  audit, or production data operation was performed.
- Visual inspection covered representative states, not every combination of
  user data, language, browser zoom, and operating-system setting.

## Prioritized release recommendations

1. Complete and record the named human accessibility review.
2. Complete and record the real-iPhone Safari/installed-PWA review.
3. Validate security, session, notification, manifest/icon, ownership, and
   operational behavior on production-configured HTTPS staging.
4. Triage the preserved eight medium and three low findings; do not infer their
   closure from C1/C2/H1-H7 remediation.
5. Change the release verdict to GO only when the external gates pass and the
   intended release checkout is clean.
