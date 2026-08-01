# Today and Core Interactions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Today the resilient daily home where users understand their plan, log nicotine in two taps, get immediate craving support, and recover neutrally from difficult days.

**Architecture:** `TodayService` composes only plan, event, preference, and pouch data into a stable view model. Idempotent services own mutations and return canonical summaries. The server renders a fully usable Today page; small JavaScript modules add optimistic updates, sheets/panels, retry, undo, IndexedDB replay, and timed craving support.

**Tech Stack:** Flask/Jinja, SQLAlchemy, pytest, Tailwind CSS, native ES modules, IndexedDB, Playwright.

## Global Constraints

Phases 1–2 must be green. Follow the [master plan](./2026-07-26-nicotine-tracker-ui-ux-rework.md). Every listed test matrix is a completion checklist implemented through repeated one-behavior red/green cycles. Today may not import or load ApexCharts, Lodash, `InsightService`, Pandas, or chart assets. A failure in coaching or analytics must never hide counts or primary actions. Free text is never stored in the offline queue.

---

## Task 1: Compose a Canonical, Resilient Today View Model

**Files:**

- Create: `services/today_service.py`
- Create: `services/coaching_service.py`
- Create: `services/api_types.py`
- Create: `tests/unit/test_today_service.py`
- Create: `tests/unit/test_coaching_service.py`

- [ ] **Step 1: Define the exact view-model contract in tests.**

```python
@dataclass(frozen=True)
class TodaySummary:
    local_date: date
    window_start_utc: datetime
    window_end_utc: datetime
    plan: TodayPlan | None
    actual_pouches: int
    actual_nicotine_mg: Decimal | None
    known_nicotine_mg: Decimal
    remaining_pouches: int | None
    remaining_nicotine_mg: Decimal | None
    status: Literal["neutral", "unknown", "on_track", "approaching", "met", "exceeded"]
    pouch_status: Literal["neutral", "on_track", "approaching", "met", "exceeded"]
    nicotine_state: Literal["neutral", "unknown", "on_track", "approaching", "met", "exceeded"]
    timeline: tuple[TimelineItem, ...]
    smart_default: SmartDefault | None
    check_in: CanonicalCheckIn | None
    coaching: CoachingMessage | None
```

The serialized contract also includes `generated_at` with an explicit UTC offset. Timeline items have `type`, `id`, `occurred_at_utc`, `occurred_at_local`, `state`, `label`, and type-specific structured data.

`GET /api/today` returns this stable outer shape:

```json
{
  "today": {
    "local_date": "2026-07-26",
    "window": {"start_utc": "2026-07-25T21:00:00+00:00", "end_utc": "2026-07-26T21:00:00+00:00"},
    "generated_at": "2026-07-26T16:00:00+00:00",
    "plan": null,
    "actuals": {"pouches": 0, "nicotine_mg": "0.00", "known_nicotine_mg": "0.00", "unknown_strength_events": 0},
    "remaining": {"pouches": null, "nicotine_mg": null},
    "status": "neutral",
    "pouch_status": "neutral",
    "nicotine_state": "neutral",
    "timeline": [],
    "smart_default": null,
    "check_in": null,
    "coaching": null
  }
}
```

Plan, event, product, check-in, and coaching subobjects use the typed schemas defined below. If any current-day event has unknown strength, `actuals.nicotine_mg` and `remaining.nicotine_mg` are null, `known_nicotine_mg` retains the partial subtotal, and `nicotine_state` is `unknown`. The endpoint uses the standard error envelope on failure.

Define these frozen typed contracts in `services/api_types.py` and serialize without undeclared keys:

- `TodayPlan`: `id`, `mode`, `status`, `local_date`, `day_number`, nullable integer `target_pouches`, nullable two-decimal `nicotine_ceiling_mg`, nullable `pace`, and `stage_label`.
- `SmartDefault`: `pouch_id`, `brand`, two-decimal `nicotine_mg`, and `source` (`preferred` or `recent`).
- `CoachingMessage`: stable `key`, `headline`, `body`, and allowlisted `actions` containing `key`, `label`, and internal `href`.
- `CanonicalLog`: `id`, nullable `client_event_id`, offset `occurred_at_utc`, offset `occurred_at_local`, nullable `pouch_id`, nullable `product_brand`, nullable two-decimal `nicotine_mg`, integer `quantity`, nullable two-decimal `total_nicotine_mg`, nullable `notes`, and nullable `linked_craving_id`.
- `CanonicalCraving`: `id`, nullable `client_event_id`, offset UTC/local times, integer `intensity`, nullable normalized `trigger`, nullable `outcome`, nullable `linked_log_id`, and the allowlisted optional detail fields from Task 6.
- `CanonicalCheckIn`: `id`, `local_date`, nullable integer `mood`, nullable integer `confidence`, nullable `reflection`, and nullable `context`.
- `MutationWarning`: stable `code` and boolean `retryable`.
- Timeline discriminated union: every item has `type`, `id`, both offset times, `state`, and `label`; `type=log` has `data: CanonicalLog`, `type=craving` has `data: CanonicalCraving`, and `type=check_in` has `data: CanonicalCheckIn`. No generic untyped `data` shape is accepted.

- [ ] **Step 2: Write failing state tests.**

Cover no plan/no logs, active observe plan, zero target with zero use, below 80%, exactly 80%, exactly at a positive target, pouch/mg exceeded priority, quantity totals, fractional immutable strength snapshots, non-midnight reset, chronological mixed log/craving/outcome timeline, exact preferred/recent smart product, missing/deleted pouch fallback, final-two-hours check-in timing, three-of-five exceeded review threshold, and stage-derived milestones.

- [ ] **Step 3: Prove coaching failure isolation.**

Patch `CoachingService.message_for_today` to raise. `TodayService.get_summary` must still return counts, plan state, timeline, actions, and `coaching=None` while logging a correlation-aware warning.

- [ ] **Step 4: Run and confirm imports fail.**

Run: `.venv/bin/python -m pytest tests/unit/test_today_service.py tests/unit/test_coaching_service.py -q`

Expected: missing module failures.

- [ ] **Step 5: Implement bounded, portable composition.**

Required interface:

```python
class TodayService:
    @classmethod
    def get_summary(cls, user_id: int, local_date: date | None = None,
                    now: datetime | None = None) -> TodaySummary:
        ...
```

Use one `UserDayWindow`; query only current-day logs/cravings/check-in and the matching `PlanDay`; calculate nicotine from immutable `Log.nicotine_mg_snapshot` and expose unknown-strength counts rather than zero; sort timeline in Python using canonical UTC event time. Select the smart default from ranked `UserPreferredPouch` rows first, then most recent owned/default pouch. Use eager loading to avoid per-event pouch queries.

Apply status in this exact order: `exceeded` if pouch actuals or the known nicotine subtotal exceed their guardrail; else `unknown` if any current-day event lacks a strength snapshot; else `met` when a positive pouch target or nicotine ceiling is exactly reached; else `approaching` at 80% or more of either guardrail; else `on_track`. No plan/observe is `neutral`; a zero target with zero use is `on_track`. Calculate `pouch_status` independently, retain `known_nicotine_mg`, and never let partial nicotine data establish on-track, approaching, or met. Offer check-in in the final two hours before reset or immediately after `met`/`exceeded`. Recommend review only after at least three exceeded days among the last five completed targeted days. Milestones are completed contiguous stages or the next scheduled whole-pouch reduction.

- [ ] **Step 6: Implement deterministic coaching states.**

`CoachingService` returns a key, headline, body, and allowed action list. Copy is non-medical and selected from explicit states: neutral tracking, early on-track, target met, plan exceeded, unresolved craving, and end-of-day reflection. It must never alter plan data or call an LLM/network service.

- [ ] **Step 7: Verify and checkpoint.**

Run: `.venv/bin/python -m pytest tests/unit/test_today_service.py tests/unit/test_coaching_service.py -q`

Expected: all pass. If Git is available, commit `feat: compose resilient today summary`; otherwise record `phase3-task1`.

---

## Task 2: Render Today as the Authenticated Home

**Files:**

