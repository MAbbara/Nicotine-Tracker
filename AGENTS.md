# Project Instructions

Work skeptically and double-check assumptions, implementation details, and verification results. The user and the agent can both be mistaken; prioritize evidence and accuracy.

## Complexity admission and retirement

Do not add or retain a new abstraction, service or process, execution path, compatibility or fallback path, recovery mechanism, configuration option, custom framework or tool, permanent planning or evidence document, or additional test layer unless the change:

1. Identifies the current supported requirement and its live consumer, or the concrete credible failure or threat the addition prevents.
2. Explains why the existing implementation, framework or platform guarantee, standard tool, or a smaller local change is insufficient.
3. Uses one canonical implementation and representation rather than creating a parallel path.
4. States the exact removal condition for anything temporary, transitional, deprecated, or replaced, and removes superseded code, tests, fixtures, configuration, and documentation when that condition is met.

Test behavior at the lowest sufficient layer. Add coverage at another layer only when it protects a distinct risk that the existing tests do not cover.

For financial operations, authentication and authorization, privacy-sensitive data, cryptographic custody, migrations, durable-data integrity, destructive storage or hardware operations, process ownership, and other high-consequence boundaries, proactive defense in depth is allowed without a prior incident. Each safeguard must still protect a distinct named failure mode or trust boundary, must explain why existing safeguards are insufficient, and must not duplicate an existing authority or recovery path.

If these conditions are not met, do not implement the additional machinery. Record it as a future option outside the active implementation.

Keep only current canonical product, architecture, and operational documentation in the repository. Keep chronological plans, implementation journals, task reports, completion reports, and transient verification evidence in the issue, pull request, or Git history unless they have an ongoing operational purpose.

## Project complexity profile

### Current engineering mode

NicotineTracker is a small production-oriented Flask application, not a safety-sensitive clinical system. The verified checkout supports a single Flask application with server-rendered pages and focused browser JavaScript, SQLAlchemy/Alembic persistence, and an optional separately invoked notification scheduler. Local development and tests use Python 3.11, Node/npm-built assets, SQLite, and Chromium desktop/mobile browser projects. Production configuration and MySQL 8.4+ migration gates exist, but no committed CI or deployment definition establishes a particular production host, process supervisor, proxy, or broader browser/database matrix; do not infer one. Authentication, private health-adjacent usage data, historical nicotine records, migrations, offline replay, destructive account/data actions, and queued notification delivery are the high-consequence boundaries. Prefer the smallest change inside this monolith and its existing framework contracts.

### Canonical architecture and ownership

1. **Application and process shape.** `create_app()` and registered Flask blueprints are the authoritative web path; services hold shared business operations, SQLAlchemy models own persistence, Alembic owns schema evolution, and npm/Tailwind owns generated CSS. `run_background_tasks.py` is the only established separate worker path. Extend these owners directly. Add another service, worker, cache, queue, provider interface, process supervisor, or deployment framework only for a verified live consumer and distinct failure mode; otherwise rely on Flask, SQLAlchemy, Alembic, the database, npm, and the actual deployment platform.

2. **Product and data authorities.** Today is the primary daily-use surface and Journey/reduction plans are the current planning path. For nicotine history, the UTC `Log.log_time` and immutable product snapshots are authoritative; `log_date`, mutable pouch relationships, legacy Goal rows/routes, and migration-created legacy-plan drafts are compatibility or review data, not competing authorities. Preserve persisted compatibility only where current rows or a verified client require it, and never make a compatibility representation the source for new behavior.

### Project-specific complexity constraints

3. **Durable workflows and recovery.** Keep nicotine logging, plan lifecycle changes, offline replay, notification queueing, and destructive data actions on one ownership-scoped, transactional operation each. Idempotency, uniqueness constraints, confirmation gates, bounded retries, and recovery are justified where they protect duplicate replay, partial writes, cross-user access, irreversible deletion, or external delivery uncertainty. Do not add a second queue, shadow state machine, compensating path, or imagined recovery state at the same boundary; an added state must correspond to a user-visible promise and have a tested exit.

