import assert from 'node:assert/strict'
import test from 'node:test'
import type { Prisma } from '@prisma/client'
import {
  ReviewProviderError,
  validateAnalysis,
  type ReviewAnalysis,
} from './analyzer'
import {
  processReview,
  type ReviewJobRecord,
  type ReviewJobStore,
} from './review.pipeline'
import { ReviewService } from './review.service'
import type { ReviewAccessStore } from './review.service'
import { authMiddleware } from '@/middleware/auth.middleware'
import {
  persistReviewAnalysis,
  resolveReviewSourceRevision,
  type ReviewPersistenceOperations,
} from './review.persistence'
import {
  InvalidReviewTargetError,
  parseReviewRepositoryName,
  selectReviewTreeFiles,
  type GitHubTreeItem,
  validateReviewBranchName,
} from '@/modules/github/github.service'

const sourceFiles = [
  { path: 'src/app.ts', content: 'const value = 1\nreturn value', sourceRevision: 'a'.repeat(40) },
  { path: 'src/lib.ts', content: 'export const ready = true', sourceRevision: 'a'.repeat(40) },
]

const review: ReviewJobRecord = {
  id: 'review-1',
  userId: 'user-1',
  branch: 'feature/review',
  status: 'pending',
  repository: { name: 'owner/repository' },
  user: { email: 'owner@example.com' },
}

const analysis: ReviewAnalysis = validateAnalysis(
  {
    summary: 'Two actionable findings were identified.',
    findings: [
      {
        file: 'src/app.ts',
        line: 2,
        title: 'Unvalidated value is returned',
        severity: 'error',
        category: 'security',
        message: 'Validate the value before returning it.',
        impact: 'Returning the unvalidated value can expose invalid data to callers.',
        evidence: 'return value',
        suggestions: ['Validate the input.'],
      },
      {
        file: 'src/lib.ts',
        line: 1,
        title: 'Potential repeated work',
        severity: 'warning',
        category: 'performance',
        message: 'Consider avoiding repeated work.',
        impact: 'Repeated work can increase processing cost for large inputs.',
        evidence: 'export const ready = true',
        suggestions: [],
      },
    ],
  },
  sourceFiles
)

function createStore(events: string[]): ReviewJobStore {
  return {
    async findForProcessing() {
      events.push('load')
      return review
    },
    async markRunning() {
      events.push('running')
    },
    async complete() {
      events.push('completed')
    },
    async markFailed(_reviewId, message) {
      events.push(`failed:${message}`)
    },
  }
}

test('validates AI findings against selected files and computes analytics', () => {
  assert.deepEqual(analysis.analytics, {
    totalIssues: 2,
    bugs: 0,
    securityIssues: 1,
    performanceIssues: 1,
    qualityScore: 72,
  })
  assert.throws(
    () =>
      validateAnalysis(
        {
          summary: 'Invalid location.',
          findings: [
            {
              file: 'src/missing.ts',
              line: 1,
              title: 'Missing source finding',
              severity: 'warning',
              category: 'bug',
              message: 'Not in this review.',
              impact: 'Unsupported impact.',
              evidence: 'unsupported',
              suggestions: [],
            },
          ],
        },
        sourceFiles
      ),
    /invalid finding location/
  )
})

test('requires one immutable commit revision for every retrieved source file', () => {
  assert.equal(resolveReviewSourceRevision(sourceFiles), 'a'.repeat(40))
  assert.throws(
    () => resolveReviewSourceRevision([{ path: 'src/file.ts', content: 'source' }]),
    /do not share a valid source revision/
  )
  assert.throws(
    () =>
      resolveReviewSourceRevision([
        sourceFiles[0],
        { ...sourceFiles[1], sourceRevision: 'b'.repeat(40) },
      ]),
    /do not share a valid source revision/
  )
})

test('selects supported review files within file-count and byte limits', () => {
  const tree: GitHubTreeItem[] = [
    { path: 'src/too-large.ts', type: 'blob', size: 20_001, sha: 'large' },
    { path: 'src/image.png', type: 'blob', size: 100, sha: 'image' },
    ...Array.from({ length: 21 }, (_, index) => ({
      path: `src/file-${index}.ts`,
      type: 'blob',
      size: 5_000,
      sha: `sha-${index}`,
    })),
  ]

  const selected = selectReviewTreeFiles(tree)
  assert.equal(selected.length, 20)
  assert.ok(selected.every((file) => file.size !== undefined && file.size <= 20_000))
  assert.ok(selected.every((file) => file.path.endsWith('.ts')))

  const totalLimitSelection = selectReviewTreeFiles(
    Array.from({ length: 10 }, (_, index) => ({
      path: `src/large-${index}.ts`,
      type: 'blob',
      size: 18_000,
      sha: `total-${index}`,
    }))
  )
  assert.equal(totalLimitSelection.length, 5)
})

