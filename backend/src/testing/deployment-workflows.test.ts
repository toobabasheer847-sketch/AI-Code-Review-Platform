import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..')

async function readRepoFile(path: string): Promise<string> {
  return readFile(join(repoRoot, path), 'utf8')
}

test('production deployment stays manual, approved, and separate from staging', async () => {
  const production = await readRepoFile('.github/workflows/deploy-production.yml')
  const staging = await readRepoFile('.github/workflows/deploy-staging.yml')
  const rollback = await readRepoFile('.github/workflows/rollback-production.yml')
  for (const workflow of [production, staging, rollback]) {
    assert.equal(workflow.includes('pull_request:'), false)
    assert.match(workflow, /permissions:\s+contents: read/)
    assert.equal(workflow.includes('echo ${{ secrets'), false)
    assert.equal(workflow.includes('echo "$DATABASE_URL"'), false)
    assert.equal(workflow.includes('echo "$DEPLOY_WEBHOOK_TOKEN"'), false)
  }
  assert.match(production, /workflow_dispatch:/)
  assert.match(production, /environment:\s+name: production/)
  assert.match(production, /refs\/heads\/main/)
  assert.match(production, /PRODUCTION_DATABASE_URL/)
  assert.match(production, /CONFIRM_PRODUCTION_MIGRATION: approved/)
  assert.match(staging, /environment:\s+name: staging/)
  assert.match(staging, /STAGING_DATABASE_URL/)
  assert.equal(staging.includes('PRODUCTION_DATABASE_URL'), false)
  assert.equal(production.includes('STAGING_DATABASE_URL'), false)
  assert.match(rollback, /environment:\s+name: production/)
  assert.match(rollback, /deploy:rollback/)
  assert.equal(rollback.includes('deploy:migrate'), false)
})

test('production container definition does not use development commands or secret files', async () => {
  const compose = await readRepoFile('docker-compose.production.yml')
  const dockerfile = await readRepoFile('backend/Dockerfile')
  const dockerignore = await readRepoFile('.dockerignore')
  assert.equal(compose.includes('target: development'), false)
  assert.equal(compose.includes('npm run dev'), false)
  assert.equal(compose.includes('env_file'), false)
  assert.equal(compose.includes('.env'), false)
  assert.match(dockerfile, /USER node/)
  assert.match(dockerfile, /CMD \["node", "dist\/app\/server\.js"\]/)
  assert.equal(dockerfile.includes('npm run dev'), false)
  assert.match(dockerignore, /\*\*\/\.env/)
})
