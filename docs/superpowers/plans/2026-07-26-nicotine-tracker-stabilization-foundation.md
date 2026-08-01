# Stabilization and UI Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing application portable and testable, establish one timezone/day model, and replace the forced-dark monolithic shell with the approved responsive design foundation.

**Architecture:** First make the checked migration chain and test environment reproducible. Then consolidate all local-day reads behind a half-open UTC window and remove deprecated `log_date` reads. Finally add tokens, layouts, component macros, and a four-destination theme-aware shell without changing the product domain yet.

**Tech Stack:** Flask, Jinja, SQLAlchemy/Alembic, pytest, Tailwind CSS 4, native ES modules, Playwright setup.

## Global Constraints

Follow the [master plan](./2026-07-26-nicotine-tracker-ui-ux-rework.md). Every listed test matrix is a completion checklist: implement it as repeated one-behavior red/green cycles, never one large batch of failing tests. Preserve the checked database at `instance/nicotine_tracker.db`; migration tests operate on copied fixtures. Do not activate plans or build Today interactions in this phase. Do not initialize Git if metadata remains absent.

---

## Task 1: Establish a Reproducible Test and Asset Toolchain

**Files:**

- Create: `requirements-dev.txt`
- Modify: `requirements.txt`
- Modify: `package.json`
- Modify: `pytest.ini`
- Modify: `tests/conftest.py`
- Create: `tests/smoke/test_environment.py`
- Create: `tests/js/shell.test.js`
- Create: `playwright.config.js`

- [ ] **Step 1: Write the failing environment contract.**

```python
# tests/smoke/test_environment.py
from pathlib import Path


def test_app_factory_uses_isolated_test_database(app):
    assert app.config["TESTING"] is True
    assert app.config["SQLALCHEMY_DATABASE_URI"] == "sqlite:///:memory:"


def test_css_is_built_from_tailwind_source():
    package = Path("package.json").read_text()
    assert '"build:css"' in package
    assert Path("static/css/tailwind.css").exists()
```

- [ ] **Step 2: Run the focused test and confirm it fails because the scripts/dev environment contract is absent.**

Run: `.venv/bin/python -m pytest tests/smoke/test_environment.py -q`

Expected: at least `test_css_is_built_from_tailwind_source` fails before `package.json` is updated. If `.venv` is missing, create it using Python 3.11 or 3.12, then install dependencies; a missing environment is not a passing test.

- [ ] **Step 3: Split runtime and development dependencies and add deterministic scripts.**

Keep runtime packages in `requirements.txt`. Put test-only packages in `requirements-dev.txt`, including:

```text
-r requirements.txt
pytest==8.4.1
pytest-cov==6.2.1
hypothesis==6.137.1
beautifulsoup4==4.13.4
locust==2.34.0
bandit==1.8.6
axe-selenium-python==2.1.6  # temporary until Phase 4 replaces the legacy suite
```

Keep Axe-Selenium only as a temporary development dependency so fresh installs can collect the legacy suite; Phase 4 removes it when Playwright/axe-core replaces those tests. Add these `package.json` scripts and dev dependencies:

```json
{
  "scripts": {
    "build": "npm run build:css",
    "build:css": "tailwindcss -i ./static/css/tailwind.css -o ./static/css/style.css --minify",
    "watch:css": "tailwindcss -i ./static/css/tailwind.css -o ./static/css/style.css --watch",
    "test": "node --test \"tests/js/*.test.js\"",
    "test:e2e": "playwright test",
    "test:e2e:update": "playwright test --update-snapshots"
  },
  "devDependencies": {
    "@axe-core/playwright": "^4.10.2",
    "@playwright/test": "^1.55.0"
  }
}
```

Declare `"engines": {"node": ">=22.6"}`. The JavaScript smoke test and report must demonstrate that at least one test was discovered and executed; a zero-test exit is a failure even if Node exits `0`.

Retain the existing Tailwind/Preline packages. Lockfile changes must be produced by `npm install`, never hand-edited.

- [ ] **Step 4: Repair fixtures rather than hiding broken tests.**

Update `tests/conftest.py` so the app fixture uses an isolated database, creates all registered models, yields inside a valid application context, and rolls back before dropping tables. Replace the fixed port and `time.sleep(5)` live server with a free port plus readiness polling. Add a real session-login helper using Flask's test client; do not pretend a Bearer header authenticates session routes.

