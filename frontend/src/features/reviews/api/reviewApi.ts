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

export interface FixVerificationAttempt {
  id: string
  patchSha256: string
  status: 'RUNNING' | 'VERIFIED' | 'FAILED' | 'INCONCLUSIVE'
  executionStatus: 'NOT_RUN' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'BLOCKED'
  testCommands: string[]
  testsPassed: boolean | null
  originalIssueReproducedBefore: boolean | null
  originalIssueReproducedAfter: boolean | null
  startedAt: string
  completedAt: string | null
  sanitizedLogs: string | null
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
    status: FindingStatus
    independentlyVerifiedAt: string | null
    verificationRecords: FindingVerificationRecord[]
    feedback: FindingFeedback[]
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

  get: async (id: string): Promise<ReviewDetail> => {
    const res = await axiosInstance.get<ReviewDetail>(`/reviews/${id}`)
    return res.data
  },
  start: async (repository: string, branch = 'main'): Promise<{ reviewId: string }> => {
    const res = await axiosInstance.post<{ reviewId: string }>('/reviews/start', { repository, branch })
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
}
