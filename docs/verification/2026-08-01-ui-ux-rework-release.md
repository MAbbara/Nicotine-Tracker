# UI/UX rework release verification — 2026-08-01

## Decision

**NO-GO — automated application gates are green, but release acceptance is
incomplete.** A copied legacy-database migration rehearsal was not authorized,
an HTTPS production-configured staging environment was not available, and the
required named human accessibility and real-iPhone Safari reviews have not been
performed. The repository also contains concurrent uncommitted branding work,
so the clean-status completion rule is not met.

No deployment, push, merge, tag, production connection, or access to
`instance/nicotine_tracker.db` occurred during this verification.

## Evidence baseline

- Branch: `main`
- Application/test baseline through: `ed340e2c5ba3168cc3a41434b450bc4c69431ae5`
- Verification date/time zone: 2026-08-01, Asia/Riyadh
- Python: 3.11.15
- Node.js: 24.14.1
- npm: 11.11.0
- Playwright: 1.62.0
- Browser: Google Chrome for Testing 151.0.7922.34
- MySQL: 8.4.8 Community Server, disposable `mysql` image pinned by digest
- Frontend build: Tailwind CSS 4.1.11

## Automated verification

| Gate | Command | Result | Duration / exit |
| --- | --- | --- | --- |
| Python application suite | `.venv/bin/python -m pytest -q` | 1,178 passed, 2 skipped, 31 warnings | 317.88s / 0 |
| Production CSS build | `npm run build` | Tailwind 4.1.11 build completed | exit 0 |
| JavaScript unit suite | `npm test` | 7 passed | exit 0 |
| Browser/accessibility suite | `npm run test:e2e` | 130 passed across desktop and mobile Chromium | 2.8m / 0 |
| SQLite migration suite | `.venv/bin/python -m pytest tests/migrations -q` | 50 passed, 1 skipped | 126.05s / 0 |
| MySQL migration suite | `TEST_MYSQL_URL=mysql+pymysql://<disposable-test-credentials>@127.0.0.1:<ephemeral-port>/nicotine_tracker_test_release .venv/bin/python -m pytest tests/migrations -q --db=mysql` | 51 passed | 1,008.15s / 0 |
| MySQL application matrix | `TEST_MYSQL_URL=mysql+pymysql://<disposable-test-credentials>@127.0.0.1:<ephemeral-port>/nicotine_tracker_test_release .venv/bin/python -m pytest tests/regression/test_log_product_history.py tests/integration/test_plan_revisions.py tests/unit/test_idempotent_log_service.py tests/api/test_log_mutations.py tests/unit/test_craving_mutations.py tests/api/test_craving_mutations.py tests/unit/test_portable_aggregations.py tests/unit/test_insights.py tests/security/test_security.py tests/api/test_endpoints.py tests/api/test_preference_endpoints.py tests/integration/test_journey.py -q --db=mysql` | 439 passed, 6 skipped | 1,368.88s / 0 |

The MySQL fixture rejected unsafe or ambiguously named databases and used only
the disposable empty database `nicotine_tracker_test_release`. Migration tests
covered upgrade/downgrade behavior and schema parity on SQLite and MySQL. The
application matrix covered immutable log history, plan revision behavior,
idempotent log/craving mutation, portable aggregations, insights, and the
currently implemented security/ownership cases.

After verification, `docker rm -f nicotine-tracker-mysql84-release` removed the
disposable container and its test-only database. This cleanup is intentionally
nonrecoverable; it did not target any persistent or production data.

The first complete Python run produced one load-sensitive failure in
`test_two_independent_connections_map_activation_race_to_one_conflict[zero-timeout]`
while browser tests were also active. The exact node passed in five separate
focused processes, and the fresh isolated complete run above passed. No product
code was changed without a reproducible failure mechanism.

## Corrections made during verification

- Stabilized the dashboard snapshot regression without weakening immutable
  historical snapshot assertions.
- Removed test-order pollution from Locust/gevent collection.
- Replaced obsolete live-server accessibility coverage with the maintained
  Playwright/axe gate and removed unversioned snapshot expectations.
- Tracked the npm lockfile and verified `npm ci`, build, and unit tests.
- Made the test database fixture backend-aware and added MySQL schema-parity
  canaries and migration downgrade/index safeguards.
- Updated stale browser registration locators.
- Kept Quick Log quantity confirmation and saved-reflection cancellation copy
  synchronized with current UI state.

## Incomplete release gates

### Copied legacy database migration — BLOCKED

The task explicitly prohibits opening, inspecting, copying, or migrating
`instance/nicotine_tracker.db` without approval. Approval was not supplied, so
the private database was not accessed. A temporary-copy upgrade, single-head
check, row-count/relationship comparison, and existing-user journey rehearsal
remain required.

### Staging security and operations — BLOCKED

No HTTPS staging target or staging credentials were provided. The following
remain unverified in a production-configured environment: strong unique secret,
production MySQL connection, CSRF and secure cookie attributes, sanitized error
responses, SMTP/password reset, notification worker retries, PWA manifest/icons,
session persistence, and cross-user ownership isolation.

### Named accessibility review — BLOCKED

Automated axe, keyboard-focus, 320px, 200% text, dark-theme, and reduced-motion
checks pass in Playwright, but they do not replace a named human review. Record
reviewer, date, browser, OS, screen reader, keyboard-only results, and known
limitations for landing/login, onboarding, Quick Log, craving support, Journey
revision, Insights alternatives, and destructive You actions.

### iPhone Safari / installed PWA — BLOCKED

A named reviewer must verify installation and standalone navigation on a real
iPhone in Safari, including session persistence, safe-area behavior, offline
replay/retry, Undo, all craving outcomes, pause/resume/revision, check-in, and
no-plan/paused/exceeded/unknown-strength states.

### Comprehensive data ownership lifecycle — GAP

Cross-user ownership assertions exist across current mutation, onboarding,
catalog, plan, and security tests. The planned centralized
`DataOwnershipService` and comprehensive export/anonymization/transactional
deletion suite do not exist. Current green tests must not be represented as
full proof of that planned lifecycle contract.

## Known limitations

- SQLAlchemy legacy `Query.get()` warnings remain in notification, log, and
  craving services; they did not fail the suite.
- MySQL normalizes microseconds for columns declared without fractional-second
  precision, so the explicitly SQLite-specific subminute cases are skipped on
  MySQL.
- Human, staging, and private-data gates above are release blockers, not waived
  checks.

## GO criteria remaining

Release status may change to **GO** only after the copied-database rehearsal,
production-configured staging checks, named accessibility review, and real
iPhone Safari/PWA review all pass, and the intended release checkout has a clean
Git status. Attach those results to this record; do not infer them from the
automated suite.
