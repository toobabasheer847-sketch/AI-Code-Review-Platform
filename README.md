# AI-CodeGuard - AI Code Review Platform

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-22%2B-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.4%2B-blue.svg)

AI-CodeGuard is a full-stack application for AI-assisted code review with GitHub integration, background processing, and optional subscription billing.

## 🚀 Features

- **AI-assisted Code Review**: An OpenAI-backed review path is implemented and requires a configured provider. Findings are validated against supplied source (and available pull-request diff lines); displayed scores are heuristic indicators, not guarantees that code is safe or issue-free.
- **AI Chat**: Authenticated HTTP chat for owned reviews and authorized GitHub repositories
- **GitHub Integration**: OAuth and repository-access flows are implemented; live provider access requires app setup and is not verified by the test suite
- **GitHub Development Agent**: Evidence-backed repository and pull-request context with approval-gated issue and comment actions
- **Social Publishing**: Evidence-backed LinkedIn drafts, approval inbox, and scheduled member text posts; actual publishing requires LinkedIn configuration and account authorization
- **Subscription Billing**: Stripe checkout and webhook flows are implemented; live billing requires Stripe configuration and was not live-tested here
- **Background Jobs**: BullMQ for async processing of reviews and emails
- **Automation MVP**: Approval-gated plans with persisted task status and safe text-draft execution
- **Analytics**: Owner-scoped review feedback and AI usage reports
- **Security controls**: server-managed HttpOnly JWT sessions, signed CSRF tokens, encrypted provider credentials, explicit-origin CORS, Helmet, and Redis-backed rate limits shared by every API replica
- **Multi-language Support**: Support for various programming languages
- **Email Notifications**: Nodemailer integration for alerts and notifications
- **Error Monitoring**: Optional privacy-scrubbed Sentry reporting; monitoring is disabled until a DSN is configured
- **Redis**: Background queues and shared rate-limit storage

## 📁 Project Structure

```
AI-CodeGuard/
├── frontend/                 # React + Vite application
│   ├── src/
│   │   ├── app/             # Application root
│   │   ├── components/      # Reusable React components
│   │   ├── features/        # Feature-specific modules
│   │   ├── lib/             # Utilities and configurations
│   │   └── types/           # TypeScript type definitions
│   └── package.json
└── backend/                 # Express API server
    ├── src/
    │   ├── app/             # Express application setup
    │   ├── config/          # Configuration files
    │   ├── modules/         # Feature modules
    │   ├── middleware/      # Custom middleware
    │   ├── utils/           # Utility functions
    │   └── prisma/          # Database schema and migrations
    └── package.json
```

## 🛠️ Tech Stack

### Frontend

- **React 18** with TypeScript
- **Vite** - Next generation build tool
- **TanStack Query** - Data fetching and caching
- **React Router** - Client-side routing
- **Tailwind CSS** - Utility-first CSS framework
- **Zustand** - Lightweight state management
- **Framer Motion** - Animation library
- **Recharts** - Data visualization
- **Zod** - Schema validation
- **React Hook Form** - Form state management

### Backend

- **Express.js** - Web framework
- **TypeScript** - Type safety
- **Prisma ORM** - Database abstraction
- **PostgreSQL** - Relational database
- **Redis** - Background queues and shared rate-limit storage
- **BullMQ** - Background job processing
- **OpenAI API** - AI-powered code analysis
- **JWT** - Authentication tokens
- **Stripe** - Payment processing
- **Nodemailer** - Email service
- **GitHub OAuth** - Repository access and development workflows
- **LinkedIn OAuth** - Optional member text-post publishing
- **SMTP** - Required email delivery for account and workflow notifications

## 🚀 Getting Started

### Prerequisites

- Node.js >= 22.0.0
- npm >= 10.0.0
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (optional)

### Installation

1. **Clone the repository**

```bash
git clone https://github.com/yourusername/ai-codeguard.git
cd ai-codeguard
```

2. **Set up environment files**

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

On Windows PowerShell, use `Copy-Item backend\.env.example backend\.env` and
`Copy-Item frontend\.env.example frontend\.env`. Configure valid SMTP
credentials in `backend/.env`; the email worker validates mail settings during
server startup. Set provider credentials only for integrations you intend to
exercise. For local services, PostgreSQL defaults to port `5432`; the backend
Redis default is port `6380` (change `REDIS_URL` if your Redis listens elsewhere).

