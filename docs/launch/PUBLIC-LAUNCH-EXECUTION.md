# Public launch execution — 2026-11-11

**Status: NOT READY — BLOCKERS FOUND**

This record audits commit `e0352cc` on `main` (`origin/main`). It is not approval to deploy. Production was not deployed. The staging workflow was not dispatched. No production or staging secret values were read or written here.

Stripe live mode was not enabled. No production database was changed.

## What was executed locally

| Check | Result |
| --- | --- |
| `npm run deploy:check --workspace=backend` | Passed. Printed `Migration preflight passed. No database was changed.` |
| Backend unit tests | Passed. AI usage pretest: 10 passed, 0 failed. Main suite: 366 passed, 0 failed. |
| Frontend unit tests (`vitest run`) | Passed. 15 files, 62 tests, 0 failed. The run printed jsdom `AggregateError` network noise and still exited 0. |
| Database, Redis, and SMTP integration suites | Not run. Docker Desktop’s engine was not running, so disposable Postgres, Redis, and Mailpit were not started. |
| Provider integration (GitHub, OpenAI, Stripe, SMTP) | Not run. Those tests stay opt-in and were not enabled. |
| Docker image build | Not run. The Docker engine pipe was unavailable. |
| Staging or production workflow dispatch | Not run. `gh` is not installed on this machine, and no staging backup was confirmed. |
| `npm audit --audit-level=high` | Exit 0. Metadata counts: 6 moderate, 0 high, 0 critical. The moderate findings are `@typescript-eslint/*` and `minimatch` in the development tree. |
| `npm audit --omit=dev --audit-level=moderate` | Exit 0. Production dependency metadata counts: 0. |
| Playwright | See the E2E section. The run uses mocked providers against the local Vite server. It is not a live staging or production test. |

## Launch checklist

### READY

These items exist in this checkout and matched the local checks above. READY means the source and the tests that ran. It does not mean a deployed environment was exercised.

| Area | Evidence |
| --- | --- |
| Authentication and registration | `POST /api/auth/register`, `/login`, `/logout`, verification, and password reset are mounted. Product routes reject unverified users with `EMAIL_VERIFICATION_REQUIRED`. Account routes still allow resend, logout, and deletion. Sessions use an HttpOnly cookie. Password reset and logout advance the token version. |
| Workspace management and RBAC | `Organization`, `Workspace`, `WorkspaceMembership`, and role checks exist. `/api/workspaces` is mounted. Access middleware loads an `ACTIVE` membership before applying the role. Roles covered in unit tests: owner, admin, developer, viewer. |
| Invitation lifecycle | Invitation tokens are stored as SHA-256 hashes. Create, accept, decline, revoke, and expiry paths exist in the workspace service. The disposable-Postgres integration suite was not re-run in this session. |
| GitHub integration | OAuth state cookies, encrypted credentials, repository listing, and signed pull-request webhooks are implemented. No live GitHub call was made. |
| AI code review | Review start, finding validation, quota reservation, and usage recording are implemented. Free tier is three reviews per calendar month. No live OpenAI call was made. |
| AI repository chat | `POST /api/chat/repository-message` retrieves bounded excerpts. Review chat (`POST /api/chat/message`) resolves the caller’s personal workspace. |
| Automation | Approval-gated plans, schedule caps, and BullMQ execution are implemented and covered by unit tests. |
| Billing code | Checkout accepts only `STRIPE_PRO_PRICE_ID`. Webhooks use the raw body and Stripe signature verification. Event ids are stored for idempotency. Checkout is per user. There is no Customer Portal screen and no workspace checkout. |
| AI usage and cost | Owner-scoped usage analytics and the same cost calculation used by the metrics dashboard. Ten unit tests passed. |
| Database migrations | 29 committed migrations. `deploy:check` and the migration-safety unit test found no destructive SQL, down scripts, or non-transactional concurrent indexes. `prisma migrate deploy` was not run against any database. |
| Redis client behavior | Readiness pings Redis. Rate limits use a shared Redis store. Login, registration, account security, verification, reviews, repository chat, automation, AI generation, and invitation email fail closed when that store is down. |
| CI/CD definitions | `.github/workflows/ci.yml` runs audit, Prisma, lint, types, unit tests, build, image build, and mocked Playwright on pull requests and pushes to `main`. Deploy workflows are `workflow_dispatch` only. |
| Monitoring code | `/health/live`, `/health/ready`, and `/health` exist. `/metrics` is 404 until `METRICS_TOKEN` is set, then requires a bearer token. Optional Sentry reporting omits prompts, source, and user identity. |
| Public landing page | `/` renders `LandingPage`. Docs, privacy, terms, and cookies routes are public. |
| Product documentation | `README.md`, `docs/launch/README.md`, and the in-app guide match the mounted routes after the workspace wording correction in this change. |

