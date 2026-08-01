# Reduction Plan and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a transparent, revision-safe reduction-plan domain and let a new or existing user create, review, and manage a plan through the approved five-step onboarding and Journey experience.

**Architecture:** New additive tables store plan identity, immutable dated targets, future-effective revisions, and daily reflections. Pure baseline/schedule logic is separated from transactional lifecycle logic. JSON/HTML routes authorize and validate, then delegate to services. Onboarding creates a preview before any activation; Journey exposes the canonical plan and revision history.

**Tech Stack:** Flask, Jinja, SQLAlchemy/Alembic, pytest, Tailwind CSS, native ES modules.

## Global Constraints

Phase 1 must be green. Follow the [master plan](./2026-07-26-nicotine-tracker-ui-ux-rework.md) and authoritative design. Every listed test matrix is a completion checklist implemented through repeated one-behavior red/green cycles. The generated schedule is a behavioral tracking aid, not medical advice. A plan never activates without explicit confirmation. Past or already-started `PlanDay` rows never change.

---

## Task 1: Add the Plan Domain Schema and Idempotency Fields

**Files:**

- Create: `models/reduction_plan.py`
- Create: `models/plan_revision.py`
- Create: `models/plan_day.py`
- Create: `models/plan_status_event.py`
- Create: `models/daily_check_in.py`
- Create: `models/onboarding_draft.py`
- Modify: `models/log.py`
- Modify: `models/craving.py`
- Modify: `models/__init__.py`
- Modify: `app.py`
- Create: `migrations/versions/<revision>_add_reduction_plan_domain.py`
- Create: `tests/unit/test_plan_models.py`
- Expand: `tests/migrations/test_schema_parity.py`

- [ ] **Step 1: Write failing model invariant tests.**

Cover valid enums, targeted-activation requirements, observe/draft nullability, unique `(plan_id, local_date)`, one daily check-in per `(user_id, local_date)`, one onboarding draft per user with allowlisted steps, unique `(user_id, client_event_id)` when an event ID is present, nullable duplicate `NULL` IDs, one active slot per user, status/slot consistency, status-event history, rejection of cross-plan active revisions and PlanDay revisions, and craving-to-log linkage with `ON DELETE SET NULL`. Add one behavior test and red/green cycle at a time.

```python
def test_plan_day_is_unique_per_plan_and_local_date(db_session, plan, revision):
    db_session.add_all([
        PlanDay(plan_id=plan.id, revision_id=revision.id,
                local_date=date(2026, 7, 27), target_pouches=8,
                nicotine_ceiling_mg=48),
        PlanDay(plan_id=plan.id, revision_id=revision.id,
                local_date=date(2026, 7, 27), target_pouches=7,
                nicotine_ceiling_mg=42),
    ])
    with pytest.raises(IntegrityError):
        db_session.commit()
```

- [ ] **Step 2: Run and confirm imports fail.**

Run: `.venv/bin/python -m pytest tests/unit/test_plan_models.py -q`

Expected: import failure for the new models.

- [ ] **Step 3: Implement explicit model contracts.**

Use these field types and constraints:

```python
class ReductionPlan(db.Model):
    __tablename__ = "reduction_plan"
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    mode = db.Column(db.String(24), nullable=False)
    status = db.Column(db.String(16), nullable=False, default="draft", index=True)
    start_date = db.Column(db.Date)
    target_date = db.Column(db.Date)
    baseline_pouches = db.Column(db.Numeric(6, 2))
    baseline_mg = db.Column(db.Numeric(8, 2))
    baseline_mg_per_pouch = db.Column(db.Numeric(8, 2))
    baseline_source = db.Column(db.String(20))
    pace = db.Column(db.String(16))
    end_target_pouches = db.Column(db.Integer)
    active_revision_id = db.Column(db.Integer)
    active_slot = db.Column(db.Integer)
    migration_fingerprint = db.Column(db.String(64), unique=True)
    legacy_goal_ids = db.Column(db.JSON)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)
    updated_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow,
                           onupdate=datetime.utcnow)
```

