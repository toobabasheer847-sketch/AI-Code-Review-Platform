import type { Request, Response } from 'express'
import { env } from '@/config/env'
import { prismaVerificationJobStore } from './fix-verification.job-store'
import { applyVerificationCallback } from './fix-verification.lifecycle'
import { bearerTokenMatches, verifyVerificationSignature } from './fix-verification.signature'

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export async function receiveVerificationCallback(request: Request, response: Response): Promise<void> {
  const body = Buffer.isBuffer(request.body)
    ? request.body.toString('utf8')
    : typeof request.body === 'string'
      ? request.body
      : null
  const token = env.FIX_VERIFICATION_RUNNER_TOKEN
  if (
    body === null ||
    !token ||
    !bearerTokenMatches(token, headerValue(request.headers.authorization)) ||
    !verifyVerificationSignature({
      secret: token,
      timestamp: headerValue(request.headers['x-codeguard-timestamp']),
      signature: headerValue(request.headers['x-codeguard-signature']),
      body,
    })
  ) {
    response.status(401).json({ error: 'Unauthorized' })
    return
  }

  let payload: unknown
  try {
    payload = JSON.parse(body)
  } catch {
    response.status(400).json({ error: 'Invalid verification callback.' })
    return
  }
  const attemptId =
    payload &&
    typeof payload === 'object' &&
    'attemptId' in payload &&
    typeof payload.attemptId === 'string'
      ? payload.attemptId
      : ''
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(attemptId)) {
    response.status(400).json({ error: 'Invalid verification callback.' })
    return
  }
  await applyVerificationCallback(prismaVerificationJobStore, attemptId, payload)
  response.status(204).end()
}