3. **Install dependencies and apply migrations**

```bash
npm ci
npm run prisma:generate --workspace=backend
npm run prisma:deploy --workspace=backend
```

4. **Run the applications** in separate terminals

```bash
npm run dev --workspace=backend
npm run dev --workspace=frontend
```

5. **Access Application**

- Frontend: http://localhost:3000
- Backend API: http://localhost:3001
- Liveness check: http://localhost:3001/health/live
- Readiness check: http://localhost:3001/health/ready (also available at `/health`)

### Docker Setup

```bash
# Build and run with Docker Compose
docker-compose up -d
```

Compose is for local development and uses local-only database credentials. Do
not use it as a production deployment template. Copy the root `.env.example`
to `.env` for Compose interpolation and configure `backend/.env` for provider,
mail, and other backend settings. Compose applies migrations before starting
the backend. `GET /health/ready` (also `/health`) checks PostgreSQL, Redis, configured
queues, and scheduler state. `GET /health/live` checks only that the API
process is responding.

See [SAAS-LAUNCH-READINESS.md](./SAAS-LAUNCH-READINESS.md) for production
environment setup, release checks, deployment and rollback guidance, backup
and restore steps, and audited launch limitations. The application has not
been independently verified in a production deployment.

## 📚 API Documentation

The following inventory is based on the Express routers mounted by
`backend/src/routes.ts`. Most product routes require an authenticated session;
public callbacks and webhooks are identified below. The route-wiring tests check that protected product paths reject
unauthenticated requests and that selected public callbacks/webhooks are
mounted when given incomplete requests. These are route-availability checks;
provider-backed calls are not live-tested by the unit suite.
In each table row, abbreviated paths inherit that row's API prefix (for
example, `/login` in Authentication means `/api/auth/login`). Session
authentication is required except for the explicitly public auth flows,
provider callbacks, and signed webhooks.

| Area | Mounted routes |
| --- | --- |
| Health | `GET /health/live`, `/health/ready`, `/health` (readiness alias) |
| Authentication | `GET /api/auth/csrf`, `/api/auth/me`; `POST /api/auth/register`, `/login`, `/logout`, `/verification-email/request`, `/verification-email`, `/verify-email`, `/password-reset/request`, `/password-reset/confirm`; `DELETE /api/auth/account` |
| GitHub | `GET /api/github/connect`, `/callback`, `/repos`, `/repos/:owner/:repo/files`, `/repos/:repoName/files`, `/file`, `/development/templates`; `POST /api/github/development/workflows`; `DELETE /api/github/disconnect` |
| Reviews | `GET /api/reviews`, `/analytics`, `/feedback-analytics`, `/:id`, `/:id/duplicate-candidates`, `/fix-verification-attempts`, `/fix-verification-attempts/:attemptId`, `/findings/:findingId/verification-requests/:requestKey`; `POST /api/reviews/start`, `/findings/:findingId/feedback`, `/findings/:findingId/fix-proposals`, `/findings/:findingId/verification-requests`, `/fix-proposals/:proposalId/verification-attempts`, `/fix-verification-attempts/:attemptId/review-decision`, `/fix-verification-attempts/:attemptId/cancel`, `/:id/findings/:findingId/test-suggestions`, `/internal/verification-callback`; `PATCH /api/reviews/findings/:findingId/status`; `DELETE /api/reviews/:id` |
| Repository records and rules | `GET /api/repositories`, `/api/repositories/:repositoryId/review-rules`; `POST /api/repositories/:repositoryId/review-rules`; `PATCH /api/repositories/:repositoryId/review-rules/:ruleId`; `DELETE /api/repositories/:repositoryId/review-rules/:ruleId` |
| Chat | `POST /api/chat/message`, `/api/chat/repository-message` |
| AI usage | `GET /api/ai-usage` |
| Billing | `POST /api/billing/create-checkout`, `/cancel-subscription`, `/webhook`; `GET /api/billing/subscription`, `/usage` |
| Automations | `GET /api/automations`, `/:id`, `/schedules`, `/notification-preferences`; `POST /api/automations`, `/visual`, `/visual/validate`, `/:id/execute-draft`, `/:id/approve`, `/:id/reject`, `/:id/cancel`, `/:id/retry`, `/schedules`, `/schedules/:id/pause`, `/schedules/:id/resume`; `PATCH /api/automations/schedules/:id`, `/notification-preferences`; `DELETE /api/automations/schedules/:id` |
| Social publishing | `GET /api/social/linkedin/callback`, `/status`, `/posts`; `POST /api/social/linkedin/connect`, `/drafts/generate`, `/drafts`, `/posts/:postId/request-approval`, `/posts/:postId/approve`, `/posts/:postId/reject`, `/posts/:postId/cancel`, `/posts/:postId/retry`; `PATCH /api/social/posts/:postId`; `DELETE /api/social/accounts/:accountId` |
| Integrations | `GET /api/integrations`; `POST /api/integrations/:provider/check` |
| Work memory | `GET /api/memory`, `/settings`, `/projects`; `POST /api/memory`; `PATCH /api/memory/:id`, `/settings`; `DELETE /api/memory/:id` |
| GitHub pull-request webhook | `POST /api/webhooks/github` |

