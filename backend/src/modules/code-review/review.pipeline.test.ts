import assert from 'node:assert/strict'
import test from 'node:test'
import { validateAnalysis, type ReviewAnalysis } from './analyzer'
import {
  processReview,
  type ReviewJobRecord,
  type ReviewJobStore,
} from './review.pipeline'
import {
  parseReviewRepositoryName,
  selectReviewTreeFiles,
  type GitHubTreeItem,
  validateReviewBranchName,
} from '@/modules/github/github.service'

const sourceFiles = [
  { path: 'src/app.ts', content: 'const value = 1\nreturn value' },
  { path: 'src/lib.ts', content: 'export const ready = true' },
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
        severity: 'error',
        category: 'security',
        message: 'Validate the value before returning it.',
        suggestions: ['Validate the input.'],
      },
      {
        file: 'src/lib.ts',
        line: 1,
        severity: 'warning',
        category: 'performance',
        message: 'Consider avoiding repeated work.',
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

  assert.throws(
    () =>
      validateAnalysis(
        {
          summary: 'Invalid location.',
          findings: [
            {
              file: 'src/missing.ts',
              line: 1,
              severity: 'warning',
              category: 'bug',
              message: 'Not in this review.',
              suggestions: [],
            },
          ],
        },
        sourceFiles
      ),
    /invalid finding location/
  )
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

test('marks the review failed and propagates analysis errors', async () => {
  const events: string[] = []
  await assert.rejects(
    processReview(review.id, {
      store: createStore(events),
      async fetchFiles() {
        throw new Error('GitHub request failed')
      },
      async analyze() {
        return analysis
      },
      async notify() {
        assert.fail('Failed review must not notify')
      },
    }),
    /GitHub request failed/
  )

  assert.deepEqual(events, ['load', 'running', 'failed:GitHub request failed'])
})
