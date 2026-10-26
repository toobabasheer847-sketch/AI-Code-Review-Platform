import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request, Response } from 'express'
import {
  classifyVerificationResult,
  createFixProposalSchema,
  hashFixPatch,
  sanitizeVerificationLogs,
  validateFixPatch,
  type VerificationExecutionResult,
} from './fix-verification.domain'
import {
  FixProposalNotFoundError,
  FixProposalService,
  FixVerificationService,
  type FixProposalRecord,
  type FixProposalStore,
  type TrustedVerificationStore,
} from './fix-verification.service'
import { ReviewController } from './review.controller'

const patch = [
  'diff --git a/src/index.ts b/src/index.ts',
  '--- a/src/index.ts',
  '+++ b/src/index.ts',
  '@@ -1 +1 @@',
  '-old()',
  '+new()',
].join('\n')
const patchSha256 = hashFixPatch(patch)

function createControllerResponse() {
  let statusCode = 200
  let body: unknown
  const response = {
    status(code: number) {
      statusCode = code
      return response
    },
    json(value: unknown) {
      body = value
      return response
    },
  }
  return {
    response: response as unknown as Response,
    get statusCode() {
      return statusCode
    },
    get body() {
      return body
    },
  }
}

test('fix verification endpoint validates authentication and forwards the request key', async () => {
  const calls: Array<[string, string, string]> = []
  const attempt: FixProposalRecord['attempts'][number] = {
    id: 'attempt-1',
    requestKey: 'request-1',
    patchSha256,
    status: 'INCONCLUSIVE',
    executionStatus: 'BLOCKED',
    testCommands: [],
    testsPassed: null,
    originalIssueReproducedBefore: null,
    originalIssueReproducedAfter: null,
    startedAt: new Date('2026-10-22T12:00:00.000Z'),
    completedAt: new Date('2026-10-22T12:00:00.000Z'),
    sanitizedLogs: 'No isolated verification runner is configured.',
    createdAt: new Date('2026-10-22T12:00:00.000Z'),
  }
  const controller = new ReviewController({
    async verifyProposal(userId, proposalId, requestKey) {
      calls.push([userId, proposalId, requestKey])
      return attempt
    },
  })

  const unauthorized = createControllerResponse()
  await controller.verifyFixProposal(
    { params: { proposalId: 'proposal-1' }, body: { requestKey: 'request-1' } } as Request,
    unauthorized.response
  )
  assert.equal(unauthorized.statusCode, 401)

  const invalid = createControllerResponse()
  await controller.verifyFixProposal(
    {
      user: { userId: 'owner-1' },
      params: { proposalId: 'proposal-1' },
      body: { requestKey: 'bad key' },
    } as Request,
    invalid.response
  )
  assert.equal(invalid.statusCode, 400)
  assert.equal(calls.length, 0)

  const successful = createControllerResponse()
  await controller.verifyFixProposal(
    {
      user: { userId: 'owner-1' },
      params: { proposalId: 'proposal-1' },
      body: { requestKey: 'request-1' },
    } as Request,
    successful.response
  )
  assert.equal(successful.statusCode, 200)
  assert.deepEqual(calls, [['owner-1', 'proposal-1', 'request-1']])
  assert.deepEqual(successful.body, { attempt })
})

test('validates a bounded unified diff and rejects path traversal and binary input', () => {
  assert.equal(createFixProposalSchema.safeParse({ patch }).success, true)
  assert.equal(createFixProposalSchema.safeParse({ patch: 'x'.repeat(100_001) }).success, false)
  assert.throws(
    () => validateFixPatch(patch.replace('--- a/src/index.ts', '--- a/../secret')),
    /unsafe file path/
  )
  assert.throws(() => validateFixPatch(`${patch}\0binary`), /binary data/)
  assert.throws(() => validateFixPatch('not a unified diff'), /unified diff/)
  assert.equal(createFixProposalSchema.safeParse({ patch, trusted: true }).success, false)
})

