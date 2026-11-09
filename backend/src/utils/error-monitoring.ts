import * as Sentry from '@sentry/node'
import type { ErrorEvent, Event } from '@sentry/node'
import { env } from '@/config/env'
import { safeErrorName } from '@/observability/redaction'
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

function groupedErrorName(event: Event): string {
  const exceptionType = event.exception?.values?.find((value) => value.type)?.type
  return safeErrorName(exceptionType)
}

export function sanitizeMonitoringEvent(event: Event): ErrorEvent {
  const component = safeTag(event.tags?.component, components)
  const category = safeTag(event.tags?.category, categories)
  const errorName = groupedErrorName(event)
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'node',
    level: 'error',
    type: undefined,
    environment: env.NODE_ENV,
    ...(env.SENTRY_RELEASE ? { release: env.SENTRY_RELEASE } : {}),
    message: 'Application operation failed',
    fingerprint: [component, category, errorName],
    tags: { component, category, errorName },
  }
}

export function buildErrorMonitoringOptions(dsn: string, release = env.SENTRY_RELEASE) {
  const configuredDsn = dsn.trim()
  if (!configuredDsn) return null
  return {
    dsn: configuredDsn,
    environment: env.NODE_ENV,
    release: release.trim() || undefined,
    defaultIntegrations: false as const,
    tracesSampleRate: 0,
    beforeSend: sanitizeMonitoringEvent,
  }
}

export function isErrorMonitoringEnabled(): boolean {
  return monitoringEnabled
}

export function initializeErrorMonitoring(): void {
  const options = buildErrorMonitoringOptions(env.SENTRY_DSN)
  if (!options) {
    if (env.NODE_ENV === 'production') {
      logger.warn('SENTRY_DSN is not configured; external error monitoring is disabled')
    }
    return
  }

  Sentry.init(options)
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
    const errorName = safeErrorName(error instanceof Error ? error.name : undefined)
    Sentry.withScope((scope) => {
      scope.setTag('component', safeComponent)
      scope.setTag('category', category)
      scope.setTag('errorName', errorName)
      scope.setFingerprint([safeComponent, category, errorName])
      Sentry.captureMessage('Application operation failed', 'error')
    })
  } catch {
    logger.warn('External error monitoring could not accept an event')
  }
}

export async function flushErrorMonitoring(timeoutMs = 2_000): Promise<void> {
  if (monitoringEnabled) await Sentry.flush(timeoutMs)
}
