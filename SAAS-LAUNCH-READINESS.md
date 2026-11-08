# SaaS Launch Readiness

## Release decision

**Not production-launch-ready based on this repository audit.** The automated
checks and local source review below are not a production deployment, external
security certification, or independent penetration test. Do not advertise
organization/workspace tenancy or enterprise RBAC: the current data model is
user-owned and has no organization, workspace, membership, or role models.

## Prioritized release blockers

| Priority | Finding | Required release action |
| --- | --- | --- |
| Blocker | There is no organization/workspace membership or role-based access model. Ownership is by individual `userId`; there is no tenant administrator or member lifecycle. | Decide the intended tenancy model, then implement and test tenant-scoped access across APIs, database relations, jobs, approvals, schedules, files, billing, and provider credentials before selling team/organization plans. |
| High | The application uses an HttpOnly session cookie, signed CSRF token, and exact-origin validation in source; production cookie and proxy behavior has not been verified. | Verify production `CSRF_SECRET`, cookie SameSite/HTTPS settings, deployed frontend/API origins, OAuth callbacks, and browser behavior in staging before launch. |
| High | API rate limits now use shared Redis counters. `X-Forwarded-For` is ignored unless `TRUST_PROXY_HOPS` is the exact trusted hop count. | Set `TRUST_PROXY_HOPS` to the deployed proxy chain, point every replica at the same durable Redis, and confirm spoofed forwarded headers do not create new buckets in staging. |
| Medium | The 2026-11-05 dependency audit reports 6 moderate development-tooling findings, including GHSA-g3hv-75wg-m249; it reports no high/critical issues and `npm audit --omit=dev --audit-level=moderate` reports no production dependency vulnerabilities. | Keep CI at `npm audit --audit-level=high` so critical and high advisories fail the build. Do not lower that level. The minimatch advisory affects the development lint/type-check dependency tree. Revisit when compatible lint/type-check dependencies can use a fixed version without a breaking toolchain change. |
| High | The API, BullMQ workers, and scheduler run in the same process. A Redis lease coordinates scheduler ticks, but production multi-replica behavior, Redis persistence/HA, queue recovery, and graceful drain have not been independently validated. | Define the supported replica topology, Redis durability/monitoring, worker shutdown policy, and recovery SLOs; conduct restart, failover, and duplicate-side-effect tests in a staging environment. |
| High | Playwright browser smoke tests cover mocked auth/email, GitHub, Stripe, review, automation, expired-session, keyboard-focus, and narrow-screen flows in CI. They do not test live providers, assistive technologies, or every product route. | Complete keyboard/screen-reader and responsive checks for auth, billing, integrations, automation, and error flows before release. |
| Medium | Billing and quota rules are per individual user. The free tier has a monthly code-review count; scheduled automation has a separate active-schedule cap. There is no general AI/token/execution-credit budget. | Define the commercial usage policy and add server-side metering and enforcement for any promised limits. |
| Medium | Billing behavior depends on live Stripe configuration and webhook delivery. `invoice.payment_failed` currently maps the local subscription to expired; grace-period and recovery policy need product approval. | Test signed webhook replay, ordering, retry/recovery, cancellation timing, payment failure/recovery, and entitlement boundaries against Stripe test-mode fixtures before launch. |
| Medium | Privacy-scrubbed Sentry reporting is available but optional; no production DSN, alert routing, backup service, restore drill, or data-retention policy is verified here. | Establish owned operational procedures, retention, alert routing, restore objectives, and a successful restore rehearsal. |

## Controls verified in source

- Protected API routes validate JWT signatures and compare the token version with
  the current user record. Protected product routes now reject unverified users;
  account lifecycle routes still allow an authenticated user to view their
  account, resend verification, log out, or request deletion.
- Password reset and email-verification tokens are hashed in storage and
  expire; password reset and logout increment the session token version.
- GitHub and LinkedIn OAuth callbacks validate one-time state against
  short-lived cookies. Provider credentials are encrypted at rest using the
  configured encryption key. Key rotation supports a previous key during
  migration.
- Stripe webhooks use raw request bodies and Stripe signature verification.
  Event IDs are persisted for idempotency, and older subscription events are
  prevented from overwriting newer stored events.
- Review quota reservation is transactional. Automation records and approvals
  are scoped to the authenticated user, and actions require approval according
  to their declared workflow policy.
- API error and request logging are structured and avoid serializing bearer
  headers or request bodies in the HTTP request serializer.
- `/health/live` checks process responsiveness. `/health/ready` and `/health`
  check PostgreSQL, Redis, queues, and scheduler state. They are health checks,
  not substitutes for external monitoring or alerting.
- Optional Sentry adapters report fixed error messages and allowlisted
  component/category tags. They omit exception details, request data, user
  identity, prompts, repository content, and arbitrary context.

