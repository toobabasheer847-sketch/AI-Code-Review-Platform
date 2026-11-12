import { axiosInstance } from '@/lib/axios'

export const findingStatuses = [
  'UNREVIEWED',
  'CONFIRMED',
  'FALSE_POSITIVE',
  'DUPLICATE',
  'FIXED',
  'WONT_FIX',
] as const

export type FindingStatus = (typeof findingStatuses)[number]

export interface FindingFeedback {
  id: string
  previousStatus: FindingStatus
  status: FindingStatus
  reason: string | null
  createdAt: string
  user: { fullName: string }
}

export const findingFeedbackCategories = [
  'TRUE_POSITIVE',
  'FALSE_POSITIVE',
  'ALREADY_FIXED',
  'NEEDS_REVIEW',
] as const

export type FindingFeedbackCategory = (typeof findingFeedbackCategories)[number]

export interface FindingAssessmentFeedback {
  id: string
  findingId: string
  userId: string
  repositoryId: string
  requestKey: string
  category: FindingFeedbackCategory
  explanation: string | null
  createdAt: string
  user: { fullName: string }
}

export interface FixVerificationAttempt {
  id: string
  patchSha256: string
  status: 'RUNNING' | 'VERIFIED' | 'FAILED' | 'NEEDS_REVIEW'
  executionStatus: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED'
  testCommands: string[]
  checkResults: Array<{
    name: 'TEST' | 'TYPECHECK' | 'LINT'
    command: string
    status: 'PASSED' | 'FAILED' | 'TIMED_OUT' | 'NOT_RUN'
    exitCode: number | null
    durationMs: number
    failureDetails: string | null
    logs: string
  }>
  testsPassed: boolean | null
  originalIssueReproducedBefore: boolean | null
  originalIssueReproducedAfter: boolean | null
  repositoryName: string
  repositoryUrl: string
  branch: string
  pullRequestNumber: number | null
  commitSha: string | null
  findingTitle: string
  findingSeverity: string
  findingFile: string
  changedFiles: string[]
  executionDurationMs: number
  exitCode: number | null
  failureDetails: string | null
  humanReviewDecision: 'APPROVE' | 'REJECT' | 'NEEDS_MORE_EVIDENCE' | null
  humanReviewNote: string | null
  humanReviewedAt: string | null
  startedAt: string
  completedAt: string | null
  sanitizedLogs: string | null
  jobState?:
    | 'QUEUED'
    | 'RUNNING'
    | 'PASSED'
    | 'FAILED'
    | 'TIMED_OUT'
    | 'CANCELLED'
    | 'NEEDS_REVIEW'
  executionOccurred?: boolean
  runnerIdentity?: string | null
  runnerVersion?: string | null
}

export interface FixVerificationDashboardRun extends FixVerificationAttempt {
  reviewId: string
  findingId: string
  repositoryId: string
}

export interface FixVerificationDashboard {
  total: number
  verified: number
  failed: number
  needsReview: number
  repositories: Array<{ id: string; name: string }>
  runs: FixVerificationDashboardRun[]
}

export interface FixProposal {
  id: string
  patch: string
  patchSha256: string
  createdAt: string
  attempts: FixVerificationAttempt[]
}

export type FindingVerificationStatus =
  | 'AI_REPORTED'
  | 'VERIFIED'
  | 'VERIFICATION_FAILED'
  | 'INCONCLUSIVE'

export interface FindingVerificationRecord {
  id: string
  requestKey: string
  status: FindingVerificationStatus
  method: string
  resultSummary: string
  sourceRevision: string | null
  diagnosticSummary: string | null
  executionOccurred: boolean
  toolIdentity: string | null
  exitCode: number | null
  durationMs: number
  startedAt: string
  completedAt: string
  createdAt: string
}

export interface ReviewSummary {
  id: string
  repository: string
  score: number | null
  issues: number
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  source?: 'MANUAL' | 'PULL_REQUEST'
  pullRequestNumber?: number | null
  createdAt: string
}

export interface ReviewChatMessage {
  id: string
  role: 'USER' | 'ASSISTANT'
  content: string
  createdAt: string
}

export interface ReviewChat {
  id: string
  title: string
  messages: ReviewChatMessage[]
}

export interface TestSuggestion {
  name: string
  code: string
  explanation: string
  expectedBenefit: string
  behaviorChanging: boolean
}

export interface TestSuggestionResult {
  framework: 'node:test via tsx' | 'vitest'
  suggestions: TestSuggestion[]
  duplicateCount: number
  previewOnly: true
}