test('validates repository identifiers and Git branch names before GitHub access', () => {
  assert.deepEqual(parseReviewRepositoryName('owner/repository'), ['owner', 'repository'])
  assert.throws(() => parseReviewRepositoryName('owner/repository/extra'), /valid owner\/repository/)
  assert.doesNotThrow(() => validateReviewBranchName('feature/review-pipeline'))
  assert.throws(() => validateReviewBranchName('feature/../main'), /Branch name is invalid/)
  assert.throws(() => validateReviewBranchName('feature/.hidden'), /Branch name is invalid/)
  assert.throws(() => validateReviewBranchName('invalid branch'), /Branch name is invalid/)
})

test('persists findings, analytics, review content, and completion in one transaction', async () => {
  const calls: string[] = []
  let savedFindings: unknown
  let savedAnalytics: unknown
  let savedReview: unknown
  const operations: ReviewPersistenceOperations = {
    async deleteFindings(reviewId) {
      calls.push(`delete:${reviewId}`)
    },
    async createFindings(findings, sourceRevision) {
      savedFindings = findings
      assert.equal(sourceRevision, 'a'.repeat(40))
      calls.push('findings')
    },
    async upsertAnalytics(userId, reviewId, analytics) {
      savedAnalytics = {
        where: { reviewId },
        create: { userId, reviewId, ...analytics },
        update: analytics,
      }
      calls.push('analytics')
    },
    async completeReview(
      reviewId,
      summary,
      fileContent,
      sourceRevision,
      _changedLines,
      limitations
    ) {
      savedReview = {
        where: { id: reviewId },
        data: {
          status: 'completed',
          errorMessage: null,
          description: summary,
          fileContent,
          sourceRevision,
          reviewLimitations: limitations,
        },
      }
      calls.push('review')
    },
  }

  await persistReviewAnalysis(operations, review, analysis, sourceFiles)

  assert.deepEqual(calls, ['delete:review-1', 'findings', 'analytics', 'review'])
  assert.equal((savedFindings as Array<{ reviewId: string }>).length, 2)
  assert.ok((savedFindings as Array<{ reviewId: string }>).every((finding) => finding.reviewId === review.id))
  assert.equal(
    (savedFindings as Array<{ title: string }>)[0].title,
    analysis.findings[0].title
  )
  assert.equal(
    (savedFindings as Array<{ evidence: string }>)[0].evidence,
    analysis.findings[0].evidence
  )
  const initialVerification = (
    savedFindings as Array<{
      verificationRecords: {
        create: {
          requestKey: string
          status: string
          method: string
          resultSummary: string
          sourceRevision: string
          startedAt: Date
          completedAt: Date
        }
      }
    }>
  )[0].verificationRecords.create
  assert.equal(initialVerification.requestKey, 'ai-review:review-1')
  assert.equal(initialVerification.status, 'AI_REPORTED')
  assert.equal(initialVerification.method, 'AI_REVIEW')
  assert.equal(initialVerification.sourceRevision, 'a'.repeat(40))
  assert.match(initialVerification.resultSummary, /not independently verified/)
  assert.ok(initialVerification.startedAt instanceof Date)
  assert.equal(initialVerification.completedAt, initialVerification.startedAt)
  assert.deepEqual(savedAnalytics, {
    where: { reviewId: review.id },
    create: { userId: review.userId, reviewId: review.id, ...analysis.analytics },
    update: analysis.analytics,
  })
  assert.deepEqual(savedReview, {
    where: { id: review.id },
    data: {
      status: 'completed',
      errorMessage: null,
      description: analysis.summary,
      fileContent: sourceFiles
        .map((file) => `--- ${file.path} ---\n${file.content}`)
        .join('\n\n'),
      sourceRevision: 'a'.repeat(40),
      reviewLimitations: [],
    },
  })
})

test('processes a review through running, analysis, persistence, and notification', async () => {
  const events: string[] = []
  let suppliedFiles: typeof sourceFiles = []

  await processReview(review.id, {
    store: createStore(events),
    async fetchFiles(userId, repository, branch) {
      assert.equal(userId, review.userId)
      assert.equal(repository, review.repository.name)
      assert.equal(branch, review.branch)
      events.push('fetch')
      return sourceFiles
    },
    async analyze(files) {
      suppliedFiles = files
      events.push('analyze')
      return analysis
    },
    async notify(completedReview, result) {
      assert.equal(completedReview.id, review.id)
      assert.equal(result?.analytics.totalIssues, 2)
      events.push('notify')
    },
  })

  assert.deepEqual(suppliedFiles, sourceFiles)
  assert.deepEqual(events, [
    'load',
    'running',
    'fetch',
    'analyze',
    'completed',
    'notify',
  ])
})

