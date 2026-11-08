const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1'])

const RESERVED_DATABASE_NAMES = new Set([
  'ai_codeguard',
  'postgres',
  'template0',
  'template1',
  'production',
  'prod',
])

const PRODUCTION_NAME_PATTERN = /(^|_)(prod|production|live)(_|$)/i
const DISPOSABLE_NAME_PATTERN = /(test|integration)/i

export class DisposableDatabaseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DisposableDatabaseError'
  }
}

export interface DisposableDatabaseTarget {
  databaseUrl: string
  databaseName: string
  hostname: string
}

function databaseNameFromUrl(target: URL): string {
  return decodeURIComponent(target.pathname.replace(/^\//, '').split('/')[0] ?? '')
}

export function canonicalDatabaseUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl)
  url.searchParams.delete('schema')
  url.hash = ''
  if (url.pathname.length > 1) {
    url.pathname = url.pathname.replace(/\/+$/, '')
  }
  return url.toString()
}

export function assertDisposableTestDatabase(databaseUrl: string): DisposableDatabaseTarget {
  let target: URL
  try {
    target = new URL(databaseUrl)
  } catch {
    throw new DisposableDatabaseError('Test database URL must be a valid URL')
  }

  if (!/^postgres(ql)?:$/i.test(target.protocol)) {
    throw new DisposableDatabaseError('Test database URL must use the postgresql protocol')
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, '')
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new DisposableDatabaseError(
      'Test database URL must point at localhost. Refusing remote and production hosts.'
    )
  }

  const databaseName = databaseNameFromUrl(target)
  if (!databaseName || RESERVED_DATABASE_NAMES.has(databaseName.toLowerCase())) {
    throw new DisposableDatabaseError(
      'Test database name is reserved for application or production data. Use a dedicated database whose name contains "test" or "integration".'
    )
  }
  if (PRODUCTION_NAME_PATTERN.test(databaseName)) {
    throw new DisposableDatabaseError(
      'Test database name must not look like a production database'
    )
  }
  if (!DISPOSABLE_NAME_PATTERN.test(databaseName)) {
    throw new DisposableDatabaseError(
      'Test database name must contain "test" or "integration"'
    )
  }

  return { databaseUrl, databaseName, hostname }
}

function configuredIntegrationUrls(): string[] {
  return [
    process.env.INTEGRATION_TEST_DATABASE_URL,
    process.env.WORKSPACE_TENANCY_TEST_DATABASE_URL,
    process.env.FINDING_LIFECYCLE_TEST_DATABASE_URL,
  ].flatMap((value) => {
    const trimmed = value?.trim()
    return trimmed ? [trimmed] : []
  })
}

export function resolveDisposableTestDatabaseUrl(): string | undefined {
  const configured = configuredIntegrationUrls()
  if (configured.length === 0) return undefined

  const canonicalTargets = new Set(configured.map((url) => canonicalDatabaseUrl(url)))
  if (canonicalTargets.size !== 1) {
    throw new DisposableDatabaseError(
      'INTEGRATION_TEST_DATABASE_URL, WORKSPACE_TENANCY_TEST_DATABASE_URL, and FINDING_LIFECYCLE_TEST_DATABASE_URL must point at the same disposable database'
    )
  }

  const databaseUrl = configured[0]
  if (!databaseUrl) return undefined
  assertDisposableTestDatabase(databaseUrl)

  const applicationUrl = process.env.DATABASE_URL?.trim()
  if (
    !applicationUrl ||
    canonicalDatabaseUrl(applicationUrl) !== canonicalDatabaseUrl(databaseUrl)
  ) {
    throw new DisposableDatabaseError(
      'DATABASE_URL must match the disposable test database URL. Refusing to run integration tests against a different database.'
    )
  }
  assertDisposableTestDatabase(applicationUrl)
  return databaseUrl
}