- [ ] **Step 5: Add a minimal Playwright configuration and JS smoke test.**

`playwright.config.js` must use `tests` with a `testMatch` restricted to `browser/**/*.spec.js`, `accessibility/**/*.spec.js`, and `visual/**/*.spec.js`; define Chromium mobile and desktop projects, trace-on-first-retry, and `reuseExistingServer` outside CI. `tests/js/shell.test.js` initially verifies the Node test runner executes; feature assertions arrive with the modules.

- [ ] **Step 6: Run the toolchain verification.**

Run:

```bash
.venv/bin/python -m pytest tests/smoke/test_environment.py tests/test_app.py -q
npm run build
npm run test
```

Expected: all commands exit `0`; `static/css/style.css` is regenerated from source.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add requirements.txt requirements-dev.txt package.json package-lock.json pytest.ini playwright.config.js tests/conftest.py tests/smoke tests/js && git commit -m "test: establish reproducible ui rework harness"`. Otherwise record `phase1-task1` in the handoff.

---

## Task 2: Make Migrations Portable, Reconcile Drift, and Snapshot Product History

**Files:**

- Modify: `migrations/versions/f8e091ac4f79_feat_store_notification_channels_as_a_.py`
- Modify: `migrations/versions/6848755d9016_move_preferred_brands_and_units_.py`
- Modify: `migrations/env.py`
- Modify: `models/pouch.py`
- Modify: `models/log.py`
- Modify: `services/log_service.py`
- Modify: `routes/api.py`
- Modify: `routes/logging.py`
- Modify: `routes/catalog.py`
- Create: `migrations/versions/<revision>_reconcile_schema_and_snapshot_log_products.py`
- Create: `tests/fixtures/legacy_schema_9a3d3841f6c1.sql`
- Create: `tests/fixtures/drifted_schema_6848755d9016.sql`
- Create: `tests/fixtures/stamp_drift_schema_9a3d3841f6c1.sql`
- Create: `tests/migrations/harness.py`
- Create: `tests/migrations/conftest.py`
- Rewrite: `tests/migrations/test_migrations.py`
- Create: `tests/migrations/test_schema_parity.py`
- Create: `tests/regression/test_log_product_history.py`
- Modify: `tests/conftest.py`

- [ ] **Step 1: Capture a deterministic legacy fixture.**

Export schema plus representative, synthetic rows at revision `9a3d3841f6c1` into `tests/fixtures/legacy_schema_9a3d3841f6c1.sql`. Include four synthetic users, each with one preference row representing `email`, `discord`, `both`, or `none`; attach the representative pouch, log, craving, notification, and active goals to one of those users. Separately construct `drifted_schema_6848755d9016.sql`, stamped at that revision but intentionally missing `user_preferences.units_preference` and `preferred_brands`. This is a synthetic reconciliation case, not a representation of the checked database. The checked database is instead stamped at `9a3d3841f6c1` while already carrying post-`684...` preference structure; capture that third schema shape with fixed synthetic rows in `stamp_drift_schema_9a3d3841f6c1.sql`. Never copy real user values from `instance/nicotine_tracker.db`.

Add a `--db=sqlite|mysql` test option. SQLite connections enable `PRAGMA foreign_keys=ON`. MySQL runs require `TEST_MYSQL_URL`, verify MySQL 8.4+, and abort unless the URL's database name begins with `nicotine_tracker_test_`; never create/drop or truncate an unverified database. A missing MySQL URL is an explicit not-run locally and a release/CI failure, not a pass.

- [ ] **Step 2: Write failing upgrade and parity tests.**

The tests must:

```python
def test_legacy_sqlite_fixture_upgrades_to_head(alembic_config, legacy_db_url):
    command.upgrade(alembic_config, "head")
    expected_head = ScriptDirectory.from_config(alembic_config).get_current_head()
    assert current_revision(legacy_db_url) == expected_head


def test_head_schema_matches_sqlalchemy_metadata(app, migrated_engine):
    context = MigrationContext.configure(migrated_engine.connect())
    assert compare_metadata(context, db.metadata) == []