test('classifies failed, timed-out, inconclusive, and issue-specific verified results', () => {
  const base: VerificationExecutionResult = {
    patchSha256,
    executionStatus: 'SUCCEEDED',
    testCommands: ['npm test -- --runInBand'],
    testsPassed: true,
    originalIssueReproducedBefore: true,
    originalIssueReproducedAfter: false,
    sanitizedLogs: 'ok',
  }

  assert.equal(classifyVerificationResult(patchSha256, { ...base, testsPassed: false }), 'FAILED')
  assert.equal(
    classifyVerificationResult(patchSha256, { ...base, executionStatus: 'TIMED_OUT' }),
    'INCONCLUSIVE'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, { ...base, originalIssueReproducedAfter: true }),
    'FAILED'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, {
      ...base,
      originalIssueReproducedBefore: null,
    }),
    'INCONCLUSIVE'
  )
  assert.equal(classifyVerificationResult(patchSha256, base), 'VERIFIED')
  assert.equal(
    classifyVerificationResult('different-patch-digest', base),
    'INCONCLUSIVE'
  )
})

test('sanitizes terminal controls and common credential formats from logs', () => {
  assert.equal(
    sanitizeVerificationLogs('\u001b[31mfailed\u001b[0m ghp_123456789012345678901234 [x]'),
    'failed [REDACTED] [x]'
  )
})

test('proposal creation is owner-scoped and deduplicates the exact patch digest', async () => {
  let findingOwned = true
  let saved: FixProposalRecord | null = null
  const store: FixProposalStore = {
    async findOwnedFinding() {
      return findingOwned ? { id: 'finding-1' } : null
    },
    async findProposal(_findingId, digest) {
      return saved?.patchSha256 === digest ? saved : null
    },
    async createProposal(input) {
      saved = {
        id: 'proposal-1',
        ...input,
        createdAt: new Date('2026-10-22T12:00:00.000Z'),
        attempts: [],
      }
      return saved
    },
  }
  const service = new FixProposalService(store)

  const created = await service.createProposal('owner-1', 'finding-1', { patch })
  assert.equal(created.patchSha256, patchSha256)
  assert.equal((await service.createProposal('owner-1', 'finding-1', { patch })).id, created.id)
  assert.equal(saved?.patch, patch)

  findingOwned = false
  await assert.rejects(
    service.createProposal('other-user', 'finding-1', { patch }),
    FixProposalNotFoundError
  )
})

