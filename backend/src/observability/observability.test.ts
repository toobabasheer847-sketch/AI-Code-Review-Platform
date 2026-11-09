import assert from 'node:assert/strict'
import { Writable } from 'node:stream'
import test from 'node:test'
import type { Request, Response } from 'express'
import { evaluateAlerts, recommendedAlertThresholds, resetAlertState, takeNewlyTriggeredAlerts } from '@/observability/alerts'
import { authorizeMetricsRequest, buildMonitoringDashboard } from '@/observability/dashboard'
import { checkDependencyHealth } from '@/observability/health'
import {
  metricsSnapshot,
  recordAIUsage,
  recordDependencyStatus,
  recordHttpObservation,
  recordJobOutcome,
  resetMetrics,
} from '@/observability/metrics'
import { redactLogValue, redactSensitiveText, serializeLogError } from '@/observability/redaction'
import { assignRequestContext, requestContextMiddleware } from '@/observability/request-context'
import { createApplicationLogger } from '@/utils/logger'

test('request ids propagate and ignore unsafe header values', () => {
  const generated = assignRequestContext({})
  assert.match(generated.requestId, /^[0-9a-f-]{36}$/)
  assert.equal(generated.correlationId, generated.requestId)

  const supplied = assignRequestContext({
    'x-request-id': 'req-21',
    'x-correlation-id': 'corr-21',
  })
  assert.deepEqual(supplied, { requestId: 'req-21', correlationId: 'corr-21' })
  assert.equal(assignRequestContext({ 'x-request-id': 'Bearer secret' }).requestId === 'Bearer secret', false)

  const headers = new Map<string, string>()
  const response = {
    setHeader(name: string, value: string) {
      headers.set(name, value)
    },
  }
  requestContextMiddleware(
    { headers: { 'x-request-id': 'req-header' } } as Request,
    response as unknown as Response,
    () => undefined
  )
  assert.equal(headers.get('x-request-id'), 'req-header')
  assert.equal(headers.get('x-correlation-id'), 'req-header')
})

test('structured logs redact secrets and keep error name and stack', () => {
  const lines: string[] = []
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(String(chunk))
      callback()
    },
  })
  const logger = createApplicationLogger(stream)
  const failure = new Error('postgres://app:super-secret@db.internal/app failed')
  failure.name = 'QueryError'
  logger.error(
    {
      password: 'super-secret',
      invitationToken: 'invite-secret',
      err: failure,
      method: 'POST',
      route: '/api/reviews',
      statusCode: 500,
      durationMs: 12,
    },
    'request failed'
  )

  const record = JSON.parse(lines.join('')) as Record<string, unknown>
  const serialized = JSON.stringify(record)
  assert.equal(record.level, 'error')
  assert.equal(record.method, 'POST')
  assert.equal(record.route, '/api/reviews')
  assert.equal(record.statusCode, 500)
  assert.equal(record.durationMs, 12)
  assert.equal(serialized.includes('super-secret'), false)
  assert.equal(serialized.includes('invite-secret'), false)
  assert.match(serialized, /QueryError/)
  assert.match(serialized, /\[redacted-database-url\]/)

  const redacted = redactLogValue({
    email: 'person@example.test',
    nested: { apiKey: 'sk_live_private' },
  }) as { email: string; nested: { apiKey: string } }
  assert.equal(redacted.email, '[redacted]')
  assert.equal(redacted.nested.apiKey, '[redacted]')
  assert.equal(redactSensitiveText('Bearer private-token').includes('private-token'), false)
  assert.equal(serializeLogError(failure).stack?.includes('super-secret'), false)
})

test('readiness reports each dependency without leaking connection details', async () => {
  const healthy = await checkDependencyHealth({
    database: async () => undefined,
    redis: async () => 'PONG',
  })
  assert.deepEqual(healthy, { database: 'ok', redis: 'ok' })

  const databaseDown = await checkDependencyHealth({
    database: async () => {
      throw new Error('postgres://user:password@db/production')
    },
    redis: async () => 'PONG',
  })
  assert.deepEqual(databaseDown, { database: 'unavailable', redis: 'ok' })
  assert.equal(JSON.stringify(databaseDown).includes('password'), false)

  const redisDown = await checkDependencyHealth({
    database: async () => undefined,
    redis: async () => {
      throw new Error('rediss://default:secret@cache/0')
    },
  })
  assert.deepEqual(redisDown, { database: 'ok', redis: 'unavailable' })
})

