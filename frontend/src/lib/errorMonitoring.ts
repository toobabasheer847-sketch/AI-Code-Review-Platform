import * as Sentry from '@sentry/react'
import type { ErrorEvent, Event } from '@sentry/react'

const components = new Set(['ui', 'api'])
const categories = new Set(['render', 'server', 'network', 'unknown'])
let monitoringEnabled = false

function safeTag(value: unknown, allowedValues: Set<string>): string {
  return typeof value === 'string' && allowedValues.has(value) ? value : 'unknown'
}

export function sanitizeFrontendMonitoringEvent(event: Event): ErrorEvent {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'javascript',
    level: 'error',
    environment: import.meta.env.MODE,
    message: 'Frontend operation failed',
    tags: {
      component: safeTag(event.tags?.component, components),
      category: safeTag(event.tags?.category, categories),
    },
  }
}

export function initializeFrontendErrorMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return

  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE || undefined,
    defaultIntegrations: false,
    tracesSampleRate: 0,
    beforeSend: sanitizeFrontendMonitoringEvent,
  })
  monitoringEnabled = true
}

function getErrorCategory(error: unknown): string {
  if (error instanceof SyntaxError) return 'render'
  if (error instanceof TypeError) return 'network'
  if (error instanceof Error) return 'server'
  return 'unknown'
}

export function reportFrontendError(
  error: unknown,
  component: 'ui' | 'api',
  category?: 'render' | 'server' | 'network'
): void {
  if (!monitoringEnabled) return

  try {
    Sentry.withScope((scope) => {
      scope.setTag('component', component)
      scope.setTag('category', category ?? getErrorCategory(error))
      Sentry.captureMessage('Frontend operation failed', 'error')
    })
  } catch {
    console.warn('External error monitoring could not accept an event')
  }
}
