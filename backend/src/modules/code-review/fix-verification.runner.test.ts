import assert from 'node:assert/strict'
import test from 'node:test'
import type { VerificationExecutionResult } from './fix-verification.domain'
import {
  RemoteFixVerificationRunner,
  VerificationRunnerTimeoutError,
  VerificationRunnerUnavailableError,
  type VerificationRunnerHttpClient,
} from './fix-verification.runner'
import { verifyVerificationSignature } from './fix-verification.signature'

const passedResult: VerificationExecutionResult = {
  attemptId: 'attempt-1',
  patchSha256: 'a'.repeat(64),
  commitSha: 'b'.repeat(40),
  executionStatus: 'SUCCEEDED',
  testCommands: ['npm test'],
  testsPassed: true,
  originalIssueReproducedBefore: true,
  originalIssueReproducedAfter: false,
  sanitizedLogs: 'All checks passed.',
  checkResults: [
    {
      name: 'TEST',
      command: 'npm test',
      status: 'PASSED',
      exitCode: 0,
      durationMs: 125,
      failureDetails: null,
      logs: 'Tests passed.',
    },
  ],
}

const runnerInput = {
  attemptId: 'attempt-1',
  proposalId: 'proposal-1',
  patch: 'unified diff',
  patchSha256: passedResult.patchSha256,
  repository: {
    name: 'owner/repo',
    url: 'https://github.com/owner/repo',
    branch: 'main',
    pullRequestNumber: 12,
    commitSha: passedResult.commitSha,
  },
  finding: {
    id: 'finding-1',
    title: 'A finding',
    severity: 'high',
    file: 'src/index.ts',
  },
  changedFiles: ['src/index.ts'],
}

test('sends an idempotent, bounded request to the configured isolated runner', async () => {
  let request:
    | {
        url: string
        data: Parameters<VerificationRunnerHttpClient['post']>[1]
        config: Parameters<VerificationRunnerHttpClient['post']>[2]
      }
    | undefined
  const client: VerificationRunnerHttpClient = {
    async post(url, data, config) {
      request = { url, data, config }
      return { data: passedResult }
    },
  }
  const runner = new RemoteFixVerificationRunner(
    'r'.repeat(48),
    60_000,
    'https://runner.example.test/api',
    client
  )

  assert.deepEqual(await runner.execute(runnerInput), passedResult)
  assert.ok(request)
  assert.equal(request.url, 'https://runner.example.test/api/v1/verification-runs')
  assert.equal(request.data.protocolVersion, 1)
  assert.equal(request.data.attemptId, runnerInput.attemptId)
  assert.equal(request.data.repository.commitSha, passedResult.commitSha)
  assert.equal(request.data.patchSha256, passedResult.patchSha256)
  assert.equal('token' in request.data, false)
  assert.equal(request.config.timeout, 60_000)
  assert.equal(request.config.maxRedirects, 0)
  assert.equal(request.config.maxBodyLength, 150_000)
  assert.equal(request.config.maxContentLength, 128_000)
  const headers = Object.fromEntries(
    Object.entries(request.config.headers ?? {}).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ])
  )
  assert.equal(headers.authorization, `Bearer ${'r'.repeat(48)}`)
  assert.equal(headers['idempotency-key'], runnerInput.attemptId)
  assert.equal(
    verifyVerificationSignature({
      secret: 'r'.repeat(48),
      timestamp: String(headers['x-codeguard-timestamp']),
      signature: String(headers['x-codeguard-signature']),
      body: JSON.stringify(request.data),
      now: Number(headers['x-codeguard-timestamp']),
    }),
    true
  )
})

test('rejects malformed or incomplete evidence from the isolated runner', async () => {
  const runner = new RemoteFixVerificationRunner(
    'r'.repeat(48),
    60_000,
    'https://runner.example.test',
    {
      async post() {
        return { data: { ...passedResult, checkResults: undefined } }
      },
    }
  )

  await assert.rejects(
    runner.execute(runnerInput),
    VerificationRunnerUnavailableError
  )
})

test('classifies runner timeouts without exposing remote error details', async () => {
  class HttpTimeoutError extends Error {
    readonly isAxiosError = true
    readonly code = 'ECONNABORTED'
  }
  const runner = new RemoteFixVerificationRunner(
    'r'.repeat(48),
    1_000,
    'https://runner.example.test',
    {
      async post() {
        throw new HttpTimeoutError('remote response included a sensitive message')
      },
    }
  )

  await assert.rejects(runner.execute(runnerInput), VerificationRunnerTimeoutError)
})

test('does not expose runner response or transport errors', async () => {
  const runner = new RemoteFixVerificationRunner(
    'r'.repeat(48),
    1_000,
    'https://runner.example.test',
    {
      async post() {
        throw new Error('remote response included a sensitive message')
      },
    }
  )

  await assert.rejects(runner.execute(runnerInput), (error: unknown) => {
    assert.ok(error instanceof VerificationRunnerUnavailableError)
    assert.doesNotMatch(error.message, /sensitive/)
    return true
  })
})
