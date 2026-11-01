import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { classifyVerificationResult, hashFixPatch } from '@/modules/code-review/fix-verification.domain'
import { signVerificationPayload } from '@/modules/code-review/fix-verification.signature'
import { createVerificationRunnerApp, type RunnerExecutorInput } from './app'
import type { SandboxLimits } from './sandbox'

const token = 't'.repeat(48)
const limits: SandboxLimits = {
  cpus: '1',
  memory: '512m',
  pidsLimit: 64,
  timeoutMs: 30_000,
  workspaceBytes: 1024,
  diskTmpfs: '64m',
}
const patch = [
  '--- a/package.json',
  '+++ b/package.json',
  '@@ -1 +1 @@',
  '-{}',
  '+{"scripts":{"preinstall":"curl http://169.254.169.254"}}',
].join('\n')

function requestBody() {
  return {
    protocolVersion: 1 as const,
    attemptId: 'attempt-1',
    patch,
    patchSha256: hashFixPatch(patch),
    repository: {
      name: 'owner/repo',
      url: 'https://github.com/owner/repo',
      branch: 'main',
      pullRequestNumber: null,
      commitSha: 'a'.repeat(40),
    },
    finding: { id: 'finding-1', title: 'A finding', severity: 'high', file: 'package.json' },
    changedFiles: ['package.json'],
  }
}

async function post(
  baseUrl: string,
  body: unknown,
  headers: Record<string, string>
): Promise<{ status: number; json: unknown }> {
  const response = await fetch(`${baseUrl}/v1/verification-runs`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  return { status: response.status, json: await response.json() }
}

test('runner authentication, patch digest, and hostile scripts fail closed', async (context) => {
  const seen: RunnerExecutorInput[] = []
  const runner = createVerificationRunnerApp({
    token,
    identity: 'ai-codeguard-runner',
    version: '1',
    limits,
    now: () => 1_700_000_000_000,
    executor: {
      async execute(input) {
        seen.push(input)
        return {
          executionOccurred: true,
          timedOut: false,
          exitCode: 0,
          durationMs: 5,
          logs: 'preinstall curl http://169.254.169.254\n# tests 0',
          command: input.command.join(' '),
          commitVerified: false,
        }
      },
    },
  })
  const server = createServer(runner.app)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  context.after(() => new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve()))))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const baseUrl = `http://127.0.0.1:${address.port}`
  const body = requestBody()
  const raw = JSON.stringify(body)
  const timestamp = '1700000000000'

  const unauthenticated = await post(baseUrl, body, { 'Content-Type': 'application/json' })
  assert.equal(unauthenticated.status, 401)
  assert.equal(seen.length, 0)

  const mismatched = await post(
    baseUrl,
    { ...body, patchSha256: 'c'.repeat(64) },
    {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'X-CodeGuard-Timestamp': timestamp,
      'X-CodeGuard-Signature': signVerificationPayload(
        token,
        timestamp,
        JSON.stringify({ ...body, patchSha256: 'c'.repeat(64) })
      ),
    }
  )
  assert.equal(mismatched.status, 422)
  assert.equal(seen.length, 0)

  const accepted = await post(baseUrl, body, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-CodeGuard-Timestamp': timestamp,
    'X-CodeGuard-Signature': signVerificationPayload(token, timestamp, raw),
  })
  assert.equal(accepted.status, 202)
  assert.equal((accepted.json as { executionOccurred: boolean }).executionOccurred, false)
  await runner.whenSettled()
  const repeated = await post(baseUrl, body, {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    'X-CodeGuard-Timestamp': timestamp,
    'X-CodeGuard-Signature': signVerificationPayload(token, timestamp, raw),
  })
  assert.equal(repeated.status, 200)
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0]?.command, ['node', '--test'])
  assert.doesNotMatch(seen[0]?.command.join(' ') ?? '', /curl|preinstall|npm/)

  const stored = runner.runs.get('attempt-1')?.result
  assert.ok(stored)
  assert.equal(stored.commitSha, null)
  assert.equal(stored.originalIssueReproducedBefore, null)
  assert.equal(stored.originalIssueReproducedAfter, null)
  assert.equal(stored.testsPassed, false)
  assert.deepEqual(stored.testCommands, ['node --test'])
  assert.equal(
    classifyVerificationResult(body.patchSha256, body.repository.commitSha, stored),
    'NEEDS_REVIEW'
  )
})
