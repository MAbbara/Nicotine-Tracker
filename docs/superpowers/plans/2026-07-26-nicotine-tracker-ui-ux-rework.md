# NicotineTracker UI/UX Rework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current utility-style tracker with the approved mobile-first Guided Daily Coach while preserving every user's history and keeping Flask/Jinja as the rendering architecture.

**Architecture:** Stabilize the existing database and time model first, build a shared server-rendered design foundation, add a revision-safe reduction-plan domain, make Today the resilient daily loop, then consolidate secondary surfaces and compatibility behavior. Routes parse and authorize, services own domain rules, Jinja owns initial rendering, and feature-sized JavaScript modules progressively enhance interactions.

**Tech Stack:** Python 3.11+, Flask 2.3, Jinja, SQLAlchemy/Flask-Migrate, SQLite and MySQL-compatible SQLAlchemy, Tailwind CSS 4, native ES modules, IndexedDB, ApexCharts behind an adapter, pytest, Playwright, axe-core.

**Authoritative design:** [`../specs/2026-07-26-nicotine-tracker-ui-ux-rework-design.md`](../specs/2026-07-26-nicotine-tracker-ui-ux-rework-design.md)

## Global Constraints

- Read `AGENTS.md`, the authoritative design, and the current phase plan before editing.
- Product and visual decisions are already approved. Do not substitute a generic dashboard, add gamified punishment, introduce gradients, restore the seven-item navigation, or force dark mode.
- Keep Flask/Jinja/SQLAlchemy/Tailwind. Do not introduce a SPA, client-side router, or parallel API-only application.
- Use test-driven development: add one focused failing test, run it and confirm the expected failure, implement the smallest passing behavior, then rerun the focused test and the affected suite.
- Within every task, repeat `one behavior test → focused red run → minimal implementation → focused green run` before adding the next behavior. A task's listed behavior matrix is a completion checklist, not authorization to write all of its tests before the first implementation.
- Preserve all existing logs, cravings, pouches, preferences, notifications, settings, and goals. Migrations are additive unless a shadow/backfill makes a change demonstrably reversible.
- Store event timestamps in UTC and calculate user days only through `TimezoneService` with half-open intervals: `start_utc <= event_time < end_utc`.
- Treat `Log.log_date` as write-only compatibility data until its eventual removal. No new read path may query, group, sort, or calculate by it.
- Enforce ownership in every query and mutation. Enable CSRF on authenticated mutations; JSON requests use a CSRF header token emitted by the app shell.
- Core Today data must render without analytics, chart libraries, or coaching generation.
- User-facing copy is neutral and non-medical. Use “Plan exceeded,” never “failed,” and never claim health or financial outcomes without trustworthy user inputs.
- No placeholder links, placeholder screens, `TODO`, `TBD`, silent fallback behavior, or unhandled empty/error/loading state may ship.
- The current checkout has no usable Git metadata. Do **not** run `git init`. At each commit checkpoint, commit only if the repository metadata has been restored; otherwise record the checkpoint in the task handoff and continue.
- One implementation worker edits a bounded task at a time. After each task, the primary agent runs the task's verification and reviews the diff before dispatching the next worker.

## Shared Contracts

Every JSON endpoint, including reads, uses this error envelope:

```json
{
  "error": {
    "code": "stable_machine_code",
    "message": "Human-readable recovery guidance",
    "field_errors": {},
    "retryable": false
  }
}
```

The canonical user-day boundary is:

```python
from dataclasses import dataclass
from datetime import date, datetime

@dataclass(frozen=True)
class UserDayWindow:
    local_date: date
    start_utc: datetime
    end_utc: datetime
```

Every JSON timestamp is ISO 8601 with an explicit offset. Every local plan date is `YYYY-MM-DD` and is interpreted with the user's current timezone and daily reset.

