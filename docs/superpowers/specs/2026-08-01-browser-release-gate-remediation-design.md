# Browser Release-Gate Remediation Design

**Date:** 2026-08-01

**Status:** Approved in conversation; awaiting written-spec review

**Source:** `docs/verification/2026-08-01-full-browser-audit.md`

## Purpose

Clear the two critical and seven high findings from the full browser acceptance
audit without broad product rewrites or interference with concurrent branding
work. The result must preserve existing routes and data models, make failure
states explicit and safe, and provide regression evidence strong enough to
rerun the release decision.

## Scope

This remediation covers exactly these audit findings:

1. C1 — grouped Data & Privacy forms dispatch the wrong action;
2. C2 — Insights and dashboard fail because ApexCharts is absent;
3. H1 — the data-retention input has no programmatic label;
4. H2 — theme state conflicts with legacy dark-mode utilities;
5. H3 — verified contrast and keyboard-scroll failures;
6. H4 — analytics lacks resilient, accessible alternatives and Insights
   overflows at 320px;
7. H5 — private, auth, and token-bearing pages are not explicitly excluded
   from indexing;
8. H6 — the installable/offline contract exceeds actual cold-offline support;
9. H7 — the public landing page conflicts with the product brand and includes
   an unsupported social-proof claim.

The eight medium and three low findings remain documented. They may be fixed
only when a scoped high-priority change necessarily touches the same behavior
and the additional correction is small, directly tested, and does not expand
the architecture.

## Global constraints

- Preserve all existing application routes and database models.
- Do not connect to or mutate production or user data during implementation or
  verification.
- Use disposable test databases and synthetic accounts for browser actions.
- Do not overwrite, discard, stage, or commit concurrent branding work in
  `static/favicon.png`, `static/icons/pwa/`, `static/brand/`, or the currently
  modified layout files except through a reviewed patch that preserves those
  changes.
- Keep the existing warm ivory, mineral-green, restrained-terracotta,
  editorial visual direction. Do not introduce purple-blue gradients,
  neon-on-dark styling, glassmorphism, emoji-led metric cards, repetitive
  dashboard grids, guilt language, or unsupported claims.
- Target WCAG 2.2 AA, including color-independent meaning, visible focus,
  keyboard access, comfortable mobile targets, and reduced-motion support.
- Follow test-driven development: each behavior change begins with a focused
  failing test that is observed failing for the intended reason.
- Keep dependencies local and version-pinned. No runtime dependency may rely on
  a third-party CDN.

## Selected approach

Use focused release-gate remediation. Correct each root cause and introduce a
shared contract only where multiple findings depend on the same behavior. Do
not rebuild whole subsystems or perform unrelated legacy cleanup.

Rejected alternatives:

- A broad subsystem modernization would produce a cleaner long-term codebase
  but is too large for the release gate and would collide with active branding
  changes.
- A critical-only hotfix would leave the seven agreed high findings unresolved
  and would not satisfy the approved remediation scope.

## Architecture and component boundaries

### 1. Destructive-action safety

Each Data & Privacy submit control must contribute one action value through the
clicked button. A form must not contain multiple hidden inputs with the same
`action` name. The settings route must validate the submitted action against an
explicit allowlist before entering any mutation branch.

Action-specific validation remains isolated to its branch. A missing, unknown,
or conflicting action must perform no mutation and return a clear error.
Destructive operations retain explicit confirmation fields and existing CSRF
protection.

The route contract is:

- exactly one recognized action selects exactly one operation;
- invalid action input selects no operation;
- response copy names the operation actually performed;
- tests assert database effects, not only flash text or HTTP status.

### 2. Analytics runtime and resilient output

A locally stored, pinned ApexCharts browser bundle must load before Insights or
dashboard initialization. The shared app layout may expose the dependency to
analytics routes, or analytics templates may load it through a route-specific
script block. The selected implementation must avoid loading the chart runtime
on unrelated pages when the existing template architecture can do so safely.

Chart initialization must check both the runtime and target element before
constructing a chart. Initialization failures must not leave unexplained blank
space. Each chart region must retain a concise textual interpretation and an
accessible data representation derived from the same server-provided values.
The text or table is primary content; the chart is a visual enhancement.