test('metrics collect http, auth, rate limits, ai usage, and job outcomes', () => {
  resetMetrics()
  const now = Date.parse('2026-11-10T00:00:00Z')
  recordHttpObservation({ at: now, status: 200, durationMs: 25 })
  recordHttpObservation({ at: now + 1, status: 401, durationMs: 40 })
  recordHttpObservation({ at: now + 2, status: 429, durationMs: 15 })
  recordHttpObservation({ at: now + 3, status: 500, durationMs: 2_500 })
  recordHttpObservation({ at: now - 10 * 60 * 1000, status: 500, durationMs: 9_000 })
  recordAIUsage({
    at: now,
    inputTokens: 100,
    outputTokens: 20,
    estimatedCostUsd: 0.02,
    failed: false,
    unpriced: false,
  })
  recordJobOutcome({ at: now, queue: 'reviews', outcome: 'failed' })
  recordDependencyStatus('database', 'ok')
  recordDependencyStatus('redis', 'unavailable')

  const snapshot = metricsSnapshot(now + 4)
  assert.equal(snapshot.http.requests, 4)
  assert.equal(snapshot.http.serverErrors, 1)
  assert.equal(snapshot.http.authenticationFailures, 1)
  assert.equal(snapshot.http.rateLimitEvents, 1)
  assert.equal(snapshot.http.errorRate, 0.25)
  assert.equal(snapshot.http.latencyMs.max, 2_500)
  assert.equal(snapshot.ai.requests, 1)
  assert.equal(snapshot.ai.inputTokens, 100)
  assert.equal(snapshot.ai.outputTokens, 20)
  assert.equal(snapshot.ai.estimatedCostUsd, 0.02)
  assert.equal(snapshot.jobs.reviews.failed, 1)
  assert.equal(snapshot.dependencies.redis, 'unavailable')
  assert.equal(snapshot.http.latencyMs.p95 === null, false)
})

test('alert thresholds stay quiet below the sample floor and open once', () => {
  resetAlertState()
  resetMetrics()
  const quiet = evaluateAlerts({
    live: 'ok',
    database: 'ok',
    redis: 'ok',
    snapshot: metricsSnapshot(),
  })
  assert.equal(quiet.every((alert) => alert.triggered === false), true)

  const snapshot = metricsSnapshot()
  snapshot.http.requests = recommendedAlertThresholds.serverErrorMinRequests
  snapshot.http.serverErrors = 3
  snapshot.http.errorRate = 0.1
  snapshot.http.latencyMs.p95 = recommendedAlertThresholds.latencyP95Ms
  snapshot.ai.requests = recommendedAlertThresholds.aiMinRequests
  snapshot.ai.estimatedCostUsd = recommendedAlertThresholds.aiCostUsd
  snapshot.jobs.email.failed = recommendedAlertThresholds.jobFailureCount

  const triggered = evaluateAlerts({
    live: 'unavailable',
    database: 'unavailable',
    redis: 'unavailable',
    snapshot,
  })
  assert.deepEqual(
    triggered.filter((alert) => alert.triggered).map((alert) => alert.id),
    [
      'backend_unavailable',
      'high_http_5xx_rate',
      'high_api_latency',
      'postgresql_unavailable',
      'redis_unavailable',
      'background_job_failures',
      'ai_cost_spike',
    ]
  )
  assert.equal(takeNewlyTriggeredAlerts(triggered).length, triggered.length)
  assert.equal(takeNewlyTriggeredAlerts(triggered).length, 0)

  const dashboard = buildMonitoringDashboard({ live: 'ok', ready: 'error', snapshot })
  assert.equal(dashboard.panels.apiTraffic.requests, snapshot.http.requests)
  assert.equal(dashboard.panels.aiUsage.estimatedCostUsd, snapshot.ai.estimatedCostUsd)
  assert.equal(dashboard.panels.backgroundJobs.email.failed, snapshot.jobs.email.failed)
  assert.equal(JSON.stringify(dashboard).includes('postgres://'), false)
})

test('metrics endpoint authorization fails closed', () => {
  assert.equal(authorizeMetricsRequest(undefined, ''), 'not-configured')
  assert.equal(authorizeMetricsRequest('Bearer secret-token', 'secret-token'), 'authorized')
  assert.equal(authorizeMetricsRequest('Bearer wrong', 'secret-token'), 'rejected')
  assert.equal(authorizeMetricsRequest(undefined, 'secret-token'), 'rejected')
})
