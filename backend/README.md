# Backend Setup Guide

## Installation

```bash
npm install
npm run prisma:generate
```

## Development

```bash
npm run dev
```

Server runs on http://localhost:3001

## Database

### Setup Prisma

This project connects directly to PostgreSQL. Set `DATABASE_URL` to a
`postgres://` or `postgresql://` connection URL; `prisma://` Accelerate URLs are
not supported by this backend.

```bash
# Generate Prisma client
npm run prisma:generate

# Apply committed migrations (after reviewing pending changes)
npm run prisma:deploy

# Create a new development migration only when changing the schema
npm run prisma:migrate -- --name describe_change

# Seed database
npm run seed

# Open Prisma Studio
npm run prisma:studio
```

### Personal AI work memory

Users can explicitly save project summaries and context, technical decisions,
preferences, lessons, reviewed AI summaries or inferences, and outcomes from their
own completed workflows. Each entry records its source, attribution, and
timestamps, and can optionally be linked to one of that user's repositories.
Memory is scoped to the authenticated user; the current data model has no
separate organization or shared-tenant concept.

Saved entries are never collected from conversations automatically. Users can
inspect, edit, delete, or disable memory in the app under **Settings → Manage
saved memory**. Disabled memory is not retrieved for AI plans; deleting an entry
removes it from future retrieval because planning searches the live database and
does not maintain a vector index or derived document store. Automation planning
is currently the only AI surface that retrieves memory; it uses simple lexical
matching over the 100 most recently updated entries and sends at most 8 relevant
entries (up to 6,000 characters) to the planner. There is no organization-level
tenant model or shared memory in this application. Completed workflow entries
are accepted only when the referenced workflow belongs to the user.
Integration references should name a provider or configuration location only;
plaintext secrets and common sensitive values are rejected, but this pattern
check is not comprehensive and is not a substitute for avoiding sensitive data.

### Visual workflow builder

The authenticated `/automations/builder` page saves workflow graphs as drafts.
The server validates the complete graph before validation or persistence, checks
connected-account access for GitHub actions, and compiles supported action nodes
into the existing automation tasks and dependency engine. Submitting a draft
creates the existing owner approval, then execution continues through the
existing queue, active-automation limit, task permissions, and audit events.
The workflow graph is included in the approval fingerprint and revalidated by
the worker before execution.

Only manual triggers are supported: this project has no workflow scheduler or
generic GitHub-event workflow trigger. The approval node must immediately follow
the manual trigger and represents the existing workflow-level owner approval;
mid-run approval pauses are not supported. Conditions use only predefined
review-count and GitHub result checks. Merge/join paths and arbitrary
expressions or user code are rejected. Graph actions are limited to existing
automation operations. Apply the `20261017150000_add_visual_workflows` migration
before deploying this feature.

### Review processing

Starting a review verifies that the connected GitHub account can access the
requested repository and branch, then queues the analysis in Redis. The backend
worker fetches supported source files (up to 20 files, 20 KB per file, and 100
KB total), sends them to the configured OpenAI model, and saves findings,
analytics, review status, and a completion email job. Configure `OPENAI_API_KEY`
and ensure Redis is available before requesting reviews. Apply schema changes
before deploying with:

```bash
npx prisma migrate deploy --schema src/prisma/schema.prisma
```

AI findings are schema-validated against the selected source: locations must
exist, cited evidence must occur at that location, and duplicate findings are
removed before persistence. Repository content is sent as untrusted user data;
it is not executed by the review service. The AI prompt context is capped at
60,000 serialized characters. If file-selection or context limits omit eligible
files, the completed review displays that limitation instead of implying full
coverage. Findings retain optional title, evidence, and end-line fields so older
stored reviews remain compatible.

The configured `OPENAI_API_KEY` authenticates review requests. `OPENAI_MODEL`
selects the model and defaults to `gpt-4o-mini`. Missing credentials, rate
limits, provider timeouts, and malformed or schema-invalid responses fail the
review with safe, actionable status text; provider response bodies and
credentials are not copied into review records or API errors. No fallback
findings are generated. The persisted heuristic score is derived only from
validated findings:
`max(0, min(100, 100 - 12*bugs - 20*security - 8*performance - 3*quality))`.
It is not an AI quality judgment or an objective measure of code quality; a
missing score is shown as unavailable rather than zero.