- Modify: `routes/today.py`
- Modify: `routes/__init__.py`
- Modify: `app.py`
- Create: `templates/pages/today/index.html`
- Create: `templates/pages/today/_plan_status.html`
- Create: `templates/pages/today/_actions.html`
- Create: `templates/pages/today/_timeline.html`
- Create: `templates/pages/today/_check_in.html`
- Modify: `templates/layouts/app.html`
- Modify: `static/css/tailwind.css`
- Create: `tests/integration/test_today_page.py`
- Create: `tests/browser/today-page.spec.js`

- [ ] **Step 1: Write failing route and semantic-layout tests.**

Assert `/today` requires auth, registered/activated users land on Today, server HTML includes plan day, pouch target, nicotine state, primary and secondary actions, timeline and optional check-in, no-plan and no-log empty states, one `h1`, chronological `time[datetime]`, and no chart/lodash script.

- [ ] **Step 2: Run and confirm 404/template failures.**

Run: `.venv/bin/python -m pytest tests/integration/test_today_page.py -q && npm run test:e2e -- tests/browser/today-page.spec.js`

Expected: the Phase 1 Today foundation response fails the new Today semantic contract until this task expands the existing handler and templates.

- [ ] **Step 3: Implement a thin page route and server-first template.**

`GET /today` calls `TodayService.get_summary(current_user.id)`. A core-data failure renders a specific recoverable error with logging actions where possible; a coaching failure is already isolated. The page order is exactly: greeting/plan day, status, Log nicotine use, I have a craving, coaching/milestone, timeline, check-in.

- [ ] **Step 4: Make navigation/home redirects target Today.**

Authenticated visits to `/` and successful login/registration-plan completion go to `/today`. Do not remove legacy dashboard routes yet; Phase 4 owns compatibility redirects.

- [ ] **Step 5: Verify mobile and desktop composition.**

Run:

```bash
npm run build
.venv/bin/python -m pytest tests/integration/test_today_page.py -q
npm run test:e2e -- tests/browser/today-page.spec.js
```

Expected: mobile primary action is visible without nav overlap; desktop uses the wider content canvas; both retain identical capabilities.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add routes app.py templates/pages/today templates/layouts/app.html static/css tests && git commit -m "feat: make today the authenticated home"`. Otherwise record `phase3-task2`.

---

## Task 3: Implement Idempotent Quick Log, Canonical Reconciliation, and Undo

**Files:**

- Rewrite: `services/log_service.py`
- Modify: `routes/api.py`
- Create: `services/serializers.py`
- Create: `tests/unit/test_idempotent_log_service.py`
- Create: `tests/api/test_log_mutations.py`
- Create: `tests/integration/test_quick_log_contract.py`

- [ ] **Step 1: Write failing idempotency and ownership tests.**

Cover duplicate `client_event_id` returns the same log and `201` then `200`, no ID creates independent legacy-compatible events, product must be global default or user-owned, quantity 1–100, past/future timestamp limits, timezone validation, custom strength validation, free-text notes accepted online, linked craving ownership, delete/undo ownership, and preservation of the committed log when post-commit Today-summary composition fails.

- [ ] **Step 2: Define request and response contracts.**

```json
{
  "client_event_id": "018f...uuid",
  "pouch_id": 12,
  "custom_product": null,
  "quantity": 1,
  "occurred_at_local": "2026-07-26T18:42:00+03:00",
  "timezone": "Asia/Riyadh",
  "notes": "",
  "craving_id": null
}
```

Exactly one of `pouch_id` or `custom_product` is supplied. Online custom input is `{ "brand": "Trimmed brand", "nicotine_mg": "6.50" }`; brand is at most 80 characters and strength is a positive two-decimal string. Unknown fields are rejected. The explicit offset must match the supplied IANA timezone at that instant; nonexistent or mismatched wall times return `422 invalid_local_time`. Replay preserves the original offset and timezone.

Success returns `{ "log": <CanonicalLog>, "today": <canonical summary or null>, "created": true, "warnings": [] }`. Never trust user-supplied nicotine values for a selected `pouch_id`. `DELETE /api/logs/<id>` returns `{ "deleted_log_id": <id>, "today": <summary or null>, "warnings": [] }`. If post-commit Today composition fails after any committed log, craving, or check-in mutation, return the canonical mutation data with `today: null` and `warnings: [{"code":"today_refresh_unavailable","retryable":true}]`; never return an error implying that the committed mutation rolled back. The client refetches only `GET /api/today` and does not replay the original mutation.

- [ ] **Step 3: Run and confirm old `/api/quick_add` behavior fails.**

Run SQLite: `.venv/bin/python -m pytest tests/unit/test_idempotent_log_service.py tests/api/test_log_mutations.py tests/integration/test_quick_log_contract.py -q`

Run the concurrency/FK subset on MySQL: `.venv/bin/python -m pytest tests/unit/test_idempotent_log_service.py tests/api/test_log_mutations.py -q --db=mysql`

Expected: 404 for `POST /api/logs`, duplicate creation, or wrong error shape.

- [ ] **Step 4: Implement transactional service methods.**

```python
@dataclass(frozen=True)
class CreateLogResult:
    log: Log
    created: bool