test('does not analyze a pull request when retrieved source is from a stale revision', async () => {
  const events: string[] = []
  let analysisCalls = 0
  const store: ReviewJobStore = {
    ...createStore(events),
    async findForProcessing() {
      return { ...review, source: 'PULL_REQUEST', headSha: 'b'.repeat(40) }
    },
  }

  await assert.rejects(
    processReview(review.id, {
      store,
      async fetchFiles() {
        return sourceFiles
      },
      async analyze() {
        analysisCalls += 1
        return analysis
      },
      async notify() {
        assert.fail('Stale source must not notify')
      },
    }),
    /Review processing failed/
  )

  assert.equal(analysisCalls, 0)
  assert.ok(events.some((event) => event.startsWith('failed:')))
})

test('does not rerun analysis when retrying a completed review notification', async () => {
  const events: string[] = []
  let status = 'pending'
  let analysisCalls = 0
  let failNotificationOnce = true
  const store: ReviewJobStore = {
    ...createStore(events),
    async findForProcessing() {
      return {
        ...review,
        status,
        description: analysis.summary,
        analytics: {
          qualityScore: analysis.analytics.qualityScore,
          totalIssues: analysis.analytics.totalIssues,
        },
      }
    },
    async complete() {
      status = 'completed'
      events.push('completed')
    },
  }
  const dependencies = {
    store,
    async fetchFiles() {
      events.push('fetch')
      return sourceFiles
    },
    async analyze() {
      analysisCalls += 1
      return analysis
    },
    async notify(completedReview, completedAnalysis) {
      if (failNotificationOnce) {
        failNotificationOnce = false
        throw new Error('Notification queue is unavailable')
      }
      assert.equal(completedReview.analytics?.qualityScore, 72)
      assert.equal(completedAnalysis, undefined)
      events.push('notify')
    },
  }

  await assert.rejects(processReview(review.id, dependencies), /Notification queue is unavailable/)
  await processReview(review.id, dependencies)

  assert.equal(analysisCalls, 1)
  assert.deepEqual(events, ['running', 'fetch', 'completed', 'notify'])
})

test('marks review failures without persisting provider or repository error details', async () => {
  const events: string[] = []
  await assert.rejects(
    processReview(review.id, {
      store: createStore(events),
      async fetchFiles() {
        throw new Error('Authorization: Bearer private-provider-secret')
      },
      async analyze() {
        return analysis
      },
      async notify() {
        assert.fail('Failed review must not notify')
      },
    }),
    /Review processing failed/
  )

  assert.deepEqual(events, [
    'load',
    'running',
    'failed:Review processing failed. Provider and repository details were omitted.',
  ])
  assert.equal(events.join(' ').includes('private-provider-secret'), false)
})

test('stores a safe provider failure classification instead of reporting success', async () => {
  const events: string[] = []
  await assert.rejects(
    processReview(review.id, {
      store: createStore(events),
      async fetchFiles() {
        return sourceFiles
      },
      async analyze() {
        throw new ReviewProviderError('rate_limited')
      },
      async notify() {
        assert.fail('Failed review must not notify')
      },
    }),
    /Review processing failed/
  )

  assert.ok(
    events.includes(
      'failed:The AI provider rate limit was reached. Retry the review later.'
    )
  )
})

test('rejects requests missing valid bearer tokens', () => {
  const response = {
    status(code: number) {
      this.statusCode = code
      return this
    },
    json(body: unknown) {
      this.body = body
      return this
    },
  }

  authMiddleware({ headers: {} } as any, response as any, () => assert.fail('next should not be called'))
  assert.equal(response.statusCode, 401)

  authMiddleware(
    { headers: { authorization: 'Bearer invalid-token' } } as any,
    response as any,
    () => assert.fail('next should not be called')
  )
  assert.equal(response.statusCode, 401)
})

test('scopes review reads and deletes to the authenticated user', async () => {
  let readCount = 0
  let deleteCount = 0
  const reviewAccess: ReviewAccessStore = {
    async findOwnedReview(userId, reviewId) {
      assert.deepEqual({ id: reviewId, userId }, { id: review.id, userId: 'user-2' })
      readCount += 1
      return null
    },
    async deleteOwnedReview(userId, reviewId) {
      assert.deepEqual({ id: reviewId, userId }, { id: review.id, userId: 'user-2' })
      deleteCount += 1
      return 0
    },
  }
  const service = new ReviewService({ reviewAccess })

  await assert.rejects(() => service.getReview('user-2', review.id), /Review not found/)
  await assert.rejects(() => service.deleteReview('user-2', review.id), /Review not found/)
  assert.equal(readCount, 1)
  assert.equal(deleteCount, 1)
})