`PlanRevision` stores `effective_date`, `pace`, `target_date`, `end_target_pouches`, non-null JSON `generation_inputs`, confirmed preview digest, reason, optional note, and timestamp. `PlanDay.target_pouches` and `nicotine_ceiling_mg` are nullable **only** for `observe` plans because observe mode intentionally has no target. `PlanStatusEvent` stores every active/paused/completed/archived transition with UTC instant, local date, and reason. `DailyCheckIn.plan_id` is nullable so neutral tracking can still record a reflection; ownership remains on `user_id`.

Add `UNIQUE(plan_id, id)` to PlanRevision. Use a named deferred/`use_alter` composite FK from `ReductionPlan(id, active_revision_id)` to `PlanRevision(plan_id, id)`, and a composite FK from `PlanDay(plan_id, revision_id)` to the same key. Separate single-column revision FKs are insufficient. Verify rejection on SQLite with foreign keys enabled and MySQL.

`OnboardingDraft` has a unique `user_id`, allowlisted `current_step`, JSON `structured_payload`, and timestamps. The payload may store intention codes, numeric baseline fields, pace, dates, normalized support codes, pouch IDs, and reminder windows; it may not store notes or arbitrary free text.

Use `CheckConstraint` for enum values and non-negative numeric values. `baseline_source` allows `manual`, `recent_logs`, `observe`, and `legacy_goal`. Targeted activation requires start date, baseline source, baseline pouches, baseline milligrams, baseline milligrams per pouch, pace, and end target; draft and observe rows may retain unknown values as null and never use zero/`steady` sentinels. `active_slot` is `1` exactly when status is `active` and null otherwise, with `UNIQUE(user_id, active_slot)`. `migration_fingerprint` is a distinct unique column; `legacy_goal_ids` stores only source IDs and never hides in revision generation inputs. Add relationship names explicitly to avoid the `active_revision_id`/`plan_id` circular ambiguity.

- [ ] **Step 4: Add log/craving event fields.**

Add `client_event_id = db.Column(db.String(64))` to both models and nullable `linked_log_id` FK with `ondelete="SET NULL"` to `Craving`. Add named unique constraints on `(user_id, client_event_id)`. Do not make `client_event_id` globally unique.

- [ ] **Step 5: Create and inspect an additive migration.**

Generate the revision only after model tests define the desired schema. The migration creates the six tables and three existing-table columns/indexes. It then creates one inactive `reduce` draft per active `daily_pouches` goal. Exactly one active `daily_mg` goal whose `start_date` and `end_date` both equal that pouch goal may attach as context; zero or multiple matches remain separate review context. Unpaired/conflicting `daily_mg` and every `weekly_reduction` goal create no plan. Candidate `start_date` and unconfirmed baseline fields remain null, `baseline_source` is `legacy_goal`, source IDs live in `legacy_goal_ids`, and the deterministic SHA-256 fingerprint includes user ID plus sorted source goal IDs. No Goal row changes and no plan activates. Downgrade may drop the new columns/tables only while the feature is unused, and the migration docstring must state this operational precondition.

- [ ] **Step 6: Verify fresh metadata and migration-upgraded schemas.**

Run:

```bash
.venv/bin/python -m pytest tests/unit/test_plan_models.py tests/migrations -q
```

Expected: both `db.create_all()` and legacy-fixture-to-head schemas pass the same parity assertions.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add models app.py migrations/versions tests/unit/test_plan_models.py tests/migrations && git commit -m "feat: add reduction plan persistence model"`. Otherwise record `phase2-task1`.

---

## Task 2: Implement Transparent Baseline Suggestions

**Files:**

- Create: `services/baseline_service.py`
- Create: `tests/unit/test_baseline_service.py`

- [ ] **Step 1: Define the result contract in tests.**

```python
@dataclass(frozen=True)
class BaselineSuggestion:
    available: bool
    pouches_per_day: Decimal | None
    nicotine_mg_per_day: Decimal | None
    median_mg_per_pouch: Decimal | None
    logged_days_used: int
    window_start: date
    window_end: date
    reason: str | None = None
