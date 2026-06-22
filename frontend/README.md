# Frontend Setup Guide

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Server runs on http://localhost:3000

## Build

```bash
npm run build
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

## Project Structure

- `src/app/` - Application root, providers, store, and router
- `src/assets/` - Images and icons
- `src/components/` - Reusable components (UI, common, layout, charts)
- `src/features/` - Feature modules (auth, dashboard, reviews, etc.)
- `src/hooks/` - Custom React hooks
- `src/lib/` - Utilities, axios, queryClient, constants
- `src/services/` - API services
- `src/types/` - TypeScript types
- `src/layouts/` - Page layouts
- `src/pages/` - Page components

## Environment Variables

Create `.env` in the frontend directory:

```
VITE_API_URL=http://localhost:3001/api
VITE_APP_NAME=AI-CodeGuard
```

## API Integration

The frontend uses axios configured in `src/lib/axios.ts` with:
- Automatic token attachment to requests
- 401 redirect on auth failure
- Base URL configuration from env variables

## State Management

Uses Zustand with persistence for global app state in `src/app/store/useAppStore.ts`

## Component Library

Uses Shadcn UI components from `src/components/ui/`

## Form Validation

Uses React Hook Form + Zod schemas from `src/features/*/schemas/`