class LogService:
    @classmethod
    def create_idempotent(cls, user_id: int, payload: CreateLogInput) -> CreateLogResult:
        ...

    @classmethod
    def delete_owned(cls, user_id: int, log_id: int) -> None:
        ...
```

Look up an existing event ID before insert and also catch the unique-constraint race, roll back, then return the canonical existing row. Snapshot brand/strength in the Log row before commit. When `craving_id` is supplied and outcome is `used_nicotine`, set `linked_log_id` in the same transaction. `delete_owned` clears any owned craving link in the same transaction before/through `ON DELETE SET NULL`, preserving the craving and outcome. `log_date` may be assigned as compatibility data from UTC, but no read path may use it.

- [ ] **Step 5: Add `GET /api/today`, `POST /api/logs`, and `DELETE /api/logs/<id>`.**

Routes use shared error translation and CSRF. `DELETE` returns the recalculated Today summary. `/api/quick_add` becomes a temporary adapter that calls the same service and advertises deprecation without bypassing idempotency/ownership.

- [ ] **Step 6: Verify.**

Run SQLite: `.venv/bin/python -m pytest tests/unit/test_idempotent_log_service.py tests/api/test_log_mutations.py tests/integration/test_quick_log_contract.py -q`

Run MySQL: `.venv/bin/python -m pytest tests/unit/test_idempotent_log_service.py tests/api/test_log_mutations.py -q --db=mysql`

Expected: all pass, including concurrent duplicate-event simulation and linked-log deletion on SQLite with foreign keys enabled and MySQL.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add services/log_service.py services/serializers.py routes/api.py tests && git commit -m "feat: add idempotent quick logging api"`. Otherwise record `phase3-task3`.

---

## Task 4: Build the Two-Tap Quick-Log Sheet and Optimistic State Machine

**Files:**

- Create: `templates/pages/today/_quick_log.html`
- Create: `static/js/today/quick_log.js`
- Create: `static/js/today/timeline.js`
- Modify: `templates/pages/today/index.html`
- Modify: `static/css/tailwind.css`
- Create: `tests/js/quick_log.test.js`
- Create: `tests/browser/quick-log.spec.js`

- [ ] **Step 1: Write failing reducer/state tests.**

States are `closed`, `editing`, `submitting`, `synced`, and `failed`. Test smart default, quantity 1, current local time, one confirmation from the opened sheet, pending timeline insertion, canonical replacement, Retry/Discard draft preservation, duplicate response handling, ten-second Undo, expired Undo, focus trap, Escape close, and focus return.

- [ ] **Step 2: Run and confirm missing module behavior.**

Run: `npm run test && npm run test:e2e -- tests/browser/quick-log.spec.js`

Expected: module/page control failures.

- [ ] **Step 3: Implement progressive disclosure.**

Initial mobile sheet shows selected product, quantity `1`, current time, and `Log one pouch`. “Change details” reveals product, quantity, past time, and notes. Desktop uses the same markup/state in an anchored side panel selected by CSS. The trigger plus confirmation is the ordinary two-tap path.

- [ ] **Step 4: Implement optimistic reconciliation without global handlers.**

Create one UUID event ID per draft, render a visibly labelled `Syncing` item, submit once with an `AbortController`, replace by canonical ID on success, and retain the exact structured draft on error. Use event delegation inside the Today root only. Announce important state changes through one polite live region.