```

Test exactly 0, 3, 4, and 14 logged days; missing days as unknown; multiple logs per day; quantities greater than one; immutable custom/catalog strength snapshots including fractional values; current incomplete user day excluded; non-midnight reset; and median for odd/even sample counts. Include a case proving that `median(daily_mg) / median(daily_pouches)` differs from the direct median event strength and assert the direct value. Include one unknown-strength quantity and assert `available=false`, retained pouch median, null nicotine fields, and reason `unknown_strength`.

- [ ] **Step 2: Run and confirm service import fails.**

Run: `.venv/bin/python -m pytest tests/unit/test_baseline_service.py -q`

Expected: import failure for `BaselineService`.

- [ ] **Step 3: Implement the 14-complete-day query and medians.**

```python
class BaselineService:
    MIN_LOGGED_DAYS = 4
    LOOKBACK_DAYS = 14

    @classmethod
    def suggest(cls, user_id: int, as_of_local_date: date | None = None) -> BaselineSuggestion:
        ...
```

Calculate the previous fourteen **complete** user days. A day is included in the daily medians only if one or more logs exist. Sum `quantity`; nicotine is `quantity * Log.nicotine_mg_snapshot`. Calculate `median_mg_per_pouch` directly from per-pouch snapshot strengths, weighted by quantity, across the included logged events. `available` means schedule-ready: at least four included days and every included quantity has resolvable strength, producing all three baseline values. If any snapshot strength is missing, retain `pouches_per_day`, set `nicotine_mg_per_day` and `median_mg_per_pouch` to null, and return reason `unknown_strength`; onboarding offers manual nicotine values or observe mode. Never treat unknown as zero or re-read a mutable Pouch strength.

- [ ] **Step 4: Make the explanation deterministic.**

Available copy data must state: “Based on N logged days from DATE to DATE.” Insufficient data returns the exact remaining logged-day count needed and offers manual or observe mode; it does not fabricate zero-use days.

- [ ] **Step 5: Verify.**

Run: `.venv/bin/python -m pytest tests/unit/test_baseline_service.py -q`

Expected: all cases pass with `Decimal` results rounded to two decimal places only at the output boundary.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add services/baseline_service.py tests/unit/test_baseline_service.py && git commit -m "feat: derive transparent usage baselines"`. Otherwise record `phase2-task2`.

---

## Task 3: Build a Pure, Deterministic Schedule Generator

**Files:**

- Create: `services/plan_schedule.py`
- Create: `tests/unit/test_plan_schedule.py`
- Create: `tests/property/test_plan_schedule_properties.py`

- [ ] **Step 1: Write the schedule input/output contracts.**

```python
@dataclass(frozen=True)
class StageTarget:
    start_date: date
    end_date: date
    target_pouches: int
    nicotine_ceiling_mg: Decimal


@dataclass(frozen=True)
class PlanGenerationInput:
    mode: Literal["reduce", "quit_by_date", "observe"]
    start_date: date
    baseline_pouches: Decimal | None = None
    baseline_mg: Decimal | None = None
    baseline_mg_per_pouch: Decimal | None = None
    pace: Literal["gentle", "steady", "focused"] | None = None
    end_target_pouches: int | None = None
    target_date: date | None = None
    duration_days: int | None = None
    stage_targets: tuple[StageTarget, ...] | None = None


@dataclass(frozen=True)
class GeneratedPlanDay:
    local_date: date
    target_pouches: int | None
    nicotine_ceiling_mg: Decimal | None


@dataclass(frozen=True)
class GeneratedPlanPreview:
    days: tuple[GeneratedPlanDay, ...]
    normalized_stages: tuple[StageTarget, ...]
    digest: str
```

- [ ] **Step 2: Specify the algorithm with failing examples.**

Default durations are 77 days for gentle, 49 for steady, and 28 for focused. User-specified durations within the approved ranges are accepted. `quit_by_date` derives inclusive duration from dates. For targeted modes without explicit stages:

```python
start_target = ceil(baseline_pouches)
reductions = start_target - end_target
drop_count = floor(day_index * reductions / (duration_days - 1))
target = start_target - drop_count
ceiling = quantize_2dp(baseline_mg_per_pouch * target)
```

The first day equals `start_target`; the last equals `end_target`; targets never increase; each target is a whole pouch; drop events are distributed across the duration. Explicit stages must be contiguous, non-overlapping, monotonic, and cover the selected duration exactly. Observe mode accepts unknown baseline/pace values and produces seven days with both target fields `None`; it never synthesizes zero or `steady` values.

Normalize bounds before hashing: for `reduce`, `duration_days` is authoritative and `target_date` is derived; a supplied target date must match. For `quit_by_date`, `target_date` is authoritative and duration is derived; a supplied duration must match. Observe derives both as seven days. Explicit stages derive both values; any supplied bounds must match. Reject mismatch with `422 inconsistent_schedule_bounds` at the API boundary.

- [ ] **Step 3: Run and confirm failure.**

Run: `.venv/bin/python -m pytest tests/unit/test_plan_schedule.py tests/property/test_plan_schedule_properties.py -q`

Expected: module import failure.

- [ ] **Step 4: Implement validation and pure generation.**

Reject missing/zero/negative baseline values for targeted modes, end targets above the starting target, a past/end-before-start date, a quit plan whose end target is not zero, durations too short to represent the requested schedule, and invalid stage coverage/ordering. Return structured `PlanValidationError(field_errors=...)`; do not write to the database here.

Return `GeneratedPlanPreview(days, normalized_stages, digest)`. For a new-plan preview, the digest is a stable SHA-256 over canonical generation inputs, normalized stages, and generated days; this pure function reads no database state. The lifecycle service wraps a revision preview with plan ID, earliest effective date, and protected PlanDay identifiers/values before hashing. Persistence APIs require the corresponding digest so the saved schedule is the schedule the user reviewed.

The public pure interface is `PlanScheduleGenerator.generate(generation_input) -> GeneratedPlanPreview`. Routes never call it directly; `PlanService` is the application boundary and delegates schedule work to it.

- [ ] **Step 5: Add property invariants.**

Hypothesis covers baselines 1–100 pouches, strengths 0.1–100mg, valid durations, end targets, and valid/invalid stage partitions. Assert deterministic output/digest, exact date count, monotonic targets, no negatives, exact endpoints, contiguous stage coverage, and `ceiling == baseline_mg_per_pouch * target` within two-decimal quantization.

- [ ] **Step 6: Verify.**

Run: `.venv/bin/python -m pytest tests/unit/test_plan_schedule.py tests/property/test_plan_schedule_properties.py -q`

