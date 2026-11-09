import assert from 'node:assert/strict'
import test from 'node:test'
import {
  assertBackupConfirmed,
  assertDatabaseUrl,
  assertHttpsEndpoint,
  assertReleaseTarget,
  assertRollbackSha,
  assertWebhookCredential,
  redactSensitiveText,
  ReleaseGuardError,
} from './release-guard'

const main = 'refs/heads/main'

test('restricts production migration to an approved main-branch release', () => {
  assert.equal(
    assertReleaseTarget({ target: 'staging', confirmation: undefined, ref: main }),
    'staging'
  )
  assert.throws(
    () => assertReleaseTarget({ target: 'production', confirmation: undefined, ref: main }),
    /explicit approval/
  )
  assert.equal(
    assertReleaseTarget({ target: 'production', confirmation: 'approved', ref: main }),
    'production'
  )
  assert.throws(
    () => assertReleaseTarget({ target: 'production', confirmation: 'approved', ref: 'refs/heads/feature' }),
    /main branch/
  )
})

test('refuses unsafe database targets and strips credentials from errors', () => {
  const secretUrl = 'postgresql://deployer:super-secret-password@127.0.0.1:5432/ai_codeguard_production'
  assert.throws(
    () => assertDatabaseUrl(secretUrl, 'staging'),
    (error: unknown) => {
      assert.ok(error instanceof ReleaseGuardError)
      assert.equal(error.message.includes('super-secret-password'), false)
      assert.match(error.message, /looks like production/)
      return true
    }
  )
  assert.throws(
    () => assertDatabaseUrl('postgresql://deployer:secret@db.internal:5432/ai_codeguard_integration_test', 'production'),
    /test database/
  )
  assert.doesNotThrow(() =>
    assertDatabaseUrl('postgresql://deployer:secret@db.internal:5432/ai_codeguard_staging', 'staging')
  )
  assert.equal(redactSensitiveText(`failed ${secretUrl}`).includes('super-secret-password'), false)
})

test('requires a confirmed backup and HTTPS endpoints without embedded secrets', () => {
  assert.throws(() => assertBackupConfirmed('true'), /confirmed backup/)
  assert.doesNotThrow(() => assertBackupConfirmed('yes'))
  assert.throws(
    () => assertHttpsEndpoint('https://user:token@deploy.example.com/hook?token=secret', 'Deployment hook'),
    (error: unknown) => {
      assert.ok(error instanceof ReleaseGuardError)
      assert.equal(error.message.includes('token'), false)
      return true
    }
  )
  assert.throws(() => assertWebhookCredential(''), /No migration was started/)
  assert.doesNotThrow(() => assertWebhookCredential('hook-token'))
  assert.equal(assertRollbackSha('a'.repeat(40)), 'a'.repeat(40))
  assert.throws(() => assertRollbackSha('abc'), /40-character/)
})