### BLOCKED

| Item | Why it blocks launch |
| --- | --- |
| Staging release | The staging workflow was not dispatched. This machine has no `gh` CLI, the Docker engine is stopped, and no fresh staging backup was confirmed. Application health, Postgres, Redis, migrations, auth, GitHub, AI review, repository chat, and Stripe test mode were not exercised on a deployed staging URL. |
| Production deployment | Not authorized and not performed. |
| Production domain and SSL | No production hostname was requested or observed. |
| GitHub environment protection | `deploy-production.yml` selects the `production` environment, but required reviewers are a GitHub setting, not a line in the workflow. That setting was not read. |
| Database backup and restore | No backup was taken and no restore rehearsal was run. |
| Live email delivery | Registration and verification depend on SMTP. Mailpit integration was not started. |
| Alert delivery | Threshold logs and optional Sentry exist. No on-call route received a test alert. |
| Legal approval | `/privacy`, `/terms`, and `/cookies` are labeled “Draft for professional review. This is not a legally approved policy.” |
| Docker production images | Dockerfiles and `docker-compose.production.yml` exist. Images were not built or scanned in this session. |

### NEEDS MANUAL CONFIGURATION

Do these in the secret manager and GitHub environments. Do not commit the values.

| Item | Required action |
| --- | --- |
| GitHub `staging` and `production` environments | Add required reviewers on `production`. Restrict deployment branches to `main`. Store `STAGING_*` and `PRODUCTION_*` database, health, and deploy-hook secrets separately. Confirm the names exist; do not print the values. |
| Stripe mode | Keep `STRIPE_SECRET_KEY` on an `sk_test_` key and the matching test webhook secret and price. Production startup accepts `sk_live_` if someone sets it. Do not set a live key until a named person approves live charges. |
| Database and Redis | Managed PostgreSQL with TLS and a least-privilege role. Redis must be `rediss://` and not a local host. Point every replica at that same Redis. |
| `TRUST_PROXY_HOPS` | Set the exact hop count. Unset ignores `X-Forwarded-For`. `true` and `all` are rejected at startup. |
| Public signup posture | An empty `BETA_ALLOWLIST` marks every new registration `ACTIVE`. Set a comma-separated allowlist to hold everyone else at `PENDING`. Set `BETA_ADMIN_EMAILS` before anyone can open `/beta-admin`. |
| Email | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, and `MAIL_FROM` must deliver verification and password-reset mail. |
| GitHub OAuth and webhooks | Register the exact HTTPS callback and webhook URL. Use a unique `GITHUB_TOKEN_ENCRYPTION_KEY` of at least 32 characters. |
| Browser and API origins | `FRONTEND_URL` must be the exact public HTTPS origin. Build the frontend with the public `VITE_API_URL` and test price id only. |
| Observability | Create Sentry projects before setting `SENTRY_DSN` and `VITE_SENTRY_DSN`. Set `METRICS_TOKEN`. Name the on-call route. Deliver one test alert before calling monitoring ready. |
| Recovery ownership | Name the incident owner, RPO, and RTO before any customer data is accepted. Those values are not defined in this repository. |
| Secrets | `JWT_SECRET`, `CSRF_SECRET`, `EMAIL_OTP_SECRET`, and `GITHUB_TOKEN_ENCRYPTION_KEY` must be independent, at least 32 characters, and not placeholders. |

## Staging validation

Staging was not deployed, so the following were not verified on a running staging stack:

- Application deployment and the deploy hook
- Backend `/health/ready`
- Frontend accessibility on the staging origin
- PostgreSQL and Redis connectivity in staging
- `prisma migrate deploy` against the staging database
- Authentication, workspace authorization, GitHub, AI review, and repository chat against live providers
- Stripe test-mode checkout and webhook replay against the staging URL
- Monitoring delivery

Local substitutes that did run are listed in the first table. They do not replace that staging pass.

## Production deployment gate

Do not dispatch `.github/workflows/deploy-production.yml` until every line below is true and a person approves the GitHub `production` environment. This document does not check any of them.

- [ ] The commit is the approved `main` SHA. The workflow checks out `main` and refuses any other `GITHUB_REF`.
- [ ] A named reviewer approved the `production` environment.
- [ ] Secrets come from that environment: `PRODUCTION_DATABASE_URL`, `PRODUCTION_HEALTH_URL`, `PRODUCTION_DEPLOY_WEBHOOK_URL`, `PRODUCTION_DEPLOY_TOKEN`.
- [ ] The database name does not look like a test database. The release guard refuses names matching test, integration, or disposable.
- [ ] A fresh production backup or point-in-time checkpoint exists. The dispatch input `backup_confirmed` is set only after that backup is verified. The workflow maps that input to `BACKUP_CONFIRMED=yes`.
- [ ] `npm run deploy:check --workspace=backend` has passed on that SHA. The migrate job runs the same migration-safety check again before `prisma migrate deploy`.
- [ ] Stripe is still in test mode unless live charges were explicitly approved.
- [ ] The deploy hook pulls the approved image digests. `docker-compose.production.yml` does not migrate on startup and does not load an env file.
- [ ] After the hook, `PRODUCTION_HEALTH_URL` returns success. The script polls for about 150 seconds. A failed check exits non-zero. It does not undo the migration and it does not automatically roll the image back.
- [ ] If readiness fails, stop customer traffic and run `.github/workflows/rollback-production.yml` with the previous 40-character SHA, or restore the database if the schema change is not backward compatible. Rollback does not run down migrations. There are none.

## Public signup and tenant isolation

Source behavior, not a live signup test:

- Public registration is open when `BETA_ALLOWLIST` is empty. Otherwise unknown emails stay `PENDING` and product routes return `403` `BETA_ACCESS_REQUIRED`.
- Unverified users can read `/api/auth/me`, resend verification, reset a password, and log out. Other product routes require `isVerified`.
- Registration is limited to 5 requests per 15 minutes per IP and fails closed if Redis is unavailable. Login uses the same window and limit and does not count successful attempts. Verification allows 10 per 15 minutes.
- Workspace data requires an active membership for that workspace id. Invitation email is limited to 10 per 15 minutes per user.
- Repository chat uses the caller’s GitHub credential. Review chat looks up the review inside the caller’s personal workspace.
- API, GitHub, integration, and social limiters fail open if Redis is unavailable. Treat a Redis outage as a security event for those routes, not only as a capacity event.

No live registration, mailbox, or second-tenant probe was run in this session.

## E2E test results

The suite is `frontend/e2e` under Playwright Chromium, against the Vite dev server, with provider HTTP calls mocked. It is not a live staging or production test.

The first launch failed all 13 tests before any page assertion. Playwright looked for Chromium in a cache directory that did not contain the executable. The installed browser is under the user profile. That run is not a product result.

A second run with 4 workers and the installed browser finished **6 passed, 7 failed**. The failures were mostly the full-screen session spinner. The same flows passed when the suite was run again with one worker, so that parallel result is not treated as a product defect.

The serial rerun (`--workers=1`) finished **11 passed, 2 failed** in 3.4 minutes:

Passed: beta feedback and admin status, registration with verification, login, logout, password reset, automation approve and reject, mocked Stripe checkout and expired session, keyboard login on a narrow viewport, failed sign-in, workspace member administration, narrow workspace layout, and invitation decline.

Failed:

- GitHub connect, start review, and finding feedback. The browser reached `/reviews?repo=sample%2Fproject` and the page stayed on “Loading review...”. The assertion for the finding text “Unsafe input” timed out at 5 seconds. The finding was not shown in that window.
- Accept, expire, and reject an invitation. The accept page was still on the lazy-route loading spinner when the 20 second assertion for “Accept invitation” expired. The invitation secret was not displayed because the page body had not rendered. The decline test in the same file passed on the next run.

No live GitHub, OpenAI, Stripe, or SMTP call was part of these tests.

## Security findings

This is a source review plus the unit tests above. It is not a penetration test.

- Session cookies are HttpOnly. `Secure` is set when `NODE_ENV` is production. CSRF tokens are signed. Mutations check the configured frontend origin.
- GitHub and Stripe webhooks verify signatures. Provider tokens are encrypted. Invitation tokens are hashed.
- API 500 responses use a fixed message. Logs redact tokens, cookies, and database URLs.
- Production configuration rejects local database and Redis hosts, short or reused secrets, and placeholder provider values.
- Gaps that remain: legal pages are drafts; `sk_live_` is a valid production key shape; some rate limits fail open without Redis; metrics are in-process for five minutes and are not one series across replicas; Sentry and `/metrics` stay off until configured; review chat is personal-workspace only; billing has no workspace checkout or Customer Portal; the API, workers, and scheduler share one process; a failed post-migrate health check does not roll back the schema.

## Launch monitoring plan

No live metrics were collected and no alert was delivered. The process evaluates `recommendedAlertThresholds` over the trailing five minutes and logs `Monitoring alert threshold crossed` the first time an alert opens. That log is not a page.

| Signal | Implemented threshold | Operator action |
| --- | --- | --- |
| Backend down | `/health/live` fails | Page immediately. Check the process, then `/health/ready`. |
| HTTP 5xx | At least 30 requests and at least 5% are 5xx | Open the error log and Sentry for that release. If the rate stays up, roll forward or roll the image back. |
| API latency | At least 30 requests and p95 is at least 2,000 ms | Check database, Redis, and AI provider latency before scaling. |
| PostgreSQL | Readiness reports `unavailable` | Stop deploys. Check the managed database. Do not point the app at a local URL. |
| Redis | Readiness reports `unavailable` | Treat as user-facing and security-relevant. Auth and AI routes fail closed. API, GitHub, integration, and social limits fail open. |
| Background jobs | At least 3 terminal failures in the window | Inspect review, email, automation, social, and fix-verification counts on `/health`. |
| AI cost | At least 5 priced AI requests and estimated cost at least $5 | Confirm the price id and model. Pause nonessential review traffic if the spend is unexpected. |
| AI request failures | Counted as `ai.failedRequests`. No alert is implemented. | Watch the dashboard. Investigate if failures are a large share of `ai.requests` in the same five-minute window. Do not treat this sentence as a configured page. |
| Authentication failures | Counted as HTTP 401s. No alert is implemented. | Watch `authenticationFailures` and 429s together. A surge of 401s with a stable 5xx rate is a credential-stuffing signal, not an outage page. |
| User feedback | Stored as allowlisted product events and beta feedback. No external sink is wired. | Review `/beta-admin` during launch. The form rejects connection strings and live-looking secrets. It does not store prompts or source. |

`GET /metrics` shows the same window only when `METRICS_TOKEN` is set. Queue depth, backup age, and SMTP delivery are not in this process. An external probe of `/health/ready` is still required.

## Incident response

RPO and RTO are not set. Name them before accepting customer data. Do not paste database URLs, tokens, or mailbox contents into tickets.

### Critical incident

1. Assign one incident owner. Record the start time, the release SHA, and whether customer data is affected.
2. Check `/health/live` and `/health/ready`. If readiness is failing, stop further deploys.
3. If the current release is the cause and the schema is still compatible, roll the application back with the procedure below.
4. If data integrity is in doubt, stop writes and follow database recovery. Do not restore over the only remaining copy.
5. Tell users with the communication procedure below. Update them when the impact window is known.

### Rollback