Expected: all examples and properties pass.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add services/plan_schedule.py tests/unit/test_plan_schedule.py tests/property/test_plan_schedule_properties.py && git commit -m "feat: generate transparent reduction schedules"`. Otherwise record `phase2-task3`.

---

## Task 4: Add Transactional Plan Lifecycle and Revision Rules

**Files:**

- Create: `services/plan_service.py`
- Modify: `services/preference_service.py`
- Create: `services/legacy_goal_service.py`
- Create: `tests/unit/test_plan_lifecycle.py`
- Create: `tests/integration/test_plan_revisions.py`

- [ ] **Step 1: Write failing lifecycle tests.**

Cover draft creation, explicit activation, database-enforced one-active-plan behavior, pause, resume with a future revision, completion, archive, observe completion, rejected cross-user access, rollback on schedule generation failure, stale preview rejection, status-event history, paused-interval derivation, revision effective-date rules, and active-plan timezone/reset transitions. Include Riyadh→Los Angeles, Los Angeles→Riyadh, and DST reset changes. Run each behavior through its own red/green cycle.

- [ ] **Step 2: Prove current and past rows are immutable.**

Create yesterday/today/tomorrow `PlanDay` rows, freeze `now` after today's reset, revise tomorrow onward, and assert yesterday/today values and revision IDs are byte-for-byte unchanged. At a reset boundary, the new local day is already started and cannot be revised.

- [ ] **Step 3: Run and confirm lifecycle functions are absent.**

Run: `.venv/bin/python -m pytest tests/unit/test_plan_lifecycle.py tests/integration/test_plan_revisions.py -q`

Expected: missing method failures.

- [ ] **Step 4: Implement service methods with one transaction each.**

Required interface:

```python
PlanService.create_draft(user_id, generation_input, baseline_source) -> ReductionPlan
PlanService.create_from_preview(user_id, generation_input, baseline_source, preview_digest, activation) -> ReductionPlan
PlanService.activate(user_id, plan_id, preview_digest) -> ReductionPlan
PlanService.preview_revision(user_id, plan_id, changes, effective_date, now=None) -> GeneratedPlanPreview
PlanService.apply_revision(user_id, plan_id, changes, effective_date, preview_digest, reason, note=None, now=None) -> PlanRevision
PlanService.pause(user_id, plan_id, reason=None, now=None) -> ReductionPlan
PlanService.preview_resume(user_id, plan_id, resume_date, now=None) -> GeneratedPlanPreview
PlanService.resume(user_id, plan_id, resume_date, preview_digest, now=None) -> ReductionPlan
PlanService.complete(user_id, plan_id, now=None) -> ReductionPlan
PlanService.archive(user_id, plan_id, reason=None, now=None) -> ReductionPlan
PlanService.finish_observe(user_id, plan_id, now=None) -> ReductionPlan
PlanService.apply_boundary_change(user_id, now=None) -> PlanRevision | None
```

Activation deactivates no plan silently: if another active plan exists, return a conflict requiring the user to pause/archive it. Lock the owning `User` row before checking/activating plans and rely on the unique `(user_id, active_slot)` database constraint as the final concurrency guard. Exactly one of two concurrent activation transactions may commit on SQLite or MySQL. Every lifecycle change appends a `PlanStatusEvent`. `apply_revision` verifies the preview digest, returns `409 preview_stale` on drift, and deletes/recreates only future `PlanDay` rows from the validated effective date inside the same transaction.

`create_from_preview` is the only service used by `POST /api/plans`. One transaction verifies the digest, locks the User when activation is requested, checks the active-plan conflict, creates the plan/revision/days, optionally activates and appends the status event, and deletes the user's OnboardingDraft. Any failure rolls back the plan and preserves onboarding progress; it may not leave an unintended draft.

`finish_observe` completes the observe plan, derives a proposed baseline from its seven-day window, and creates a separate targeted **draft** with no automatic activation. If evidence remains insufficient, it completes observe and returns a manual-baseline prompt instead of inventing values.

`PreferenceService.schedule_day_boundary_change` only validates and computes the first new timezone/reset boundary at or after the current old-boundary day ends, then persists `boundary_change_effective_at_utc` plus `boundary_change_target_local_date`. When due, `PlanService.apply_boundary_change` owns one transaction: preserve protected PlanDays, create a `boundary_change` PlanRevision containing the re-dated normalized stages, update `active_revision_id`, apply the preference, and regenerate only future PlanDays under that revision while preserving their target sequence. It must avoid date collisions and never reuse a protected local date.

- [ ] **Step 5: Add compatible legacy-goal draft conversion.**

The additive migration in Task 1 already creates idempotent inactive draft candidates under the exact grouping rule above. `LegacyGoalService.get_draft_candidates(user_id)` reads and explains those migrated rows plus unattached context goals without changing them. `daily_pouches` prefills the end target. The uniquely date-matched `daily_mg` remains visible nicotine context until schedule confirmation. Conflicts remain separate; none activate automatically. Source IDs live in `ReductionPlan.legacy_goal_ids`; the fingerprint remains in `ReductionPlan.migration_fingerprint`, never in revision generation inputs. Goal rows remain unchanged.

- [ ] **Step 6: Verify transactionality and history.**

Run SQLite: `.venv/bin/python -m pytest tests/unit/test_plan_lifecycle.py tests/integration/test_plan_revisions.py -q`

Run concurrency/lifecycle on MySQL: `.venv/bin/python -m pytest tests/integration/test_plan_revisions.py -q --db=mysql`

Expected: all lifecycle, ownership, rollback, and immutable-history assertions pass.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add services/plan_service.py services/preference_service.py services/legacy_goal_service.py tests/unit/test_plan_lifecycle.py tests/integration/test_plan_revisions.py && git commit -m "feat: enforce future-only plan lifecycle"`. Otherwise record `phase2-task4`.

