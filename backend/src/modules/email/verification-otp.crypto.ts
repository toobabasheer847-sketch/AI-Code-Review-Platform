import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

import { env } from '@/config/env'

export interface EncryptedVerificationOtp {
  ciphertext: string
  iv: string
  tag: string
}

function encryptionKey(): Buffer {
  return createHash('sha256')
    .update('ai-codeguard-email-verification-otp-encryption')
    .update(env.EMAIL_OTP_SECRET)
    .digest()
}

export function encryptVerificationOtp(otp: string): EncryptedVerificationOtp {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const ciphertext = Buffer.concat([cipher.update(otp, 'utf8'), cipher.final()])
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  }
}

export function decryptVerificationOtp(payload: EncryptedVerificationOtp): string {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(),
    Buffer.from(payload.iv, 'base64')
  )
  decipher.setAuthTag(Buffer.from(payload.tag, 'base64'))
  return Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]).toString('utf8')
}
