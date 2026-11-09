import * as Sentry from '@sentry/react'
import type { ErrorEvent, Event } from '@sentry/react'

const components = new Set(['ui', 'api'])
const categories = new Set(['render', 'server', 'network', 'unknown'])
let monitoringEnabled = false

function safeTag(value: unknown, allowedValues: Set<string>): string {
  return typeof value === 'string' && allowedValues.has(value) ? value : 'unknown'
}

function safeErrorName(value: unknown): string {
  return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value) ? value : 'Error'
}

export function sanitizeFrontendMonitoringEvent(event: Event): ErrorEvent {
  const component = safeTag(event.tags?.component, components)
  const category = safeTag(event.tags?.category, categories)
  const errorName = safeErrorName(event.exception?.values?.find((value) => value.type)?.type)
  const release = import.meta.env.VITE_SENTRY_RELEASE
  return {
    event_id: event.event_id,
    timestamp: event.timestamp,
    platform: 'javascript',
    level: 'error',
    type: undefined,
    environment: import.meta.env.MODE,
    ...(release ? { release } : {}),
    message: 'Frontend operation failed',
    fingerprint: [component, category, errorName],
    tags: { component, category, errorName },
  }
}

export function buildFrontendMonitoringOptions(
  dsn: string,
  release = import.meta.env.VITE_SENTRY_RELEASE
): {
  dsn: string
  environment: string
  release: string | undefined
  defaultIntegrations: false
  tracesSampleRate: number
  beforeSend: (event: Event) => ErrorEvent
} | null {
  const configuredDsn = dsn.trim()
  if (!configuredDsn) return null
  return {
    dsn: configuredDsn,
    environment: import.meta.env.MODE,
    release: release?.trim() || undefined,
    defaultIntegrations: false as const,
    tracesSampleRate: 0,
    beforeSend: sanitizeFrontendMonitoringEvent,
  }
}

export function isFrontendMonitoringEnabled(): boolean {
  return monitoringEnabled
}

export function initializeFrontendErrorMonitoring(): void {
  const options = buildFrontendMonitoringOptions(import.meta.env.VITE_SENTRY_DSN ?? '')
  if (!options) return

  Sentry.init(options)
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
    const safeCategory = category ?? getErrorCategory(error)
    const errorName = error instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)
      ? error.name
      : 'Error'
    Sentry.withScope((scope) => {
      scope.setTag('component', component)
      scope.setTag('category', safeCategory)
      scope.setTag('errorName', errorName)
      scope.setFingerprint([component, safeCategory, errorName])
      Sentry.captureMessage('Frontend operation failed', 'error')
    })
  } catch {
    console.warn('External error monitoring could not accept an event')
  }
}