- [ ] **Step 5: Implement Undo as an accessible timed action.**

The ten-second visual affordance uses `DELETE /api/logs/<id>`. Reduced motion disables animated countdown but retains text. If delete fails, restore the canonical entry and show recovery guidance.

- [ ] **Step 6: Verify interaction semantics.**

Run:

```bash
npm run build
npm run test
.venv/bin/python -m pytest tests/integration/test_quick_log_contract.py -q
npm run test:e2e -- tests/browser/quick-log.spec.js
```

Expected: usual logging is two taps; keyboard, mobile sheet, desktop panel, Retry/Discard, and Undo pass.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add templates/pages/today static/js/today static/css tests && git commit -m "feat: add optimistic two-tap quick log"`. Otherwise record `phase3-task4`.

---

## Task 5: Add Privacy-Aware Offline Replay

**Files:**

- Create: `static/js/today/offline_queue.js`
- Modify: `static/js/today/quick_log.js`
- Modify: `static/js/shell/offline_status.js`
- Modify: `routes/settings.py`
- Create: `tests/js/offline_queue.test.js`
- Create: `tests/integration/test_offline_replay.py`
- Create: `tests/browser/offline-replay.spec.js`

- [ ] **Step 1: Write failing queue privacy tests.**

Test structured fields persist, `notes`, custom products, and every other free-text field are stripped, original `client_event_id` is retained, successful replay clears the item, duplicate replay clears it, retryable failure retains it, permanent validation failure requires Discard/Edit, account identity change or `401`/`403` quarantines/clears prior items, logout/account deletion clears the database, privacy setting disables/clears it, and no API response is CacheStorage-cached.

- [ ] **Step 2: Run and confirm missing queue module.**

Run: `npm run test && .venv/bin/python -m pytest tests/integration/test_offline_replay.py -q && npm run test:e2e -- tests/browser/offline-replay.spec.js`

Expected: module/setting failures.

- [ ] **Step 3: Consume the persisted, account-scoped preference.**

Phase 1 already added `offline_queue_enabled` and the opaque `offline_queue_id`. Emit both through authenticated shell configuration without exposing a raw database user ID. Expose the toggle under You later; for now the canonical preference endpoint and app shell provide the value.

- [ ] **Step 4: Implement a narrow IndexedDB adapter.**

Database: `nicotine-tracker`; store: `pending_events`; composite key: `[offline_queue_id, client_event_id]`. Persist only the opaque queue ID, event ID, an existing owned/default `pouch_id`, quantity, offset local time, timezone, and craving ID. Do not queue ad-hoc custom brand/strength input because the brand is free text; the user must save it as a pouch first or retry online. Do not persist notes, context, outcome notes, reflection, mood text, raw user IDs, or server responses.

- [ ] **Step 5: Replay safely.**

Replay on the `online` event and app-shell start, one item at a time in insertion order **only** when its queue ID matches the current shell identity. Use the original event ID. Reconcile canonical Today data after each success. Clear or quarantine unmatched items on identity change and `401`/`403`; clear on explicit logout, account deletion, and setting disable. No service worker is required for this feature; if one is later added, `/api/*` must be network-only.

- [ ] **Step 6: Verify online/offline transitions.**

Run:

```bash
npm run test
.venv/bin/python -m pytest tests/integration/test_offline_replay.py tests/migrations -q
npm run test:e2e -- tests/browser/offline-replay.spec.js
```

Expected: at-least-once delivery produces at most one canonical server row through idempotency, eventually clears the queue, and all account-isolation/privacy assertions pass.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add models migrations static/js routes/settings.py tests && git commit -m "feat: add privacy-aware offline log replay"`. Otherwise record `phase3-task5`.

---

## Task 6: Make Cravings Idempotent, Outcome-Aware, and Log-Linkable

**Files:**

- Rewrite relevant mutations: `services/craving_service.py`
- Modify: `models/craving.py`
- Modify: `routes/api.py`
- Create: `tests/unit/test_craving_mutations.py`
- Create: `tests/api/test_craving_mutations.py`

- [ ] **Step 1: Write failing mutation tests.**

Cover intensity 1–10, normalized optional trigger, offset/timezone validation, idempotent create, unresolved initial outcome, each allowed outcome (`resisted`, `used_nicotine`, `used_alternative`), unknown-field rejection, invalid transitions/values, optional later details with length/range constraints, ownership, duplicate patch safety, used-nicotine linkage, linked-log deletion, and missing outcomes excluded from outcome-rate denominators.

- [ ] **Step 2: Run and confirm old nested endpoint/error shape fails.**

Run: `.venv/bin/python -m pytest tests/unit/test_craving_mutations.py tests/api/test_craving_mutations.py -q`

Expected: `/api/cravings` is missing or legacy behavior does not satisfy idempotency/envelope tests.

- [ ] **Step 3: Implement service contracts.**

```python
class CravingService:
    @classmethod
    def create_idempotent(cls, user_id: int, payload: CreateCravingInput) -> CreateCravingResult:
        ...

    @classmethod
    def update_owned(cls, user_id: int, craving_id: int,
                     patch: UpdateCravingInput) -> Craving:
        ...
```

Create accepts exactly `{ "client_event_id", "intensity", "trigger", "occurred_at_local", "timezone" }`; the timestamp contains an offset that matches the IANA timezone. Patch allowlists `outcome`, `duration_minutes`, `mood_before`, `mood_after`, `stress_level`, normalized `physical_symptoms`, `situation_context`, `notes`, and `outcome_notes`. Scale values are integers 1–10, duration is 0–1440, and free text is trimmed/null or at most 2,000 characters. Never interpret no outcome as resistance.

Create success is `{ "craving": <canonical craving>, "today": <canonical summary or null>, "created": true, "warnings": [] }`; duplicate event IDs return the same object with `created: false`. Patch success is `{ "craving": <canonical craving>, "today": <canonical summary or null>, "warnings": [] }`. Canonical craving timestamps include offsets and `outcome` remains null while unresolved.

- [ ] **Step 4: Add canonical endpoints.**

Implement `POST /api/cravings` and `PATCH /api/cravings/<id>`. Keep `/cravings/api/cravings` only as a temporary adapter calling the same service. Return the craving plus recalculated Today summary.

- [ ] **Step 5: Verify.**

Run SQLite: `.venv/bin/python -m pytest tests/unit/test_craving_mutations.py tests/api/test_craving_mutations.py tests/unit/test_portable_aggregations.py -q`

Run linkage/deletion on MySQL: `.venv/bin/python -m pytest tests/unit/test_craving_mutations.py tests/api/test_craving_mutations.py -q --db=mysql`

Expected: all pass on SQLite.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add services/craving_service.py models/craving.py routes/api.py tests && git commit -m "feat: add linked craving outcome api"`. Otherwise record `phase3-task6`.

---

## Task 7: Build the Immediate Craving Support Flow

**Files:**

- Create: `templates/pages/today/_craving_flow.html`
- Create: `static/js/today/craving_flow.js`
- Modify: `templates/pages/today/index.html`
- Modify: `static/css/tailwind.css`
- Create: `tests/js/craving_flow.test.js`
- Create: `tests/browser/craving-flow.spec.js`
- Create: `tests/integration/test_craving_flow.py`

- [ ] **Step 1: Write failing flow-state tests.**

States are check-in, action choice, three-minute pause, outcome, optional details, and complete. Test cancel after created record, pause timer, page visibility/resume, reduced motion, each outcome, used-nicotine handoff into quick log with craving ID, linked success, log failure/retry, optional detail skip, Escape/focus return, and unresolved craving rendering.

- [ ] **Step 2: Run and confirm missing flow.**

Run: `npm run test && .venv/bin/python -m pytest tests/integration/test_craving_flow.py -q && npm run test:e2e -- tests/browser/craving-flow.spec.js`

Expected: module/control failures.

- [ ] **Step 3: Implement the focused flow.**

Step 1 shows intensity and optional normalized trigger. Step 2 offers a three-minute pause first plus a small set of calm alternatives. Step 3 records one of the three exact outcomes. Optional context fields appear only afterward. The timer communicates elapsed/remaining time but never blocks choosing an outcome early.

- [ ] **Step 4: Link used nicotine through the existing quick-log state machine.**

Open quick log with `craving_id`; on successful canonical log, patch/render craving linkage without duplicating either event. If logging fails, the craving stays valid and unresolved/used outcome draft remains recoverable.

- [ ] **Step 5: Verify accessibility and responsive behavior.**

Run:

```bash
npm run build
npm run test
.venv/bin/python -m pytest tests/integration/test_craving_flow.py -q
npm run test:e2e -- tests/browser/craving-flow.spec.js
```

Expected: every outcome and focus/timer behavior passes at mobile and desktop sizes.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add templates/pages/today static/js/today static/css tests && git commit -m "feat: add immediate craving support flow"`. Otherwise record `phase3-task7`.

---

## Task 8: Add Check-In, Timeline Recovery, and Over-Target Copy

**Files:**

- Create or expand: `services/check_in_service.py`
- Modify: `routes/api.py`
- Modify: `services/today_service.py`
- Modify: `services/coaching_service.py`
- Modify: `templates/pages/today/_check_in.html`
- Modify: `templates/pages/today/_timeline.html`
- Modify: `static/js/today/timeline.js`
- Create: `tests/unit/test_check_in_service.py`
- Create: `tests/api/test_check_ins.py`
- Create: `tests/browser/today-states.spec.js`

- [ ] **Step 1: Write failing state and copy tests.**

Cover upsert once per user/server-derived local day, nullable integer mood/confidence values 1–5, trimmed nullable reflection/context strings up to 2,000 characters, unknown-field rejection, plan ownership, daily reset, empty reflection, exact final-two-hours visibility, over-pouch and over-mg cases, three-of-five repeated difficulty producing a review recommendation but no automatic revision, plan paused/neutral states, and exact forbidden words in user-facing output (`Failed`, `broken streak`, `cheated`).

- [ ] **Step 2: Run and confirm missing endpoint/state behavior.**

Run: `.venv/bin/python -m pytest tests/unit/test_check_in_service.py tests/api/test_check_ins.py -q && npm run test:e2e -- tests/browser/today-states.spec.js`

Expected: missing `POST /api/check-ins` and/or state failures.

- [ ] **Step 3: Implement local-day upsert and canonical refresh.**

`POST /api/check-ins` accepts exactly `{ "mood", "confidence", "reflection", "context" }`; it never accepts `local_date` or `user_id`. It creates or updates the authenticated user's server-derived current local-day row and returns canonical check-in plus Today summary. Reflection remains server-only and never enters IndexedDB.

Success is `{ "check_in": {"id": 1, "local_date": "YYYY-MM-DD", "mood": 3, "confidence": 4, "reflection": null, "context": null}, "today": <canonical summary> }` with no extra user-controlled fields.

- [ ] **Step 4: Implement neutral recovery content and actions.**

When exceeded, show `Plan exceeded`, accurate counts, “One day does not erase your progress,” and actions: keep logging, review tomorrow, reflect, pause/revise. Repeated difficulty may show a review suggestion linking to Journey; it cannot apply a revision.

- [ ] **Step 5: Verify full Today domain.**

Run:

```bash
npm run build
npm run test
.venv/bin/python -m pytest tests/unit/test_today_service.py tests/unit/test_coaching_service.py tests/unit/test_check_in_service.py tests/api/test_log_mutations.py tests/api/test_craving_mutations.py tests/api/test_check_ins.py tests/integration/test_quick_log_contract.py tests/integration/test_craving_flow.py -q
npm run test:e2e -- tests/browser/today-page.spec.js tests/browser/quick-log.spec.js tests/browser/craving-flow.spec.js tests/browser/today-states.spec.js
```

Expected: all pass; Today has no chart dependencies.

- [ ] **Step 6: Phase exit gate.**

Run:

```bash
.venv/bin/python -m pytest tests/unit tests/property tests/api tests/integration tests/migrations -q
npm run build
npm run test
npm run test:e2e -- tests/browser
rg -n "apexcharts|lodash|dashboard-charts" templates/pages/today templates/layouts/app.html static/js/today
```

Expected: test/build commands pass and the dependency scan returns no matches.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add services routes templates/pages/today static/js/today tests && git commit -m "feat: complete supportive today loop"`. Otherwise record `phase3-task8` and phase exit evidence.
