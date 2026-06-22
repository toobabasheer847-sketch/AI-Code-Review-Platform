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

### Environment Variables

Create `.env` in the backend directory with database connection:

```
DATABASE_URL=postgresql://user:password@localhost:5432/ai_codeguard
REDIS_URL=redis://localhost:6379
```

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
