export const betaLimitations = [
  'This beta can change or reset. Do not rely on it for production customer data.',
  'Do not paste secrets, credentials, or private source code into feedback.',
  'Detailed finding feedback stays on the review page. This form records product feedback only.',
  'Review chat currently follows your personal workspace.',
  'AI spend is not capped by a general budget in this beta.',
] as const

export const feedbackCategories = [
  { id: 'BUG', label: 'Bug report' },
  { id: 'FEATURE', label: 'Feature request' },
  { id: 'GENERAL', label: 'General feedback' },
  { id: 'REVIEW_QUALITY', label: 'AI review quality' },
] as const

export type FeedbackCategory = (typeof feedbackCategories)[number]['id']

export interface FeedbackDraft {
  category: FeedbackCategory
  subject: string
  body: string
  rating?: number
  reviewId?: string
}

export function validateFeedbackDraft(input: FeedbackDraft): string | null {
  const subject = input.subject.trim()
  const body = input.body.trim()
  if (subject.length < 3 || subject.length > 120) return 'Subject must be between 3 and 120 characters.'
  if (body.length < 1 || body.length > 2000) return 'Feedback must be between 1 and 2000 characters.'
  if (/postgres(?:ql)?:\/\/|rediss?:\/\/|\bBearer\s+\S|\b(?:sk|rk)_(?:test|live)_/i.test(`${subject}\n${body}`)) {
    return 'Remove secrets or connection strings before submitting feedback.'
  }
  if (input.category === 'REVIEW_QUALITY' && (!input.rating || input.rating < 1 || input.rating > 5)) {
    return 'Review quality feedback requires a rating from 1 to 5.'
  }
  return null
}

export function visibleOnboardingSteps<T extends { complete: boolean }>(
  steps: T[],
  dismissed: boolean
): T[] {
  if (dismissed) return []
  return steps
}
