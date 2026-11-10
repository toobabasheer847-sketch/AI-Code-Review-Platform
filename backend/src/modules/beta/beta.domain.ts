export const productEventNames = [
  'REGISTRATION',
  'WORKSPACE_CREATED',
  'REPOSITORY_CONNECTED',
  'REVIEW_STARTED',
  'REVIEW_COMPLETED',
  'REPO_CHAT',
  'FEEDBACK_SUBMITTED',
] as const

export type ProductEventName = (typeof productEventNames)[number]

export const feedbackCategories = ['BUG', 'FEATURE', 'GENERAL', 'REVIEW_QUALITY'] as const
export type FeedbackCategory = (typeof feedbackCategories)[number]

export const feedbackStatuses = ['OPEN', 'TRIAGED', 'PLANNED', 'CLOSED'] as const
export type FeedbackStatus = (typeof feedbackStatuses)[number]

export const betaStatuses = ['ACTIVE', 'PENDING', 'REVOKED'] as const
export type BetaStatus = (typeof betaStatuses)[number]

export const betaLimitations = [
  'This beta can change or reset. Do not rely on it for production customer data.',
  'Do not paste secrets, credentials, or private source code into feedback.',
  'Detailed finding feedback stays on the review page. This form records product feedback only.',
  'Review chat currently follows your personal workspace.',
  'AI spend is not capped by a general budget in this beta.',
] as const

const secretPattern = /postgres(?:ql)?:\/\/|rediss?:\/\/|\bBearer\s+\S|\b(?:sk|rk)_(?:test|live)_/i

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase()
}

export function parseEmailList(value: string | undefined): string[] {
  if (!value) return []
  return [...new Set(value.split(',').map(normalizeEmail).filter((email) => email.includes('@')))]
}

export function betaAllowlist(source = process.env.BETA_ALLOWLIST): string[] {
  return parseEmailList(source)
}

export function betaAdminEmails(source = process.env.BETA_ADMIN_EMAILS): string[] {
  return parseEmailList(source)
}

export function resolveBetaStatus(email: string, allowlist: string[]): BetaStatus {
  if (allowlist.length === 0) return 'ACTIVE'
  return allowlist.includes(normalizeEmail(email)) ? 'ACTIVE' : 'PENDING'
}

export function isBetaAdmin(email: string | undefined, admins: string[]): boolean {
  if (!email || admins.length === 0) return false
  return admins.includes(normalizeEmail(email))
}

export interface FeedbackDraft {
  category: FeedbackCategory
  subject: string
  body: string
  rating?: number | null
  reviewId?: string | null
}

export function parseFeedbackDraft(input: unknown): FeedbackDraft {
  if (!input || typeof input !== 'object') throw new Error('Feedback is invalid')
  const record = input as Record<string, unknown>
  const category = record.category
  if (typeof category !== 'string' || !feedbackCategories.includes(category as FeedbackCategory)) {
    throw new Error('Feedback category is invalid')
  }
  const subject = typeof record.subject === 'string' ? record.subject.trim() : ''
  const body = typeof record.body === 'string' ? record.body.trim() : ''
  if (subject.length < 3 || subject.length > 120) throw new Error('Subject must be between 3 and 120 characters')
  if (body.length < 1 || body.length > 2000) throw new Error('Feedback must be between 1 and 2000 characters')
  if (secretPattern.test(`${subject}\n${body}`)) {
    throw new Error('Remove secrets or connection strings before submitting feedback')
  }
  const reviewId = typeof record.reviewId === 'string' && record.reviewId.trim() ? record.reviewId.trim() : null
  if (reviewId && !/^[A-Za-z0-9_-]{8,64}$/.test(reviewId)) throw new Error('Review reference is invalid')
  let rating: number | null = null
  if (category === 'REVIEW_QUALITY') {
    if (typeof record.rating !== 'number' || !Number.isInteger(record.rating) || record.rating < 1 || record.rating > 5) {
      throw new Error('Review quality feedback requires a rating from 1 to 5')
    }
    rating = record.rating
  }
  return { category: category as FeedbackCategory, subject, body, rating, reviewId }
}

export function parseFeedbackStatus(value: unknown): FeedbackStatus {
  if (typeof value === 'string' && feedbackStatuses.includes(value as FeedbackStatus)) {
    return value as FeedbackStatus
  }
  throw new Error('Feedback status is invalid')
}

export function onboardingSteps(input: {
  workspaceCount: number
  githubConnected: boolean
  reviewCount: number
}): Array<{ id: string; label: string; href: string; complete: boolean }> {
  return [
    {
      id: 'workspace',
      label: 'Create a workspace for the team you want to review with',
      href: '/workspaces',
      complete: input.workspaceCount > 0,
    },
    {
      id: 'github',
      label: 'Connect the GitHub account that can read the repository',
      href: '/github/repos',
      complete: input.githubConnected,
    },
    {
      id: 'review',
      label: 'Run one AI code review and read the findings before sharing them',
      href: '/reviews',
      complete: input.reviewCount > 0,
    },
  ]
}
