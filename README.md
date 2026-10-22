# AI-CodeGuard - AI Code Review Platform

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-18%2B-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.3%2B-blue.svg)

AI-CodeGuard is a full-stack application for AI-assisted code review with GitHub integration, background processing, and optional subscription billing.

## 🚀 Features

- **AI-Powered Code Review**: Automated analysis using OpenAI GPT models. Findings are validated against supplied source (and available pull-request diff lines); displayed scores are heuristic indicators, not guarantees that code is safe or issue-free.
- **Real-time Collaboration**: Socket.io powered chat and discussions
- **GitHub Integration**: Seamless GitHub repository integration with OAuth
- **GitHub Development Agent**: Evidence-backed repository and pull-request context with approval-gated issue and comment actions
- **Social Publishing**: Evidence-backed LinkedIn drafts, approval inbox, and scheduled member text posts
- **Subscription Billing**: Stripe integration for payment processing
- **Background Jobs**: BullMQ for async processing of reviews and emails
- **Automation MVP**: Approval-gated plans with persisted task status and safe text-draft execution
- **Real-time Analytics**: Dashboard with comprehensive insights
- **Security controls**: JWT authentication, encrypted provider credentials, CORS, and Helmet
- **Multi-language Support**: Support for various programming languages
- **Email Notifications**: Nodemailer integration for alerts and notifications
- **Redis Caching**: High-performance caching layer

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
- **Shadcn UI** - Accessible component library
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
- **Redis** - Caching and job queue storage
- **BullMQ** - Background job processing
- **OpenAI API** - AI-powered code analysis
- **Socket.io** - Real-time bidirectional communication
- **JWT** - Authentication tokens
- **Stripe** - Payment processing
- **Nodemailer** - Email service
- **GitHub OAuth** - Social authentication

## 🚀 Getting Started

### Prerequisites
- Node.js >= 18.0.0
- npm >= 9.0.0
- PostgreSQL 15+
- Redis 7+
- Docker & Docker Compose (optional)

### Installation

1. **Clone the repository**
```bash
git clone https://github.com/yourusername/ai-codeguard.git
cd ai-codeguard
```

2. **Setup Environment Variables**
```bash
copy .env.example .env
# Configure backend values in backend/.env or export them in your shell
```

3. **Install and configure**
```bash
npm install
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
- API Documentation: http://localhost:3001/api/docs

### Docker Setup

```bash
# Build and run with Docker Compose
docker-compose up -d

# Apply pending migrations (Compose also does this before starting the local backend)
docker-compose exec backend npm run prisma:deploy