For pull requests, source content is fetched at the webhook's expected head
revision. Findings must cite exact evidence from the retrieved file and their
cited range must overlap changed lines. A range can include adjacent unchanged
context to establish the cause; the review records that limitation, and such a
location may not be eligible for an inline GitHub comment. Equivalent findings
are deduplicated conservatively only when file, category, exact normalized
evidence, an overlapping line range, and title or message agree. Different
evidence or distinct issue wording is preserved.

### AI test suggestion previews

`POST /api/reviews/:id/findings/:findingId/test-suggestions` generates up to
three TypeScript/JavaScript test-code suggestions for an owned review finding.
Backend source uses the repository's `node:test`/`tsx` framework; frontend
source uses Vitest. The API returns code as a preview only. It does not write
files, run generated code, or report coverage. Review the suggestion before
copying it into the project; no automatic apply or execution approval flow is
available yet.

The generator checks for duplicate names and test bodies in related test files
included in the persisted, pinned review snapshot. That snapshot can omit tests
from elsewhere in the repository, so duplicate checks are not a repository-wide
test inventory. Unsupported languages, malformed provider output, and provider
timeouts return explicit errors. The review owner is checked before generation,
and suggestions are not persisted or linked to verification/analytics records.

Generated tests are untrusted code and are never executed by this feature.
There is no isolated runner, resource/time limit, actual test result, or
coverage integration for generated suggestions. Do not treat suggestions or
coverage figures from other tooling as proof of correctness.

### Repository Q&A

Authenticated users can ask a repository question with
`POST /api/chat/repository-message`, supplying `repository` (`owner/name`),
optional `branch` (defaults to `main`), and `question`. The request uses the
authenticated user's existing GitHub OAuth access and fetches source through the
review integration, which pins content to the branch commit and applies its
existing file and size limits. Each response includes that source revision,
retrieved evidence snippets with file paths and line ranges, and any source
limitations. If no relevant source is found, the API reports that the available
repository evidence is insufficient instead of calling the AI provider.

This first iteration retrieves source for each question rather than creating a
persistent index. It uses bounded lexical snippet retrieval, excludes common
secret/environment, dependency, and build paths, redacts recognized credentials,
and instructs the configured review AI provider to treat repository content as
untrusted data. AI evidence identifiers are validated against the snippets
actually retrieved. The endpoint does not persist repository chat history;
existing review chat remains separately stored and owner-scoped. It does not
provide an incremental index, a frontend Q&A history, or embeddings/vector
search.

An opt-in real-provider integration test uses only a small synthetic source
file and does not execute it. It is excluded from the regular test suite:

```powershell
$env:RUN_LIVE_AI_REVIEW_TEST = '1'
npm run test:ai-review:live --workspace=backend
Remove-Item Env:RUN_LIVE_AI_REVIEW_TEST
```

Set a valid `OPENAI_API_KEY` (at least 20 characters and not a sample
placeholder) and optionally `OPENAI_MODEL` in the backend environment before
running it. Without explicit opt-in or a usable credential, the test is
reported as skipped. The invocation makes a real provider request and may
incur usage charges.

### Review quality benchmark

Run `npm run benchmark --workspace=backend` from the repository root (or
`npm run benchmark` from `backend`) to evaluate the versioned synthetic
fixtures with deterministic mock provider responses. This offline mode is the
default and does not make model/API calls. It reports expected/detected
findings, false-positive and missed-finding locations, TP/FP/FN, precision,
recall, exact-duplicate provider output rate, category/severity breakdowns,
runtime, and sanitized failures. Undefined precision, recall, and duplicate
rate are reported as `null` when their denominators are zero. No aggregate
quality score is presented.

