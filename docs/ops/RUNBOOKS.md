# Operational runbooks

Use these with [ALERTS.md](./ALERTS.md) and [INCIDENTS.md](./INCIDENTS.md). Commands below do not print secrets. Keep `DATABASE_URL`, `REDIS_URL`, and provider keys in the secret manager. Do not echo them into a ticket or shell history.

Production verification of these paths is pending. Do not run a restore or a production migration from this document unless that change is separately approved.

## Backend outage

Diagnose: `GET /health/live` fails, or the process is not listening.

1. Check the host or container state and the last shutdown log for `Closing server`.
2. Read the latest `Failed to start server` or `Shutdown cleanup failed` line. It keeps the error name, not the connection string.
3. If the process is crash-looping, stop new deploys. Roll back with `.github/workflows/rollback-production.yml` and the last known-good 40-character SHA when the schema is still compatible.
4. Escalate to SEV-1 while liveness stays down.

## PostgreSQL outage

Diagnose: `/health/ready` reports `dependencies.database` as `unavailable`.

1. Check the managed database status in the provider console. Do not paste the connection URL into the ticket.
2. From a trusted operator shell, `psql` with the secret-manager URL can run `SELECT 1`. Do not put the URL on the command line if history is retained; use the provider’s authenticated client instead.
3. If the database is up and the app is not, restart one replica and read `/health/ready` again.
4. If data is damaged, stop writes and follow the restore steps in `SAAS-LAUNCH-READINESS.md`. Restore into an empty database first.
5. Escalate to SEV-1 until readiness reports `database: ok`.

## Redis outage

Diagnose: `/health/ready` reports `dependencies.redis` as `unavailable`.

1. Check the managed Redis service. The app reconnects with a delay that grows from 100 ms and then stays at 3 seconds. It does not stop trying.
2. Auth, registration, reviews, repository chat, automation, and AI routes fail closed while the shared limiter store is down. API, GitHub, integration, and social limits fail open. Treat that as SEV-2.
3. After Redis answers `PING`, read `/health/ready` and confirm `redis: ok` before telling users the service is normal.
4. Do not flush Redis to “clear” a bad state unless the incident owner accepts losing queued jobs and rate-limit buckets.

## GitHub API outage

Diagnose: GitHub connect, repository list, or review start fails while `/health/ready` is ok and AI usage is not the failing panel.

1. Check GitHub’s status page. Do not retry OAuth in a loop.
2. Keep login, stored reviews, and workspace reads available.
3. Webhook deliveries that fail signature checks stay rejected. Do not disable signature verification.
4. Escalate to SEV-3 unless review start is also returning HTTP 5xx above the alert floor, which is SEV-2.

## OpenAI or other model-provider outage

Diagnose: `providerHealth` is `unavailable`, or `ai_provider_outage` is open. `unknown` means the window has no AI requests. It does not mean the provider is healthy.

1. Confirm the failure kind in logs is a timeout, rate limit, or provider failure. The client times out at 60 seconds and retries at most twice.
2. Leave the free-tier review cap in place. Do not raise `maxRetries`.
3. If the cost alert is also open, pause nonessential review starts. A provider failure is not approval to switch Stripe to live mode.
4. Escalate to SEV-2 while the outage alert stays open. Stored reviews should still open.

## Stripe webhook failure

Diagnose: checkout or subscription state stops matching Stripe, and webhook logs show signature or processing failures.

1. Confirm the endpoint is the raw-body route `/api/billing/webhook` and the signing secret matches the Stripe endpoint. Do not copy the secret into the ticket.
2. In Stripe test mode, replay the event from the Stripe dashboard. Do not mark local subscriptions cancelled by hand.
3. Duplicate event ids are ignored. An older event must not overwrite a newer stored subscription event.
4. Escalate to SEV-2 if paid entitlements are wrong. Stay in test mode unless live charges were explicitly approved.

## AI usage or cost spike

Diagnose: `ai_cost_spike` is open: at least five priced requests and at least $5 estimated in five minutes.

1. Read `panels.aiUsage` for requests, failures, unpriced requests, token totals, and estimated cost.
2. Identify the feature from AI usage analytics. Do not copy prompts into the incident channel.
3. Keep the review quota. If Pro spend is still unbounded, restrict the provider key or new review starts with the incident owner’s approval.
4. This is SEV-3 unless customer data or a provider outage is also involved.

## Failed deployment

Diagnose: the deploy workflow exits after the hook, or `/health/ready` does not succeed.

1. The migrate job can apply schema changes before the health check. A failed check does not undo the migration.
2. If the schema is still compatible, dispatch the production rollback workflow with the previous full SHA. Rollback does not run down migrations.
3. If the new migration is incompatible, stop writes and use the database recovery runbook.
4. Escalate to SEV-1 when the current production process is unhealthy after the hook.

## Database migration failure

Diagnose: `prisma migrate deploy` exits non-zero, or the release guard refuses the migration.

1. Read the scrubbed command output. It redacts database URLs.
2. Do not retry a production migration until `deploy:check` passes and a fresh backup is confirmed.
3. A failed transactional migration should leave the previous schema. Confirm that with the provider’s migration history before starting the app.
4. There are no down migrations. Do not invent one during the incident.

## Security incident

Diagnose: a credential, session, or customer repository may be exposed.

1. Contain the account by a password reset or another action that increments `tokenVersion`. Disconnect the affected GitHub credential.
2. Rotate only the leaked secret. For the token encryption key, keep the previous key until stored tokens are re-encrypted.
3. Preserve redacted logs and the release SHA.
4. This is SEV-1 if customer repository content or credentials were exposed. Tell the affected users directly. The application does not send that notice for you.