```

Also assert the synthetic rows and notification-channel meaning survive the upgrade. The Alembic harness must pass an explicit fixture connection through `config.attributes["connection"]`; update `migrations/env.py` to honor that connection rather than overwriting the test URL from an incidental Flask app engine. Resolve exactly one head dynamically. Configure `compare_metadata` with `compare_type=True` and `compare_server_default=True`; it must detect unexpected/missing tables, columns, types, nullability, defaults, indexes, unique constraints, and foreign keys. Add negative canaries for each operation class. Normalize only exact, documented, dialect-and-column-specific representation differences.

- [ ] **Step 3: Run and confirm the dialect failures.**

Run: `.venv/bin/python -m pytest tests/migrations/test_migrations.py tests/migrations/test_schema_parity.py tests/regression/test_log_product_history.py -q`

Expected: failure in the MySQL JSON/type conversion and/or `UPDATE ... JOIN` when upgrading SQLite.

- [ ] **Step 4: Replace dialect-specific data movement with SQLAlchemy/Python row transforms.**

In `f8e091ac4f79`, normalize legacy values in Python, use Alembic batch operations, and use a portable temporary column if in-place type conversion is unsafe. In `6848755d9016`, replace `UPDATE ... JOIN` with a select/update loop through `op.get_bind()`:

```python
rows = conn.execute(sa.text(
    "SELECT up.user_id, u.units_preference, u.preferred_brands "
    "FROM user_preferences AS up "
    "JOIN user AS u ON u.id = up.user_id"
)).mappings()
for row in rows:
    conn.execute(
        sa.text(
            "UPDATE user_preferences "
            "SET units_preference=:units, preferred_brands=:brands "
            "WHERE user_id=:user_id"
        ),
        {"units": row["units_preference"] or "mg", "brands": row["preferred_brands"],
         "user_id": row["user_id"]},
    )
```

Downgrades must be portable too. Add a comment where a downgrade is meaning-preserving but representation-changing.

- [ ] **Step 5: Add a new reconciliation and immutable-snapshot migration.**

Do not rely only on edited historical revisions: a database already stamped at `6848755d9016`, or incorrectly stamped at `9a3d3841f6c1` while already carrying the later preference structure, will never safely replay the intended history. Create a new head revision that idempotently reconciles missing `UserPreferences` columns/defaults/types, changes `Pouch.nicotine_mg` and `Log.custom_nicotine_mg` to `Numeric(8,2)`, adds nullable `Log.product_brand_snapshot` and `Log.nicotine_mg_snapshot`, changes nullable `Log.pouch_id` to `ON DELETE SET NULL`, and backfills snapshots from the current pouch/custom values. Unknown historical values remain null, never zero. Update models/relationships to match. Route every existing log creation path through one LogService snapshot helper so every future write populates immutable values; this includes both quick-add routes, form logging, bulk logging, and the existing service test helper. Make `Log` brand/nicotine accessors prefer immutable snapshots so catalog-edit and catalog-delete regressions are observable now; Task 5 moves every remaining aggregate/analytics path off mutable catalog joins.

The authenticated custom-pouch deletion route currently rejects pouches referenced by logs. Remove that guard after the FK/snapshot migration is in place: deleting an owned custom pouch must succeed, set historical `Log.pouch_id` values to null, and retain snapshot brand, strength, and totals. Keep ownership checks and default-pouch protection unchanged. Parse catalog and logging strengths as positive two-decimal values rather than integers.

Write one red/green vertical slice at a time: decimal preservation first, then catalog-edit stability, then catalog-delete stability, then drifted-stamp reconciliation. Test fractional `1.5mg` values explicitly.

- [ ] **Step 6: Verify upgrade, downgrade, re-upgrade, and model parity on both engines.**

Run SQLite with foreign keys enabled: `.venv/bin/python -m pytest tests/migrations tests/regression/test_log_product_history.py -q`

Run MySQL 8.4 through the disposable `TEST_MYSQL_URL` fixture: `.venv/bin/python -m pytest tests/migrations tests/regression/test_log_product_history.py -q --db=mysql`

Expected: the clean `9a3d...` fixture, the separately drifted/stamped `684...` fixture, and the synthetic checked-database-shaped `9a3d...` stamp-drift fixture all upgrade to dynamic head, downgrade/re-upgrade where supported, and preserve row counts, fractional strengths, snapshots, and values. SQLite runs use a file-backed database per case and assert both `PRAGMA foreign_keys=ON` and an empty `foreign_key_check` before and after each phase. The MySQL release gate is required; local absence of `TEST_MYSQL_URL` is reported as not-run with a non-zero command result, never as a passing skip. MySQL fixture setup must validate a MySQL (not MariaDB) 8.4+ server and a database name beginning exactly `nicotine_tracker_test_` before any mutation.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add migrations/versions models/pouch.py models/log.py services/log_service.py routes/api.py routes/logging.py tests/fixtures tests/migrations tests/regression/test_log_product_history.py tests/conftest.py && git commit -m "fix: reconcile schema and preserve product history"`. Otherwise record `phase1-task2`.

