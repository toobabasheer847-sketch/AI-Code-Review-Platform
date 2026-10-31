import { z } from 'zod'

export const findingFeedbackCategories = [
  'TRUE_POSITIVE',
  'FALSE_POSITIVE',
  'ALREADY_FIXED',
  'NEEDS_REVIEW',
] as const

export type FindingFeedbackCategoryValue = (typeof findingFeedbackCategories)[number]

export const submitFindingFeedbackSchema = z
  .object({
    requestKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/),
    category: z.enum(findingFeedbackCategories),
    explanation: z.string().trim().max(1_000).optional(),
  })
  .strict()
  .transform(({ requestKey, category, explanation }) => ({
    requestKey,
    category,
    explanation: explanation || null,
  }))

export interface FindingFeedbackAssessment {
  id: string
  findingId: string
  userId: string
  repositoryId: string
  requestKey: string
  category: FindingFeedbackCategoryValue
  explanation: string | null
  createdAt: Date
  user: { fullName: string }
}
