# Incident management

There is no incident-ticket UI in this application. Track incidents in the operator’s existing channel. Do not invent user counts, error rates, or delivery confirmations. The only in-app incident list is `panels.openIncidents` on `GET /metrics`, and it contains alerts that are over threshold in that process’s five-minute window.

The incident owner, RPO, and RTO are still unnamed. Name them before accepting customer data.

## Severity

| Level | Use when | First response |
| --- | --- | --- |
| SEV-1 | Backend or PostgreSQL is unavailable, or customer data may be exposed or corrupted | Page the owner. Stop deploys. Start the matching runbook. |
| SEV-2 | Redis is down, the 5xx alert is open, or the AI provider outage alert is open | Page the owner during staffed hours. Protect fail-closed routes and AI spend. |
| SEV-3 | Latency, terminal job failures, or the AI cost alert is open, and the API is still serving | Investigate in the same business day. Do not page overnight unless it becomes SEV-2. |
| SEV-4 | One user report, a single failed job, or a question with no alert open | Record it. Fix or answer in the normal queue. |

## Report

Record:

- Severity, start time, and the release SHA
- Who owns the incident
- Which alert ids are open, or that none are
- What customers can still do
- Whether production data was changed

Do not paste database URLs, tokens, prompts, or source code into the record.

## Investigate

1. Read `/health/live` and `/health/ready`. Ready reports `ok` or `unavailable` for PostgreSQL and Redis and does not include connection strings.
2. If `METRICS_TOKEN` is configured, read `GET /metrics` with the bearer token. Use `openIncidents`, `errorRate`, `latency`, `providerHealth`, `dependencies`, and `backgroundJobs`.
3. Follow the runbook for the failing dependency. Stop when the health check and one read-only product path succeed.
4. Escalate from SEV-3 to SEV-2 when the 5xx or provider-failure rule opens. Escalate to SEV-1 when liveness or PostgreSQL stays unavailable, or when data exposure is confirmed.

## Resolve and correct

Resolution requires the owner to record the end time, the alert ids that cleared, and the recovery action. A cleared log line is not resolution by itself.

Keep a corrective-action list with the owner and the due date:

- the change that prevents the same failure
- the test or probe that would catch it
- whether a backup restore or secret rotation is still unfinished

## Postmortem

Write this after a SEV-1 or SEV-2, and after a SEV-3 that recurred.

- Summary
- Impact window and what remained available
- Detection: which alert or user report, and the delay before a person saw it
- Timeline
- Root cause and how it was confirmed
- What was ruled out
- What fixed it
- Corrective actions that are not done yet

Leave unknown items unknown. Do not fill the timeline with metrics that were not collected.
