import { z } from 'zod'

export const sendMessageSchema = z.object({
  reviewId: z.string().min(1, 'Review ID is required'),
  message: z.string().min(1, 'Message is required').max(2000, 'Message is too long'),
})
