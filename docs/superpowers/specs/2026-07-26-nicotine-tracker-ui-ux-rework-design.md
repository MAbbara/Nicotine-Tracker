# NicotineTracker UI/UX Rework Design

**Status:** Approved for implementation  
**Date:** 2026-07-26  
**Product direction:** Guided Daily Coach  
**Primary platform:** Mobile-first responsive web; desktop optimized for planning and analysis  
**Working name:** NicotineTracker. Renaming is outside this rework.

## 1. Summary

NicotineTracker will change from a collection of equally weighted tracking utilities into a reduction-first coaching product. The central behavior loop is:

1. See today's plan and next useful action.
2. Log nicotine use or respond to a craving with minimal effort.
3. Recalculate today's status immediately.
4. Offer a realistic next action.
5. Close the day with an optional brief reflection.

The redesign retains Flask, Jinja, SQLAlchemy, Tailwind CSS, and progressive JavaScript. It does not introduce a separate SPA. It adds an explicit reduction-plan domain, modularizes the templates and JavaScript, repairs known database and portability problems, and preserves all existing user data.

## 2. Goals

- Make reducing or quitting nicotine the product's primary purpose.
- Make the usual nicotine log achievable in two taps after opening Today.
- Unite plan status, nicotine logs, cravings, and daily coaching on one screen.
- Support steady reduction, quitting by a chosen date, and an observe-only baseline period.
- Treat lapses and over-target days neutrally while preserving honest data.
- Give every metric and chart an actionable purpose.
- Provide a warm light theme and an independently tuned dark theme.
- Meet WCAG 2.2 AA across keyboard, touch, screen-reader, color, text-scaling, and reduced-motion use.
- Preserve all logs, cravings, products, settings, and historical goals during migration.
- Create clear presentation, domain, and persistence boundaries that can be implemented and tested independently.

## 3. Non-goals

- Medical diagnosis, treatment, dosing advice, or claims that a generated plan is medically safe.
- Clinician, caregiver, or social-accountability portals.
- Native iOS or Android applications.
- A React, Vue, or other SPA migration.
- Gamification based on punishment, broken streaks, public rankings, or guilt.
- A product rename or full brand strategy exercise.
- Automatic plan changes without explicit user confirmation.
- Deleting or rewriting historical data to make progress appear better.

## 4. Users and Context

The primary user regularly uses nicotine pouches and wants to reduce or quit. The product is used repeatedly on a phone throughout the day, often with one hand and sometimes while the user is stressed or experiencing a craving. Desktop use is less frequent and supports plan editing, deeper review, data export, and analytics.

The interface must feel calm, encouraging, and candid. It behaves as a trusted coach: supportive without sentimentality, direct without becoming clinical, and honest without blame.

## 5. Product Principles

1. **Today before history.** Current plan status and the next helpful action lead.
2. **Coach, never judge.** Difficult days are information, not failure.
3. **Make logging nearly effortless.** The default path contains only essential choices.
4. **Reveal depth progressively.** Advanced data and settings remain available without crowding daily use.
5. **Use data to guide action.** Decorative or redundant metrics are removed.
6. **Keep recommendations transparent.** The product names the baseline, pace, and rule behind every generated schedule.
7. **Preserve user control.** Plans can be paused, revised, restarted, or ended without losing history.

## 6. Information Architecture

### 6.1 Authenticated navigation

The current seven top-level destinations become four:

| Destination | Purpose | Includes |
| --- | --- | --- |
| **Today** | Current plan and immediate actions | Plan status, quick log, craving support, next milestone, daily timeline, end-of-day check-in |
| **Journey** | Longer reduction or quit plan | Baseline, weekly schedule, quit date, plan revisions, milestones, historical goals |
| **Insights** | Patterns that support decisions | Consumption trends, nicotine exposure, timing, triggers, craving outcomes, amount avoided, written interpretations |
| **You** | Personal setup and ownership | Pouch catalog, reminders, theme, timezone, data export, privacy, notification channels, account |

Mapping from current screens:

- Dashboard, Logs, and Cravings merge into Today.
- Goals becomes Journey.
- Dashboard analytics and the existing Insights page are consolidated into Insights.
- Catalog and Settings move under You.

### 6.2 Responsive navigation

- Mobile uses a fixed four-item bottom navigation: Today, Journey, Insights, You.
- Desktop uses a persistent four-item side rail and a wider content canvas.
- All critical functions remain available on mobile. Desktop adds space and context; it does not gain exclusive functionality.
- Legacy URLs redirect to their new destinations during the transition.