Use `npm run benchmark --workspace=backend -- --live` only when an intentional
paid model run is approved and `OPENAI_API_KEY` is configured. Live evaluation
uses the same fixed fixture dataset, the configured OpenAI integration
(`gpt-4o-mini`, temperature 0.1), and defaults to a 60-second per-fixture
timeout. Optional `--timeout-ms <ms>` and `--output <path>` flags set a
positive timeout and write a JSON report plus a `.summary.txt` companion.
Reports contain fixture IDs and metric references, not source text, finding
messages, or credentials. Include `--output` to persist machine-readable and
human-readable reports; without it, the human-readable summary is printed.

The versioned dataset is in
`src/modules/code-review/benchmark/fixtures.ts`. Add synthetic source snippets,
explicit category/file/line/evidence ground truth, and a valid deterministic
mock JSON response when adding a fixture. Fixture validation verifies unique
IDs/paths and that each expected evidence marker exists at its labelled line.
Finding matches require category, case-insensitive file path, evidence
containment, and any specified severity; line numbers may differ by up to two
lines. That tolerance accommodates nearby citations but can conflate adjacent
issues. Evidence containment is approximate, not semantic equivalence. The
reported duplicate rate counts exact repeated file/category/line-range/evidence
tuples in raw provider output; mock output is deterministic, while live
duplicate rates reflect that particular model response. The analyzer removes
exact duplicates before scoring.
An empty dataset produces null precision/recall rather than implying a measured
zero score. Severity metrics use only expected findings with an explicit
expected severity.
Live runs can vary across model versions and are not a measure of general
real-world review quality beyond these small synthetic fixtures. The fixture
responses exercise the measurement pipeline and are not evidence that the
analyzer itself detected those issues.

### Finding lifecycle and developer feedback

Apply the `20261021230000_finding_lifecycle_feedback` migration before
deploying the status controls. Findings default to `UNREVIEWED`; review owners
can transition them to `CONFIRMED`, `FALSE_POSITIVE`, `DUPLICATE`, `FIXED`, or
`WONT_FIX`, with optional feedback text. The review API returns the current
status and feedback history, including actor and timestamp, and
`PATCH /api/reviews/findings/:findingId/status` validates ownership and
transitions server-side. Per-review analytics count persisted statuses and
separate developer-marked fixes from records with an independent-verification
timestamp. No independent process currently sets this legacy fixed timestamp,
so that metric remains zero; developers cannot set the verification timestamp.
Feedback is not used to suppress future findings or retrain the analyzer.

### Evidence-backed verification

Apply the `20261024133000_evidence_backed_verification` migration before
deploying this version. Reviews persist a source commit revision: pull requests
use the validated head SHA, while branch reviews first resolve the branch to a
commit and fetch both its tree and file contents by that immutable SHA. Findings
retain their cited source evidence and receive an `AI_REPORTED` verification
record tied to that revision. The record explicitly states that source citation
validation does not independently verify the issue.

The available statuses are `AI_REPORTED`, `VERIFIED`,
`VERIFICATION_FAILED`, and `INCONCLUSIVE`. Authenticated owners can request one
of two allowlisted profiles through
`POST /api/reviews/findings/:findingId/verification-requests` and inspect its
record through the corresponding `GET` route. Requests are idempotent per
finding/request key and limited to five per finding. The request schema rejects
client-supplied status, exit code, source revision, and execution evidence.
Developer feedback/status APIs cannot set verification data.

There is currently no production static-analysis or isolated test runner
connected to findings. The orchestration endpoint therefore records
`INCONCLUSIVE`, `executionOccurred=false`, no tool or exit code, and an explicit
diagnostic that no check ran. It does not enqueue a BullMQ job or execute code
and never returns `VERIFIED` or `VERIFICATION_FAILED`. The schema retains
execution metadata for a future trusted runner; a request result becomes
inconclusive if the source revision is missing or stale. Proposal verification
is a separate workflow and does not verify the AI finding.

Do not add a runner until a separately deployed isolation boundary is
implemented and validated. Unit tests use an in-memory store test double for
request and stale-revision behavior; they are not evidence of a real check
execution or sandbox.

### Fix proposals and verification safety

