import assert from 'node:assert/strict'
import test from 'node:test'
import type { Request, Response } from 'express'
import {
  classifyVerificationResult,
  createFixProposalSchema,
  hashFixPatch,
  sanitizeVerificationLogs,
  validateFixPatch,
  getChangedFilesFromPatch,
  type VerificationExecutionResult,
} from './fix-verification.domain'
import {
  VerificationRunnerTimeoutError,
} from './fix-verification.runner'
import {
  FixProposalNotFoundError,
  FixProposalService,
  FixVerificationAttemptNotFoundError,
  FixVerificationEvidenceService,
  FixVerificationReviewConflictError,
  FixVerificationRevisionConflictError,
  FixVerificationService,
  type FixProposalRecord,
  type FixVerificationDashboard,
  type FixVerificationEvidenceStore,
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
    status: 'NEEDS_REVIEW',
    executionStatus: 'BLOCKED',
    testCommands: [],
    checkResults: [],
    testsPassed: null,
    originalIssueReproducedBefore: null,
    originalIssueReproducedAfter: null,
    repositoryName: 'owner/repo',
    repositoryUrl: 'https://github.com/owner/repo',
    branch: 'main',
    pullRequestNumber: 12,
    commitSha: 'a'.repeat(40),
    findingTitle: 'A finding',
    findingSeverity: 'high',
    findingFile: 'src/index.ts',
    changedFiles: ['src/index.ts'],
    executionDurationMs: 0,
    exitCode: null,
    failureDetails: null,
    humanReviewDecision: null,
    humanReviewNote: null,
    humanReviewedAt: null,
    humanReviewerId: null,
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

test('records paths for added, changed, renamed, and deleted files', () => {
  const patchWithFileOperations = [
    '--- a/src/changed.ts',
    '+++ b/src/changed.ts',
    '--- a/src/renamed-old.ts',
    '+++ b/src/renamed-new.ts',
    '--- a/src/deleted.ts',
    '+++ /dev/null',
    '--- /dev/null',
    '+++ b/src/added.ts',
  ].join('\n')

  assert.deepEqual(getChangedFilesFromPatch(patchWithFileOperations), [
    'src/changed.ts',
    'src/renamed-old.ts',
    'src/renamed-new.ts',
    'src/deleted.ts',
    'src/added.ts',
  ])
})

test('requires complete passing check evidence and issue-specific reproduction for verification', () => {
  const base: VerificationExecutionResult = {
    attemptId: 'attempt-1',
    patchSha256,
    commitSha: 'a'.repeat(40),
    executionStatus: 'SUCCEEDED',
    testCommands: ['npm test -- --runInBand'],
    testsPassed: true,
    originalIssueReproducedBefore: true,
    originalIssueReproducedAfter: false,
    sanitizedLogs: 'ok',
    checkResults: [
      {
        name: 'TEST',
        command: 'npm test',
        status: 'PASSED',
        exitCode: 0,
        durationMs: 120,
        failureDetails: null,
        logs: 'ok',
      },
    ],
  }

  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, { ...base, testsPassed: false }),
    'FAILED'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, {
      ...base,
      executionStatus: 'TIMED_OUT',
    }),
    'NEEDS_REVIEW'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, {
      ...base,
      originalIssueReproducedAfter: true,
    }),
    'FAILED'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, {
      ...base,
      originalIssueReproducedBefore: null,
    }),
    'NEEDS_REVIEW'
  )
  assert.equal(classifyVerificationResult(patchSha256, base.commitSha, base), 'VERIFIED')
  assert.equal(
    classifyVerificationResult('different-patch-digest', base.commitSha, base),
    'NEEDS_REVIEW'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, { ...base, checkResults: [] }),
    'NEEDS_REVIEW'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, {
      ...base,
      checkResults: [
        {
          ...base.checkResults![0]!,
          name: 'TYPECHECK',
        },
      ],
    }),
    'NEEDS_REVIEW'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, { ...base, testCommands: [] }),
    'NEEDS_REVIEW'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, {
      ...base,
      checkResults: base.checkResults?.map((check) => ({ ...check, exitCode: 1 })),
    }),
    'FAILED'
  )
  assert.equal(
    classifyVerificationResult(patchSha256, base.commitSha, {
      ...base,
      checkResults: base.checkResults?.map((check) => ({ ...check, status: 'FAILED' as const })),
    }),
    'FAILED'
  )
  assert.equal(classifyVerificationResult(patchSha256, 'b'.repeat(40), base), 'NEEDS_REVIEW')
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
  let currentCommitSha = 'a'.repeat(40)
  const attempts = new Map<string, FixProposalRecord['attempts'][number]>()
  const stored: FixProposalRecord['attempts'][number][] = []
  const store: TrustedVerificationStore = {
    async findOwnedProposal(userId, proposalId) {
      return allowed && userId === 'owner-1' && proposalId === 'proposal-1'
        ? {
            id: proposalId,
            findingId: 'finding-1',
            patchSha256,
            patch,
            findingTitle: 'A finding',
            findingSeverity: 'high',
            findingFile: 'src/index.ts',
            repositoryName: 'owner/repo',
            repositoryUrl: 'https://github.com/owner/repo',
            branch: 'feature',
            pullRequestNumber: 12,
            commitSha: currentCommitSha,
          }
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
        ...input.snapshot,
        status: 'RUNNING' as const,
        executionStatus: 'BLOCKED' as const,
        testCommands: [],
        checkResults: [],
        testsPassed: null,
        originalIssueReproducedBefore: null,
        originalIssueReproducedAfter: null,
        executionDurationMs: 0,
        exitCode: null,
        failureDetails: null,
        humanReviewDecision: null,
        humanReviewNote: null,
        humanReviewedAt: null,
        humanReviewerId: null,
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
        checkResults: input.checkResults,
        executionDurationMs: input.executionDurationMs,
        exitCode: input.exitCode,
        failureDetails: input.failureDetails,
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
    attemptId: 'attempt-1',
    patchSha256,
    commitSha: 'a'.repeat(40),
    executionStatus: 'FAILED',
    testCommands: ['npm test'],
    checkResults: [
      {
        name: 'TEST',
        command: 'npm test',
        status: 'PASSED',
        exitCode: 0,
        durationMs: 120,
        failureDetails: null,
        logs: 'ok',
      },
    ],
    testsPassed: false,
    originalIssueReproducedBefore: true,
    originalIssueReproducedAfter: true,
    sanitizedLogs: 'test failed',
  }
  const runner = {
    responseAttemptId: null as string | null,
    async execute(input: {
      attemptId: string
      repository: { commitSha: string | null }
    }) {
      runnerCalls += 1
      return {
        ...currentResult,
        attemptId: this.responseAttemptId ?? input.attemptId,
        commitSha: input.repository.commitSha,
      }
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

  currentResult = {
    ...currentResult,
    executionStatus: 'TIMED_OUT',
    testsPassed: false,
    originalIssueReproducedAfter: null,
  }
  const timedOut = await service.verifyProposal('owner-1', 'proposal-1', 'attempt-timeout')
  assert.equal(timedOut.status, 'NEEDS_REVIEW')
  assert.equal(timedOut.executionStatus, 'TIMED_OUT')

  currentResult = {
    ...currentResult,
    executionStatus: 'SUCCEEDED',
    testsPassed: true,
    originalIssueReproducedBefore: null,
    originalIssueReproducedAfter: false,
  }
  const inconclusive = await service.verifyProposal('owner-1', 'proposal-1', 'attempt-uncertain')
  assert.equal(inconclusive.status, 'NEEDS_REVIEW')

  currentResult = {
    ...currentResult,
    originalIssueReproducedBefore: true,
    originalIssueReproducedAfter: false,
    sanitizedLogs: 'ghp_123456789012345678901234',
  }
  const verified = await service.verifyProposal('owner-1', 'proposal-1', 'attempt-verified')
  assert.equal(verified.status, 'VERIFIED')
  assert.equal(verified.patchSha256, patchSha256)
  assert.equal(verified.commitSha, 'a'.repeat(40))
  assert.deepEqual(verified.changedFiles, ['src/index.ts'])
  assert.equal(verified.sanitizedLogs, '[REDACTED]')
  assert.equal(
    (await service.verifyProposal('owner-1', 'proposal-1', 'attempt-verified')).id,
    verified.id
  )
  assert.equal(runnerCalls, 4)
  assert.equal(stored.length, 4)

  currentCommitSha = 'b'.repeat(40)
  await assert.rejects(
    service.verifyProposal('owner-1', 'proposal-1', 'attempt-verified'),
    FixVerificationRevisionConflictError
  )
  assert.equal(runnerCalls, 4)
  const updatedRevision = await service.verifyProposal(
    'owner-1',
    'proposal-1',
    'attempt-updated-commit'
  )
  assert.equal(updatedRevision.commitSha, 'b'.repeat(40))
  assert.notEqual(updatedRevision.id, verified.id)
  assert.equal(runnerCalls, 5)

  runner.responseAttemptId = 'different-attempt'
  const mismatchedAttempt = await service.verifyProposal(
    'owner-1',
    'proposal-1',
    'attempt-mismatched-response'
  )
  assert.equal(mismatchedAttempt.status, 'NEEDS_REVIEW')
  runner.responseAttemptId = null

  const timeoutService = new FixVerificationService(
    store,
    {
      async execute() {
        throw new VerificationRunnerTimeoutError()
      },
    },
    () => now
  )
  const timeoutAttempt = await timeoutService.verifyProposal(
    'owner-1',
    'proposal-1',
    'attempt-runner-timeout'
  )
  assert.equal(timeoutAttempt.status, 'NEEDS_REVIEW')
  assert.equal(timeoutAttempt.executionStatus, 'TIMED_OUT')
  assert.match(timeoutAttempt.failureDetails ?? '', /configured timeout/)
})

test('without a sandbox, verification persists NEEDS_REVIEW without executing commands', async () => {
  const attempts: FixProposalRecord['attempts'][number][] = []
  const store: TrustedVerificationStore = {
    async findOwnedProposal() {
      return {
        id: 'proposal-1',
        findingId: 'finding-1',
        patchSha256,
        patch,
        findingTitle: 'A finding',
        findingSeverity: 'high',
        findingFile: 'src/index.ts',
        repositoryName: 'owner/repo',
        repositoryUrl: 'https://github.com/owner/repo',
        branch: 'main',
        pullRequestNumber: null,
        commitSha: 'a'.repeat(40),
      }
    },
    async findAttempt(_proposalId, key) {
      return attempts.find((attempt) => attempt.requestKey === key) ?? null
    },
    async createAttempt(input) {
      const attempt = {
        id: 'attempt-1',
        requestKey: input.requestKey,
        patchSha256: input.patchSha256,
        ...input.snapshot,
        status: 'RUNNING' as const,
        executionStatus: 'BLOCKED' as const,
        testCommands: [],
        checkResults: [],
        testsPassed: null,
        originalIssueReproducedBefore: null,
        originalIssueReproducedAfter: null,
        executionDurationMs: 0,
        exitCode: null,
        failureDetails: null,
        humanReviewDecision: null,
        humanReviewNote: null,
        humanReviewedAt: null,
        humanReviewerId: null,
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
        checkResults: input.checkResults,
        executionDurationMs: input.executionDurationMs,
        exitCode: input.exitCode,
        failureDetails: input.failureDetails,
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

  assert.equal(result.status, 'NEEDS_REVIEW')
  assert.equal(result.executionStatus, 'BLOCKED')
  assert.deepEqual(result.testCommands, [])
  assert.equal(
    result.failureDetails,
    'No isolated verification runner is configured; no repository code was executed.'
  )
  assert.match(result.sanitizedLogs ?? '', /patch was not executed/)
})

test('verification history is owner-scoped and human decisions never rewrite execution status', async () => {
  const timestamp = new Date('2026-10-30T12:00:00.000Z')
  let saved: FixProposalRecord['attempts'][number] = {
    id: 'attempt-1',
    requestKey: 'request-1',
    patchSha256,
    status: 'NEEDS_REVIEW',
    executionStatus: 'BLOCKED',
    testCommands: [],
    checkResults: [],
    testsPassed: null,
    originalIssueReproducedBefore: null,
    originalIssueReproducedAfter: null,
    repositoryName: 'owner/repo',
    repositoryUrl: 'https://github.com/owner/repo',
    branch: 'main',
    pullRequestNumber: 12,
    commitSha: 'a'.repeat(40),
    findingTitle: 'A finding',
    findingSeverity: 'high',
    findingFile: 'src/index.ts',
    changedFiles: ['src/index.ts'],
    executionDurationMs: 0,
    exitCode: null,
    failureDetails: 'No sandbox configured.',
    humanReviewDecision: null,
    humanReviewNote: null,
    humanReviewedAt: null,
    humanReviewerId: null,
    startedAt: timestamp,
    completedAt: timestamp,
    sanitizedLogs: 'Not executed.',
    createdAt: timestamp,
  }
  const dashboard: FixVerificationDashboard = {
    total: 1,
    verified: 0,
    failed: 0,
    needsReview: 1,
    repositories: [{ id: 'repo-1', name: 'owner/repo' }],
    runs: [],
  }
  let filtersReceived: unknown
  const store: FixVerificationEvidenceStore = {
    async listOwned(userId, filters) {
      if (userId !== 'owner-1') {
        return { total: 0, verified: 0, failed: 0, needsReview: 0, repositories: [], runs: [] }
      }
      filtersReceived = filters
      return dashboard
    },
    async findOwnedAttempt(userId, attemptId) {
      return userId === 'owner-1' && attemptId === saved.id ? saved : null
    },
    async recordHumanDecision(input) {
      if (input.userId !== 'owner-1' || input.attemptId !== saved.id) {
        throw new FixVerificationAttemptNotFoundError()
      }
      if (saved.status === 'RUNNING' || saved.humanReviewedAt) {
        throw new FixVerificationReviewConflictError()
      }
      saved = {
        ...saved,
        humanReviewDecision: input.decision,
        humanReviewNote: input.note,
        humanReviewedAt: input.reviewedAt,
        humanReviewerId: input.userId,
      }
      return saved
    },
  }
  const service = new FixVerificationEvidenceService(store, () => timestamp)
  const filtered = await service.list('owner-1', {
    status: 'NEEDS_REVIEW',
    repositoryId: 'repo-1',
    from: timestamp.toISOString(),
    to: timestamp.toISOString(),
  })
  assert.equal(filtered.needsReview, 1)
  assert.deepEqual(filtersReceived, {
    status: 'NEEDS_REVIEW',
    repositoryId: 'repo-1',
    from: timestamp.toISOString(),
    to: timestamp.toISOString(),
  })

  await assert.rejects(service.get('other-user', 'attempt-1'), FixVerificationAttemptNotFoundError)
  await assert.rejects(
    service.list('owner-1', { status: 'INCONCLUSIVE' }),
    /Invalid verification filters/
  )

  const reviewed = await service.review('owner-1', 'attempt-1', {
    decision: 'APPROVE',
    note: 'Execution is unavailable; approval is not proof of verification.',
  })
  assert.equal(reviewed.humanReviewDecision, 'APPROVE')
  assert.equal(reviewed.humanReviewerId, 'owner-1')
  assert.equal(reviewed.status, 'NEEDS_REVIEW')
  await assert.rejects(
    service.review('owner-1', 'attempt-1', { decision: 'REJECT' }),
    FixVerificationReviewConflictError
  )
})