## 7. Core Screens and Journeys

### 7.1 Public landing and authentication

The landing page stops presenting a generic feature inventory. It explains the value in terms of a reduction journey, the daily coaching loop, and data ownership. Registration and authentication use the same visual system as the application. Placeholder legal and support links must not ship; they are either implemented or removed.

After account creation, new users enter onboarding. Existing authenticated users without an active plan receive a non-blocking prompt to create one; they may continue neutral tracking.

### 7.2 Onboarding

Onboarding contains five short steps and targets approximately three minutes when the user already knows their baseline.

1. **Intention:** Reduce steadily, quit by a date, or understand the baseline first.
2. **Baseline:** Review a suggestion from existing logs, enter a typical day manually, or begin a seven-day observe-only period.
3. **Pace:** Choose Gentle, Steady, or Focused after seeing the resulting duration and weekly schedule.
4. **Support:** Select difficult times or triggers, preferred products, reminder windows, and a start date. Only product strength is required for nicotine calculations.
5. **Review:** Confirm daily pouch targets, nicotine ceilings, stage timing, start date, and end target. Every assumption is editable.

For an existing user, a schedule-ready baseline suggestion is available only when at least four logged days exist among the previous fourteen complete local calendar days and every included pouch quantity has a strength snapshot. Days without logs are unknown, not zero. The suggestion uses the median pouch total, median nicotine total, and median resolved milligrams per pouch from the logged events and states exactly how many days were used. If any included strength is unknown, preserve the pouch median, leave nicotine values null, return `unknown_strength`, and offer manual nicotine values or observe mode. The user must confirm or replace the values.

For a new user or an existing user with insufficient data, the product offers manual entry or the observe-only period. Observe-only mode records usage without a reduction target and ends with a plan-review prompt.

### 7.3 Plan modes and pace

Plan modes are:

- `reduce`: Move from the confirmed baseline to a user-selected lower daily target.
- `quit_by_date`: Move from the baseline to zero by a selected date.
- `observe`: Track without a target for seven days, then calculate a proposed baseline and create a separate targeted draft for explicit confirmation. Observe mode never stores zero baselines or a fake pace as sentinels.

Pace labels express schedule length, not medical safety:

- **Gentle:** approximately 10–12 weeks.
- **Steady:** approximately 6–8 weeks and the default recommendation.
- **Focused:** approximately 3–5 weeks.

The generator evenly distributes whole-pouch reductions across the selected duration. It shows the complete schedule before activation. The user can edit duration, contiguous per-stage targets and timing, start date, end target, and quit date. Stages must cover the duration without gaps or overlap and may not increase targets. A preview is identified by a digest; activation or revision rejects a stale digest if inputs, protected days, or the earliest effective date changed. The interface states that the plan is a behavioral tracking tool rather than medical advice.

Schedule bounds normalize deterministically: `reduce` treats duration as authoritative and derives target date; `quit_by_date` treats target date as authoritative and derives duration; observe derives both as seven days; explicit stages derive both values. Any redundant supplied bound must match the derived value or validation returns `inconsistent_schedule_bounds`.

### 7.4 Dual target guardrail

Each plan day contains:

- A primary whole-pouch target.
- A nicotine ceiling in milligrams.

The initial ceiling uses the confirmed baseline's directly calculated median milligrams per pouch multiplied by the day's pouch target. It does not divide two independently calculated daily medians. This prevents a lower pouch count from appearing successful after switching to a materially stronger product. Both values remain visible in plan review; daily Today copy emphasizes pouch count and surfaces milligrams when the ceiling is approached or exceeded.

### 7.5 Today

Today contains, in order:

1. Plan day and short greeting.
2. Today's pouch target, nicotine ceiling state, remaining amount, pace, and progress.
3. Primary `Log nicotine use` action.
4. Secondary `I have a craving` action.
5. One achievable personal milestone or coaching message.
6. Chronological timeline of nicotine logs, cravings, and craving outcomes.
7. Optional end-of-day check-in when appropriate.

Today must render even when analytics or coaching generation fails. Core counts and actions depend only on the plan, logs, pouches, cravings, timezone, and daily-reset settings.

