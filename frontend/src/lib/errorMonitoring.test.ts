import { describe, expect, it } from 'vitest'

import {
  buildFrontendMonitoringOptions,
  isFrontendMonitoringEnabled,
  sanitizeFrontendMonitoringEvent,
} from './errorMonitoring'

describe('sanitizeFrontendMonitoringEvent', () => {
  it('removes user, request, exception and breadcrumb data', () => {
    const event = sanitizeFrontendMonitoringEvent({
      message: 'private source and prompt',
      request: { url: '/api/reviews/private-id?token=secret', data: 'private source' },
      user: { id: 'private-user', email: 'person@example.test' },
      exception: { values: [{ type: 'Error', value: 'secret token' }] },
      breadcrumbs: [{ message: 'private prompt', timestamp: 1 }],
      tags: { component: 'api', category: 'server', repository: 'private/repo' },
    })

    expect(event.message).toBe('Frontend operation failed')
    expect(event.tags).toEqual({ component: 'api', category: 'server', errorName: 'Error' })
    expect(event.fingerprint).toEqual(['api', 'server', 'Error'])
    expect(JSON.stringify(event)).not.toContain('secret')
    expect(event).not.toHaveProperty('request')
    expect(event).not.toHaveProperty('user')
    expect(event).not.toHaveProperty('exception')
    expect(event).not.toHaveProperty('breadcrumbs')
  })

  it('does not forward unrecognized tags', () => {
    const event = sanitizeFrontendMonitoringEvent({
      tags: { component: 'person@example.test', category: 'private prompt' },
    })

    expect(event.tags).toEqual({ component: 'unknown', category: 'unknown', errorName: 'Error' })
  })

  it('stays disabled without a DSN and keeps a configured release', () => {
    expect(buildFrontendMonitoringOptions('')).toBeNull()
    expect(isFrontendMonitoringEnabled()).toBe(false)
    const options = buildFrontendMonitoringOptions('https://public@o0.ingest.sentry.io/1', 'web-21')
    expect(options?.release).toBe('web-21')
    expect(options?.tracesSampleRate).toBe(0)
    const sanitized = options?.beforeSend?.({
      message: 'invitation token secret',
      tags: { component: 'ui', category: 'render' },
    })
    expect(JSON.stringify(sanitized)).not.toContain('secret')
  })
})
