# UI/UX rework release verification — 2026-08-01

## Decision

**CONDITIONAL NO-GO — the technical browser remediation gate passes; three
external release gates remain.** C1, C2, and H1-H7 have passed fresh focused,
complete, and manual Chromium verification at `d6419a6`. The copied
production-data migration rehearsal remains passing. Release must still wait
for production-configured HTTPS staging verification, a named human
accessibility review, and a real-iPhone Safari/installed-PWA review.

No deployment, push, merge, tag, production connection, or access to
`instance/nicotine_tracker.db` occurred during this verification.

## Evidence baseline

- Branch: `codex/browser-release-gate-remediation`
- Application/test baseline through: `d6419a6`
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
| Python application suite | `.venv/bin/python -m pytest -q` | 1,201 passed, 2 skipped, 31 warnings | 293.01s / 0 |
| Production CSS build | `npm run build` | Tailwind 4.1.11 build completed | 133ms / 0 |
| JavaScript unit suite | `npm test` | 8 passed, 0 failed, 0 skipped | 400.599ms / 0 |
| Browser/accessibility suite | `npm run test:e2e` | 174 passed, 2 intentional mobile-only skips across desktop and mobile Chromium | 3.3m / 0 |
| SQLite migration suite | `.venv/bin/python -m pytest tests/migrations -q` | 50 passed, 1 skipped | 126.05s / 0 |
| MySQL migration suite | `TEST_MYSQL_URL=mysql+pymysql://<disposable-test-credentials>@127.0.0.1:<ephemeral-port>/nicotine_tracker_test_release .venv/bin/python -m pytest tests/migrations -q --db=mysql` | 51 passed | 1,008.15s / 0 |
| MySQL application matrix | `TEST_MYSQL_URL=mysql+pymysql://<disposable-test-credentials>@127.0.0.1:<ephemeral-port>/nicotine_tracker_test_release .venv/bin/python -m pytest tests/regression/test_log_product_history.py tests/integration/test_plan_revisions.py tests/unit/test_idempotent_log_service.py tests/api/test_log_mutations.py tests/unit/test_craving_mutations.py tests/api/test_craving_mutations.py tests/unit/test_portable_aggregations.py tests/unit/test_insights.py tests/security/test_security.py tests/api/test_endpoints.py tests/api/test_preference_endpoints.py tests/integration/test_journey.py -q --db=mysql` | 439 passed, 6 skipped | 1,368.88s / 0 |
| Production-copy upgrade | `DATABASE_URL=mysql+pymysql://<disposable-test-credentials>@127.0.0.1:<ephemeral-port>/nicotine_tracker_test_production_copy FLASK_ENV=development .venv/bin/flask db upgrade` | `6848755d9016` upgraded through three revisions to `8a2d1c4e6f90` | exit 0 |
| Production-copy schema parity | Strict Alembic `compare_metadata` through `tests.migrations.harness.schema_diffs` | 0 diffs | exit 0 |
| Production-copy journey smoke | Authenticated aggregate-only test-client GETs | `/today/`, `/journey/`, `/insights/`, and `/you` returned 200 with nonempty bodies | exit 0 |
| Full browser acceptance audit | Manual actions plus expanded axe/page-error/responsive/metadata scan | **TECHNICAL PASS — C1, C2, H1-H7 remediated; 8 medium and 3 low retained** | Conditional NO-GO pending external gates |

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

The separate [full browser acceptance audit](2026-08-01-full-browser-audit.md)
retains the original findings and now records C1, C2, and H1-H7 closure
finding-by-finding. The fresh disposable-browser pass exercised each named
Data & Privacy action, normal and failed analytics runtime states, Light/Dark/
System themes, scoped axe routes, 320px containment, route metadata, offline
status messaging, and rebuilt landing visuals. The preferred Playwright CLI
was attempted first; because its packaged binary path
`/opt/google/chrome/chrome` is absent, the manual scan used the repository's
installed, pinned Playwright Chromium runtime and recorded that limitation.

### Browser remediation commits and evidence

| Finding | Fix commit(s) | Verification status |
| --- | --- | --- |
| C1 / H1 — exact Data & Privacy actions and retention label | `6a1365a`, `e22b0f0` | Focused Python and Data & Privacy axe passed; all named actions manually dispatched to their intended branch |
| C2 / H4 — analytics runtime, alternatives, fallback, and containment | `b2df5b8`, `4593494` | Unit/rendered/desktop/mobile analytics gates passed; charts, tables, failed-runtime fallback, and 320px containment manually passed |
| H2 — authoritative theme contract | `af9e926`, `30b61aa`, `f92b3c0` | Shell/analytics regressions and manual Light/Dark/System state passed |
| H3 — contrast and keyboard-scroll accessibility | `09ec541`, `f92b3c0`, `d6419a6` | Complete desktop/mobile axe gate and fresh scoped manual axe scan passed |
| H5 / H6 — indexing privacy and bounded offline contract | `a0b7c3e` | Integration, shell/offline browser, metadata, and live-region checks passed; cold offline launch remains explicitly unsupported |
| H7 — landing brand/trust | `2491e52`, `d6419a6` | Design-token, desktop/mobile, accessibility, build, and visual/manual checks passed |