Today status is deterministic: `exceeded` if pouch actuals or the known nicotine subtotal exceed their guardrail; otherwise `unknown` when any current-day event lacks a strength snapshot; otherwise `met` when a positive pouch target or nicotine ceiling is exactly reached; otherwise `approaching` at 80% or more of either guardrail; otherwise `on_track`. No plan and observe mode are `neutral`. A zero target with zero use remains `on_track`. Pouch status remains independently visible when nicotine is unknown; partial nicotine data may never establish on-track, approaching, or met. Offer the check-in during the final two hours before reset or immediately after `met`/`exceeded`. Recommend plan review after exceeding on at least three of the last five completed targeted days. Milestones are completed contiguous plan stages or the next scheduled whole-pouch reduction.

### 7.6 Quick nicotine log

On mobile, `Log nicotine use` opens a bottom sheet. On desktop, it opens an anchored side panel. The default state contains:

- The user's most recently used or explicitly preferred pouch.
- Quantity `1`.
- Current local time.
- A clear `Log one pouch` confirmation.
- A secondary path for another product, quantity, past time, or notes.

After confirmation, Today updates optimistically with a `Syncing` state. A successful response replaces the pending entry with canonical server data and offers Undo for ten seconds. A failed response keeps the draft and offers Retry or Discard. Free-text notes never enter the offline queue.

### 7.7 Craving support

`I have a craving` opens a focused flow rather than the existing long analytical form:

1. Record intensity from 1–10 and optionally choose a trigger.
2. Choose a small immediate action, with a three-minute pause offered first.
3. Check in with one outcome: resisted, used nicotine, or used an alternative.
4. Optionally record mood, symptoms, context, or a note after the immediate moment.

Choosing `used nicotine` opens the quick log with the craving context already linked. The craving remains a valid record regardless of outcome. Craving analytics use the same normalized trigger and outcome values currently supported by the model.

### 7.8 Over-target and lapse behavior

When the user exceeds a target:

- The status is `Plan exceeded`, never `Failed`.
- The log remains visible and counts remain accurate.
- The product states that one day does not erase progress.
- The next actions are: keep logging honestly, review tomorrow's target, reflect on what changed, or pause/revise the plan.
- No streak is broken or hidden as punishment.

Repeated difficulty may produce a plan-adjustment recommendation. The plan changes only after the user reviews and confirms a new revision.

### 7.9 Journey

Journey shows the active plan, baseline, current stage, upcoming daily targets, end target or quit date, revisions, paused periods, and completed milestones. Editing a plan creates a revision effective no earlier than the next plan day that has not begun under the user's daily-reset boundary. Past and already-started PlanDay targets remain immutable.

Historical Goal rows remain visible in a legacy history section. Active legacy goals are converted into draft plans and require confirmation before activation. A `daily_pouches` goal may prefill an end target, and a compatible `daily_mg` goal may prefill the nicotine ceiling. A `weekly_reduction` goal is displayed as context but is not translated automatically because it does not define a complete daily schedule. Conflicting goals are shown separately for the user to resolve.

### 7.10 Insights

Insights contains only charts or metrics that answer a decision-relevant question. Each visualization includes a written interpretation and accessible text summary. Initial sections are:

- Pouches and nicotine milligrams over time.
- Plan adherence with targets shown alongside actual values.
- Median time between nicotine events.
- Time-of-day and weekday patterns.
- Common craving triggers and outcome rates.
- Product-strength changes.
- Estimated pouches and milligrams avoided relative to the confirmed baseline.

Charts load lazily on Insights and never block Today. Empty states explain how to generate enough data. Unsupported claims such as money saved or health improvement are not calculated without explicit, trustworthy inputs.

### 7.11 You

You contains pouch catalog management, notification channels and timing, theme, timezone and daily-reset preferences, profile, account security, data export, anonymization, and deletion controls. Export covers every existing and new user-owned record, including immutable log snapshots, cravings, goals, plan/revision/day/status history, check-ins, preferences, settings, and notification records. Anonymization clears every applicable free-text field and secret. Deletion removes every owned row transactionally and invalidates the offline queue identity. Destructive actions retain explicit confirmation and server-side ownership checks.

## 8. Visual System

### 8.1 Direction

The visual language is warm, grounded, organic, and editorial rather than technological or clinical. It avoids the AI-template signals in the current interface: forced dark mode, purple-blue gradients, repetitive metric-card grids, emoji tiles, generic rounded rectangles, and unnecessary dashboard chrome.

### 8.2 Color

Light theme foundation:

- Canvas: Warm Ivory `#F5F1E7`
- Primary ink and actions: Forest Ink `#1E2A24`
- Constructive progress: Mineral Sage `#55755F`
- Attention and plan exceptions: Terracotta `#B76343`
- Milestones: Muted Gold `#C5A05A`

Dark theme foundation:

- Canvas: Deep Forest `#111915`
- Surface: Forest Surface `#1B2721`
- Border: `#344139`
- Primary text: Warm Sand `#EEE8D8`
- Secondary text: `#A7AEA7`
- Constructive progress: `#94B29A`
- Attention: `#D38466`

Color is never the only status signal. Terracotta communicates attention, not shame or irreversible error. Pure black, pure white, neon accents, and decorative gradients are excluded.

Theme resolution order is an authenticated server choice, then a device-local choice, then the operating-system preference, then light. The persisted setting uses only `light`, `dark`, or `system`; legacy `auto` values migrate to `system`.

### 8.3 Typography

- Display face: Newsreader, self-hosted variable font where licensing permits.
- Interface face: DM Sans, self-hosted variable font where licensing permits.
- Display typography is reserved for major headings, key plan values, and reflective moments.
- Labels, controls, body copy, and tables use the interface face.
- Fluid sizes use `clamp()` and remain readable at 200% browser zoom.

If either selected font cannot be self-hosted under an acceptable license, implementation must substitute a metrically tested, licensed face with the same roles rather than silently falling back to Inter.

### 8.4 Components and spacing

- Controls use approximately 12px radius.
- Content surfaces use approximately 18px radius.
- Bottom sheets and major overlays use approximately 28px radius at the exposed edge.
- Borders carry most separation; shadows appear only for actual elevation.
- Touch targets are at least 44×44 CSS pixels.
- Layout uses tight spacing within related groups and generous spacing between sections.
- Jinja components standardize buttons, fields, status labels, sheets, empty states, alerts, timelines, and chart frames.

### 8.5 Icons, charts, and motion

- Use one consistent, accessible line-icon family at roughly 1.75px stroke.
- Do not use emojis as product icons or metric decoration.
- Charts use direct labels, restrained gridlines, one focus color, and written interpretation.
- Routine feedback targets approximately 180ms; sheets and panels approximately 240ms.
- Motion uses decelerating exponential easing, not bounce or elastic easing.
- Reduced-motion mode preserves every state change without movement-dependent meaning.

The chosen icon family, version, license, and local asset source are recorded with the font licenses. Informative icons have accessible names; decorative icons are hidden from assistive technology.

## 9. Technical Architecture

### 9.1 Stack decision

Retain:

- Flask application factory and blueprints.
- Jinja server-rendered views.
- SQLAlchemy and Alembic/Flask-Migrate.
- Tailwind CSS v4 as the build-time styling foundation.
- Progressive JavaScript with `fetch`, native semantics, and feature-sized modules.
- ApexCharts initially, isolated behind a chart adapter and loaded only on analytical screens.

Do not introduce a client-side SPA, a second routing system, or a duplicated API-only application.

### 9.2 Presentation structure

Target structure:

```text
templates/
  layouts/
    app.html
    auth.html
    marketing.html
  components/
    button.html
    field.html
    status.html
    sheet.html
    empty_state.html
    alert.html
    timeline.html
    chart.html
  pages/
    today/
    journey/
    insights/
    you/
```

The exact number of files may vary, but the contracts may not: layouts own global structure, components own reusable markup, and pages own product-specific composition. The current base template must no longer contain page-specific modal or timezone behavior.

Target JavaScript structure:

```text
static/js/
  shell/
    theme.js
    navigation.js
    offline_status.js
  today/
    quick_log.js
    craving_flow.js
    timeline.js
  journey/
    onboarding.js
    plan_editor.js
  insights/
    chart_adapter.js
    filters.js
```

Each module owns one feature and exposes the smallest required interface. Inline page scripts are removed. Charts and their dependencies are lazy-loaded only when an Insights chart enters the relevant page.

### 9.3 Route and service boundaries

New or reorganized blueprints:

- `today`: authenticated Today page.
- `journey`: onboarding, plan view, pause, resume, and revisions.
- `insights`: consolidated analytics page and read APIs.
- `you`: catalog and settings pages.
- `api`: structured mutation APIs for logs, cravings, plans, and check-ins.

Routes authenticate, parse, perform basic request-shape validation, call a service, and translate the result into HTML or JSON. They do not calculate schedules, timezone windows, chart datasets, or coaching messages.