Apply the `20261022200000_fix_verification_proposals` migration before deploying
the patch-proposal UI. Review owners may save a unified-diff proposal against
their finding; proposals are size-limited, path-checked, content-addressed by
SHA-256, deduplicated, and shown for review. Each finding is limited to 10
proposals and each proposal to 5 verification attempts. Saving a proposal does not apply,
push, merge, or execute it.

Verification attempts have idempotency keys and persist the tested patch digest,
server-supplied test commands, execution state, timestamps, outcome, and
sanitized output. The trusted verification service classifies a result as
`VERIFIED` only when tests pass, the exact patch digest matches, and a
finding-specific reproduction is observed before but not after the patch.
Passing a general test suite by itself is insufficient. Verification of a
proposal is not evidence that the proposal has been applied to the repository;
therefore proposal outcomes do not set `Finding.independentlyVerifiedAt` or
increment independently verified-fix analytics.

This repository does not currently provide a sandboxed runner, isolated worker
queue, or controls for CPU, memory, process count, filesystem access, and
network egress. The application intentionally does not execute repository
scripts, dependencies, or proposed patches. Without a configured trusted
isolated runner, internal verification requests persist `INCONCLUSIVE` with
`BLOCKED` execution status and an explicit no-execution log. Runner behavior in
unit tests uses fakes only. The current proposal API and UI only save and
display patches; they do not request execution. Do not enable execution until a
separate sandbox deployment has enforceable resource/time limits, restricted
network access, ephemeral credentials, command allowlisting, and output
sanitization. Log redaction is best-effort and is not a substitute for keeping
secrets out of the runner environment. A process crash can leave an attempt in
`RUNNING`; retry keys prevent duplicate execution, but automated stale-attempt
recovery is not implemented and would need to be added with the isolated worker.

To exercise database persistence and API authorization, point both
`DATABASE_URL` and `FINDING_LIFECYCLE_TEST_DATABASE_URL` at the same blank,
disposable PostgreSQL database on localhost whose database name contains
`test` or `lifecycle`. Apply migrations with `npm run prisma:deploy`, then run
`npm run test:finding-lifecycle:integration`. The test refuses remote or
non-test-named databases and removes only the fixture users it creates.

### GitHub pull request webhooks

Apply the database migration and configure a GitHub repository webhook pointing
to `https://<your-host>/api/webhooks/github`. Select `application/json`, set a
high-entropy webhook secret, and configure the same value as
`GITHUB_WEBHOOK_SECRET` in the backend environment. Subscribe to Pull requests;
the service processes `opened`, `synchronize`, and `reopened` actions and safely
ignores unsupported events/actions.

The webhook does not trust the event's sender as an application user. It only
queues a review when the repository is already linked to an application account
and that account's connected GitHub OAuth token can access the pull request.
OAuth permissions must allow reading repository contents and pull-request
metadata. The OAuth app currently requests the broad classic `repo` scope;
least-privilege GitHub App installation authorization is not configured.
Reviews are queued through Redis and results are stored in CodeGuard. GitHub
pull-request comments are not posted automatically because there is no
per-review approval step. GitHub issue and comment actions in automation
require approval of the exact plan before execution. Live webhook delivery is
not configured by this project.

### Authentication and account lifecycle

Generate the updated Prisma Client and apply the account lifecycle migration and
`20261025120000_email_verification_otp_attempts` migration before deploying.
The OTP migration adds the failed-attempt counter; migrations are not applied
automatically by the application.

