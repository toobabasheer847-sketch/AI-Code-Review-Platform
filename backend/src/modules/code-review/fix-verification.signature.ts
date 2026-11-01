import { createHmac, timingSafeEqual } from 'node:crypto'

const DEFAULT_TOLERANCE_MS = 300_000

export function signVerificationPayload(secret: string, timestamp: string, body: string): string {
  return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
}

export function verifyVerificationSignature(input: {
  secret: string
  timestamp: string | undefined
  signature: string | undefined
  body: string
  now?: number
  toleranceMs?: number
}): boolean {
  if (!input.secret || !input.timestamp || !input.signature) return false
  if (!/^[0-9]{10,13}$/.test(input.timestamp)) return false
  if (!/^[a-f0-9]{64}$/.test(input.signature)) return false
  const stamp = Number(input.timestamp)
  const millis = input.timestamp.length <= 10 ? stamp * 1000 : stamp
  const now = input.now ?? Date.now()
  if (!Number.isFinite(millis) || Math.abs(now - millis) > (input.toleranceMs ?? DEFAULT_TOLERANCE_MS)) {
    return false
  }
  const expected = Buffer.from(signVerificationPayload(input.secret, input.timestamp, input.body))
  const actual = Buffer.from(input.signature)
  if (expected.length !== actual.length) return false
  return timingSafeEqual(expected, actual)
}

export function bearerTokenMatches(expected: string, header: string | undefined): boolean {
  if (!expected || !header?.startsWith('Bearer ')) return false
  const actual = Buffer.from(header.slice('Bearer '.length))
  const wanted = Buffer.from(expected)
  if (actual.length !== wanted.length || actual.length === 0) return false
  return timingSafeEqual(actual, wanted)
}