Request middleware creates or validates a UUID request correlation ID, attaches it to structured logs and service warnings, and returns it in `X-Request-ID`. User-facing errors may include the ID for support but never expose a stack trace or database detail.

Focused services:

- `BaselineService`: baseline suggestion and source explanation.
- `PlanScheduleGenerator`: pure dataclasses, validation, stage normalization, schedule generation, and pure new-plan preview digests; it performs no database I/O.
- `PlanService`: persistence, user-row locking, protected-day state, lifecycle preview digests, PlanDay creation, revisions, status events, and plan state; it calls PlanScheduleGenerator.
- `TodayService`: local-day boundary, target, actuals, remaining values, pace, timeline, and next-action data.
- `LogService`: ownership, product resolution and immutable snapshotting, timezone conversion, idempotency, write, and undo.
- `CravingService`: craving creation, updates, outcomes, and linked nicotine logs.
- `CoachingService`: deterministic, non-medical copy derived from plan state and recent patterns.
- `InsightService`: portable aggregations and written summaries.
- `DataOwnershipService`: complete export, anonymization of every free-text field, and transactional deletion across existing and new owned records.

### 9.4 Data model

Existing User, Pouch, Log, Craving, UserPreferences, Notification, and Goal records remain authoritative.

New tables:

#### ReductionPlan

- `id`, `user_id`
- `mode`: `reduce`, `quit_by_date`, or `observe`
- `status`: `draft`, `active`, `paused`, `completed`, or `archived`
- optional `start_date` and `target_date`; targeted activation requires a start date, while incomplete migrated drafts may leave it null
- optional `baseline_pouches`, `baseline_mg`, and `baseline_mg_per_pouch`; targeted activation requires all three, while draft and observe plans may retain unknown values as null
- optional `baseline_source`: `manual`, `recent_logs`, `observe`, or `legacy_goal`; targeted activation requires it
- optional `pace`: `gentle`, `steady`, or `focused`; targeted activation requires it, while observe mode leaves it null
- optional `end_target_pouches`
- `active_revision_id`
- nullable `active_slot`, constrained to `1` when and only when status is `active`
- optional unique `migration_fingerprint` for idempotent legacy-goal draft backfill
- optional `legacy_goal_ids` JSON containing only source Goal IDs for migrated candidates
- timestamps

`user_id` plus `active_slot` is unique, so only one plan per user may have `active` status even under concurrent activation. Lifecycle transitions also lock the owning User row where the database supports row locks.

#### PlanRevision

- `id`, `plan_id`
- `effective_date`
- pace, target date, end target, and generation inputs in effect
- normalized contiguous stage targets and the confirmed preview digest in generation inputs
- `reason`: `initial`, `user_edit`, `difficulty_adjustment`, `resume`, `boundary_change`, or `other`
- optional user note
- timestamp

`effective_date` must be the local date of the next unstarted plan day or later. A revision cannot mutate the target of a plan day whose daily-reset boundary has already passed.

`PlanRevision` has a unique `(plan_id, id)` key. `ReductionPlan(id, active_revision_id)` references that composite key, and `PlanDay(plan_id, revision_id)` references it as well, so neither an active revision nor a day can cite another plan's revision.

#### PlanStatusEvent

- `id`, `plan_id`
- `status`: `active`, `paused`, `completed`, or `archived`
- `effective_at_utc`, `local_date`
- `reason`, timestamp

Every lifecycle transition appends an event. Pause history and completed observe periods are derived from these events rather than guessed from `updated_at`.

#### PlanDay

- `id`, `plan_id`, `revision_id`
- `local_date`
- nullable `target_pouches` and `nicotine_ceiling_mg`; both are null only for `observe` plan days
- timestamp

`plan_id` plus `local_date` is unique. Once a local date begins, its target values are immutable. A plan revision affects only future PlanDay rows.

#### DailyCheckIn

- `id`, `user_id`, optional `plan_id`, `local_date`
- optional mood, confidence, reflection, and context
- timestamp

#### OnboardingDraft

- `id`, unique `user_id`
- `current_step`: `intention`, `baseline`, `pace`, `support`, or `review`
- validated `structured_payload` JSON containing only allowlisted structured answers; no notes or other free text
- timestamps

The draft exists before enough information is known to create a ReductionPlan. Successful plan creation deletes it in the same transaction. It is included in export and account deletion.

Existing tables gain:

- Nullable `client_event_id` on Log and Craving, unique per user when present.
- Nullable `linked_log_id` on Craving with `ON DELETE SET NULL`.
- Decimal `Pouch.nicotine_mg` and `Log.custom_nicotine_mg` values using `Numeric(8,2)`.
- Nullable `product_brand_snapshot` and `nicotine_mg_snapshot` on Log, backfilled wherever the referenced pouch or custom values resolve; unknown historical values remain null rather than becoming zero. Every new quantified log snapshots exact values, and baseline, Today, and Insights calculations use these immutable snapshots rather than a mutable catalog row.
- Nullable `Log.pouch_id` uses `ON DELETE SET NULL`, so a catalog deletion preserves the immutable log snapshot and historical totals.
- Non-null `offline_queue_enabled` plus an opaque, non-user-identifying `offline_queue_id` on UserPreferences so privacy and account-scoped replay choices persist.
- Validated normalized `difficult_times` and `common_triggers` JSON arrays on UserPreferences.
- Optional `pending_timezone`, `pending_daily_reset_time`, `boundary_change_effective_at_utc`, and `boundary_change_target_local_date` on UserPreferences for future-effective day-boundary changes during an active plan.
- A `theme` setting constrained to `light`, `dark`, or `system`, backfilled from the legacy chart theme with `auto` becoming `system`.

#### UserPreferredPouch

- `id`, `user_id`, `pouch_id`, `rank`
- ownership and uniqueness constraints on user/pouch and user/rank; pouch and user FKs cascade association deletion

Preferred products identify an exact pouch and strength. A brand-name array alone is not sufficient for the smart logging default.

### 9.5 Interaction APIs

The detailed endpoint plan may refine naming, but the following contracts are required:

- `GET /api/today`: canonical Today summary.
- `POST /api/logs`: idempotent nicotine-log creation.
- `DELETE /api/logs/<id>`: ownership-checked undo/delete.
- `POST /api/cravings`: idempotent craving creation.
- `PATCH /api/cravings/<id>`: outcome and optional later details.
- `POST /api/plans`: create a draft or active plan after explicit confirmation.
- `POST /api/plans/<id>/revisions`: confirm a future-effective change.
- `POST /api/plans/<id>/pause`, `/resume/preview`, and `/resume`.
- `POST /api/check-ins`: create or update the current local-day reflection.
- `GET`, `PUT`, and `DELETE /api/onboarding-draft`: resume, save, or discard allowlisted onboarding progress.

All JSON endpoints, including reads, use this error envelope:

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

CSRF protection is enabled for authenticated mutations. Every query and mutation enforces user ownership.

Whole-pouch counts are JSON integers. Milligram and fractional-baseline values are fixed two-decimal JSON strings. Every timestamp includes an explicit UTC offset, unknown request fields are rejected, and cross-owner object lookups return `404`. Check-in mood and confidence are nullable integers from 1–5; free-text fields are trimmed, nullable strings of at most 2,000 characters; the server derives a check-in's local date.

## 10. Data Flows

### 10.1 Quick log

1. The client creates a unique `client_event_id` and displays a pending timeline entry.
2. `POST /api/logs` sends product, quantity, an ISO 8601 local timestamp with explicit offset, IANA timezone, and the event ID.
3. LogService validates ownership and values, verifies that the offset matches the IANA timezone at that instant, rejects nonexistent or mismatched local times, snapshots product brand/strength, converts time to UTC, and writes in one transaction.
4. Duplicate event IDs return the already-created canonical entry rather than creating a second log.
5. TodayService calculates the canonical Today summary.
6. The response replaces the pending entry and makes Undo available for ten seconds.
7. On failure, the draft remains with Retry and Discard actions.

### 10.2 Offline replay

- Structured log fields for an existing owned/default pouch may be queued in IndexedDB when the device is offline.
- Notes, ad-hoc custom products, and other free text are excluded from the queue.
- Pending entries are visibly distinct from confirmed entries.
- Replay uses the original `client_event_id`.
- Queued payloads clear after confirmed sync, explicit discard, or logout.
- Each item is scoped by the current user's opaque `offline_queue_id`; identity changes, `401`/`403`, account deletion, and privacy disable clear or quarantine unmatched items before replay.
- Offline queueing can be disabled in privacy settings.
- API responses containing user data are not cached by the service worker.

Delivery is at least once at the network layer and at most one canonical server row through idempotency; the queue eventually clears after canonical acknowledgement.

