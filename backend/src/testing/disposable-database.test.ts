import assert from 'node:assert/strict'
import test, { describe } from 'node:test'
import {
  DisposableDatabaseError,
  assertDisposableTestDatabase,
  resolveDisposableTestDatabaseUrl,
} from './disposable-database'

const localTestUrl = 'postgresql://postgres:postgres@localhost:5432/ai_codeguard_integration_test'

test('accepts a localhost database whose name marks it as disposable', () => {
  const target = assertDisposableTestDatabase(
    'postgresql://postgres:postgres@127.0.0.1:5432/ai_codeguard_integration_test?schema=public'
  )
  assert.equal(target.databaseName, 'ai_codeguard_integration_test')
  assert.equal(target.hostname, '127.0.0.1')
})

test('rejects the application database and remote or production-like targets', () => {
  assert.throws(
    () => assertDisposableTestDatabase('postgresql://postgres:postgres@localhost:5432/ai_codeguard'),
    DisposableDatabaseError
  )
  assert.throws(
    () =>
      assertDisposableTestDatabase(
        'postgresql://postgres:postgres@db.example.com:5432/ai_codeguard_integration_test'
      ),
    /localhost/
  )
  assert.throws(
    () =>
      assertDisposableTestDatabase(
        'postgresql://postgres:postgres@localhost:5432/ai_codeguard_production_test'
      ),
    /production/
  )
  assert.throws(
    () => assertDisposableTestDatabase('postgresql://postgres:postgres@localhost:5432/app'),
    /test/
  )
})

describe('disposable database environment resolution', { concurrency: false }, () => {
  const previous = {
    DATABASE_URL: process.env.DATABASE_URL,
    INTEGRATION_TEST_DATABASE_URL: process.env.INTEGRATION_TEST_DATABASE_URL,
    WORKSPACE_TENANCY_TEST_DATABASE_URL: process.env.WORKSPACE_TENANCY_TEST_DATABASE_URL,
    FINDING_LIFECYCLE_TEST_DATABASE_URL: process.env.FINDING_LIFECYCLE_TEST_DATABASE_URL,
  }

  test.after(() => {
    restore('DATABASE_URL', previous.DATABASE_URL)
    restore('INTEGRATION_TEST_DATABASE_URL', previous.INTEGRATION_TEST_DATABASE_URL)
    restore('WORKSPACE_TENANCY_TEST_DATABASE_URL', previous.WORKSPACE_TENANCY_TEST_DATABASE_URL)
    restore('FINDING_LIFECYCLE_TEST_DATABASE_URL', previous.FINDING_LIFECYCLE_TEST_DATABASE_URL)
  })

  test('stays disabled until a disposable database is requested', () => {
    delete process.env.INTEGRATION_TEST_DATABASE_URL
    delete process.env.WORKSPACE_TENANCY_TEST_DATABASE_URL
    delete process.env.FINDING_LIFECYCLE_TEST_DATABASE_URL
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ai_codeguard'
    assert.equal(resolveDisposableTestDatabaseUrl(), undefined)
  })

  test('requires every configured test URL to match DATABASE_URL', () => {
    process.env.INTEGRATION_TEST_DATABASE_URL = localTestUrl
    process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/ai_codeguard'
    delete process.env.WORKSPACE_TENANCY_TEST_DATABASE_URL
    delete process.env.FINDING_LIFECYCLE_TEST_DATABASE_URL
    assert.throws(() => resolveDisposableTestDatabaseUrl(), /must match/)
  })

  test('accepts the canonical URL and the older aliases when they are the same local database', () => {
    process.env.DATABASE_URL = `${localTestUrl}?schema=public`
    process.env.INTEGRATION_TEST_DATABASE_URL = localTestUrl
    process.env.WORKSPACE_TENANCY_TEST_DATABASE_URL = localTestUrl
    process.env.FINDING_LIFECYCLE_TEST_DATABASE_URL = localTestUrl
    assert.equal(resolveDisposableTestDatabaseUrl(), localTestUrl)
  })
})

function restore(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