These are source-level observations and test-backed boundaries, not proof of
deployed configuration or a security certification.

## Environment setup

Use a managed secrets store and separate credentials for local, staging, and
production. Never put production values in `.env` files committed to source
control, frontend variables, build arguments, logs, or support bundles.

Required production backend settings:

| Variable | Purpose / production requirement |
| --- | --- |
| `NODE_ENV` | Set to `production`. |
| `PORT` | Listen port exposed by the backend runtime. |
| `DATABASE_URL` | Managed PostgreSQL URL; use TLS and a least-privilege application role. |
| `REDIS_URL` | Managed Redis URL; use TLS (`rediss://`) and persistence/availability appropriate to the queue recovery policy. |
| `JWT_SECRET` | Unique random secret of at least 32 characters. Do not reuse the encryption key. |
| `CSRF_SECRET` | Independent random secret of at least 32 characters; signs short-lived CSRF tokens. |
| `AUTH_COOKIE_SAME_SITE` | `lax` for same-site frontend/API origins (default); use `none` only for cross-site HTTPS deployments. |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Independent random secret of at least 32 characters. Preserve the previous key during a planned rotation until stored tokens have been re-encrypted. |
| `SENTRY_DSN` | Optional backend Sentry DSN. Leave empty to disable external reporting. |
| `SENTRY_RELEASE` | Optional release identifier used to group events by deployed version. |
| `OPENAI_API_KEY` | Server-side AI provider credential. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CALLBACK_URL` | GitHub OAuth/webhook configuration. Register the callback URL exactly as deployed. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID` | Stripe credentials, signing secret, and allowed Pro price. Production startup validation requires all three. |
| `FRONTEND_URL` | Exact public frontend origin only (no path, query, or fragment); used as the sole trusted CORS and mutation Origin. |