### 10.3 Craving outcome

1. A craving is created when the immediate support flow begins or when the user confirms the initial check-in.
2. A later outcome patch records resisted, used nicotine, or used an alternative.
3. `used nicotine` opens quick log with a reference to the craving.
4. On log success, the Craving receives `linked_log_id` in the same service workflow or a compensating retry.
5. Analytics treat missing outcomes as unresolved rather than resisted or used.

Undoing a linked nicotine log clears `Craving.linked_log_id` in the same transaction through `ON DELETE SET NULL` semantics while preserving the craving and its `used_nicotine` outcome.

### 10.4 Plan revision

1. The user reviews a complete future schedule made of contiguous, non-overlapping, monotonic `StageTarget(start_date, end_date, target_pouches, nicotine_ceiling_mg)` values and receives a preview digest.
2. The server rejects an effective date earlier than the next unstarted plan day.
3. Confirmation supplies the preview digest. The server returns `409 preview_stale` if inputs, protected days, or the earliest effective date changed; otherwise it creates a PlanRevision with the normalized stages.
4. Future PlanDay rows from the effective date are regenerated inside one transaction.
5. Past and current started PlanDay rows remain unchanged.
6. Today reads the PlanDay for the user's local date and daily-reset boundary.

## 11. State, Error, and Empty-State Design

### 11.1 Loading

- Server-render the Today shell and essential counts whenever possible.
- Use restrained skeletons only for delayed secondary content.
- Do not display empty chart frames before data is known.

### 11.2 Empty states

- No plan: explain the value of a plan and offer Create Plan or Continue Neutral Tracking.
- No logs: offer the smart first log and explain what will become visible.
- No cravings: explain that craving tracking is optional and available when needed.
- Insufficient insights: state the exact data requirement instead of showing zero-filled charts.

### 11.3 Validation and failures

- Field errors appear beside the relevant control and preserve every valid input.
- Database writes use explicit transactions and roll back cleanly.
- Retryable failures retain the user's draft and expose Retry.
- Analytics and coaching failures degrade independently and never remove core Today actions.
- Error messages avoid blame and include a next step.
- Server logs include a request correlation ID; user-facing messages never expose stack traces or database details.

### 11.4 Timezone and daily reset

All local-day calculations use one TimezoneService. Storage remains UTC. PlanDay lookup, Today summaries, logs, cravings, charts, reminders, and check-ins use the same timezone and configured daily-reset boundary. Legacy `log_date` reads are removed after migration verification.

Invalid timezone/reset input is rejected. Only invalid legacy persisted zones temporarily fall back to UTC and emit a correlation-ID warning. A nonexistent reset time shifts forward by the DST gap; an ambiguous reset time uses the earlier occurrence (`fold=0`). With an active plan, compute the transition as the first new timezone/reset boundary at or after the current old-boundary day ends and persist both its UTC instant and target local date. At that instant, PlanService creates a `boundary_change` revision containing re-dated normalized stages, updates `active_revision_id`, applies the preference, and assigns regenerated future PlanDays to that revision without changing their target sequence. Current/past PlanDays retain their original revision and values.

## 12. Migration and Compatibility

Implementation begins with stabilization:

1. Repair historical migrations for fresh portable upgrades and add a new head reconciliation migration for databases already stamped at a drifted revision, including UserPreferences fields referenced by models but absent in the checked database.
2. Convert pouch and custom strengths to decimal values and backfill immutable Log brand/strength snapshots before any new baseline or Today calculation uses them.
3. Replace dialect-specific functions such as MySQL `dayofweek` with portable SQLAlchemy or Python aggregation.
4. Add plan, revision, PlanDay, PlanStatusEvent, check-in, preferred-pouch, idempotency, craving-link, theme/support, offline identity, and future-effective boundary preference fields using additive migrations.
5. The additive plan migration idempotently creates one inactive `reduce` draft candidate per active `daily_pouches` goal. Exactly one active `daily_mg` goal with the same start and end dates may attach as nicotine context; unpaired/ambiguous `daily_mg` goals and every `weekly_reduction` goal remain review context only. Incomplete fields remain null, `baseline_source` is `legacy_goal`, source IDs live in `legacy_goal_ids`, and a separate unique migration fingerprint prevents duplicate candidates. No candidate activates automatically.
6. Preserve historical goals and all existing logs, cravings, products, preferences, and notification records.
7. Add redirects and temporary compatibility endpoints for legacy routes.
8. Remove compatibility code only after all migrated workflows and tests pass.