### Offline capability boundary

Eligible queued mutations can replay after connectivity returns in an already
loaded browser session. A cold offline launch and an offline application shell
are unsupported; either capability requires a separate service-worker project.
The existing offline-replay browser tests verify only the supported in-session
recovery path.

## Copied production-data migration rehearsal — PASS

The user supplied `nicotinetracker.sql` as a production-data copy. The original
file was treated as read-only. It was 501,105 bytes with SHA-256
`e70372362ef2a98557c689dc2f2012db94453683bc3ee88429fcbac3d3672849`;
its header identifies MariaDB 11.4.10 and its Alembic stamp was
`6848755d9016`. No dump values or credentials are included in this record.

The MariaDB dump represented four JSON columns as `LONGTEXT` plus
`json_valid(...)` checks, including a literal default on
`user_preferences.notification_channel`. MySQL 8.4 correctly rejected that
literal `TEXT/JSON` default on the first import. A streaming, import-only
compatibility transform converted exactly those four emulated columns to
native MySQL `JSON` and removed only the illegal notification-channel server
default. Validation before import reported zero remaining emulated JSON
columns, four native JSON columns, and zero notification-channel defaults. The
source file was not modified and no transformed copy was written to disk.

The transformed stream restored into a disposable MySQL 8.4.8 database named
`nicotine_tracker_test_production_copy`. Before upgrade:

- revision: `6848755d9016`;
- 11 users, 42 pouches, 4,798 logs, 1 craving, 137 notification-history
  records, 2 password-reset records, and 9 preference records;
- zero goals, notification-queue rows, user-activity rows, settings rows, or
  email-verification rows;
- zero checked user/pouch foreign-key orphans.

`flask db upgrade` then applied `38495c4b5bbd`, `5f8c9b2a4e01`, and
`8a2d1c4e6f90`. Fresh post-upgrade checks proved:

- the live stamp and sole repository head are both `8a2d1c4e6f90`;
- strict model/schema comparison reports zero diffs;
- every pre-existing table retained its exact aggregate row count;
- all checked legacy and new-domain foreign-key orphan counts are zero;
- all 11 users retain a nonempty timezone;
- all 4,798 historical logs have brand and nicotine-strength snapshots;
- all 9 preference rows contain valid notification-channel JSON;
- aggregate ORM counts match direct SQL counts;
- Today, Journey, Insights, and You render successfully through the upgraded
  database.

The copy contained no reduction plans, plan revisions/days/status events,
daily check-ins, onboarding drafts, goals, or settings records. Their migrated
tables exist and match ORM metadata, but preservation of populated historical
rows in those domains could not be evidenced from this particular backup.

One schema-location diagnostic inadvertently printed adjacent private rows in
the local tool transcript. Those values were not copied into a file, commit,
or this evidence record and are not repeated here.

After verification, `docker rm -f
nicotine-tracker-mysql84-production-copy` permanently removed the disposable
container, its restored database, and both test-only database accounts. The
original user-supplied SQL file remains unchanged.

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

### Full browser acceptance — TECHNICAL PASS

C1, C2, and H1-H7 passed the fresh focused gates, the four complete automated
gates, and the expanded disposable Chromium pass. The eight medium and three
low findings remain tracked in the
[full browser acceptance audit](2026-08-01-full-browser-audit.md). This pass
does not waive the staging, named accessibility, or real-device gates below.

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
- The supplied production-copy header identifies MariaDB rather than Oracle
  MySQL. The rehearsal therefore required the documented JSON-DDL compatibility
  stream before restoration to the MySQL 8.4 release target.
- Human and staging gates above are release blockers, not waived checks.
- Cold offline launch and an offline application shell are unsupported; only
  the documented in-session queue/recovery boundary is verified.

## GO criteria remaining

Release status may change to **GO** only after production-configured HTTPS
staging checks pass, named accessibility and real iPhone Safari/installed-PWA
reviews pass, and the intended release checkout has a clean Git status. Attach
those results to this record; do not infer them from this technical Chromium
pass. The retained eight medium and three low findings must remain visible and
be dispositioned deliberately rather than silently treated as remediated.