---

## Task 5: Expose Authenticated Plan and Baseline Contracts

**Files:**

- Verify: `extensions.py`
- Modify: `app.py`
- Verify: `config.py`
- Modify: `routes/api.py`
- Modify: `routes/journey.py`
- Modify: `routes/__init__.py`
- Create: `services/api_errors.py`
- Create: `services/api_schemas.py`
- Create: `services/onboarding_draft_service.py`
- Create: `tests/api/test_plan_endpoints.py`
- Create: `tests/api/test_onboarding_draft_endpoints.py`
- Modify: `tests/security/test_security.py`
- Expand: `tests/security/test_csrf_inventory.py`
- Modify: every form template returned by `rg -l '<form' templates`
- Modify: every mutation-fetch module/template returned by the route/fetch inventory

- [ ] **Step 1: Write failing API contract tests.**

Cover:

- `GET /api/baseline-suggestion`
- `POST /api/plans/preview`
- `POST /api/plans`
- `POST /api/plans/<id>/revisions/preview`
- `POST /api/plans/<id>/revisions`
- `POST /api/plans/<id>/pause`
- `POST /api/plans/<id>/resume/preview`
- `POST /api/plans/<id>/resume`
- `GET`, `PUT`, and `DELETE /api/onboarding-draft`

Assert CSRF rejection, unauthenticated rejection, user ownership, exact success schemas, fixed two-decimal string values, offset timestamps, unknown-field rejection, the error envelope for GET and mutation failures, stable error codes, field errors, status `409` for active-plan or stale-preview conflict, and no database writes from preview endpoints.

`GET /api/baseline-suggestion` returns:

```json
{
  "baseline": {
    "available": true,
    "pouches_per_day": "10.00",
    "nicotine_mg_per_day": "60.00",
    "median_mg_per_pouch": "6.00",
    "logged_days_used": 8,
    "window_start": "2026-07-12",
    "window_end": "2026-07-25",
    "reason": null
  }
}
```

Unavailable values are null and `reason` is a stable machine code with recovery copy supplied separately by the page.

Canonical plan preview/create input is:

```json
{
  "mode": "reduce",
  "baseline_source": "recent_logs",
  "baseline_pouches": "10.00",
  "baseline_mg": "60.00",
  "baseline_mg_per_pouch": "6.00",
  "pace": "steady",
  "start_date": "2026-07-27",
  "target_date": "2026-09-13",
  "duration_days": 49,
  "end_target_pouches": 2,
  "stage_targets": null
}
```

Observe preview uses null baseline/pace/end fields. An explicit stage item is `{ "start_date": "YYYY-MM-DD", "end_date": "YYYY-MM-DD", "target_pouches": 8, "nicotine_ceiling_mg": "48.00" }`. Preview success is `{ "preview_digest": "<sha256>", "normalized_input": <canonical input>, "stages": [...], "days": [...] }`. Create accepts canonical input plus `preview_digest` and `activation` equal to `draft` or `activate`; it returns `{ "plan": <canonical plan>, "created": true }`.

Revision preview accepts `{ "effective_date": "YYYY-MM-DD", "changes": <allowed canonical generation fields> }`. Apply accepts the same payload plus `preview_digest`, `reason`, and optional `note` (trimmed, at most 2,000 characters). Pause accepts optional `{ "reason": "..." }`. Resume preview accepts `{ "resume_date": "YYYY-MM-DD" }` and returns normalized future stages/days plus `preview_digest`; resume accepts that date plus the digest and returns `409 preview_stale` on drift. Every plan response includes status events and decimal values as two-decimal strings.