The runtime contract is:

- no uncaught page error during normal analytics navigation;
- successful initialization produces observable chart output;
- unavailable or failed chart initialization produces an accessible status
  message while leaving the underlying values usable;
- chart containers have programmatic names;
- 320px layouts contain chart content without page-level horizontal overflow.

### 3. Unified theme contract

The root `data-theme` attribute is authoritative for application styling and
JavaScript. Theme preference and effective theme are distinct:

- saved preference: `light`, `dark`, or `system`;
- effective theme: `light` or `dark` after resolving `system` against
  `prefers-color-scheme`.

The theme controller must publish the effective theme in one stable DOM form
consumed by styles, chart palettes, `color-scheme`, and `theme-color`. If legacy
Tailwind utilities require a `.dark` class, that class must be synchronized
with the effective theme rather than removed unconditionally. No component may
independently infer theme from stale local storage or an unrelated class.

System preference changes must update the effective theme only while the saved
preference is `system`. Explicit Light or Dark selections remain stable when
the OS preference changes.

### 4. Accessibility and responsive corrections

The `days_to_keep` input receives a visible, correctly bound label and any help
text is associated through `aria-describedby`.

The verified Journey, dashboard, detailed-log, and 404 color pairs must meet a
minimum 4.5:1 ratio for normal text in both themes. Corrections should use
shared semantic tokens when the failing color is token-driven; isolated legacy
colors may be corrected locally when token changes would affect unrelated
surfaces.

Horizontally scrollable Journey and dashboard regions must be keyboard
focusable, have an accessible name or instruction, and show a visible focus
indicator. Their content must remain usable at 320px and at keyboard focus.

Insights must not cause page-level horizontal overflow at 320px. Internal
tables or charts may scroll within a named, focusable region when fitting the
content would make it unreadable.

### 5. Indexing and token privacy

Authenticated application layouts, authentication pages, and reset-token pages
must emit `robots` metadata with `noindex, nofollow`. Token-bearing pages must
also emit a restrictive referrer policy so a reset URL is not sent as a
referrer to another origin.

The public landing page remains indexable and must not inherit the private-page
directive. Tests must exercise rendered public, auth, authenticated, and reset
responses rather than checking only template source.

This scope does not add canonical URLs, Open Graph metadata, robots.txt, or a
sitemap; those are medium-priority audit findings.

### 6. Honest PWA and offline contract

This release pass will not introduce a new service-worker subsystem. The
manifest may continue to provide standalone presentation metadata, and the
existing in-session offline mutation queue may remain. Product copy, metadata,
and acceptance documentation must not claim that a cold offline launch or full
offline application shell is supported.

Tests must make the boundary explicit: queued mutations may recover during an
existing loaded session, while the absence of a service worker is not described
as full offline capability. Implementing cold-offline support is a separate
future project requiring cache versioning, update strategy, logout/data
isolation, and installed-device testing.

### 7. Public landing trust surface

The landing page content and styling must use the existing warm editorial
system. The unsupported “Join thousands” claim must be removed unless the
repository contains an approved source for it. Emoji-led feature cards and the
purple gradient/indigo call-to-action treatment must be replaced with restrained
typography, native shapes or existing icon language, and the established color
tokens.

The page must retain clear Sign in and registration paths, one H1, a concise
product explanation, responsive behavior at 320px, visible keyboard focus, and
reduced-motion behavior. This is a focused surface correction, not a new brand
identity or marketing-information architecture project.

Because marketing and layout files contain concurrent work, implementation must
first diff those files against HEAD, preserve the user's edits, and patch only
the landing content or metadata needed by this design.

## Data flow and failure handling

### Data & Privacy request flow

1. The user activates one submit button.
2. The browser submits one `action=<recognized-value>` pair plus the branch's
   required fields and CSRF token.
3. The route rejects absent or unrecognized actions before mutation.
4. The selected branch validates its own fields and confirmation text.
5. Exactly one service operation runs inside the existing transaction model.
6. The response reports the operation that actually completed or a safe error.

### Analytics initialization flow

