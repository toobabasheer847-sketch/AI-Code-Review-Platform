import assert from 'node:assert/strict'
import test from 'node:test'

import { buildErrorMonitoringOptions, isErrorMonitoringEnabled, reportBackendError, sanitizeMonitoringEvent } from './error-monitoring'

test('monitoring events retain only static, privacy-safe metadata', () => {
  const sanitized = sanitizeMonitoringEvent({
    event_id: 'event-id',
    message: 'private repository source and password',
    request: {
      url: 'https://example.test/api/reviews/private-review-id?token=secret',
      data: { password: 'secret', source: 'private source' },
      headers: { authorization: 'Bearer secret' },
    },
    user: { id: 'private-user-id', email: 'person@example.test' },
    exception: {
      values: [{ type: 'ProviderError', value: 'secret provider response' }],
    },
    breadcrumbs: [{ message: 'private prompt', data: { token: 'secret' }, timestamp: 1 }],
    extra: { repository: 'private/repository', token: 'secret' },
    tags: { component: 'review-worker', category: 'application', userId: 'private-user-id' },
  })

  assert.deepEqual(sanitized, {
    event_id: 'event-id',
    timestamp: undefined,
    platform: 'node',
    level: 'error',
    type: undefined,
    environment: process.env.NODE_ENV || 'development',
    message: 'Application operation failed',
    fingerprint: ['review-worker', 'application', 'ProviderError'],
    tags: { component: 'review-worker', category: 'application', errorName: 'ProviderError' },
  })
  assert.equal(JSON.stringify(sanitized).includes('secret'), false)
  assert.equal(JSON.stringify(sanitized).includes('password'), false)
})

test('unknown event tags are replaced instead of copied to telemetry', () => {
  const sanitized = sanitizeMonitoringEvent({
    tags: { component: 'person@example.test', category: 'private prompt' },
  })

  assert.deepEqual(sanitized.tags, { component: 'unknown', category: 'unknown', errorName: 'Error' })
  assert.deepEqual(sanitized.fingerprint, ['unknown', 'unknown', 'Error'])
})

test('error tracking stays disabled without a DSN and configures grouping when one is present', () => {
  assert.equal(buildErrorMonitoringOptions(''), null)
  assert.equal(isErrorMonitoringEnabled(), false)
  assert.doesNotThrow(() => reportBackendError(new Error('Bearer private-token'), 'api'))

  const options = buildErrorMonitoringOptions('https://public@o0.ingest.sentry.io/1', 'release-21')
  assert.equal(options?.release, 'release-21')
  assert.equal(options?.environment, process.env.NODE_ENV || 'development')
  assert.equal(options?.tracesSampleRate, 0)
  const sanitized = options?.beforeSend({
    message: 'postgres://user:password@db/app',
    tags: { component: 'api', category: 'application' },
    exception: { values: [{ type: 'TypeError', value: 'private token' }] },
  })
  assert.equal(JSON.stringify(sanitized).includes('password'), false)
  assert.equal(sanitized?.fingerprint?.[2], 'TypeError')
})