Whole-pouch counts are JSON integers. Milligram values and fractional baseline values are fixed two-decimal JSON strings so SQLite, MySQL, JavaScript, and Python retain the same decimal meaning. Unknown JSON fields are rejected. Cross-owner object lookups return `404` rather than revealing that another user's row exists.

All real-browser, accessibility, and visual tests use `@playwright/test` and filenames under `tests/{browser,accessibility,visual}/**/*.spec.js`. Pytest owns Python unit, API, integration, migration, property, regression, security, and performance tests only.

## Phase Order

1. [Stabilization and foundation](./2026-07-26-nicotine-tracker-stabilization-foundation.md)
2. [Reduction plan and onboarding](./2026-07-26-nicotine-tracker-plan-onboarding.md)
3. [Today and core interactions](./2026-07-26-nicotine-tracker-today-interactions.md)
4. [Secondary surfaces and release quality](./2026-07-26-nicotine-tracker-secondary-quality.md)

Do not begin a later phase until the earlier phase's exit gate passes. Within a phase, follow task order unless the plan explicitly says tasks are independent.

## Cross-Phase File Map

```text
models/
  reduction_plan.py
  plan_revision.py
  plan_day.py
  plan_status_event.py
  daily_check_in.py
  onboarding_draft.py
  user_preferred_pouch.py
services/
  baseline_service.py
  plan_schedule.py
  plan_service.py
  legacy_goal_service.py
  onboarding_draft_service.py
  today_service.py
  coaching_service.py
  check_in_service.py
  api_types.py
  api_schemas.py
  serializers.py
  insights_service.py
  request_context.py
  preference_service.py
  data_ownership_service.py
routes/
  today.py
  journey.py
  you.py
templates/
  layouts/{app,auth,marketing}.html
  components/{button,field,status,sheet,empty_state,alert,timeline,chart}.html
  pages/{today,journey,insights,you}/...
static/js/
  shell/{theme,navigation,offline_status}.js
  today/{quick_log,craving_flow,timeline}.js
  journey/{onboarding,plan_editor}.js
  insights/{chart_adapter,filters}.js
```

The old templates and routes remain only as compatibility adapters until Phase 4. New page composition must use the target structure from the first implementation onward.

## Required Verification at Every Phase Gate

Run from the repository root:

```bash
.venv/bin/python -m pytest tests/unit tests/api tests/integration -q
npm run build
npm run test
```

Expected: all selected tests pass, the CSS build exits `0`, and JavaScript unit tests exit `0`. Phase 4 adds the browser, accessibility, visual, migration, property, security, and performance suites.

If `.venv` does not exist, create it with Python 3.11 or 3.12 and install `requirements.txt` plus `requirements-dev.txt`. Do not claim verification until commands have run in the project environment.

## Execution Checkpoints

- [ ] Phase 1 exit: checked legacy SQLite fixture upgrades to head; model/schema parity, portable aggregation, half-open timezone tests, component-shell tests, and both themes pass.
- [ ] Phase 2 exit: baseline, schedule, revision, one-active-plan, onboarding, Journey, and legacy-goal draft conversion tests pass.
- [ ] Phase 3 exit: Today fallback, quick-log idempotency/undo, offline replay, craving linkage, check-in, over-target recovery, and mobile/desktop interaction tests pass.
- [ ] Phase 4 exit: Insights, You, landing/auth, compatibility redirects, preservation migration, accessibility, visual, security, and performance checks pass.
- [ ] Final acceptance: execute every criterion in Section 15 of the authoritative design and record evidence in `docs/verification/2026-07-26-ui-ux-rework.md`.

Release verification runs the migration, plan concurrency, idempotency, FK deletion, and portable aggregation suites against SQLite with `PRAGMA foreign_keys=ON` and disposable MySQL 8.4 via `TEST_MYSQL_URL`. The MySQL gate is required in CI/release verification and may not be silently skipped. Manual screen-reader review is a named human acceptance gate; automated axe results cannot substitute for it.