1. Server-rendered text and tables arrive with the page.
2. The pinned local chart runtime loads.
3. Page initialization confirms runtime and target availability.
4. Charts enhance the server-rendered information.
5. A caught initialization failure exposes a live-region message and preserves
   the source information; it does not raise an uncaught page error.

### Theme resolution flow

1. Read the saved preference from the existing server/client preference source.
2. Resolve `system` through the current media query.
3. Publish saved and effective values on the root element.
4. Synchronize any compatibility `.dark` class, CSS color scheme, theme-color
   metadata, and chart palette from the effective value.
5. Listen for OS changes only when `system` is selected.

## Testing strategy

### Red-green regression cycles

Each group starts with a test that fails against the current implementation:

- every Data & Privacy submit action asserts its exact state change;
- missing and invalid actions assert zero mutations;
- Insights and dashboard navigation assert zero uncaught page errors and
  observable chart output;
- simulated chart-runtime failure asserts accessible fallback content;
- Light, Dark, and System tests assert root state, compatibility class,
  browser color scheme, and chart palette behavior;
- authenticated axe checks reproduce and clear the label, contrast, and
  scrollable-region findings;
- 320px Insights checks assert no page-level horizontal overflow;
- rendered response tests assert correct robots and referrer metadata by route
  class;
- public landing tests reject the retired unsupported claim, emoji feature
  treatment, and purple-gradient treatment while preserving primary actions;
- offline/PWA assertions distinguish in-session mutation replay from cold
  offline shell support.

### Focused verification

Run the smallest relevant Python, JavaScript, CSS, or Playwright test after each
red-green cycle. Verify the failing test fails for the intended missing behavior
before writing production code.

### Integrated verification

Before changing the release record, run fresh:

- the complete Python test suite;
- the JavaScript unit suite;
- the production Tailwind build;
- the complete Playwright suite across configured projects;
- the expanded authenticated axe/page-error/320px route scan;
- a manual Chromium pass through Data & Privacy, Insights, dashboard, theme
  selection, landing, authentication, reset, Journey scrolling, detailed log,
  and 404.

Any failed command or reproduced critical/high finding keeps the release at
NO-GO. Safari/iPhone, installed-PWA, named human accessibility, and
production-configured HTTPS staging checks remain separate required gates.

## Delivery and commit boundaries

Implementation should be split into independently reviewable commits:

1. destructive-action regression tests and fix;
2. analytics runtime, fallback semantics, responsive behavior, and tests;
3. shared theme contract and tests;
4. label, contrast, focusable-scroll, and authenticated axe corrections;
5. route indexing/referrer protection and honest PWA contract tests;
6. focused landing trust-surface correction and browser tests;
7. refreshed browser audit and release-verification evidence.

Files from concurrent branding work must never be staged incidentally. A commit
that must touch a concurrently modified layout must stage only the reviewed
hunks or wait until the conflicting work is integrated.

## Acceptance criteria

The remediation is ready for browser re-acceptance only when all of the
following are true:

- each Data & Privacy button invokes exactly its named operation;
- invalid Data & Privacy action input performs no mutation;
- Insights and dashboard render without uncaught errors;
- analytics remains meaningful when chart enhancement is unavailable;
- Light, Dark, and System consistently control modern, legacy, and chart
  surfaces;
- the audited label, contrast, keyboard-scroll, and 320px overflow violations
  are absent;
- private/auth/token pages are not indexable and token referrers are restricted;
- no product artifact claims unsupported cold-offline behavior;
- the landing page matches the established visual direction and contains no
  unsupported social-proof claim;
- focused and complete automated verification passes freshly;
- the manual Chromium recheck finds none of C1, C2, or H1–H7;
- the release record states remaining medium/low and external human/staging
  gates accurately.

## Non-goals

- Implementing a service worker or cold-offline application shell.
- Rebuilding all legacy routes or creating a new design system.
- Resolving the eight medium and three low findings as an independent scope.
- Adding public canonical, Open Graph, Twitter card, robots.txt, sitemap, or
  structured-data support.
- Changing database schema, route URLs, product domain models, or notification
  delivery architecture.
- Modifying production data, deploying, pushing, merging, tagging, or changing
  external systems.