GitHub OAuth callback is mounted at `GET /api/auth/github/callback` (the
configured callback URL) and is also reachable at `GET /api/github/callback`.
The GitHub router is additionally mounted under `/api/auth/github`.
`GET /api/github/repos` lists repositories accessible to the authenticated
GitHub account and supplies connected repositories for selection.
`GET /api/repositories` is different: it lists persisted,
owner-scoped repository records and does not connect or disconnect GitHub
repositories. Only review-rule management is mounted under that prefix.

Review creation is `POST /api/reviews/start` with a repository and optional
branch; deletion is `DELETE /api/reviews/:id`. There is no mounted
`POST /api/reviews` or `PUT /api/reviews/:id`. Fix verification history and
remote isolated-runner setup are documented in
[docs/fix-verification-engine.md](docs/fix-verification-engine.md).

Chat is HTTP request/response, not streaming or Socket.IO. Review chat uses
`POST /api/chat/message` and is attached to an owned review; saved messages
appear in that review's detail response. Repository Q&amp;A uses
`POST /api/chat/repository-message`, returns bounded source evidence, and has
no conversation-history endpoint. The repository has Socket.IO dependencies
and placeholder files, but the HTTP server does not attach a Socket.IO runtime.

The following README/API assumptions are **not implemented**: `/api/docs`,
`/api/ai/analyze`, `/api/ai/chat`, repository create/detail/delete routes under
`/api/repositories`, review update via `PUT`, a `/api/users` router, and
real-time chat. The route-wiring test asserts that `/api/docs`,
`/api/ai/analyze`, `/api/ai/chat`, and `/api/users` return 404. The absence of
the other paths follows from the mounted route definitions above; they are not
aliases for mounted APIs and must not be used as API contracts. No OpenAPI UI
is currently served.

### Implemented, conditional, and planned scope

- **Implemented in this checkout:** authenticated review, analytics,
  repository-rule, chat, automation, memory, integration-catalog, usage, and
  workspace APIs. Workspace routes are mounted at `/api/workspaces`. Active
  membership is resolved before role checks. Owner checks are enforced by the
  relevant services.
- **Partially/configuration-dependent:** OpenAI analysis and drafting require a
  valid provider key; GitHub repository access requires a connected account and
  its permissions; LinkedIn publishing requires app/account access and explicit
  approval; Stripe billing requires complete Stripe configuration and verified
  webhooks; email delivery requires reachable SMTP. Source and automated tests
  do not prove any external provider is currently available or authorized.
- **Fix verification:** the API does not execute repository code. Execution
  needs the separate runner described in
  [docs/verification-runner.md](docs/verification-runner.md); without it,
  attempts remain unverified/`NEEDS_REVIEW`.
- **Planned, not present as APIs:** IDE plugins, mobile and CLI clients, and
  additional AI providers. The aspirational items below are not API contracts.

### Automation and integrations

The command center's supported end-to-end workflow reads up to five of the
authenticated user's latest completed code-review records, then generates an
internal text draft from the review-reported results. Review content is treated
as untrusted input; drafts must not claim an issue was fixed or an improvement
was independently verified. The goal and selected review text are sent to the
configured OpenAI provider for draft generation. The automation does not start
new code reviews or consume the review quota.

Approval-required plans create a seven-day approval request containing the
exact plan payload and its fingerprint. Approval is checked server-side;
rejection, expiration, or a changed payload prevents execution. The worker
rechecks the approved owner and plan fingerprint before starting an approved
workflow, and it claims only one ready task at a time after its dependencies
have completed. Execution uses the existing BullMQ/Redis worker and records
individual task attempts, outputs, failures, and workflow events. Draft-only
mode does not execute; automatic mode is limited to registered internal
read/draft actions.