# Seed database
docker-compose exec backend npm run seed
```

Compose is for local development and uses local-only database credentials. Do
not use it as a production deployment template. `GET /health` checks PostgreSQL,
Redis, the configured job queues, and scheduler state.

See [SAAS-LAUNCH-READINESS.md](./SAAS-LAUNCH-READINESS.md) for production
environment setup, release checks, deployment and rollback guidance, backup
and restore steps, and audited launch limitations. The application has not
been independently verified in a production deployment.

## 📚 API Documentation

### Authentication Endpoints
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - User login
- `POST /api/auth/logout` - User logout
- `GET /api/auth/github/callback` - GitHub OAuth callback

### Code Review Endpoints
- `GET /api/reviews` - List reviews
- `POST /api/reviews` - Create new review
- `GET /api/reviews/:id` - Get review details
- `PATCH /api/reviews/findings/:findingId/status` - Update an owned finding's status and record optional feedback
- `PUT /api/reviews/:id` - Update review
- `DELETE /api/reviews/:id` - Delete review

### Repository Endpoints
- `GET /api/repositories` - List repositories
- `POST /api/repositories` - Connect repository
- `GET /api/repositories/:id` - Get repository details
- `DELETE /api/repositories/:id` - Disconnect repository

### AI Endpoints
- `POST /api/ai/analyze` - Analyze code with AI
- `POST /api/ai/chat` - Chat about code review

### Automation MVP
- `POST /api/automations` - Create and validate an automation plan (authenticated)
- `GET /api/automations` and `GET /api/automations/:id` - List or retrieve owned workflows
- `POST /api/automations/:id/approve` - Approve an unchanged, unexpired plan and queue it
- `POST /api/automations/:id/reject` - Reject a pending plan without executing tasks
- `POST /api/automations/:id/cancel` - Cancel a draft or active workflow
- `POST /api/automations/:id/retry` - Retry a failed workflow
- `GET /api/automations/schedules` and `POST /api/automations/schedules` - List and create owned daily or weekly workflow schedules
- `PATCH /api/automations/schedules/:id` - Update the schedule's local time, timezone, or recurrence
- `POST /api/automations/schedules/:id/pause` and `/resume`; `DELETE /api/automations/schedules/:id` - Manage schedule state
- `GET /api/automations/notification-preferences` and `PUT /api/automations/notification-preferences` - Configure failure alerts and daily summaries
- `GET /api/github/development/templates` - List supported GitHub workflow templates (authenticated)
- `POST /api/github/development/workflows` - Create an owned, approval-required GitHub workflow (authenticated)
- `GET /api/social/status` and `GET /api/social/posts` - Read the authenticated user's provider configuration, accounts, drafts, approvals, calendar, and publication history
- `GET /api/integrations` - List supported integrations, owner-scoped connection status, granted permissions, setup steps, capabilities, limitations, and workflow action contracts
- `POST /api/integrations/:provider/check` - Verify the authenticated owner's GitHub or LinkedIn account against the provider and record the last successful check
- `POST /api/social/linkedin/connect` - Begin LinkedIn OAuth (requires LinkedIn app configuration)
- `POST /api/social/drafts/generate` - Draft a post from user instructions and one owned, completed review
- `POST /api/social/drafts` and `PATCH /api/social/posts/:postId` - Create or edit a LinkedIn text draft
- `POST /api/social/posts/:postId/request-approval` - Request approval for the exact account, content, and schedule
- `POST /api/social/posts/:postId/approve` and `/reject` - Decide the approval request
- `POST /api/social/posts/:postId/retry` - Retry only provider-confirmed non-publication failures

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

See `.env.example` for variable names and safe placeholders. Production
requires PostgreSQL `DATABASE_URL`, Redis `REDIS_URL`, independent random
`JWT_SECRET` and `GITHUB_TOKEN_ENCRYPTION_KEY` values (32+ characters),
`OPENAI_API_KEY`, GitHub OAuth credentials and webhook secret, all three Stripe
settings (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PRO_PRICE_ID`),
and `FRONTEND_URL`. Configure mail variables to send account emails. Never put
secrets in frontend `VITE_*` variables.

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
```

The current test command runs backend tests; no dedicated frontend test runner
is configured. CI runs install, Prisma generation, lint, type-check, backend
tests, and both builds. Stripe-hosted checkout, live provider webhooks, and
real database/Redis operation still require manual staging verification.
Passing CI does not establish production readiness.

## 📝 Code Quality

```bash
# Lint
npm run lint
# Type check and build
npm run type-check
npm run build
```

## 🔄 CI/CD

GitHub Actions CI is configured in `.github/workflows/ci.yml`.

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

## 🗺️ Roadmap

- [ ] Advanced AI model support
- [ ] Team collaboration features
- [ ] IDE plugins (VS Code, JetBrains)
- [ ] Custom AI models training
- [ ] API rate limiting dashboard
- [ ] Multi-language support
- [ ] Mobile app (React Native)
- [ ] CLI tool for local analysis

## 👨‍💻 Authors

- [Your Name](https://github.com/yourusername)

## 🙏 Acknowledgments

- OpenAI for GPT models
- Vercel for Prisma
- The React and Node.js communities
