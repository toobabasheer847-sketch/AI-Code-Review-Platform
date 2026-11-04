import * as Sentry from '@sentry/node'
import type { ErrorEvent, Event } from '@sentry/node'
import { env } from '@/config/env'
import logger from '@/utils/logger'

const components = new Set([
  'api',
  'review-worker',
  'automation-worker',
  'email-worker',
  'social-worker',
  'verification-worker',
  'scheduler',
  'redis',
  'startup',
])

const categories = new Set(['application', 'syntax', 'type', 'unknown'])
let monitoringEnabled = false

function safeTag(value: unknown, allowedValues: Set<string>): string {
  return typeof value === 'string' && allowedValues.has(value) ? value : 'unknown'
}

export function sanitizeMonitoringEvent(event: Event): ErrorEvent {
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'node',
    level: 'error',
    environment: env.NODE_ENV,
    message: 'Application operation failed',
    tags: {
      component: safeTag(event.tags?.component, components),
      category: safeTag(event.tags?.category, categories),
    },
  }
}

export function initializeErrorMonitoring(): void {
  if (!env.SENTRY_DSN) {
    if (env.NODE_ENV === 'production') {
      logger.warn('SENTRY_DSN is not configured; external error monitoring is disabled')
    }
    return
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    release: env.SENTRY_RELEASE || undefined,
    defaultIntegrations: false,
    tracesSampleRate: 0,
    beforeSend: sanitizeMonitoringEvent,
  })
  monitoringEnabled = true
}

function getErrorCategory(error: unknown): string {
  if (error instanceof SyntaxError) return 'syntax'
  if (error instanceof TypeError) return 'type'
  if (error instanceof Error) return 'application'
  return 'unknown'
}

export function reportBackendError(error: unknown, component: string): void {
  if (!monitoringEnabled) return

  const safeComponent = safeTag(component, components)
  const category = getErrorCategory(error)
  try {
    Sentry.withScope((scope) => {
      scope.setTag('component', safeComponent)
      scope.setTag('category', category)
      Sentry.captureMessage('Application operation failed', 'error')
    })
  } catch {
    logger.warn('External error monitoring could not accept an event')
  }
}

export async function flushErrorMonitoring(timeoutMs = 2_000): Promise<void> {
  if (monitoringEnabled) await Sentry.flush(timeoutMs)
}