1. Choose the last known-good 40-character SHA. The rollback workflow rejects any other value.
2. Dispatch `.github/workflows/rollback-production.yml` from `main`. It uses the `production` environment, posts `{ "action": "rollback", "target": "production", "sha" }` to the deploy hook, and waits for the health URL.
3. Confirm `/health/ready` and one authenticated read-only flow.
4. Rollback does not reverse schema. If the new migration is incompatible, stop and use database recovery instead of repeating the hook.

### Database recovery

1. Use the managed point-in-time checkpoint or the custom-format dump procedure in `SAAS-LAUNCH-READINESS.md`.
2. Restore into an empty recovery database first. Validate migration state, ownership, subscriptions, and credential decryption with the keys from that environment.
3. Cut over only after a second operator confirms the target is the intended database.
4. Keep a backup of the current state before replacing it.

### Provider outage

- OpenAI or GitHub errors should surface as failed AI or GitHub requests, not as a database outage. Keep serving login, workspace reads, and already stored reviews.
- Stripe outage: do not mark local subscriptions cancelled by hand. Wait for signed webhooks. Failed invoices already map the local subscription to expired; do not invent a grace period during the incident.
- SMTP outage: registration can succeed while verification mail does not. Say so in the status notice. Do not disable verification to “unblock” signup.
- Redis outage: expect 503s on fail-closed routes and weaker limits on fail-open routes. Restore Redis before telling users the service is normal.

### AI usage or cost spike

1. Read the five-minute AI panel: requests, failures, unpriced requests, and estimated cost.
2. If the cost alert has opened, identify the model and feature from AI usage analytics. Do not copy prompts into the incident channel.
3. Keep the free-tier review cap in place. If spend is still unbounded for Pro, restrict new review starts at the provider key or by a temporary configuration change approved by the incident owner.
4. Live Stripe changes are a separate approval. A cost spike is not approval to switch billing mode.

### Security incident

1. Contain: revoke the affected session generation by a password reset or account action that increments `tokenVersion`. Disconnect the affected GitHub credential.
2. Rotate the specific secret that leaked: JWT, CSRF, encryption key, GitHub client secret, Stripe key, or SMTP. For the encryption key, set the previous key until stored tokens are re-encrypted.
3. Preserve redacted logs and the release SHA. Do not copy raw tokens into the ticket.
4. If customer repository content or credentials were exposed, tell the affected users directly. Do not wait for a public post.

### User communication

- Use the status channel the operator names before launch. This repository does not send that notice.
- Say what failed, what still works, and whether people should retry signup, review, or payment.
- Do not claim data was unaffected unless the recovery check shows that.
- For billing, say whether charges are in Stripe test mode or live mode. Today’s approved posture is test mode until live mode is explicitly approved.

## Launch blockers

- Staging has not been deployed or health-checked.
- Production domain, SSL, environment reviewers, secrets, and backups were not verified.
- Privacy, terms, and cookies are unapproved drafts.
- Alert delivery, SMTP delivery, and provider test-mode replay against a deployed URL were not done.
- Docker images were not built here.
- Incident owner, RPO, and RTO are unnamed.
- Two mocked Playwright flows failed in the serial rerun: the review page stayed on “Loading review...”, and the accept-invitation page did not finish loading within 20 seconds.
- Database, Redis, SMTP, and live provider integration tests were not run.

## Known limitations

- Review chat follows the personal workspace.
- Billing is per user. There is no general AI token budget beyond the review quota and the automation schedule cap.
- One process runs the API, workers, and scheduler.
- Metrics are per process.
- Legal copy is an engineering draft.
- Fix verification does not execute repository code inside the API. Without the separate runner, attempts stay unverified.

## Recommendation

**NOT READY — BLOCKERS FOUND**

The application code for auth, workspaces, GitHub, AI review, repository chat, automation, billing, migrations, and health checks is present. Backend unit tests passed (10 AI-usage tests and 366 further tests). Frontend unit tests passed (62). Migration preflight passed without changing a database. Dependency audit reported no high or critical findings and no production-dependency findings at the moderate threshold. The serial mocked browser run passed 11 of 13 tests and failed 2. That is not a public launch. Production deployment was not authorized and was not done. Staging was not validated. Keep Stripe in test mode. Do not dispatch the production workflow from this record.