test('verification is owner-scoped, retry-safe, and persists isolated-runner outcomes', async () => {
  const allowed = true
  let runnerCalls = 0
  const attempts = new Map<string, FixProposalRecord['attempts'][number]>()
  const stored: FixProposalRecord['attempts'][number][] = []
  const store: TrustedVerificationStore = {
    async findOwnedProposal(userId, proposalId) {
      return allowed && userId === 'owner-1' && proposalId === 'proposal-1'
        ? { id: proposalId, findingId: 'finding-1', patchSha256 }
        : null
    },
    async findAttempt(proposalId, requestKey) {
      return attempts.get(`${proposalId}:${requestKey}`) ?? null
    },
    async createAttempt(input) {
      const attempt = {
        id: `attempt-${stored.length + 1}`,
        requestKey: input.requestKey,
        patchSha256: input.patchSha256,
        status: 'RUNNING' as const,
        executionStatus: 'BLOCKED' as const,
        testCommands: [],
        testsPassed: null,
        originalIssueReproducedBefore: null,
        originalIssueReproducedAfter: null,
        startedAt: input.startedAt,
        completedAt: null,
        sanitizedLogs: null,
        createdAt: input.startedAt,
      }
      attempts.set(`${input.proposalId}:${input.requestKey}`, attempt)
      return attempt
    },
    async completeAttempt(input) {
      const previous = [...attempts.values()].find((attempt) => attempt.id === input.id)
      assert.ok(previous)
      const completed = {
        ...previous,
        status: input.status,
        executionStatus: input.executionStatus,
        testCommands: input.testCommands,
        testsPassed: input.testsPassed,
        originalIssueReproducedBefore: input.originalIssueReproducedBefore,
        originalIssueReproducedAfter: input.originalIssueReproducedAfter,
        completedAt: input.completedAt,
        sanitizedLogs: input.sanitizedLogs,
      }
      for (const [key, attempt] of attempts) {
        if (attempt.id === input.id) attempts.set(key, completed)
      }
      stored.push(completed)
      return completed
    },
  }
  let currentResult: VerificationExecutionResult = {
    patchSha256,
    executionStatus: 'FAILED',
    testCommands: ['npm test'],
    testsPassed: false,
    originalIssueReproducedBefore: true,
    originalIssueReproducedAfter: true,
    sanitizedLogs: 'test failed',
  }
  const runner = {
    async execute() {
      runnerCalls += 1
      return currentResult
    },
  }
  const now = new Date('2026-10-22T12:00:00.000Z')
  const service = new FixVerificationService(store, runner, () => now)

  await assert.rejects(
    service.verifyProposal('other-user', 'proposal-1', 'unauthorized'),
    FixProposalNotFoundError
  )
  assert.equal(runnerCalls, 0)

  const failed = await service.verifyProposal('owner-1', 'proposal-1', 'attempt-failed')
  assert.equal(failed.status, 'FAILED')
  assert.equal(failed.executionStatus, 'FAILED')
  assert.deepEqual(failed.testCommands, ['npm test'])
  assert.equal(failed.completedAt?.toISOString(), now.toISOString())

  currentResult = { ...currentResult, executionStatus: 'TIMED_OUT', testsPassed: false }
  const timedOut = await service.verifyProposal('owner-1', 'proposal-1', 'attempt-timeout')
  assert.equal(timedOut.status, 'INCONCLUSIVE')
  assert.equal(timedOut.executionStatus, 'TIMED_OUT')

  currentResult = {
    ...currentResult,
    executionStatus: 'SUCCEEDED',
    testsPassed: true,
    originalIssueReproducedBefore: null,
    originalIssueReproducedAfter: false,
  }
  const inconclusive = await service.verifyProposal('owner-1', 'proposal-1', 'attempt-uncertain')
  assert.equal(inconclusive.status, 'INCONCLUSIVE')

  currentResult = {
    ...currentResult,
    originalIssueReproducedBefore: true,
    originalIssueReproducedAfter: false,
    sanitizedLogs: 'ghp_123456789012345678901234',
  }
  const verified = await service.verifyProposal('owner-1', 'proposal-1', 'attempt-verified')
  assert.equal(verified.status, 'VERIFIED')
  assert.equal(verified.patchSha256, patchSha256)
  assert.equal(verified.sanitizedLogs, '[REDACTED]')
  assert.equal((await service.verifyProposal('owner-1', 'proposal-1', 'attempt-verified')).id, verified.id)
  assert.equal(runnerCalls, 4)
  assert.equal(stored.length, 4)
})

test('without a sandbox, verification persists INCONCLUSIVE without executing commands', async () => {
  const attempts: FixProposalRecord['attempts'][number][] = []
  const store: TrustedVerificationStore = {
    async findOwnedProposal() {
      return { id: 'proposal-1', findingId: 'finding-1', patchSha256 }
    },
    async findAttempt(_proposalId, key) {
      return attempts.find((attempt) => attempt.requestKey === key) ?? null
    },
    async createAttempt(input) {
      const attempt = {
        id: 'attempt-1',
        requestKey: input.requestKey,
        patchSha256: input.patchSha256,
        status: 'RUNNING' as const,
        executionStatus: 'BLOCKED' as const,
        testCommands: [],
        testsPassed: null,
        originalIssueReproducedBefore: null,
        originalIssueReproducedAfter: null,
        startedAt: input.startedAt,
        completedAt: null,
        sanitizedLogs: null,
        createdAt: input.startedAt,
      }
      attempts.push(attempt)
      return attempt
    },
    async completeAttempt(input) {
      const attempt = {
        ...attempts[0]!,
        status: input.status,
        executionStatus: input.executionStatus,
        testCommands: input.testCommands,
        testsPassed: input.testsPassed,
        originalIssueReproducedBefore: input.originalIssueReproducedBefore,
        originalIssueReproducedAfter: input.originalIssueReproducedAfter,
        completedAt: input.completedAt,
        sanitizedLogs: input.sanitizedLogs,
      }
      attempts[0] = attempt
      return attempt
    },
  }
  const result = await new FixVerificationService(store).verifyProposal(
    'owner-1',
    'proposal-1',
    'no-runner'
  )

  assert.equal(result.status, 'INCONCLUSIVE')
  assert.equal(result.executionStatus, 'BLOCKED')
  assert.deepEqual(result.testCommands, [])
  assert.match(result.sanitizedLogs ?? '', /patch was not executed/)
})