Configure `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, and `MAIL_FROM`
for verification and password-reset email delivery, and set `FRONTEND_URL` to
the public frontend origin. Verification codes expire after 10 minutes and
allow five failed attempts; password-reset links expire after 30 minutes.
Verification OTPs are HMAC-hashed in the database and encrypted in Redis job
payloads; password-reset tokens are stored as SHA-256 hashes. Reset requests
return the same response for known and unknown email addresses. Authenticated
account-security actions are limited to five requests per IP per 15 minutes;
verification submissions are limited to ten per IP per 15 minutes.
For Gmail SMTP, use port `465` with implicit TLS or port `587` with STARTTLS;
the mailer selects implicit TLS automatically for port `465`. Docker Compose
loads `backend/.env` for SMTP settings when that file exists.

Email verification is required to sign in. If the code does not arrive, use
the sign-in page's resend option to queue a replacement code. Queue acceptance
does not prove that SMTP delivered it.
`POST /api/auth/logout` increments the user's token version, invalidating
existing bearer tokens; middleware checks that version and account existence on
each authenticated request. Password reset also invalidates existing tokens.

`POST /api/auth/github/disconnect` removes the locally stored GitHub credential
and attempts provider revocation using `GITHUB_CLIENT_ID` and
`GITHUB_CLIENT_SECRET`. Local disconnect still succeeds if provider revocation
cannot be confirmed, and existing review history is retained.
`DELETE /api/auth/account` requires the current password and the exact
confirmation `DELETE`. Account deletion is blocked while a Pro subscription is
active or remains entitled through its paid period; cancel it first. The
application does not cancel/delete the Stripe-side subscription or customer
record as part of account deletion. Account-owned data with cascading user
relations is removed; global Stripe event records are retained.

### Environment Variables

Create `.env` in the backend directory with database connection:

```
DATABASE_URL=postgresql://user:password@localhost:5432/ai_codeguard
REDIS_URL=redis://127.0.0.1:6380
```

Production must provide independent, randomly generated `JWT_SECRET` and
`GITHUB_TOKEN_ENCRYPTION_KEY` values, each at least 32 characters long. The
server refuses to start in production if either value is missing, a sample
placeholder, or if the two values are identical. Generate each value separately
with a cryptographically secure random generator and store them in your
deployment's secret manager; never reuse the development values.

Production startup also requires TLS-protected Redis (`rediss://`), an HTTPS
`FRONTEND_URL`, and a public HTTPS `GITHUB_CALLBACK_URL`. The backend image
defaults to production mode and runs as the unprivileged Node.js user; local
Compose explicitly overrides the mode for development.

When rotating `GITHUB_TOKEN_ENCRYPTION_KEY`, temporarily set
`GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS` to the old key and deploy both values.
Existing GitHub tokens are re-encrypted with the new key when their account is
next used. Keep the previous key configured until all stored tokens have been
rewrapped. Tokens encrypted before this key was introduced can still be read
using the previous `JWT_SECRET`; if rotating that secret at the same time, set
`GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS` to its old value during the transition.
Rotating `JWT_SECRET` invalidates existing login tokens, so users will need to
sign in again.

The demo seed is disabled when `NODE_ENV=production`.

### Stripe billing lifecycle

Production startup requires PostgreSQL and Redis URLs, independent random
`JWT_SECRET` and `GITHUB_TOKEN_ENCRYPTION_KEY` values (at least 32 characters),
OpenAI and GitHub credentials, and all three Stripe settings:
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRO_PRICE_ID`. Set
`FRONTEND_URL`; configure `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`,
and `MAIL_FROM` to enable account emails. `backend/.env.example` contains
variable names and safe placeholders. Never commit real secrets.

Create a recurring Pro price in Stripe and configure its ID as
`STRIPE_PRO_PRICE_ID`. Stripe test keys are supported for local and staging
verification. The API only accepts the configured price and does not treat the
checkout success redirect as proof of payment. Signed subscription and invoice
webhooks update local status; event IDs and `PROCESSING`/`PROCESSED`/`FAILED`
state are persisted for deduplication and retry diagnosis. Failed/stale events
can be retried by Stripe redelivery; inspect `StripeEvent` to diagnose failed
processing. Logs avoid payment payloads and exception text.

The existing policy is retained: Free includes three reviews per UTC month;
active/trialing Pro is unlimited; canceled Pro remains entitled through its paid
period; past-due and other delinquent subscriptions fall back to Free access.
Review quota is reserved atomically with review creation. Cancellation from the
Billing page schedules cancellation at the end of the paid period.

For test-mode webhook delivery, set a test key/price, then run the Stripe CLI:

```bash
stripe listen --forward-to localhost:3001/api/billing/webhook
```

Set the CLI's `whsec_...` as `STRIPE_WEBHOOK_SECRET` and restart the backend.
Automated signature, duplicate-claim, status-mapping, quota, and config tests use
test data/mocks; hosted Checkout and provider/account behavior still require
manual staging checks.

### Migrations and Docker operation

Generate the client after installing dependencies, and apply committed
migrations with `npm run prisma:deploy`. The production backend image does not
automatically migrate. Review and back up production data before running
`npm run prisma:deploy --workspace=backend` as a deployment step.

From the repository root, `docker compose up --build` starts the local database,
Redis, backend, and frontend. Compose waits for PostgreSQL and Redis, applies
the committed migrations before starting the backend, and waits for backend
readiness. Compose credentials are local development values only. `GET /health`
checks the database, Redis, and queue connectivity and reports failed-job
counts without including job payloads.

## Build & Run

```bash
# Build
npm run build

