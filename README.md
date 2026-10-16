# AI-CodeGuard - AI Code Review Platform

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Node.js](https://img.shields.io/badge/node.js-18%2B-green.svg)
![TypeScript](https://img.shields.io/badge/typescript-5.3%2B-blue.svg)

AI-CodeGuard is a full-stack application for AI-assisted code review with GitHub integration, background processing, and optional subscription billing.

## 🚀 Features

- **AI-Powered Code Review**: Automated analysis using OpenAI GPT models
- **Real-time Collaboration**: Socket.io powered chat and discussions
- **GitHub Integration**: Seamless GitHub repository integration with OAuth
- **GitHub Development Agent**: Evidence-backed repository and pull-request context with approval-gated issue and comment actions
- **Subscription Billing**: Stripe integration for payment processing
- **Background Jobs**: BullMQ for async processing of reviews and emails
- **Automation MVP**: Approval-gated plans with persisted task status and safe text-draft execution
- **Real-time Analytics**: Dashboard with comprehensive insights
- **Enterprise Security**: JWT authentication, encryption, CORS, and helmet protection
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
└── backend/                 # Express + Next.js API server
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
- **Next.js** - React meta-framework (optional for API routes)
- **TypeScript** - Type safety
- **Prisma ORM** - Database abstraction
- **PostgreSQL** - Relational database
- **Redis** - Caching and job queue storage
- **BullMQ** - Background job processing
- **OpenAI API** - AI-powered code analysis
- **LangChain** - LLM orchestration framework
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
Redis, and both job queues and reports retained failed-job counts.

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
- `GET /api/github/development/templates` - List supported GitHub workflow templates (authenticated)
- `POST /api/github/development/workflows` - Create an owned, approval-required GitHub workflow (authenticated)

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
idempotency markers protect retries. The only external write actions are issue
creation and pull-request comments; pushing branches, creating or changing
pull requests, merging, and arbitrary GitHub API calls are unsupported.
GitHub API access remains bounded by the existing OAuth scopes and account
permissions; broad `repo` scope is retained for compatibility with existing
private-repository review features. LinkedIn publishing is not configured.
Shell, filesystem, SQL, and arbitrary network execution are not supported.
The automation uses the existing `OPENAI_API_KEY` and `REDIS_URL`; no LinkedIn
variables are required or used.
Apply reviewed database migrations with
`npm run prisma:deploy --workspace=backend`; do not run development migrations
against production data.

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