---

## Task 3: Add Request Correlation and Safe Error Context

**Files:**

- Create: `services/request_context.py`
- Modify: `app.py`
- Modify: `config.py`
- Create: `tests/unit/test_request_context.py`
- Create: `tests/integration/test_request_correlation.py`

- [ ] **Step 1: Add one failing request-ID behavior at a time.**

Start with a normal request receiving `X-Request-ID`; then add valid inbound UUID preservation, invalid inbound replacement, exception logging with the same ID, and two independent concurrent request contexts. Each behavior gets its own red/green loop.

```python
def test_response_and_log_share_request_id(client, caplog):
    response = client.get("/__test__/warning")
    request_id = response.headers["X-Request-ID"]
    assert UUID(request_id).version == 4
    assert any(getattr(record, "request_id", None) == request_id for record in caplog.records)
```

- [ ] **Step 2: Run the first focused red test.**

Run: `.venv/bin/python -m pytest tests/integration/test_request_correlation.py::test_response_has_request_id -q`

Expected: missing `X-Request-ID`.

- [ ] **Step 3: Implement request-scoped middleware.**

Accept an inbound `X-Request-ID` only if it is a canonical UUID; otherwise generate `str(uuid.uuid4())`. Store it on Flask `g`, attach it to every application log record through a filter/context helper, and return it in `X-Request-ID`. Background tasks generate their own correlation IDs. Never store the value in global mutable state.

- [ ] **Step 4: Keep error details private.**

The 500 handler rolls back the session, logs the exception with request ID, and renders/returns generic recovery guidance. Browser and JSON responses expose no stack, SQL, credentials, or filesystem paths. A JSON error may expose the request ID as support context without changing stable error codes.

- [ ] **Step 5: Verify request and service logging.**

Run: `.venv/bin/python -m pytest tests/unit/test_request_context.py tests/integration/test_request_correlation.py tests/test_app.py -q`

Expected: all pass and concurrent test requests never share IDs.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add services/request_context.py app.py config.py tests && git commit -m "feat: add request correlation context"`. Otherwise record `phase1-task3`.

---

## Task 4: Establish One Half-Open User-Day Contract

**Files:**

- Rewrite: `services/timezone_service.py`
- Modify: `services/user_service.py`
- Modify: `models/user.py`
- Modify: `services/__init__.py`
- Expand: `tests/unit/test_services.py`
- Create: `tests/unit/test_timezone_service.py`

- [ ] **Step 1: Write boundary tests before touching the service.**

Cover UTC, `Asia/Riyadh`, spring-forward and fall-back in `America/New_York`, non-midnight reset, exact start inclusion, exact end exclusion, invalid user-input rejection, legacy invalid-zone fallback warning, and week windows composed from day windows.

```python
def test_user_day_window_is_half_open_at_custom_reset():
    window = get_user_day_window(
        "Asia/Riyadh", date(2026, 7, 26), reset_time=time(4, 0)
    )
    assert window.local_date == date(2026, 7, 26)
    assert window.start_utc == datetime(2026, 7, 26, 1, 0, tzinfo=timezone.utc)
    assert window.end_utc == datetime(2026, 7, 27, 1, 0, tzinfo=timezone.utc)
```

- [ ] **Step 2: Run and confirm the old inclusive `time.max` behavior fails the contract.**

Run: `.venv/bin/python -m pytest tests/unit/test_timezone_service.py -q`

Expected: import or equality failures because `UserDayWindow` and half-open boundaries do not yet exist.

- [ ] **Step 3: Implement the canonical value object and functions.**

```python
@dataclass(frozen=True)
class UserDayWindow:
    local_date: date
    start_utc: datetime
    end_utc: datetime


def get_user_day_window(
    timezone_name: str,
    local_date: date,
    reset_time: time = time.min,
) -> UserDayWindow:
    tz = get_timezone_object(timezone_name)
    start_local = tz.localize(datetime.combine(local_date, reset_time), is_dst=None)
    next_local = tz.localize(
        datetime.combine(local_date + timedelta(days=1), reset_time), is_dst=None
    )
    return UserDayWindow(
        local_date=local_date,
        start_utc=start_local.astimezone(pytz.UTC),
        end_utc=next_local.astimezone(pytz.UTC),
    )