# Start production server
npm start
```

## Code Quality

```bash
# Lint
npm run lint
npm run lint:fix

# Format
npm run format

# Type check
npm run type-check
```

## Testing

```bash
npm run test
npm run test:watch
```

## Project Structure

- `src/app/` - Express app setup and server
- `src/config/` - Configuration (env, database, redis, github)
- `src/modules/` - Feature modules (auth, users, github, reviews, ai, chat, billing, email)
- `src/middleware/` - Express middleware
- `src/utils/` - Utility functions (jwt, bcrypt, logger)
- `src/types/` - TypeScript interfaces
- `src/prisma/` - Database schema and migrations
- `src/jobs/` - Background jobs with BullMQ
- `src/tests/` - Test files

## API Endpoints

All endpoints prefixed with `/api`

### Health Check

- `GET /health` - Server health status

### Authentication

- `POST /auth/login` - Login user
- `POST /auth/register` - Register new user
- `POST /auth/logout` - Logout user

New accounts must verify their email before login succeeds. Registration
creates an unverified account and queues a six-digit email code; users verify
it on `/verify-email` and then sign in. Registration/verification do not issue a
session before the account is verified. The OTP expires in 10 minutes, is
single-use, allows five failed attempts, and can be resent after a 60-second
cooldown. The public resend response does not reveal whether an account exists
or whether mail was delivered.

Configure `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, and
`MAIL_FROM`; set `EMAIL_OTP_SECRET` to an independent random value of at least
32 characters in production. The worker validates mail settings at startup.
Configure Redis 6.2 or newer (Docker Compose uses Redis 7); BullMQ startup rejects older
versions. A queued email is not proof of SMTP delivery or inbox placement.
After verification, sign in; the selected Free plan continues to the dashboard,
while Pro continues to pricing/checkout. Registration does not grant a paid
subscription. GitHub connection also requires a verified account.

Before deploying this change, apply
`src/prisma/migrations/20261025120000_email_verification_otp_attempts/migration.sql`
through the normal Prisma migration process. The migration is not applied by
application startup.

### Account lifecycle

- `POST /auth/verify-email` - Verify email using `{ email, otp }`
- `POST /auth/verification-email/request` - Public, rate-limited verification resend request
- `POST /auth/password-reset/request` - Request a password-reset email
- `POST /auth/password-reset/confirm` - Set a new password using a one-time token
- `POST /auth/verification-email` - Resend verification (authenticated)
- `POST /auth/github/disconnect` - Disconnect GitHub (authenticated)
- `DELETE /auth/account` - Delete the authenticated account after confirmation

## Docker

```bash
docker-compose up -d
```

## Troubleshooting

### Database connection failed

- Ensure PostgreSQL is running
- Check DATABASE_URL in .env
- Run migrations: `npm run prisma:migrate`

### Redis connection failed

- Ensure Redis is running
- Check REDIS_URL in .env
- BullMQ requires Redis 6.2 or newer; email worker startup reports an actionable diagnostic for older versions.
- Inspect safe queue/worker error codes and SMTP response codes in backend logs. Never log OTPs or credentials.

### Port already in use

- Change PORT in .env or kill process using port 3001
