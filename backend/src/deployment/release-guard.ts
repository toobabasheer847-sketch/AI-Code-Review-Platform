import { findMigrationSafetyIssues } from '@/testing/migration-safety'

export type ReleaseTarget = 'staging' | 'production'

const PRODUCTION_NAME_PATTERN = /(^|_)(prod|production|live)(_|$)/i
const TEST_NAME_PATTERN = /(test|integration|disposable)/i

export class ReleaseGuardError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReleaseGuardError'
  }
}

export function assertReleaseTarget(input: {
  target: string | undefined
  confirmation: string | undefined
  ref: string | undefined
}): ReleaseTarget {
  if (input.ref !== 'refs/heads/main') {
    throw new ReleaseGuardError('Deployment is restricted to the main branch.')
  }
  if (input.target === 'staging') return 'staging'
  if (input.target === 'production') {
    if (input.confirmation !== 'approved') {
      throw new ReleaseGuardError('Production migration requires explicit approval. No migration was applied.')
    }
    return 'production'
  }
  throw new ReleaseGuardError('Deployment target must be staging or production.')
}

export function assertBackupConfirmed(value: string | undefined): void {
  if (value !== 'yes') {
    throw new ReleaseGuardError(
      'A confirmed backup is required before migration. No migration was applied.'
    )
  }
}

export function assertDatabaseUrl(databaseUrl: string | undefined, target: ReleaseTarget): void {
  if (!databaseUrl?.trim()) {
    throw new ReleaseGuardError('Database credential is not configured. No migration was applied.')
  }
  let parsed: URL
  try {
    parsed = new URL(databaseUrl)
  } catch {
    throw new ReleaseGuardError('Database URL is invalid. No migration was applied.')
  }
  if (!/^postgres(?:ql)?:$/i.test(parsed.protocol)) {
    throw new ReleaseGuardError('Database URL must use PostgreSQL. No migration was applied.')
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, '').split('/')[0] ?? '')
  if (!databaseName) {
    throw new ReleaseGuardError('Database URL must include a database name. No migration was applied.')
  }
  if (target === 'staging' && PRODUCTION_NAME_PATTERN.test(databaseName)) {
    throw new ReleaseGuardError(
      'Staging migration refused because the database name looks like production. No migration was applied.'
    )
  }
  if (target === 'production' && TEST_NAME_PATTERN.test(databaseName)) {
    throw new ReleaseGuardError(
      'Production migration refused because the database name looks like a test database. No migration was applied.'
    )
  }
}

export function assertHttpsEndpoint(value: string | undefined, label: string): URL {
  if (!value?.trim()) {
    throw new ReleaseGuardError(`${label} is not configured. No deployment change was performed.`)
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new ReleaseGuardError(`${label} is invalid. No deployment change was performed.`)
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new ReleaseGuardError(
      `${label} must not include credentials or query parameters. No deployment change was performed.`
    )
  }
  if (parsed.protocol !== 'https:') {
    throw new ReleaseGuardError(`${label} must use HTTPS. No deployment change was performed.`)
  }
  return parsed
}

export function assertWebhookCredential(value: string | undefined): void {
  if (!value?.trim()) {
    throw new ReleaseGuardError(
      'Deployment hook credential is not configured. No migration was started.'
    )
  }
}

export function assertRollbackSha(value: string | undefined): string {
  const sha = value?.trim() ?? ''
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw new ReleaseGuardError('Rollback requires the full 40-character commit SHA. No rollback was performed.')
  }
  return sha
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/postgres(?:ql)?:\/\/\S+/gi, '[redacted-database-url]')
    .replace(/\b(?:sk|rk)_(?:test|live)_[A-Za-z0-9]+/g, '[redacted-stripe-key]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted-token]')
}

export async function assertMigrationsAreSafe(): Promise<void> {
  const issues = await findMigrationSafetyIssues()
  if (issues.length === 0) return
  const details = issues.map((issue) => `${issue.migrationName}: ${issue.detail}`).join('\n')
  throw new ReleaseGuardError(`Refusing deployment because migrations are not safe.\n${details}`)
}
