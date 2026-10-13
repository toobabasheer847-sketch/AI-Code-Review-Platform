import { z } from 'zod'

const passwordSchema = z.string().min(8).max(72).refine(
  (password) => Buffer.byteLength(password, 'utf8') <= 72,
  'Password must be at most 72 UTF-8 bytes'
)

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
})

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: passwordSchema,
  fullName: z.string().trim().min(2).max(200),
})

export const emailSchema = z.object({ email: z.string().trim().toLowerCase().email() })
export const resetPasswordSchema = z.object({
  token: z.string().min(32).max(200),
  password: passwordSchema,
})
export const verifyEmailSchema = z.object({ token: z.string().min(32).max(200) })
export const deleteAccountSchema = z.object({
  password: z.string().min(8).max(72),
  confirmation: z.literal('DELETE'),
})

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterInput = z.infer<typeof registerSchema>
