import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  assertBackupConfirmed,
  assertDatabaseUrl,
  assertHttpsEndpoint,
  assertMigrationsAreSafe,
  assertReleaseTarget,
  assertRollbackSha,
  assertWebhookCredential,
  redactSensitiveText,
  ReleaseGuardError,
} from './release-guard'

const backendRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(join(backendRoot, 'package.json'))
const prismaCli = require.resolve('prisma/build/index.js')

interface ReleaseEndpoints {
  databaseUrl: string
  healthUrl: URL
  webhookUrl: URL
}

function fail(error: unknown): never {
  const message = error instanceof Error ? error.message : 'Deployment failed.'
  process.stderr.write(`${redactSensitiveText(message)}\n`)
  process.exit(1)
}

function readEndpoints(target: 'staging' | 'production'): ReleaseEndpoints {
  assertDatabaseUrl(process.env.DATABASE_URL, target)
  return {
    databaseUrl: process.env.DATABASE_URL ?? '',
    healthUrl: assertHttpsEndpoint(process.env.HEALTH_URL, 'Health URL'),
    webhookUrl: assertHttpsEndpoint(process.env.DEPLOY_WEBHOOK_URL, 'Deployment hook'),
  }
}

async function postWebhook(url: URL, body: Record<string, string>): Promise<void> {
  const token = process.env.DEPLOY_WEBHOOK_TOKEN?.trim() ?? ''
  if (!token) {
    throw new ReleaseGuardError('Deployment hook credential is not configured.')
  }
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    })
  } catch (error) {
    const reason = error instanceof Error ? error.name : 'Error'
    throw new ReleaseGuardError(`Deployment hook request failed (${reason}).`)
  }
  if (!response.ok) {
    throw new ReleaseGuardError(
      `Deployment hook returned HTTP ${response.status}. The response body was not recorded.`
    )
  }
}

async function waitForHealth(url: URL): Promise<void> {
  let lastStatus = 'unavailable'
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(10_000) })
      if (response.ok) return
      lastStatus = String(response.status)
    } catch (error) {
      lastStatus = error instanceof Error ? error.name : 'Error'
    }
    await new Promise((resolve) => setTimeout(resolve, 5_000))
  }
  throw new ReleaseGuardError(`Readiness check did not succeed (${lastStatus}). The response body was not recorded.`)
}

function applyMigrations(databaseUrl: string): void {
  const result = spawnSync(
    process.execPath,
    [prismaCli, 'migrate', 'deploy', '--schema', 'src/prisma/schema.prisma'],
    {
      cwd: backendRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
    }
  )
  const output = redactSensitiveText(`${result.stdout ?? ''}${result.stderr ?? ''}`)
  if (output.trim()) process.stdout.write(output.endsWith('\n') ? output : `${output}\n`)
  if (result.status !== 0) {
    throw new ReleaseGuardError('Migration command failed. Review the scrubbed output above.')
  }
}

async function migrate(): Promise<void> {
  const target = assertReleaseTarget({
    target: process.env.DEPLOY_TARGET,
    confirmation: process.env.CONFIRM_PRODUCTION_MIGRATION,
    ref: process.env.GITHUB_REF,
  })
  assertBackupConfirmed(process.env.BACKUP_CONFIRMED)
  const endpoints = readEndpoints(target)
  assertWebhookCredential(process.env.DEPLOY_WEBHOOK_TOKEN)
  await assertMigrationsAreSafe()
  applyMigrations(endpoints.databaseUrl)
  try {
    await postWebhook(endpoints.webhookUrl, {
      action: 'deploy',
      target,
      sha: process.env.GITHUB_SHA ?? '',
    })
    await waitForHealth(endpoints.healthUrl)
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Deployment hook failed.'
    throw new ReleaseGuardError(
      `${reason} Migration already completed. Verify the schema version before retrying.`
    )
  }
  process.stdout.write(`Deployment hook accepted the ${target} release and readiness succeeded.\n`)
}

async function rollback(): Promise<void> {
  const target = assertReleaseTarget({
    target: process.env.DEPLOY_TARGET,
    confirmation: process.env.CONFIRM_PRODUCTION_MIGRATION,
    ref: process.env.GITHUB_REF,
  })
  if (target !== 'production') {
    throw new ReleaseGuardError('Rollback is available only for the production environment.')
  }
  const sha = assertRollbackSha(process.env.ROLLBACK_SHA)
  assertWebhookCredential(process.env.DEPLOY_WEBHOOK_TOKEN)
  const webhookUrl = assertHttpsEndpoint(process.env.DEPLOY_WEBHOOK_URL, 'Deployment hook')
  const healthUrl = assertHttpsEndpoint(process.env.HEALTH_URL, 'Health URL')
  await postWebhook(webhookUrl, { action: 'rollback', target, sha })
  await waitForHealth(healthUrl)
  process.stdout.write('Rollback hook accepted the previous release and readiness succeeded.\n')
}

async function main(): Promise<void> {
  const command = process.argv[2]
  if (command === '--check') {
    await assertMigrationsAreSafe()
    process.stdout.write('Migration preflight passed. No database was changed.\n')
    return
  }
  if (command === '--migrate') {
    await migrate()
    return
  }
  if (command === '--rollback') {
    await rollback()
    return
  }
  throw new ReleaseGuardError('Usage: migrate-release.ts --check | --migrate | --rollback')
}

const invokedDirectly = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false

if (invokedDirectly) {
  main().catch(fail)
}