Email verification and notifications require a working SMTP setup:
`MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, and `MAIL_FROM`.
LinkedIn is optional; configure `LINKEDIN_CLIENT_ID` and
`LINKEDIN_CLIENT_SECRET` together with the matching `LINKEDIN_CALLBACK_URL` if
that provider is enabled. `GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS` is only for a
planned key rotation. `JWT_EXPIRY`, `STRIPE_API_VERSION`, and
`LINKEDIN_API_VERSION` should be deliberately reviewed rather than inherited
from development defaults.

The frontend's `VITE_API_URL` and `VITE_STRIPE_PRO_PRICE_ID` are public build
configuration, not secret storage. Do not pass server credentials as Vite
variables or Docker build arguments.
`VITE_SENTRY_DSN` and `VITE_SENTRY_RELEASE` are also public frontend build
configuration; the DSN is not a secret.

Generate independent secrets locally without printing them to a shared log:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Run once for each secret, and enter the values directly into the deployment
secret manager. `backend/.env.example` and `.env.production.sample` are
templates only; replace every sample value. Production environment validation
rejects local database/Redis endpoints, placeholder secrets, invalid Stripe
credential shapes, and reused/short JWT and encryption keys.

## Monitoring, health, and alert setup

Set `SENTRY_DSN` for backend reporting and `VITE_SENTRY_DSN` at frontend build
time only after creating the corresponding Sentry projects. Optionally set the
release identifiers so errors can be correlated with an immutable deployment.
The backend reports API 5xx, worker, scheduler, Redis, and startup/shutdown
failures; the frontend reports API network/5xx and React error-boundary
failures. Event payloads use fixed messages and allowlisted component/category
tags. Do not add request bodies, prompts, repository text, tokens, user IDs,
or arbitrary exception context to telemetry. Monitoring failures are logged
without changing the original application outcome.

Configure Sentry-side alerts and a tested on-call destination for new/frequent
issues and regressions; the application does not create alert rules or prove
delivery. Also alert on readiness failures, queue depth/oldest-job age and
terminal failures, Redis availability, scheduler tick age/leader state, failed
webhooks, SMTP delivery failures, and database storage/backup status. Use
`GET /health/live` for process liveness and `GET /health/ready` for dependency
readiness (`GET /health` is a compatibility alias). Readiness is not a
synthetic user-flow check.

## API, workers, scheduler, and retry behavior

The current server starts the HTTP API, review/email/automation/social/fix
verification BullMQ workers, and automation scheduler in each application
process. There is no API-only or worker-only role switch in this checkout.
BullMQ workers can consume shared queues across replicas; keep all replicas on
the same durable Redis service and do not assume queue depth alone proves
successful completion.

Scheduler ticks use a Redis `SET NX PX` lease with a 60-second expiry and a
20-second renewal interval. The tick also relies on PostgreSQL row locks,
persisted run records, idempotency keys, and deduplicated notification outbox
records. A Redis outage prevents lease acquisition/renewal and is logged and
reported; this source-level coordination is not a substitute for staging
failover and duplicate-side-effect tests.

Review, email, and automation jobs default to three attempts with exponential
backoff starting at five seconds. Fix-verification dispatch uses the
configured `FIX_VERIFICATION_MAX_DISPATCH_ATTEMPTS` value (default three).
Social publication defaults to one attempt to avoid blindly duplicating an
external post. Automation workers use concurrency five and social workers use
concurrency two; BullMQ defaults apply where no concurrency is configured.
Durable recovery is implemented for persisted review/automation/verification
work, but interrupted-job and provider-outcome behavior still requires the
staging checks described in
[docs/verification-runner.md](docs/verification-runner.md) and
[docs/fix-verification-engine.md](docs/fix-verification-engine.md).

Shutdown closes the HTTP server, stops the scheduler, closes workers/queues,
then disconnects Redis and PostgreSQL. Deployments must allow graceful
termination to finish; force-kill behavior and production drain timeouts are
deployment-specific and have not been verified here.

## Data retention and recovery ownership

The schema and services implement individual-user ownership and account
deletion, but this repository does not define a general retention schedule for
reviews, chat messages, usage records, automation history, telemetry, backups,
or operational logs. Product and operations owners must define retention,
legal holds, deletion verification, log/telemetry retention, backup expiry,
and key custody before production use. Avoid retaining private repository
content in logs or telemetry.

The service operator owns PostgreSQL/Redis backups, encryption, retention,
restore access, recovery objectives, migration approvals, and provider
credential recovery. The application team owns schema compatibility and
forward-fix releases. Assign named incident and recovery owners plus RPO/RTO
targets before accepting production data.

## Release checklist

- [ ] Select and document individual-account versus organization/workspace
  tenancy. Do not offer team plans until tenant RBAC and isolation exist.
- [ ] Complete the high-priority blockers above, including session storage,
  shared rate limits, dependency advisories, and the supported worker topology.
- [ ] Configure production secrets and validate callback URLs, CORS origin,
  trusted proxy hops, SMTP delivery, GitHub webhook delivery, and Stripe
  webhook delivery in staging.
- [ ] Use dedicated least-privilege database and Redis credentials; verify TLS,
  network restrictions, encryption, backups, retention, and access logging.
- [ ] Review each pending schema migration and its lock/availability impact.
  Test both fresh installation and upgrade from the exact previous release.
- [ ] Run the CI checks, dependency review, provider integration tests, and
  staging auth/billing/tenant/approval boundary tests.
- [ ] Verify operational dashboards and alerts for API readiness, database,
  Redis, queue depth/age/failures, scheduler drift, webhook failures, SMTP
  delivery, and billing reconciliation.
- [ ] Rehearse database restore and application rollback/forward recovery using
  the staging-only procedure below. Confirm the owner, recovery point objective (RPO), and
  recovery time objective (RTO).
- [ ] Obtain product, operations, and security sign-off. This checklist itself
  does not represent certification or deployment approval.

## Deployment and rollback

The root Docker Compose file is a local-development setup: it uses development
credentials, mounts source, and runs migrations automatically at container
startup. Do not use it as a production deployment template.

For a production release:

1. Build immutable backend and frontend artifacts in CI; scan and retain the
   exact image digests and dependency lockfile.
2. Take a verified pre-migration backup or managed point-in-time recovery
   checkpoint.
3. Review and apply migrations as a separately approved deployment step, using
   the release image and a production migration credential. The CI workflow
   deploys migrations only to its disposable PostgreSQL service.
4. Deploy application artifacts using a rolling strategy only when the
   migration is backward-compatible with both versions. Do not let every
   production replica run schema migrations on boot.
5. Wait for `/health` readiness and check authenticated product flows, provider
   callbacks, signed Stripe webhook processing, and queue/scheduler metrics.
6. Retain the last known-good image and record the migration version and
   release owner.

There are no down migrations. The disposable-database suite checks that
committed migrations stay additive and transactional, that a failed transaction
leaves no partial schema or workspace rows, and that `prisma migrate deploy` can
be run again after a failed change. The tenancy migration keeps nullable
workspace associations so an application rollback can leave those tables in
place. That suite does not restore a production backup. Prefer a forward
corrective migration and application rollback only when the schema remains
backward-compatible. For an incompatible or destructive migration, stop writes
and follow the approved restore plan; never restore over production without
incident authorization and a preserved backup of the current state.

## PostgreSQL backup and restore

Prefer managed encrypted backups and point-in-time recovery with documented
retention and access control. Rehearse restores regularly. A manual custom
format backup can be created with PostgreSQL client tools; keep the connection
URL in the operator's secret manager and do not paste it into shell history or
ticket logs. Set `PG_DUMP_DATABASE_URL` to the backup target in a libpq-compatible
format (do not pass Prisma-only URL query parameters such as `schema`):

```powershell
$BackupFile = "ai-codeguard-$(Get-Date -Format yyyyMMdd-HHmmss).dump"
pg_dump --format=custom --file="$BackupFile" "$env:PG_DUMP_DATABASE_URL"
pg_restore --list "$BackupFile"
```

Restore only to an explicitly selected, isolated recovery database first:

```powershell
pg_restore --no-owner --dbname="$env:RECOVERY_DATABASE_URL" "$BackupFile"
```

Validate row counts, migration state, account ownership relations, subscriptions,
usage, OAuth credential decryption with the correct key set, and application
smoke tests before authorizing a recovery cutover. The restore command above
does not configure or verify backup encryption, retention, or point-in-time
recovery; those are deployment responsibilities.

### Staging-only restore rehearsal

Run this rehearsal only with a sanitized staging backup and an explicitly
isolated staging recovery database. Never point `RECOVERY_DATABASE_URL` at a
production host or restore over a database containing the only current copy.

1. Verify the backup's provenance and checksum, and confirm the target hostname,
   database name, cloud account, and network are staging-only. Obtain a second
   operator's review of the target before restore.
2. Provision an empty recovery database in the staging environment. Supply its
   connection string through the operator secret manager; do not copy it into
   shell history, a ticket, or this document.
3. Run `pg_restore --list` on the selected dump, then restore it using the
   command above. Apply only the reviewed migrations for the application
   version under rehearsal with `npm run prisma:deploy --workspace=backend`
   and `DATABASE_URL` set to that staging recovery database.
4. Start the matching staging artifacts with external write integrations
   disabled or pointed at provider test accounts. Verify row counts, ownership
   relations, migration state, account access, usage/automation history,
   credential decryption using staging keys, and non-mutating health/smoke
   checks.
5. Record restore duration, migration result, failures, and achieved RPO/RTO.
   Have the staging operator dispose of the recovery database using the
   provider's reviewed procedure. Do not run a production restore as a rehearsal.

## Known limitations and evidence

- There is no organization, workspace, membership, or role schema. Records
  generally belong to a `User`; no cross-user tenant administration is
  implemented.
- The HttpOnly session-cookie and CSRF implementation has source-level tests;
  deployed cookie, proxy, OAuth, and browser behavior still needs staging
  verification.
- API rate limits use Redis and are shared across replicas. They survive an
  API process restart, not a Redis flush. `TRUST_PROXY_HOPS` must match the
  actual ingress or forwarded client addresses are ignored.
- The backend starts HTTP, queue workers, and the automation scheduler in the
  same process. Separate API/worker deployments and production scaling/failover
  are not demonstrated.
- The current monthly billing quota is review-count based; automation has
  separate schedule and active-workflow caps, not a general compute or AI
  budget. Quotas are per user.
- External API availability, OAuth application approval, Stripe live-mode
  behavior, email deliverability, queue durability, and managed backup/restore
  are configuration- and provider-dependent and were not tested against
  production services.
- Playwright browser smoke tests cover the listed mocked flows in CI.
  Accessibility-tree, screen-reader, live-provider, mobile-device, and broader
  error-flow testing remain outstanding.
- Dependency audit on 2026-11-01, before the remediation, reported 2 critical,
  7 high, 44 moderate, and 4 low findings. The refreshed audit on 2026-11-05
  reports 6 moderate findings in the development lint/type-check dependency
  tree, including GHSA-g3hv-75wg-m249, with no high or critical findings;
  `npm audit --omit=dev --audit-level=moderate` reports no production
  dependency vulnerabilities.
  The supported runtime is Node.js 22 or newer; CI and Docker pin Node.js
  24.22.2. Keep untrusted glob patterns out of development tooling and
  revisit the advisory when compatible dependencies can use a fixed minimatch
  release. Do not treat the development-tree finding as resolved, and do not
  hide it by lowering the CI audit level. These audit counts are time-sensitive
  and should be refreshed after dependency or lockfile changes.

## Validation and CI

The CI workflow runs install, dependency audit gates, Prisma client generation
and schema validation, migrations against a temporary PostgreSQL 15 service,
lint, type-check, backend and frontend unit tests, Playwright Chromium browser
tests with mocked provider boundaries, builds, and backend/runner/frontend
Docker image builds. `npm audit --audit-level=high` fails for high and critical
advisories and still prints moderate and low findings; the production
dependency audit uses a moderate threshold. The audit threshold must not be
lowered to hide advisories. CI uses Node.js 24.22.2, matching the pinned Docker
runtime. Playwright checks are not live-provider tests or a production launch
certification.