4. **Interfaces and integrations.** Prefer concrete route/service functions and the existing email/webhook implementations. Add a provider, plugin, factory, repository layer, generalized serializer, feature flag, or configuration alias only when at least two current implementations or a verified transition require the variation. Optional future integrations and deployment topologies stay outside active code until they have a live consumer.

### High-consequence exceptions

5. **Independent safeguards.** Separate checks remain appropriate across independent boundaries: browser/API CSRF and authentication, service ownership validation, database constraints and transactions, migration rehearsal against disposable databases, offline client idempotency plus server uniqueness, destructive-action confirmation plus authorization, and notification retry plus delivery history. Checks duplicated within the same boundary need a distinct failure mode. Preserve real history and unknown-value semantics; do not invent rollback, reconstruction, or delivery guarantees beyond migrations, persisted snapshots/revisions, queue records, and documented user-facing behavior.

### Testing policy

6. **Lowest sufficient evidence.** Use unit tests for pure schedules, calculations, validation, and serialization; Flask/service integration tests with a real test database for transactions, ownership, constraints, routes, and destructive actions; migration tests on disposable SQLite fixtures and the guarded MySQL gate only for dialect or upgrade risks; Node tests for isolated browser logic; and Playwright for browser-visible flows, accessibility, responsive behavior, IndexedDB/offline integration, or one critical end-to-end path. Test rendered behavior rather than exact template, CSS, prose, source text, or private call structure unless that text or file shape is itself a public/tooling contract. Do not repeat the same assertion across layers or run every matrix for unrelated changes.

### Compatibility, retirement, and artifacts

7. **Evidence-based retirement.** Persisted log history and applied Alembic revisions are real compatibility obligations. Before removing a legacy column, Goal adapter, route, response field, schema branch, or configuration alias, verify current database contents and every known in-repository caller, plus any owner-confirmed external consumer. A replacement is complete only when its predecessor code, tests, fixtures, configuration, and current documentation can be removed together; if external state is unknown, state that uncertainty rather than granting indefinite support. The README, Alembic history, focused asset/source notes, and these instructions are canonical repository documentation categories. Do not add permanent chronological plans, task/progress/completion reports, screenshots, generated databases, audit evidence, or transient verification output unless an ongoing operational or regulatory use is identified. Existing historical artifacts are not current authority, and their cleanup is a separate scoped task.

## Design Context

### Users

Nicotine-pouch users who want to reduce their consumption or quit entirely. The primary context is quick, repeated mobile use during the day: logging nicotine, responding to cravings, and checking whether they are on pace. Desktop supports deeper planning, review, and analytics.

### Brand Personality

Calm, encouraging, and candid. The product behaves like a trusted coach: supportive without being sentimental, clear without becoming clinical, and honest without using guilt, shame, or failure language.

### Aesthetic Direction

A warm, refined light theme is the default, paired with a purpose-designed dark theme. The visual language is organic and editorial rather than technological: warm ivory surfaces, mineral greens, restrained terracotta accents, expressive display typography, and a highly readable humanist body face. Avoid purple-blue gradients, neon-on-dark palettes, glassmorphism, emoji-led metric cards, repetitive dashboard grids, and sterile medical styling.

### Design Principles

1. **Today before history.** Lead with the user's current plan, next useful action, and immediate progress.
2. **Coach, never judge.** Treat difficult days and lapses as information; always offer a constructive next step.
3. **Make logging nearly effortless.** The most common nicotine and craving actions must work comfortably with one hand and minimal input.
4. **Reveal depth progressively.** Keep daily use focused while preserving detailed planning and analytics for users who seek them.
5. **Use data to guide action.** Every metric or chart must answer a real question or suggest a meaningful next step.
6. **Design for real-world accessibility.** Target WCAG 2.2 AA, color-independent status communication, visible focus, comfortable touch targets, responsive text, and reduced-motion support.