```

Handle `AmbiguousTimeError` and `NonExistentTimeError` with this fixed rule: a nonexistent **reset** time shifts forward by the DST gap; an ambiguous reset uses the earlier occurrence (`fold=0`, the DST occurrence for the normal fall-back case). Invalid user-submitted timezone identifiers are rejected. Only invalid legacy persisted zones may fall back to UTC, and that path emits a correlation-ID warning. Provide temporary tuple-returning wrappers for existing callers, but implement them from `UserDayWindow`; do not maintain two boundary algorithms.

- [ ] **Step 4: Convert user service and model reads to `>= start` and `< end`.**

`models/user.py:get_daily_intake` and every updated `services/user_service.py` query must use `Log.log_time`. Normalize database-naive UTC values at the service boundary. Exact `end_utc` events belong to the next user day.

- [ ] **Step 5: Verify timezone behavior.**

Run: `.venv/bin/python -m pytest tests/unit/test_timezone_service.py tests/unit/test_services.py tests/unit/test_models.py -q`

Expected: all pass, including 23-hour and 25-hour DST days. Add a separate offset-aware local-event parser that rejects nonexistent or timezone/offset-mismatched event timestamps; do not apply the reset-time shift rule to user-entered log/craving times.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add services/timezone_service.py services/user_service.py services/__init__.py models/user.py tests/unit && git commit -m "refactor: unify user day boundaries"`. Otherwise record `phase1-task4`.

---

## Task 5: Remove Deprecated Date Reads and MySQL-Only Analytics

**Files:**

- Modify: `services/log_service.py`
- Modify: `services/craving_service.py`
- Modify: `services/notification_service.py`
- Modify: `routes/dashboard.py`
- Modify: `routes/goals.py`
- Modify: `routes/logging.py`
- Modify: `routes/settings.py`
- Modify: `services/enhanced_insights_service.py`
- Create: `tests/unit/test_portable_aggregations.py`
- Create: `tests/regression/test_log_time_authority.py`
- Create: `tests/static/test_no_log_date_reads.py`

- [ ] **Step 1: Add tests that deliberately disagree `log_date` and `log_time`.**

Create logs whose legacy `log_date` points at the wrong UTC/local date and whose referenced pouch is later edited/deleted. Assert ranges, totals, averages, exports, duplicate detection, deletion cutoffs, goal analytics, recent lists, and nicotine totals follow `log_time`, `UserDayWindow`, and immutable log snapshots.

- [ ] **Step 2: Add a SQLite craving weekday test.**

```python
def test_craving_weekday_patterns_are_portable(app, test_user):
    # Insert UTC cravings spanning known local weekdays.
    result = get_craving_patterns_by_day_of_week(test_user.id, days=30)
    assert result["Monday"] == 1
```

- [ ] **Step 3: Run and confirm failures.**

Run: `.venv/bin/python -m pytest tests/unit/test_portable_aggregations.py tests/regression/test_log_time_authority.py -q`

Expected: SQLite raises on `func.dayofweek`, and at least one date query follows the deliberately wrong `log_date`.

- [ ] **Step 4: Replace date reads systematically.**

For bounded reads, query a widened UTC interval using `Log.log_time`, convert once to user-local time in Python, and group by effective local date. Resolve historical brand/strength from `Log.product_brand_snapshot` and `Log.nicotine_mg_snapshot`; a null legacy strength remains unknown and is excluded from milligram aggregates with an explicit count, never treated as zero. For portable craving weekday/time-of-day analytics, fetch the bounded rows and aggregate after timezone conversion. Do not replace MySQL functions with SQLite-only `strftime`.

Use a shared helper shaped like:

```python
def logs_for_user_window(user_id: int, window: UserDayWindow):
    return Log.query.filter(
        Log.user_id == user_id,
        Log.log_time >= window.start_utc,
        Log.log_time < window.end_utc,
    )
```

- [ ] **Step 5: Prove no runtime query path depends on `Log.log_date`.**

Implement an AST-based static test that rejects `Log.log_date` in query/filter/order/group expressions while allowing only the documented compatibility assignment/serialization and migration code. Then run:

```bash
.venv/bin/python -m pytest tests/static/test_no_log_date_reads.py -q
rg -n "Log\.log_date|filter_by\(log_date|order_by\([^\n]*log_date|group_by\([^\n]*log_date" routes services models
```

Expected: the AST test passes. The inventory may list only compatibility assignment/serialization or explicitly documented migration code; include each allowed match in verification evidence. Any query match fails the task.

- [ ] **Step 6: Run the affected suite.**

Run SQLite: `.venv/bin/python -m pytest tests/unit tests/regression tests/api tests/integration tests/static -q`

Run the portable aggregation/idempotency subset on MySQL: `.venv/bin/python -m pytest tests/unit/test_portable_aggregations.py tests/regression/test_log_time_authority.py -q --db=mysql`

Expected: all pass on SQLite without dialect branching in application services.

- [ ] **Step 7: Checkpoint.**

If Git is available: `git add services routes models tests && git commit -m "fix: make event aggregations timezone-safe and portable"`. Otherwise record `phase1-task5`.

---

## Task 6: Build the Approved Token, Icon, and Typography Foundation

**Files:**

- Rewrite: `static/css/tailwind.css`
- Regenerate: `static/css/style.css`
- Create: `static/fonts/README.md`
- Create or add licensed assets: `static/fonts/newsreader-variable.woff2`, `static/fonts/dm-sans-variable.woff2`
- Create: `static/icons/README.md`
- Create: `static/icons/<chosen-family>/*.svg`
- Create: `templates/components/icon.html`
- Create: `tests/smoke/test_design_tokens.py`
- Create: `tests/templates/test_icons.py`

- [ ] **Step 1: Confirm font licensing before adding binaries.**

Record source URL, license, font version, and file checksum in `static/fonts/README.md`. If the selected fonts cannot be legally self-hosted, use a metrically tested licensed substitute and update both the README and authoritative design status; do not silently fall back to Inter. Choose one licensed SVG line-icon family that supports an approximately 1.75px stroke and record its source, version, license, and checksums in `static/icons/README.md`; do not mix icon families.

- [ ] **Step 2: Write failing token assertions.**

Assert the source contains named semantic variables for canvas, surface, ink, muted text, border, constructive, attention, milestone, focus, radii, spacing, timing, and both explicit theme selectors.

```python
def test_light_and_dark_semantic_tokens_exist():
    css = Path("static/css/tailwind.css").read_text()
    for token in ("--color-canvas", "--color-ink", "--color-attention"):
        assert token in css
    assert '[data-theme="light"]' in css
    assert '[data-theme="dark"]' in css
```

- [ ] **Step 3: Run and confirm the old purple/forced-dark source fails.**

Run: `.venv/bin/python -m pytest tests/smoke/test_design_tokens.py -q`

Expected: missing semantic tokens or theme selectors.

- [ ] **Step 4: Implement the source tokens and base styles.**

Use the exact approved colors. Add `color-scheme`, fluid type with `clamp()`, minimum 44px interactive targets, visible `:focus-visible`, 200% zoom-safe line heights, and reduced-motion overrides. Borders carry separation; shadows are reserved for overlays. No gradient declarations. Add one icon macro: informative icons require an accessible label, while decorative icons render `aria-hidden="true"` and cannot receive focus.

- [ ] **Step 5: Build and scan generated output.**

Run:

```bash
npm run build
.venv/bin/python -m pytest tests/smoke/test_design_tokens.py tests/templates/test_icons.py -q
rg -n "linear-gradient|radial-gradient|Inter" static/css/tailwind.css
```

