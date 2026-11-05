import assert from 'node:assert/strict'
import test from 'node:test'

import { sanitizeMonitoringEvent } from './error-monitoring'

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
    tags: { component: 'review-worker', category: 'application' },
  })
})

test('unknown event tags are replaced instead of copied to telemetry', () => {
  const sanitized = sanitizeMonitoringEvent({
    tags: { component: 'person@example.test', category: 'private prompt' },
  })

  assert.deepEqual(sanitized.tags, { component: 'unknown', category: 'unknown' })
})