Onboarding draft `PUT` accepts exactly `{ "current_step": <step code>, "structured_payload": <allowlisted structured answers> }`; it rejects notes, unknown keys, arbitrary strings, and cross-user identifiers. `GET` returns `{ "onboarding_draft": null }` or the canonical draft. `DELETE` returns `204`. `POST /api/plans` calls only `PlanService.create_from_preview`; successful creation deletes the draft atomically, while validation/activation conflict preserves it and creates no plan.

- [ ] **Step 2: Run and confirm 404/CSRF contract failures.**

Run: `.venv/bin/python -m pytest tests/api/test_plan_endpoints.py tests/security/test_security.py -q`

Expected: the new plan/onboarding endpoints or their route-specific CSRF assertions fail because those endpoints are not implemented yet; the Phase 1 global CSRF baseline remains green.

- [ ] **Step 3: Extend the existing CSRF inventory.**

Phase 1 already initialized and enabled global CSRF, emitted the shell token, and covered legacy forms/fetches. Verify that protection remains enabled, then add hidden/header tokens for every new plan and onboarding form/fetch and expand `tests/security/test_csrf_inventory.py`. Do not add exemptions. Testing disables CSRF only per fixture in tests not verifying security.

- [ ] **Step 4: Implement thin routes and common error translation.**

Routes parse JSON through `api_schemas.py` with explicit allowlists, call services, serialize Decimals as fixed two-decimal strings, and return the shared envelope. They do not generate schedules or calculate user-day boundaries. Cross-owner IDs return `404`; validation returns `422`; stale digests return `409 preview_stale`.

- [ ] **Step 5: Verify all plan endpoints and legacy authenticated mutations.**

Run: `.venv/bin/python -m pytest tests/api/test_plan_endpoints.py tests/api/test_onboarding_draft_endpoints.py tests/security/test_security.py tests/security/test_csrf_inventory.py tests/api/test_endpoints.py tests/integration/test_user_workflow.py -q`

Expected: all pass; authenticated POST/PATCH/DELETE requests without a valid token are rejected, while representative legacy HTML forms succeed with valid hidden tokens.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add app.py routes services/api_errors.py services/api_schemas.py services/onboarding_draft_service.py templates static/js tests/api tests/security && git commit -m "feat: expose secure plan lifecycle api"`. Otherwise record `phase2-task5`.

---

## Task 6: Build the Five-Step Onboarding Experience

**Files:**

- Create: `templates/pages/journey/onboarding.html`
- Create: `templates/pages/journey/_intention.html`
- Create: `templates/pages/journey/_baseline.html`
- Create: `templates/pages/journey/_pace.html`
- Create: `templates/pages/journey/_support.html`
- Create: `templates/pages/journey/_review.html`
- Create: `static/js/journey/onboarding.js`
- Modify: `static/css/tailwind.css`
- Create: `tests/js/onboarding.test.js`
- Create: `tests/integration/test_onboarding.py`
- Create: `tests/browser/onboarding.spec.js`

- [ ] **Step 1: Write state-machine and route tests.**

Test forward/back navigation, preservation of valid input, contextual requirements for each mode, suggested/manual/observe baseline paths, exact preferred-pouch selection, normalized difficult-time/trigger persistence, live preview refresh/digest, stale-preview recovery, server field-error mapping, review assumptions, no activation before confirm, and registration redirect into onboarding. Exercise one state transition per red/green cycle.

- [ ] **Step 2: Run and confirm failures.**

Run:

```bash
npm run test
.venv/bin/python -m pytest tests/integration/test_onboarding.py -q
npm run test:e2e -- tests/browser/onboarding.spec.js
```

Expected: missing template/module/route failures.

- [ ] **Step 3: Implement a progressively enhanced HTML form.**

All five steps live in one semantically grouped form so submission still works without JavaScript. JavaScript manages visible steps, requests previews, and moves focus to each step heading. `OnboardingDraftService` saves/resumes allowlisted structured progress through the draft endpoints before enough information exists to create a plan; the browser URL never contains personal answers. Notes and arbitrary free text are not accepted in onboarding. Successful plan creation deletes the draft transactionally.

- [ ] **Step 4: Render exact decisions and transparent assumptions.**

Show intention; baseline source/day count and direct median milligrams per pouch; Gentle/Steady/Focused duration; contiguous editable stages; complete daily schedule; pouch target; nicotine ceiling; start/end dates; normalized difficult times/triggers; exact preferred pouch and strength; reminder window; and non-medical disclaimer. “Steady” is recommended but not pre-confirmed. Observe mode shows unknown baseline/pace values honestly. Final confirmation submits the displayed preview digest; `preview_stale` refreshes review and requires confirmation again.

- [ ] **Step 5: Verify narrow/mobile and wide/desktop layouts.**

Run:

```bash
npm run build
npm run test
.venv/bin/python -m pytest tests/integration/test_onboarding.py -q
npm run test:e2e -- tests/browser/onboarding.spec.js
```

Expected: a user can complete registration → onboarding → activated plan; keyboard and focus order pass at mobile and desktop viewports.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add templates/pages/journey static/js/journey/onboarding.js static/css tests && git commit -m "feat: add guided reduction plan onboarding"`. Otherwise record `phase2-task6`.