export interface ReviewDetail {
  id: string
  repository: { name: string; url: string }
  title?: string
  description?: string
  fileContent?: string
  findings: Array<{
    id: string
    file: string
    line: number
    endLine?: number | null
    title?: string | null
    message: string
    impact?: string | null
    evidence?: string | null
    severity: string
    category?: string
    suggestions: string[]
    confidence?: number | null
    riskLevel?: string | null
    disposition?: string | null
    issueClass?: string | null
    remediationExample?: string | null
    status: FindingStatus
    independentlyVerifiedAt: string | null
    verificationRecords: FindingVerificationRecord[]
    feedback: FindingFeedback[]
    assessmentFeedback: FindingAssessmentFeedback[]
    fixProposals: FixProposal[]
  }>
  findingLifecycleAnalytics: {
    total: number
    statusCounts: Record<FindingStatus, number>
    developerMarkedFixed: number
    independentlyVerifiedFixed: number
  }
  analytics?: { totalIssues?: number; qualityScore?: number }
  chat?: ReviewChat | null
  status: 'pending' | 'running' | 'completed' | 'failed' | string
  branch: string
  errorMessage?: string | null
  source?: 'MANUAL' | 'PULL_REQUEST'
  pullRequestNumber?: number | null
  pullRequestUrl?: string | null
  sourceRevision?: string | null
  pullRequestStatus?: string | null
  reviewLimitations?: string[]
  createdAt: string
}

export const reviewApi = {
  list: async (): Promise<ReviewSummary[]> => {
    const res = await axiosInstance.get<ReviewSummary[]>('/reviews')
    return res.data
  },

  submitFindingFeedback: async (
    findingId: string,
    input: {
      requestKey: string
      category: FindingFeedbackCategory
      explanation?: string
    }
  ): Promise<{ feedback: FindingAssessmentFeedback }> => {
    const res = await axiosInstance.post<{ feedback: FindingAssessmentFeedback }>(
      `/reviews/findings/${findingId}/feedback`,
      input
    )
    return res.data
  },

  get: async (id: string): Promise<ReviewDetail> => {
    const res = await axiosInstance.get<ReviewDetail>(`/reviews/${id}`)
    return res.data
  },
  start: async (repository: string, branch = 'main'): Promise<{ reviewId: string }> => {
    const res = await axiosInstance.post<{ reviewId: string }>('/reviews/start', { repository, branch })
    return res.data
  },

  generateTestSuggestions: async (
    reviewId: string,
    findingId: string
  ): Promise<{ result: TestSuggestionResult }> => {
    const res = await axiosInstance.post<{ result: TestSuggestionResult }>(
      `/reviews/${reviewId}/findings/${findingId}/test-suggestions`
    )
    return res.data
  },

  updateFindingStatus: async (
    findingId: string,
    input: { status: FindingStatus; reason?: string }
  ): Promise<{ feedback: FindingFeedback }> => {
    const res = await axiosInstance.patch<{ feedback: FindingFeedback }>(
      `/reviews/findings/${findingId}/status`,
      input
    )
    return res.data
  },

  createFixProposal: async (
    findingId: string,
    patch: string
  ): Promise<{ proposal: FixProposal }> => {
    const res = await axiosInstance.post<{ proposal: FixProposal }>(
      `/reviews/findings/${findingId}/fix-proposals`,
      { patch }
    )
    return res.data
  },

  verifyFixProposal: async (
    proposalId: string,
    input: { requestKey: string }
  ): Promise<{ attempt: FixVerificationAttempt }> => {
    const res = await axiosInstance.post<{ attempt: FixVerificationAttempt }>(
      `/reviews/fix-proposals/${proposalId}/verification-attempts`,
      input
    )
    return res.data
  },

  cancelFixVerification: async (
    attemptId: string
  ): Promise<{ attempt: FixVerificationAttempt }> => {
    const res = await axiosInstance.post<{ attempt: FixVerificationAttempt }>(
      `/reviews/fix-verification-attempts/${attemptId}/cancel`
    )
    return res.data
  },

  listFixVerifications: async (filters?: {
    status?: FixVerificationAttempt['status']
    repositoryId?: string
    from?: string
    to?: string
  }): Promise<FixVerificationDashboard> => {
    const res = await axiosInstance.get<FixVerificationDashboard>(
      '/reviews/fix-verification-attempts',
      { params: filters }
    )
    return res.data
  },

  getFixVerificationEvidence: async (
    attemptId: string
  ): Promise<{ attempt: FixVerificationAttempt }> => {
    const res = await axiosInstance.get<{ attempt: FixVerificationAttempt }>(
      `/reviews/fix-verification-attempts/${attemptId}`
    )
    return res.data
  },

  submitFixVerificationReview: async (
    attemptId: string,
    input: {
      decision: 'APPROVE' | 'REJECT' | 'NEEDS_MORE_EVIDENCE'
      note?: string
    }
  ): Promise<{ attempt: FixVerificationAttempt }> => {
    const res = await axiosInstance.post<{ attempt: FixVerificationAttempt }>(
      `/reviews/fix-verification-attempts/${attemptId}/review-decision`,
      input
    )
    return res.data
  },

  requestFindingVerification: async (
    findingId: string,
    input: { requestKey: string; method: 'STATIC_ANALYSIS' | 'TARGETED_TEST' }
  ): Promise<{ verification: FindingVerificationRecord }> => {
    const res = await axiosInstance.post<{ verification: FindingVerificationRecord }>(
      `/reviews/findings/${findingId}/verification-requests`,
      input
    )
    return res.data
  },

  getFindingVerification: async (
    findingId: string,
    requestKey: string
  ): Promise<{ verification: FindingVerificationRecord }> => {
    const res = await axiosInstance.get<{ verification: FindingVerificationRecord }>(
      `/reviews/findings/${findingId}/verification-requests/${encodeURIComponent(requestKey)}`
    )
    return res.data
  },

  getFeedbackAnalytics: async (filters: {
    repositoryId: string
    from?: string
    to?: string
  }): Promise<FeedbackAnalytics> => {
    const res = await axiosInstance.get<FeedbackAnalytics>('/reviews/feedback-analytics', {
      params: filters,
    })
    return res.data
  },
}

