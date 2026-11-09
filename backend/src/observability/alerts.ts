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
}

export const recommendedAlertThresholds: AlertThresholds = {
  serverErrorMinRequests: 30,
  serverErrorRatio: 0.05,
  latencyMinRequests: 30,
  latencyP95Ms: 2_000,
  jobFailureCount: 3,
  aiCostUsd: 5,
  aiMinRequests: 5,
}

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
  triggered: boolean
  summary: string
}

const activeAlerts = new Set<AlertResult['id']>()

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

  return [
    {
      id: 'backend_unavailable',
      triggered: input.live === 'unavailable',
      summary: 'Process liveness check failed',
    },
    {
      id: 'high_http_5xx_rate',
      triggered:
        input.snapshot.http.requests >= thresholds.serverErrorMinRequests &&
        errorRate !== null &&
        errorRate >= thresholds.serverErrorRatio,
      summary: `HTTP 5xx rate is at least ${thresholds.serverErrorRatio} across ${thresholds.serverErrorMinRequests} requests`,
    },
    {
      id: 'high_api_latency',
      triggered:
        input.snapshot.http.requests >= thresholds.latencyMinRequests &&
        latency !== null &&
        latency >= thresholds.latencyP95Ms,
      summary: `API p95 latency is at least ${thresholds.latencyP95Ms}ms`,
    },
    {
      id: 'postgresql_unavailable',
      triggered: input.database === 'unavailable',
      summary: 'PostgreSQL readiness check failed',
    },
    {
      id: 'redis_unavailable',
      triggered: input.redis === 'unavailable',
      summary: 'Redis readiness check failed',
    },
    {
      id: 'background_job_failures',
      triggered: failedJobs >= thresholds.jobFailureCount,
      summary: `At least ${thresholds.jobFailureCount} background jobs failed in the current window`,
    },
    {
      id: 'ai_cost_spike',
      triggered:
        input.snapshot.ai.requests >= thresholds.aiMinRequests &&
        input.snapshot.ai.estimatedCostUsd >= thresholds.aiCostUsd,
      summary: `Estimated AI cost reached $${thresholds.aiCostUsd} in the current window`,
    },
  ]
}

export function takeNewlyTriggeredAlerts(results: AlertResult[]): AlertResult[] {
  const opened: AlertResult[] = []
  for (const result of results) {
    if (result.triggered && !activeAlerts.has(result.id)) {
      activeAlerts.add(result.id)
      opened.push(result)
    }
    if (!result.triggered) activeAlerts.delete(result.id)
  }
  return opened
}

export function resetAlertState(): void {
  activeAlerts.clear()
}