---

## Task 7: Build Journey and Legacy Goal History

**Files:**

- Create: `templates/pages/journey/index.html`
- Create: `templates/pages/journey/_schedule.html`
- Create: `templates/pages/journey/_revision_history.html`
- Create: `templates/pages/journey/_legacy_goals.html`
- Create: `static/js/journey/plan_editor.js`
- Expand: `routes/journey.py`
- Create: `tests/js/plan_editor.test.js`
- Create: `tests/integration/test_journey.py`
- Create: `tests/browser/journey.spec.js`

- [ ] **Step 1: Write failing Journey tests.**

Cover no-plan prompt plus neutral tracking, active plan summary, baseline/source/median strength, current stage, upcoming dates/targets, pause/resume/complete/archive, observe completion and proposed draft, full digest-backed preview before revision confirmation, immutable historical days, exact status-event/paused intervals, milestones, migrated legacy-goal drafts, conflicting candidates, and cross-user 404 behavior.

- [ ] **Step 2: Run and confirm missing page behavior.**

Run: `.venv/bin/python -m pytest tests/integration/test_journey.py -q && npm run test:e2e -- tests/browser/journey.spec.js`

Expected: the Phase 1 Journey foundation response fails the new onboarding/Journey semantic contract until this task expands the existing route module and templates.

- [ ] **Step 3: Implement server-rendered Journey composition.**

The default mobile view emphasizes current stage and the next seven days; desktop may show a wider schedule. Historical rows state the revision that created them. Status events render exact active/paused intervals. Legacy goals and their migration-created draft candidates appear in a clearly labelled history/review section and Goal rows remain intact.

- [ ] **Step 4: Implement preview-first editing.**

`plan_editor.js` never mutates on field change. It requests a preview, renders stage/day differences, stores only the returned digest, announces the effective date, and requires an explicit final confirm. If the digest becomes stale or the server moves the earliest valid date because a reset boundary passed, refresh the preview and require confirmation again rather than silently applying.

- [ ] **Step 5: Verify Journey end to end.**

Run:

```bash
npm run build
npm run test
.venv/bin/python -m pytest tests/unit/test_plan_* tests/api/test_plan_endpoints.py tests/integration/test_onboarding.py tests/integration/test_journey.py -q
npm run test:e2e -- tests/browser/onboarding.spec.js tests/browser/journey.spec.js
```

Expected: all pass with historical plan days stable.

- [ ] **Step 6: Phase exit gate.**

Run: `.venv/bin/python -m pytest tests/unit tests/property tests/api tests/integration tests/migrations -q && npm run build && npm run test && npm run test:e2e -- tests/browser/onboarding.spec.js tests/browser/journey.spec.js`

Expected: all pass; migration fixture preserves all legacy records and creates no active plan without confirmation.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add routes/journey.py templates/pages/journey static/js/journey tests && git commit -m "feat: add revision-safe journey experience"`. Otherwise record `phase2-task7` and phase exit evidence.
