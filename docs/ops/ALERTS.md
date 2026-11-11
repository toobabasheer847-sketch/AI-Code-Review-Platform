# Alert thresholds

These rules run inside the API process over the trailing five minutes. A threshold writes one structured warning, `Monitoring alert threshold crossed`, with `alert` and `severity`. The same open alert is not logged again. After it clears, it is not logged again until 15 minutes have passed since the previous notification. No page, chat message, or Sentry issue is sent by this process. Delivery is verified only after an operator configures `SENTRY_DSN` or an external probe and confirms one test event. That confirmation has not been made from this repository.

`GET /metrics` returns the same window when `METRICS_TOKEN` is set and the request has `Authorization: Bearer <token>`. Without the token the route is 404. The dashboard reports collected samples only. Provider health is `unknown` when the window has no AI requests. Open incidents are the alerts that are over threshold now. An empty list means no threshold is currently crossed, not that production is healthy.

| Alert | Severity | Opens when |
| --- | --- | --- |
| `backend_unavailable` | critical | Liveness is unavailable |
| `postgresql_unavailable` | critical | Database readiness is unavailable |
| `redis_unavailable` | high | Redis readiness is unavailable |
| `high_http_5xx_rate` | high | At least 30 requests and at least 5% are HTTP 5xx |
| `ai_provider_outage` | high | At least 5 AI requests and at least half failed |
| `high_api_latency` | warning | At least 30 requests and p95 latency is at least 2,000 ms |
| `background_job_failures` | warning | At least 3 terminal job failures in the window |
| `ai_cost_spike` | warning | At least 5 priced AI requests and estimated cost is at least $5 |

Authentication failures and HTTP 429s are counted on the dashboard. They do not open an alert. Retry attempts that have not reached the configured attempt count are not counted as terminal job failures.

Map a critical alert to SEV-1, a high alert to SEV-2, and a warning alert to SEV-3 when declaring an incident. Use [INCIDENTS.md](./INCIDENTS.md) and [RUNBOOKS.md](./RUNBOOKS.md).
