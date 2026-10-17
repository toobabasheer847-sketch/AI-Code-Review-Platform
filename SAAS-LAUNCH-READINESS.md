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
| High | Authentication tokens are exposed to browser JavaScript (the client persists the bearer token and also writes a JavaScript-readable cookie). | Migrate to a server-set `HttpOnly`, `Secure`, appropriately `SameSite` session cookie or document and independently validate a compensating threat model before launch. Assess CSRF and cross-origin behavior as part of that change. |
| High | Express rate limits use process-local memory stores. Limits do not aggregate across replicas or survive restarts. `trust proxy` is fixed to one hop. | Put a shared rate-limit store or enforce equivalent limits at a trusted gateway/WAF. Verify the exact proxy chain and spoofed forwarding-header behavior in the deployment topology. |
| High | The latest full-tree `npm audit` reports 51 advisories: 41 high and 10 moderate (0 critical); it exits nonzero. Some proposed remediations require major upgrades (notably Nodemailer, React Router, Vite, Tailwind, Jest, and ESLint tooling). Nodemailer's proposed fix requires Node 20, while the backend package still advertises Node 18 support. | Review current `npm audit` output, prioritize reachable production packages, align the supported Node version, upgrade with compatibility tests, and record any temporary risk acceptance. CI currently fails the audit gate only for critical advisories. |
| High | The scheduler, API, and BullMQ workers are started by the same server process. Production multi-replica behavior, Redis persistence/HA, queue recovery, and graceful drain have not been independently validated. | Define the supported replica topology, Redis durability/monitoring, worker shutdown policy, and recovery SLOs; conduct restart, failover, and duplicate-side-effect tests in a staging environment. |
| High | Browser accessibility, responsive behavior, onboarding, and user-visible failure states have not had an independent accessibility/browser audit. | Complete keyboard/screen-reader and responsive checks for auth, billing, integrations, automation, and error flows before release. |
| Medium | Billing and quota rules are per individual user. The free tier has a monthly code-review count; scheduled automation has a separate active-schedule cap. There is no general AI/token/execution-credit budget. | Define the commercial usage policy and add server-side metering and enforcement for any promised limits. |
| Medium | Billing behavior depends on live Stripe configuration and webhook delivery. `invoice.payment_failed` currently maps the local subscription to expired; grace-period and recovery policy need product approval. | Test signed webhook replay, ordering, retry/recovery, cancellation timing, payment failure/recovery, and entitlement boundaries against Stripe test-mode fixtures before launch. |
| Medium | Database backups, restore drills, production migration rollback, alerting, and an external monitoring service are not configured or verified here. | Establish owned operational procedures, retention, alert routing, restore objectives, and a successful restore rehearsal. |

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
- `/health` checks PostgreSQL, Redis, queues, and scheduler state. It is a
  readiness endpoint, not a substitute for external monitoring or alerting.

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
| `GITHUB_TOKEN_ENCRYPTION_KEY` | Independent random secret of at least 32 characters. Preserve the previous key during a planned rotation until stored tokens have been re-encrypted. |
| `OPENAI_API_KEY` | Server-side AI provider credential. |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `GITHUB_CALLBACK_URL` | GitHub OAuth/webhook configuration. Register the callback URL exactly as deployed. |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID` | Stripe credentials, signing secret, and allowed Pro price. Production startup validation requires all three. |
| `FRONTEND_URL` | Public frontend origin only (no path, query, or fragment); used for CORS and redirects. |

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

Generate independent secrets locally without printing them to a shared log:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

Run once for each secret, and enter the values directly into the deployment
secret manager. `backend/.env.example` and `.env.production.sample` are
templates only; replace every sample value. Production environment validation
rejects local database/Redis endpoints, placeholder secrets, invalid Stripe
credential shapes, and reused/short JWT and encryption keys.

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
  a non-production copy. Confirm the owner, recovery point objective (RPO), and
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

There are no tested down migrations or automatic data rollback procedures in
this repository. Prefer a forward corrective migration and application
rollback only when the schema remains backward-compatible. For an incompatible
or destructive migration, stop writes and follow the approved restore plan;
never restore over production without incident authorization and a preserved
backup of the current state.

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

## Known limitations and evidence

- There is no organization, workspace, membership, or role schema. Records
  generally belong to a `User`; no cross-user tenant administration is
  implemented.
- Frontend auth persistence is accessible to browser JavaScript. No
  independently verified XSS assessment or HttpOnly session migration exists.
- Rate limiting is in-process. Limits reset on restart and are not shared
  between instances; the one-hop proxy trust setting must match the actual
  ingress.
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
- Accessibility, responsive layouts, and all onboarding/error paths require a
  dedicated browser and assistive-technology test pass.
- A source checkout cannot establish dependency exploitability for every
  installed path. Run `npm audit` against the release lockfile and review each
  advisory. At the time of this audit, compatible dependency updates were
  applied and the remaining audit included high and moderate findings; the
  remediation requires further version-specific review.

## Validation and CI

The CI workflow runs install, a critical-severity npm audit gate, Prisma client
generation and schema validation, migrations against a temporary PostgreSQL
15 service, lint, type-check, backend tests, and builds. The critical-only audit
threshold intentionally does not make the current high/moderate findings pass
as resolved; release owners must review all advisories and update this document
when remediation is complete.