Expected: build and tests pass; the final scan returns no matches. Rendered primary component fixtures contain no emoji metric/navigation decoration.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add static/css static/fonts static/icons templates/components/icon.html tests/smoke tests/templates/test_icons.py && git commit -m "style: establish warm coaching design assets"`. Otherwise record `phase1-task6`.

---

## Task 7: Replace the Monolithic Base with Layouts and Component Contracts

**Files:**

- Create: `templates/layouts/app.html`
- Create: `templates/layouts/auth.html`
- Create: `templates/layouts/marketing.html`
- Create: `templates/components/button.html`
- Create: `templates/components/field.html`
- Create: `templates/components/status.html`
- Create: `templates/components/sheet.html`
- Create: `templates/components/empty_state.html`
- Create: `templates/components/alert.html`
- Create: `templates/components/timeline.html`
- Create: `templates/components/chart.html`
- Reduce: `templates/base.html`
- Create: `tests/templates/test_components.py`
- Create: `tests/templates/test_layouts.py`

- [ ] **Step 1: Write rendering-contract tests.**

Test that button variants render as native buttons/links without invalid nesting; fields connect labels, descriptions, and errors; status includes visible text; sheets render dialog semantics and labelled titles; chart frames require a text summary; app/auth/marketing layouts expose the correct blocks and contain exactly one `main` landmark.

- [ ] **Step 2: Run and confirm component imports fail.**

Run: `.venv/bin/python -m pytest tests/templates/test_components.py tests/templates/test_layouts.py -q`

Expected: `TemplateNotFound` for the new component/layout files.

- [ ] **Step 3: Implement small Jinja macro contracts.**

Example button API:

```jinja
{% macro button(label, href=None, variant='primary', type='button', attrs='') -%}
  {% if href %}
    <a class="c-button c-button--{{ variant }}" href="{{ href }}" {{ attrs|safe }}>{{ label }}</a>
  {% else %}
    <button class="c-button c-button--{{ variant }}" type="{{ type }}" {{ attrs|safe }}>{{ label }}</button>
  {% endif %}
{%- endmacro %}
```

Do not make `attrs|safe` accept user-controlled strings; callers supply developer-owned attributes only. Prefer explicit parameters for ARIA and data attributes when practical.

- [ ] **Step 4: Move only global structure into layouts.**

`templates/base.html` becomes a compatibility bridge that extends the relevant new layout. Remove timezone modal code, chart imports, page-specific overlays, and inline JavaScript from global markup. `app.html` owns skip link, shell, flash region, navigation slots, main content, and shell modules.

- [ ] **Step 5: Verify rendered semantics.**

Run: `.venv/bin/python -m pytest tests/templates tests/snapshot/test_snapshots.py -q`

Expected: component/layout tests pass. Update legacy snapshots only when the new semantic output is intentional; do not approve broad snapshots that mask errors.

- [ ] **Step 6: Checkpoint.**

If Git is available: `git add templates/base.html templates/layouts templates/components tests/templates tests/snapshot && git commit -m "refactor: introduce accessible jinja layout system"`. Otherwise record `phase1-task7`.

---

## Task 8: Implement Preference Persistence and the Four-Destination Responsive Shell

**Files:**

- Create: `models/user_preferred_pouch.py`
- Modify: `models/user_preferences.py`
- Modify: `models/user_settings.py`
- Modify: `models/__init__.py`
- Create: `migrations/versions/<revision>_add_coaching_preferences.py`
- Create: `services/preference_service.py`
- Modify: `extensions.py`
- Modify: `config.py`
- Create: `static/js/shell/theme.js`
- Create: `static/js/shell/navigation.js`
- Create: `static/js/shell/offline_status.js`
- Modify: `routes/api.py`
- Create: `routes/today.py`
- Create: `routes/journey.py`
- Create: `routes/you.py`
- Modify: `app.py`
- Modify: `templates/layouts/app.html`
- Modify: `templates/layouts/auth.html`
- Modify: `templates/layouts/marketing.html`
- Modify: `static/css/tailwind.css`
- Modify: `tests/js/shell.test.js`
- Create: `tests/browser/shell.spec.js`
- Create: `tests/unit/test_coaching_preferences.py`
- Create: `tests/api/test_preference_endpoints.py`
- Create: `tests/security/test_csrf_inventory.py`
- Modify: every form template returned by `rg -l '<form' templates`
- Modify: every mutation-fetch module/template returned by the route/fetch inventory

- [ ] **Step 1: Add failing JavaScript and HTML shell tests.**

Test theme precedence `authenticated server choice > device-local choice > system preference > light`, valid values only, no flash-causing forced `dark` class, offline status announcements without duplicate handlers, and exactly four authenticated destinations in this order: Today, Journey, Insights, You. Add one red/green slice at a time for exact preferred-pouch ownership/rank, preferred-pouch deletion/cascade/rank compaction, normalized difficult-time/trigger arrays, opaque offline queue identity, and future-effective day-boundary fields.

- [ ] **Step 2: Run and confirm the missing modules fail.**

Run:

```bash
npm run test
npm run test:e2e -- tests/browser/shell.spec.js
```

Expected: module import/DOM assertion failures.

Before the first browser run on a new machine, install the pinned Chromium build with `npx playwright install chromium`. If system packages are missing, use Playwright's documented dependency command with explicit user approval; do not silently skip browser verification.

- [ ] **Step 3: Implement an early theme initializer and a user-controlled toggle.**

The small inline bootstrap may only select the theme before CSS paints; all interaction belongs in `theme.js`:

```javascript
const allowed = new Set(["light", "dark", "system"]);
export function resolveTheme(saved, prefersDark) {
  if (saved === "light" || saved === "dark") return saved;
  return prefersDark ? "dark" : "light";
}
```

Persist the selection locally immediately and to `UserSettings.theme` when authenticated. Migrate legacy `chart_theme` values with `auto → system`; accepted values are exactly `light`, `dark`, and `system`. The dark theme is independently tuned via tokens, not an inversion filter.

- [ ] **Step 4: Add coaching-preference persistence and APIs.**

Create `UserPreferredPouch(user_id, pouch_id, rank)` with unique user/pouch and user/rank constraints and enforce that a pouch is global default or user-owned. Its `pouch_id` and `user_id` FKs use `ON DELETE CASCADE`; deleting a preferred custom pouch removes the association and compacts remaining ranks transactionally. Add validated normalized JSON arrays `difficult_times` and `common_triggers`, non-null `offline_queue_enabled`, a generated opaque `offline_queue_id`, and optional `pending_timezone`, `pending_daily_reset_time`, `boundary_change_effective_at_utc`, and `boundary_change_target_local_date` to UserPreferences. The migration preserves legacy preferred brands as display/context only; it does not guess a strength. Test deletion on SQLite and MySQL.

Before exposing either preference mutation, initialize `CSRFProtect`, enable it by default, add hidden tokens to every existing mutating form, add `X-CSRFToken` to every mutation fetch, and run `tests/security/test_csrf_inventory.py`. Do not use blanket blueprint exemptions. `PATCH /api/preferences/theme` and `PATCH /api/preferences/day-boundary` then use the standard error envelope and enforced CSRF header. In Phase 1, when no ReductionPlan domain exists yet, a validated timezone/reset change applies immediately and all pending fields remain null. Task 4 of Phase 2 expands `PreferenceService` with active-plan scheduling and PlanDay rekeying before any new plan can activate.

- [ ] **Step 5: Build responsive navigation and useful foundation destinations.**

Mobile: fixed four-item bottom nav with safe-area padding and no CTA overlap. Desktop: persistent side rail plus content canvas. Active state uses `aria-current="page"`, visible label, the shared icon macro, and a non-color cue. Do not load ApexCharts, Lodash, dashboard charts, or page-specific modals.

Register authenticated foundation compositions in the final blueprint modules `routes/today.py`, `routes/journey.py`, and `routes/you.py` at `/today`, `/journey/`, and `/you`. Use the new app layout and existing dashboard/goal/settings services so every destination returns useful `200` content at the Phase 1 gate. `/insights/` uses its existing service in the new shell. Later phases expand these same modules/handlers in place; do not create competing URL rules, dead links, or placeholder pages.

- [ ] **Step 6: Verify responsive/theme and preference behavior.**

Run:

```bash
npm run build
npm run test
.venv/bin/python -m pytest tests/templates tests/unit/test_coaching_preferences.py tests/api/test_preference_endpoints.py tests/security/test_csrf_inventory.py tests/security/test_security.py -q
npm run test:e2e -- tests/browser/shell.spec.js
```

Expected: light default, explicit dark and system modes, four working destinations returning `200`, exact-pouch preference persistence, immediate validated day-boundary changes with pending fields null, enforced CSRF, visible keyboard focus, and no global chart script.

- [ ] **Step 7: Phase exit gate.**

Run:

```bash
.venv/bin/python -m pytest tests/migrations tests/unit tests/regression tests/api tests/integration tests/templates tests/smoke tests/static -q
npm run build
npm run test
npm run test:e2e -- tests/browser/shell.spec.js
```

Expected: all pass. Record the current migration head, test counts, and any intentionally retained compatibility write to `Log.log_date`.

- [ ] **Step 8: Checkpoint.**

If Git is available: `git add models migrations services/preference_service.py extensions.py config.py routes app.py templates static tests package.json package-lock.json && git commit -m "feat: add secure coaching preferences and responsive app shell"`. Otherwise record `phase1-task8` and the phase exit evidence.
