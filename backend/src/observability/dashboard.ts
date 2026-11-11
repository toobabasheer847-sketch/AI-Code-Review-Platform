import { timingSafeEqual } from 'node:crypto'
import { evaluateAlerts, recommendedAlertThresholds, type AlertResult } from './alerts'
import type { DependencyHealth } from './health'
import type { MetricsSnapshot } from './metrics'

export interface MonitoringDashboard {
  generatedAt: string
  windowMs: number
  panels: {
    applicationHealth: { live: 'ok' | 'unavailable'; ready: 'ok' | 'error' }
    apiTraffic: { requests: number; authenticationFailures: number; rateLimitEvents: number }
    latency: { samples: number; p95Ms: number | null; maxMs: number | null }
    errorRate: { serverErrors: number; ratio: number | null }
    aiUsage: MetricsSnapshot['ai']
    providerHealth: 'ok' | 'unavailable' | 'unknown'
    dependencies: DependencyHealth | MetricsSnapshot['dependencies']
    backgroundJobs: MetricsSnapshot['jobs']
    openIncidents: Array<Pick<AlertResult, 'id' | 'severity' | 'summary'>>
  }
}

export function providerHealthFromUsage(
  ai: MetricsSnapshot['ai'],
  thresholds = recommendedAlertThresholds
): 'ok' | 'unavailable' | 'unknown' {
  if (ai.requests === 0) return 'unknown'
  const failureRatio = ai.failedRequests / ai.requests
  if (ai.requests >= thresholds.aiFailureMinRequests && failureRatio >= thresholds.aiFailureRatio) {
    return 'unavailable'
  }
  return 'ok'
}

export function buildMonitoringDashboard(input: {
  live: 'ok' | 'unavailable'
  ready: 'ok' | 'error'
  snapshot: MetricsSnapshot
}): MonitoringDashboard {
  const openIncidents = evaluateAlerts({
    live: input.live,
    database: input.snapshot.dependencies.database,
    redis: input.snapshot.dependencies.redis,
    snapshot: input.snapshot,
  })
    .filter((item) => item.triggered)
    .map((item) => ({ id: item.id, severity: item.severity, summary: item.summary }))

  return {
    generatedAt: input.snapshot.generatedAt,
    windowMs: input.snapshot.windowMs,
    panels: {
      applicationHealth: { live: input.live, ready: input.ready },
      apiTraffic: {
        requests: input.snapshot.http.requests,
        authenticationFailures: input.snapshot.http.authenticationFailures,
        rateLimitEvents: input.snapshot.http.rateLimitEvents,
      },
      latency: {
        samples: input.snapshot.http.latencyMs.count,
        p95Ms: input.snapshot.http.latencyMs.p95,
        maxMs: input.snapshot.http.latencyMs.max,
      },
      errorRate: {
        serverErrors: input.snapshot.http.serverErrors,
        ratio: input.snapshot.http.errorRate,
      },
      aiUsage: input.snapshot.ai,
      providerHealth: providerHealthFromUsage(input.snapshot.ai),
      dependencies: input.snapshot.dependencies,
      backgroundJobs: input.snapshot.jobs,
      openIncidents,
    },
  }
}

export function authorizeMetricsRequest(
  authorizationHeader: string | undefined,
  configuredToken: string
): 'not-configured' | 'authorized' | 'rejected' {
  const expected = configuredToken.trim()
  if (!expected) return 'not-configured'
  const provided = authorizationHeader?.startsWith('Bearer ')
    ? authorizationHeader.slice('Bearer '.length).trim()
    : ''
  const providedBuffer = Buffer.from(provided)
  const expectedBuffer = Buffer.from(expected)
  if (
    providedBuffer.length === 0 ||
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return 'rejected'
  }
  return 'authorized'
}