Migrations must be reversible while the new tables are unused. No migration deletes user history. Any transformation that cannot be reversed creates a backup or shadow value first.

Migration, locking, idempotency, FK deletion, decimal, and portable aggregation verification runs against SQLite with foreign keys enabled and disposable MySQL 8.4. The release gate requires both engines.

## 13. Testing and Verification

### 13.1 Unit tests

- Baseline suggestion, including insufficient-data behavior.
- Schedule generation for every mode and pace.
- Whole-pouch rounding and nicotine ceilings.
- PlanRevision future-only effects.
- One-active-plan invariant.
- Local-day and daily-reset calculations across DST and timezone changes.
- Idempotent log and craving writes.
- Craving outcomes and linked logs.
- Over-target and coaching-state selection.
- Portable analytical aggregations.

### 13.2 Integration tests

- Registration through onboarding to first Today view.
- Existing-user draft-plan migration and confirmation.
- Quick log, optimistic reconciliation contract, undo, duplicate replay, and offline replay.
- Craving support through each outcome.
- Plan pause, resume, and revision.
- Theme, timezone, daily reset, notifications, export, anonymization, and deletion ownership.
- Partial analytics failure while Today remains usable.
- Legacy URL redirects.

### 13.3 Browser and accessibility tests

- Mobile and desktop navigation.
- Light and dark themes.
- Bottom sheet, side panel, focus trapping, Escape, focus return, and keyboard-only operation.
- Touch targets and responsive layouts at narrow and wide viewports.
- 200% text scaling and long translated-like strings even before localization exists.
- Reduced motion.
- WCAG 2.2 AA automated checks plus manual screen-reader review of the main journeys.
- Chart text alternatives and non-color status cues.

### 13.4 Visual and performance verification

- Screenshot checks for Today, onboarding, Journey, Insights, You, authentication, empty states, over-target recovery, and error states in both themes.
- Today must load without ApexCharts or the chart adapter bundle.
- Analytical libraries load only on Insights.
- No console errors, duplicate global handlers, or unhandled promise rejections.
- CSS and JavaScript are built from source; the one-line generated CSS artifact is not treated as the authoring source.

## 14. Implementation Boundaries and Sequence

The detailed implementation plan will decompose the work, but it must preserve this dependency order:

1. **Stabilize:** schema drift, portable queries, timezone consistency, test baseline.
2. **Foundation:** design tokens, fonts, layouts, component macros, theme, responsive shell.
3. **Plan domain:** models, migrations, services, onboarding, and Journey.
4. **Today:** summary service, quick log, account-scoped offline replay, craving support, timeline, over-target recovery, check-in.
5. **Secondary surfaces:** Insights consolidation and You reorganization.
6. **Compatibility and polish:** redirects, legacy-goal history, accessibility, visual regression, and performance.

Each phase must finish with its relevant tests passing before the next phase changes dependent behavior. Kimi implementation agents receive bounded tasks from this sequence; product and design decisions remain governed by this specification.

## 15. Acceptance Criteria

The rework is complete only when:

- A new user can register, create a plan, and reach Today without encountering the legacy dashboard.
- An existing user's logs, cravings, products, goals, settings, and timezone remain intact.
- A usual nicotine log takes two taps from Today and cannot duplicate during replay.
- Craving support records all three outcomes and links nicotine use correctly.
- Plan targets and nicotine ceilings remain historically stable after revisions.
- Over-target days use neutral recovery language and retain all data.
- Mobile exposes all essential functionality; desktop provides expanded composition rather than separate capabilities.
- Light and dark themes match the approved visual system.
- Today remains usable when analytics, charts, or coaching content fail.
- The migrated database matches current models and uses portable queries.
- All required unit, integration, browser, accessibility, visual, and performance checks pass.
- No primary screen depends on the old seven-item navigation, forced dark mode, giant base template, inline page scripts, or emoji metric tiles.

## 16. Approved Visual References

The browser companion artifacts are stored under `.superpowers/brainstorm/3501594-1785054558/content/`:

- `product-directions.html`
- `product-structure.html`
- `onboarding-and-plan.html`
- `core-interactions.html`
- `visual-system.html`
- `technical-architecture.html`

These artifacts illustrate hierarchy and direction. This specification is authoritative when a mockup omits a state or conflicts with an explicit requirement.
