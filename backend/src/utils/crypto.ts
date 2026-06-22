import crypto from 'crypto'
import { env } from '@/config/env'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const KEY = crypto.createHash('sha256').update(env.JWT_SECRET).digest()

export function encrypt(text: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, KEY, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

export function decrypt(payload: string): string {
  const [ivHex, tagHex, encryptedHex] = payload.split(':')
  if (!ivHex || !tagHex || !encryptedHex) {
    throw new Error('Invalid encrypted payload')
  }

  const iv = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')

  const decipher = crypto.createDecipheriv(ENCRYPTION_ALGORITHM, KEY, iv)
  decipher.setAuthTag(tag)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])

  return decrypted.toString('utf8')
}
