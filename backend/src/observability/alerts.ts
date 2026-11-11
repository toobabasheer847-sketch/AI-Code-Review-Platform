import type { DependencyState } from './health'
import type { MetricsSnapshot } from './metrics'

export interface AlertThresholds {
  serverErrorMinRequests: number
  serverErrorRatio: number
  latencyMinRequests: number
  latencyP95Ms: number
  jobFailureCount: number
  aiCostUsd: number
  aiMinRequests: number
  aiFailureMinRequests: number
  aiFailureRatio: number
}

export const recommendedAlertThresholds: AlertThresholds = {
  serverErrorMinRequests: 30,
  serverErrorRatio: 0.05,
  latencyMinRequests: 30,
  latencyP95Ms: 2_000,
  jobFailureCount: 3,
  aiCostUsd: 5,
  aiMinRequests: 5,
  aiFailureMinRequests: 5,
  aiFailureRatio: 0.5,
}

export const alertCooldownMs = 15 * 60 * 1000

export type AlertSeverity = 'critical' | 'high' | 'warning'

export interface AlertEvaluationInput {
  live: 'ok' | 'unavailable'
  database: DependencyState | 'unknown'
  redis: DependencyState | 'unknown'
  snapshot: MetricsSnapshot
}

export interface AlertResult {
  id:
    | 'backend_unavailable'
    | 'high_http_5xx_rate'
    | 'high_api_latency'
    | 'postgresql_unavailable'
    | 'redis_unavailable'
    | 'background_job_failures'
    | 'ai_cost_spike'
    | 'ai_provider_outage'
  severity: AlertSeverity
  triggered: boolean
  summary: string
}

interface AlertNoticeState {
  open: boolean
  lastNotifiedAt: number
}

const noticeState = new Map<AlertResult['id'], AlertNoticeState>()

function alert(
  id: AlertResult['id'],
  severity: AlertSeverity,
  triggered: boolean,
  summary: string
): AlertResult {
  return { id, severity, triggered, summary }
}

export function evaluateAlerts(
  input: AlertEvaluationInput,
  thresholds: AlertThresholds = recommendedAlertThresholds
): AlertResult[] {
  const failedJobs = Object.values(input.snapshot.jobs).reduce(
    (total, queue) => total + queue.failed,
    0
  )
  const latency = input.snapshot.http.latencyMs.p95
  const errorRate = input.snapshot.http.errorRate
  const aiRequests = input.snapshot.ai.requests
  const aiFailureRatio = aiRequests === 0 ? null : input.snapshot.ai.failedRequests / aiRequests

  return [
    alert(
      'backend_unavailable',
      'critical',
      input.live === 'unavailable',
      'Process liveness check failed'
    ),
    alert(
      'high_http_5xx_rate',
      'high',
      input.snapshot.http.requests >= thresholds.serverErrorMinRequests &&
        errorRate !== null &&
        errorRate >= thresholds.serverErrorRatio,
      `HTTP 5xx rate is at least ${thresholds.serverErrorRatio} across ${thresholds.serverErrorMinRequests} requests`
    ),
    alert(
      'high_api_latency',
      'warning',
      input.snapshot.http.requests >= thresholds.latencyMinRequests &&
        latency !== null &&
        latency >= thresholds.latencyP95Ms,
      `API p95 latency is at least ${thresholds.latencyP95Ms}ms`
    ),
    alert(
      'postgresql_unavailable',
      'critical',
      input.database === 'unavailable',
      'PostgreSQL readiness check failed'
    ),
    alert(
      'redis_unavailable',
      'high',
      input.redis === 'unavailable',
      'Redis readiness check failed'
    ),
    alert(
      'background_job_failures',
      'warning',
      failedJobs >= thresholds.jobFailureCount,
      `At least ${thresholds.jobFailureCount} background jobs failed in the current window`
    ),
    alert(
      'ai_cost_spike',
      'warning',
      input.snapshot.ai.requests >= thresholds.aiMinRequests &&
        input.snapshot.ai.estimatedCostUsd >= thresholds.aiCostUsd,
      `Estimated AI cost reached $${thresholds.aiCostUsd} in the current window`
    ),
    alert(
      'ai_provider_outage',
      'high',
      aiRequests >= thresholds.aiFailureMinRequests &&
        aiFailureRatio !== null &&
        aiFailureRatio >= thresholds.aiFailureRatio,
      `At least ${thresholds.aiFailureRatio} of ${thresholds.aiFailureMinRequests} AI requests failed in the current window`
    ),
  ]
}

export function takeNewlyTriggeredAlerts(
  results: AlertResult[],
  now = Date.now(),
  cooldownMs = alertCooldownMs
): AlertResult[] {
  const opened: AlertResult[] = []
  for (const result of results) {
    const previous = noticeState.get(result.id) ?? {
      open: false,
      lastNotifiedAt: Number.NEGATIVE_INFINITY,
    }
    if (!result.triggered) {
      noticeState.set(result.id, { open: false, lastNotifiedAt: previous.lastNotifiedAt })
      continue
    }
    if (previous.open) continue
    if (now - previous.lastNotifiedAt < cooldownMs) {
      noticeState.set(result.id, { open: true, lastNotifiedAt: previous.lastNotifiedAt })
      continue
    }
    noticeState.set(result.id, { open: true, lastNotifiedAt: now })
    opened.push(result)
  }
  return opened
}

export function resetAlertState(): void {
  noticeState.clear()
}
