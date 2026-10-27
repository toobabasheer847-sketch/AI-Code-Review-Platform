import { z } from 'zod'

export const sendMessageSchema = z.object({
  reviewId: z.string().min(1, 'Review ID is required'),
  message: z.string().min(1, 'Message is required').max(2000, 'Message is too long'),
})

export const repositoryQuestionSchema = z
  .object({
    repository: z
      .string()
      .min(3)
      .max(300)
      .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
      .refine(
        (repository) => repository.split('/').every((part) => part !== '.' && part !== '..'),
        'Repository owner and name must be valid.'
      ),
    branch: z.string().min(1).max(255).default('main'),
    question: z.string().trim().min(1).max(2000),
  })
  .strict()
