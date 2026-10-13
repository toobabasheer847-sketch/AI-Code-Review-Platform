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

```bash
# Generate Prisma client
npm run prisma:generate

# Create migrations
npm run prisma:migrate

# Run migrations
npm run prisma:migrate -- deploy

# Seed database
npm run seed

# Open Prisma Studio
npm run prisma:studio
```

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
metadata and creating pull-request reviews. Reviews are queued through Redis;
findings are posted as inline review comments only for valid added lines and
only when the pull request remains open at the reviewed commit. GitHub App
installation authorization and live webhook delivery are not configured by
this project.

### Environment Variables

Create `.env` in the backend directory with database connection:

```
DATABASE_URL=postgresql://user:password@localhost:5432/ai_codeguard
REDIS_URL=redis://localhost:6379
```

Production must provide independent, randomly generated `JWT_SECRET` and
`GITHUB_TOKEN_ENCRYPTION_KEY` values, each at least 32 characters long. The
server refuses to start in production if either value is missing, a sample
placeholder, or if the two values are identical. Generate each value separately
with a cryptographically secure random generator and store them in your
deployment's secret manager; never reuse the development values.

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

### To be implemented:
- User management
- Repository management
- Code reviews
- AI analysis
- Chat functionality
- Billing integration
- Email notifications

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

### Port already in use
- Change PORT in .env or kill process using port 3001