The GitHub Development Agent uses the existing encrypted GitHub OAuth
integration and persists work in the existing automation/task/approval/event
records. It can collect authorized repository, pull-request, recent-commit,
check-run (for the selected pull request or the most recently updated one),
and completed-review context when GitHub exposes those capabilities
to the connected account. Results retain supporting evidence links and mark
unavailable sources or partial failures explicitly; missing checks are never
reported as passing. Suggested fixes and pull-request descriptions are drafts,
not pushed changes.

Preparing an issue or pull-request comment requires repository write access and
creates an approval request containing the exact action payload. The server
revalidates repository/target access and approval before execution, and
idempotency markers protect retries. The only GitHub Development Agent external write actions are issue
creation and pull-request comments; pushing branches, creating or changing
pull requests, merging, and arbitrary GitHub API calls are unsupported.
GitHub API access remains bounded by the existing OAuth scopes and account
permissions; broad `repo` scope is retained for compatibility with existing
private-repository review features. Shell, filesystem, SQL, and arbitrary
network execution are not supported.

Separately, a configured pull-request webhook can queue a review whose findings
are submitted as a GitHub pull-request review comment after webhook signature,
connected-account repository, and pull-request commit checks pass. This webhook
review publication is automatic and does not create an in-app approval request;
the webhook configuration is the opt-in for that behavior. It is distinct from
GitHub Development Agent issue/comment actions, which require an explicit
approval for the exact write payload.

### Phase 9: Social publishing

The protected `/social` workspace provides editable LinkedIn text drafts,
AI-assisted drafts grounded in one of the authenticated user's completed code
reviews, a calendar, an approval inbox, and retained publication history.
Drafting works without any social provider credentials. The initial provider
implementation supports member text posts only; organization publishing,
media uploads, and other social platforms are not enabled.

LinkedIn OAuth is available only when the backend has `LINKEDIN_CLIENT_ID` and
`LINKEDIN_CLIENT_SECRET`. In the LinkedIn developer portal, configure the
Sign In with LinkedIn using OpenID Connect and Share on LinkedIn products,
register `LINKEDIN_CALLBACK_URL`, and grant the minimum `openid`, `profile`,
and `w_member_social` scopes. Set these values in the backend environment,
restart the server, then connect the member account from the Social Publishing
page. Access tokens are encrypted with the existing
`GITHUB_TOKEN_ENCRYPTION_KEY`; they are never returned to the browser. Expired
or revoked tokens require reconnecting. Organization posting is intentionally
excluded because it requires `w_organization_social` and an eligible Page role.

Verified LinkedIn Posts API behavior (documentation checked October 16, 2026):
member text posts are created with `POST https://api.linkedin.com/rest/posts`,
`lifecycleState: PUBLISHED`, and the versioned REST headers. The required
member write permission is `w_member_social`. The API schema states PUBLISHED
is the only accepted lifecycle state during post creation; native scheduled
creation is not available in this integration. CodeGuard therefore uses its
own delayed job queue (maximum 30 days) and only enqueues after approval of the
exact account, content, and schedule. The LinkedIn text editor enforces a
3,000-character limit.

Before a scheduled request, the worker verifies the stored owner, account,
approval fingerprint, and schedule version. Duplicate jobs cannot claim a
post twice. A LinkedIn HTTP 201 response with a valid returned post identifier
is required before the post is marked published. A confirmed HTTP 429 rejection
may receive a bounded safe retry. A timeout, server-side failure, missing
confirmation, or worker interruption is marked outcome-unknown and is never
automatically retried, because the API does not provide a client idempotency
key for this create operation. Publishing history retains provider identifiers,
URLs, errors, and audit events.

Official references:

- [GitHub OAuth Apps authorization](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps)
- [GitHub authenticated user endpoint](https://docs.github.com/en/rest/users/users#get-the-authenticated-user)
- [GitHub OAuth application token revocation](https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-authorization)
- [LinkedIn Posts API](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/posts-api?view=li-lms-2026-09)
- [LinkedIn Post Schema](https://learn.microsoft.com/en-us/linkedin/marketing/community-management/shares/post-api-schema?view=li-lms-2026-09)
- [LinkedIn Authorization Code Flow](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow)
- [LinkedIn OAuth permissions](https://learn.microsoft.com/en-us/linkedin/shared/authentication/authentication)
- [LinkedIn refresh-token eligibility](https://learn.microsoft.com/en-us/linkedin/shared/authentication/programmatic-refresh-tokens)

No LinkedIn credentials are present in the checked-in environment example, so
live connection and publishing are not verified in this environment. Missing
credentials are reported as setup-required; the API does not simulate a
connected account or successful publication.

### Phase 12: Integration management

The protected `/integrations` page and `GET /api/integrations` use a single
catalog for the only currently implemented user-connected providers: GitHub
and LinkedIn. Provider connections are marked verified only after their OAuth
callbacks exchange credentials and confirm the account identity; the manual
check endpoint calls the provider again and stores a per-account
`lastSuccessfulConnectionCheckAt`. Catalog responses never include tokens or
client secrets. OAuth credentials remain encrypted in the backend database
using `GITHUB_TOKEN_ENCRYPTION_KEY`. Both OAuth flows use short-lived,
HTTP-only state and user cookies, compare 256-bit state values in constant
time, and clear them on callback. Provider account reads and disconnects are
scoped to the authenticated owner. GitHub callback validates and persists the
granted OAuth scopes; existing connections without recorded permission
evidence must reconnect.

GitHub asks only for the `repo` OAuth scope to support private repository
reviews and the currently implemented read/write actions. Account identity
uses the public `login` and `id` fields returned by GitHub's authenticated-user
endpoint; the integration does not request private user-profile data.
The classic `repo` scope is broad; GitHub OAuth Apps do not provide this flow
with per-repository grants. Writes are limited to approval-required issue
creation and pull-request comments, and execution is recorded in the owned
workflow event history. Pull-request reviews, branch pushes, merges, and
arbitrary GitHub API calls are unavailable.
Workflow jobs may retry a failed action up to three times with exponential
backoff. Issue/comment actions first look for their task-key marker to avoid
duplicates when GitHub exposes the prior write; if provider visibility is
delayed, manually verify the destination before retrying.
Granted scopes are checked on callback and stored with the account; older
connections without recorded scope evidence are marked for reconnection rather
than being presented as fully authorized.

LinkedIn asks for `openid`, `profile`, and `w_member_social`. Only member text
posts are implemented. The exact draft/account/schedule must be approved
before publishing, and ambiguous create outcomes are not retried. Disconnect
removes the encrypted local credential and cancels pending posts; provider-side
revocation is not reported as successful by this implementation. LinkedIn
users should revoke app access in LinkedIn settings when remote revocation is
needed. Organization posts, media posts, platform-native scheduling, and
refresh-token automation are unavailable.

No other providers are advertised: currently verified supported APIs and
authorization paths do not justify adding placeholder integrations. Apply the
health-check timestamp migration with `npm run prisma:deploy --workspace=backend`
before deploying this phase.
Apply reviewed database migrations with
`npm run prisma:deploy --workspace=backend`; do not run development migrations
against production data.

### Phase 13: Scheduled automation and reliability

Authenticated users can create daily or weekly schedules from their saved
visual workflow drafts in the Automation Schedules view. Schedules persist in
PostgreSQL and are polled every 15 seconds by the backend; BullMQ/Redis remains
the execution queue. Apply migrations and regenerate Prisma before deploying:

```powershell
npm run prisma:generate --workspace=backend
npm run prisma:deploy --workspace=backend
```

Schedules use the selected IANA time zone and 24-hour local time. During a
daylight-saving overlap, the earlier matching instant is selected; a
nonexistent local time is skipped until the next recurrence. One late
occurrence is allowed if the service returns before the next interval; if
multiple occurrences were missed, one skipped history record represents the
outage and the `missedRuns` counter records the number skipped. The next
future run is retained. Schedules are capped at one
active schedule on Free and five on Pro; the existing automation active-run
limit still applies. Each automation is limited to two concurrent tasks per
user, retried by BullMQ up to three times with exponential backoff, and has a
persisted ten-minute execution deadline checked between actions. A currently
in-flight provider request is not forcibly killed; provider-side request
timeouts and action idempotency remain necessary for safe recovery.
Task failures show an action-specific sanitized explanation in workflow history;
provider response bodies, credentials, and raw exception messages are not shown.
Retrying a failed scheduled workflow returns its occurrence to queued history and
increments that occurrence's retry counter.

Workflows requiring approval remain approval-gated for every scheduled run.
Pausing or canceling skips unclaimed occurrences; canceling a schedule does
not forcibly stop an already-running workflow. External GitHub actions keep
their task marker checks and must be manually verified if provider visibility
is ambiguous. No automation-specific billing budget exists in the current
billing model, so there is no separate execution-credit budget.

The scheduler reconciles persisted schedule runs, re-enqueues stale queued or
running automation records after worker loss, skips stale missed intervals,
and tracks repeated failures. Five consecutive failures pause a schedule.
Email notifications use the existing SMTP environment variables and a
database outbox; queue delivery is retried, and a crash after SMTP acceptance
but before the outbox update can result in a duplicate email (SMTP has no
shared idempotency transaction). Daily summaries use only stored owner-scoped
workflow events from the prior 24 hours. `/health` reports queue counts and
sanitized scheduler state; it does not include credentials or raw error text.

## 🔐 Environment Variables

The checked-in examples are templates, not working credentials:
[`backend/.env.example`](backend/.env.example) is loaded by the backend, while
[`frontend/.env.example`](frontend/.env.example) configures Vite. Root
`.env.example` supplies Docker Compose substitutions. Never put secrets in
frontend `VITE_*` variables; only public settings such as the API URL and
Stripe price ID belong there.

| Dependency | Variables and behavior |
| --- | --- |
| PostgreSQL | `DATABASE_URL` must be a PostgreSQL connection URL. Run committed Prisma migrations before serving requests. |
| Redis | `REDIS_URL` backs BullMQ queues and shared rate limits. Local default is `redis://127.0.0.1:6380`; production configuration requires a remote TLS `rediss://` URL. |
| Session/security | Set independent random `JWT_SECRET`, `CSRF_SECRET`, `GITHUB_TOKEN_ENCRYPTION_KEY`, and `EMAIL_OTP_SECRET` values (at least 32 characters) in production. `GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS` is optional during key rotation. Configure `FRONTEND_URL`, `AUTH_COOKIE_SAME_SITE`, and, behind a proxy, the exact `TRUST_PROXY_HOPS`. |
| OpenAI | `OPENAI_API_KEY` and optional `OPENAI_MODEL` (defaults to `gpt-4o-mini`) enable AI features. `AI_PRICING_CONFIG` and `AI_PRICING_VERSION` are optional; without configured rates, estimated cost remains unknown. |
| GitHub OAuth/webhooks | `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_CALLBACK_URL`, `GITHUB_WEBHOOK_SECRET`, and `GITHUB_TOKEN_ENCRYPTION_KEY` configure OAuth and signed pull-request webhook handling. OAuth access also depends on the connected account's permissions. |
| Stripe | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, and `STRIPE_PRO_PRICE_ID` must be configured together. They are optional for local startup, but required by production environment validation. The frontend `VITE_STRIPE_PRO_PRICE_ID` is a public display/checkout setting, not a secret. |
| LinkedIn | `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` are optional, but must be set together. Configure `LINKEDIN_CALLBACK_URL` and `LINKEDIN_API_VERSION` for this integration. No LinkedIn account or provider availability is implied by these settings. |
| SMTP | `MAIL_HOST`, `MAIL_PORT`, `MAIL_USER`, `MAIL_PASSWORD`, and `MAIL_FROM` must be valid: the server constructs the mail service while starting the email worker, so placeholder SMTP credentials prevent startup. |
| Fix-verification runner | `FIX_VERIFICATION_RUNNER_URL` and `FIX_VERIFICATION_RUNNER_TOKEN` are optional, but must be set together. Runner execution is disabled when absent. See the security boundary below and [docs/verification-runner.md](docs/verification-runner.md). |
| Frontend | `VITE_API_URL` defaults to `http://localhost:3001/api`; `VITE_APP_NAME` and `VITE_STRIPE_PRO_PRICE_ID` are public frontend configuration. |

Production validation additionally requires OpenAI, GitHub OAuth and webhook
credentials and all three Stripe settings; use public HTTPS origins/callbacks
and non-placeholder secrets. Provider credentials are configuration
requirements only and do not establish that the external provider has been
connected or tested.

Fix verification execution is disabled unless `FIX_VERIFICATION_RUNNER_URL`
and `FIX_VERIFICATION_RUNNER_TOKEN` point to a separately deployed isolated
runner. The API enqueues work and does not run repository code itself. The API
container must not receive the Docker socket or execute untrusted repository
code. The separate runner's sandbox removes network access, drops privileges
and capabilities, and applies resource limits; its control plane still needs
careful isolation. Without a configured and exercised runner, attempts remain
`NEEDS_REVIEW` and are not verified. See
[docs/fix-verification-engine.md](docs/fix-verification-engine.md) and
[docs/verification-runner.md](docs/verification-runner.md) for deployment
requirements, callback authentication, allowed fetch behavior, and sandbox
boundaries.

### Stripe test-mode checkout and webhooks

1. In Stripe's **test** dashboard, create a recurring Pro price. Configure its
   ID as `STRIPE_PRO_PRICE_ID` on the backend and
   `VITE_STRIPE_PRO_PRICE_ID` on the frontend.
2. Set a Stripe test secret as `STRIPE_SECRET_KEY`.
3. Install and authenticate Stripe CLI in test mode, then run
   `stripe listen --forward-to localhost:3001/api/billing/webhook`. Set the
   resulting `whsec_...` as `STRIPE_WEBHOOK_SECRET` and restart the API.
4. Complete checkout with a Stripe test payment method. Verify the subscription
   from the authenticated Billing page, then manually test cancellation and
   failed-payment transitions with Stripe test events.

The checkout return URL is not proof of payment; verified webhooks update the
subscription. Automated tests use test signing material and mocked quota
storage and do not contact Stripe, GitHub, or OpenAI.

## 🧪 Testing

```bash
npm test
npm test --workspace=frontend
```

The root `npm test` command runs the backend Node test suite.
`npm test --workspace=frontend` runs the frontend Vitest suite.
`npm run test:database --workspace=backend` runs migration, workspace, tenant
isolation, and finding-lifecycle tests against the local disposable database
`ai_codeguard_integration_test`. Live model and provider tests stay opt-in.
CI currently runs the high-severity dependency audit gate, Prisma
generation/validation and migrations against disposable PostgreSQL 15, lint,
type-check, backend and frontend unit tests, the database integration suite,
Chromium Playwright E2E tests with provider boundaries mocked, both workspace
builds, and backend/runner/frontend Docker image builds. Provider OAuth, live
webhooks, SMTP delivery, and production Redis/runner behavior require separate
staging verification. Passing CI does not establish production readiness.

## 📝 Code Quality

```bash
# Lint
npm run lint
# Type check and build
npm run type-check
npm run build
```

## 🔄 CI/CD

GitHub Actions CI is configured in `.github/workflows/ci.yml`. Database and
Redis integration run in their own workflows. Staging and production deployment
are manual dispatches with separate environment secrets; production also
requires the GitHub environment approval gate and a confirmed backup. See
[SAAS-LAUNCH-READINESS.md](./SAAS-LAUNCH-READINESS.md). The root and workspace
manifests require Node.js 22+ and npm 10+; CI and Docker images pin Node.js
24.22.2. CI runs `npm audit --audit-level=high`; review its current output for
development-tooling advisories and run
`npm audit --omit=dev --audit-level=moderate` for the production dependency
gate. Audit results change as the lockfile and advisory database change.

## 🤝 Contributing

1. Create a feature branch (`git checkout -b feature/AmazingFeature`)
2. Commit changes (`git commit -m 'Add some AmazingFeature'`)
3. Push to branch (`git push origin feature/AmazingFeature`)
4. Open a Pull Request

### Commit Convention

Uses conventional commits:

```
feat: Add new feature
fix: Fix bug
docs: Update documentation
style: Code style changes
refactor: Code refactoring
perf: Performance improvements
test: Add tests
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙋 Support

For support, email support@ai-codeguard.com or open an issue on GitHub.

## 🗺️ Planned (not implemented)

- [ ] Additional AI providers beyond the current OpenAI integration
- [ ] Team collaboration features
- [ ] IDE plugins (VS Code, JetBrains)
- [ ] API rate limiting dashboard
- [ ] Mobile app (React Native)
- [ ] CLI tool for local analysis

## 👨‍💻 Authors

- [Your Name](https://github.com/yourusername)

## 🙏 Acknowledgments

- OpenAI for GPT models
- Vercel for Prisma
- The React and Node.js communities