test('returns persisted findings for an owned review', async () => {
  type ReviewWithRelations = Prisma.CodeReviewGetPayload<{
    include: {
      repository: true
      findings: {
        include: {
          verificationRecords: {
            orderBy: [{ startedAt: 'asc' }, { id: 'asc' }]
          }
          feedback: {
            include: { user: { select: { fullName: true } } }
            orderBy: { createdAt: 'asc' }
          }
        }
      }
      analytics: true
      chatConversation: {
        include: { messages: { orderBy: { createdAt: 'asc' } } }
      }
    }
  }>
  const createdAt = new Date()
  const persistedReview: ReviewWithRelations = {
    id: review.id,
    userId: review.userId,
    repositoryId: 'repository-1',
    title: 'Review',
    description: analysis.summary,
    fileContent: '--- src/app.ts ---\nconst value = 1\nreturn value',
    branch: review.branch,
    errorMessage: null,
    severity: 'medium',
    source: 'MANUAL',
    pullRequestNumber: null,
    pullRequestUrl: null,
    headSha: null,
    sourceRevision: 'a'.repeat(40),
    changedLines: null,
    reviewLimitations: [],
    status: 'completed',
    createdAt,
    updatedAt: createdAt,
    repository: {
      id: 'repository-1',
      userId: review.userId,
      name: review.repository.name,
      url: 'https://github.com/owner/repository',
      language: 'TypeScript',
      description: null,
      isPrivate: false,
      createdAt,
      updatedAt: createdAt,
    },
    findings: [
      {
        id: 'finding-1',
        reviewId: review.id,
        file: analysis.findings[0].file,
        line: analysis.findings[0].line,
        endLine: analysis.findings[0].endLine ?? null,
        title: analysis.findings[0].title,
        severity: analysis.findings[0].severity,
        category: analysis.findings[0].category,
        message: analysis.findings[0].message,
        evidence: analysis.findings[0].evidence,
        suggestions: analysis.findings[0].suggestions,
        status: 'FIXED',
        independentlyVerifiedAt: new Date('2026-10-20T10:00:00.000Z'),
        verificationRecords: [
          {
            id: 'verification-1',
            findingId: 'finding-1',
            requestKey: 'ai-review:review-1',
            status: 'AI_REPORTED',
            method: 'AI_REVIEW',
            resultSummary:
              'AI-reported finding. Its cited evidence matched the retrieved source; the issue itself was not independently verified.',
            sourceRevision: 'a'.repeat(40),
            diagnosticSummary: null,
            executionOccurred: false,
            toolIdentity: null,
            exitCode: null,
            durationMs: 0,
            startedAt: createdAt,
            completedAt: createdAt,
            createdAt,
          },
        ],
        createdAt,
        feedback: [
          {
            id: 'feedback-1',
            findingId: 'finding-1',
            userId: review.userId,
            previousStatus: 'CONFIRMED',
            status: 'FIXED',
            reason: 'Patched the issue.',
            createdAt,
            user: { fullName: 'Code Reviewer' },
          },
        ],
      },
    ],
    analytics: null,
    chatConversation: null,
    webhookDeliveries: [],
  }
  const service = new ReviewService({
    reviewAccess: {
      async findOwnedReview(userId, reviewId) {
        assert.deepEqual({ userId, reviewId }, { userId: review.userId, reviewId: review.id })
        return persistedReview
      },
      async deleteOwnedReview() {
        return 0
      },
    },
  })
  const result = await service.getReview(review.userId, review.id)

  assert.deepEqual(result.findings, persistedReview.findings)
  assert.equal(result.findings[0]?.feedback[0]?.reason, 'Patched the issue.')
  assert.equal(result.findings[0]?.verificationRecords[0]?.status, 'AI_REPORTED')
  assert.equal(result.sourceRevision, 'a'.repeat(40))
  assert.deepEqual(result.findingLifecycleAnalytics, {
    total: 1,
    statusCounts: {
      UNREVIEWED: 0,
      CONFIRMED: 0,
      FALSE_POSITIVE: 0,
      DUPLICATE: 0,
      FIXED: 1,
      WONT_FIX: 0,
    },
    developerMarkedFixed: 1,
    independentlyVerifiedFixed: 1,
  })
  assert.equal(result.status, 'completed')
})

test('rejects invalid and unauthorized review targets before persistence or queueing', async () => {
  const service = new ReviewService({
    githubService: {
      async validateReviewTarget(userId, repository, branch) {
        assert.equal(userId, 'user-2')
        assert.equal(repository, 'owner/repository')
        assert.equal(branch, 'main')
        throw new InvalidReviewTargetError('Repository access denied')
      },
    },
  })

  await assert.rejects(
    () => service.startReview('user-2', 'owner/repository', 'main'),
    /Repository access denied/
  )
  await assert.rejects(
    () => new ReviewService().startReview('user-2', '../repository', 'main'),
    /valid owner\/repository/
  )
})