export interface FeedbackAssessmentCounts {
  truePositive: number
  falsePositive: number
  alreadyFixed: number
  needsReview: number
  unassessed: number
  total?: number
  key?: string
}

export interface FeedbackRates {
  denominator: 'userAssessedFindings'
  sampleSize: number
  minimumSampleSize: number
  truePositive: number
  falsePositive: number
  alreadyFixed: number
  needsReview: number
}

export interface FeedbackAnalytics {
  filters: { from: string | null; to: string | null; repositoryId: string | null }
  distinctions: {
    userAssessments: string
    objectiveVerification: string
    unassessedFindings: string
    verificationFailure: string
    verifiedFix: string
    duplicateCandidates: string
  }
  findings: {
    total: number
    userAssessedTruePositives: number
    userAssessedFalsePositives: number
    alreadyFixed: number
    needsReview: number
    unassessed: number
  }
  rates: FeedbackRates | null
  ratesWithheldReason: string | null
  objectiveVerification: {
    verified: number
    verificationFailed: number
    inconclusive: number
    aiReportedOnly: number
    independentlyVerifiedFixes: number
    unreviewedAiFindingsAreConfirmed: false
  }
  distributionBySeverity: Array<FeedbackAssessmentCounts & { key: string; total: number }>
  distributionByCategory: Array<FeedbackAssessmentCounts & { key: string; total: number }>
  trends: {
    basis: 'assessment_events'
    note: string
    points: Array<{
      date: string
      truePositive: number
      falsePositive: number
      alreadyFixed: number
      needsReview: number
    }>
  }
  reviewTrends: Array<{
    reviewId: string
    createdAt: string
    qualityScore: number | null
    totalFindings: number
    userAssessedTruePositives: number
    userAssessedFalsePositives: number
    alreadyFixed: number
    needsReview: number
    unassessed: number
    objectivelyVerified: number
    rates: FeedbackRates | null
    ratesWithheldReason: string | null
  }>
  repositoryTrend: {
    reviewCount: number
    scoredReviewCount: number
    qualityScoreAverage: number | null
    qualityScoreAverageWithheldReason: string | null
    totalFindings: number
    rates: FeedbackRates | null
    ratesWithheldReason: string | null
  }
  duplicateCandidates: Array<{
    findingId: string
    reviewId: string
    matchedFindingId: string
    matchedReviewId: string
    category: string
    file: string
    line: number
    priorUserAssessment: string | null
    reason: string
    suppressed: false
    requiresHumanReview: true
  }>
  ruleSuggestions: Array<{ category: string; message: string; autoApplied: false }>
}
