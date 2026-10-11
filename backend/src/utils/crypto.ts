import crypto from 'crypto'
import { env } from '@/config/env'

const ENCRYPTION_ALGORITHM = 'aes-256-gcm'
const CURRENT_KEY = deriveKey(env.GITHUB_TOKEN_ENCRYPTION_KEY)
const DECRYPTION_KEYS = [
  CURRENT_KEY,
  env.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS
    ? deriveKey(env.GITHUB_TOKEN_ENCRYPTION_KEY_PREVIOUS)
    : null,
  env.JWT_SECRET ? deriveKey(env.JWT_SECRET) : null,
].filter((key, index, keys): key is Buffer => {
  return key !== null && keys.findIndex((candidate) => candidate?.equals(key)) === index
})

function deriveKey(secret: string): Buffer {
  return crypto.createHash('sha256').update(secret).digest()
}

function encryptWithKey(text: string, key: Buffer): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv(ENCRYPTION_ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `v1:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`
}

function decryptWithKey(payload: string, key: Buffer): string {
  const parts = payload.startsWith('v1:') ? payload.slice(3).split(':') : payload.split(':')
  const [ivHex, tagHex, encryptedHex] = parts
  if (
    parts.length !== 3 ||
    !ivHex ||
    !tagHex ||
    encryptedHex === undefined ||
    !/^[\da-f]+$/i.test(ivHex) ||
    !/^[\da-f]+$/i.test(tagHex) ||
    (encryptedHex.length > 0 && !/^[\da-f]+$/i.test(encryptedHex)) ||
    ivHex.length !== 24 ||
    tagHex.length !== 32 ||
    encryptedHex.length % 2 !== 0
  ) {
    throw new Error('Invalid encrypted payload')
  }

  const decipher = crypto.createDecipheriv(
    ENCRYPTION_ALGORITHM,
    key,
    Buffer.from(ivHex, 'hex')
  )
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'))
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, 'hex')),
    decipher.final(),
  ])

  return decrypted.toString('utf8')
}

export function encrypt(text: string): string {
  return encryptWithKey(text, CURRENT_KEY)
}

export function decryptWithRotation(payload: string): {
  plaintext: string
  needsReEncryption: boolean
} {
  const isVersioned = payload.startsWith('v1:')
  for (const key of DECRYPTION_KEYS) {
    try {
      return {
        plaintext: decryptWithKey(payload, key),
        needsReEncryption: !isVersioned || !key.equals(CURRENT_KEY),
      }
    } catch (error) {
      if (error instanceof Error && error.message === 'Invalid encrypted payload') {
        throw error
      }
    }
  }

  throw new Error('Unable to decrypt payload with configured keys')
}

export function decrypt(payload: string): string {
  return decryptWithRotation(payload).plaintext
}
