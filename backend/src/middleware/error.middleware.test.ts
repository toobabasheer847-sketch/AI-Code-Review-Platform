import assert from 'node:assert/strict'
import test from 'node:test'
import type { NextFunction, Request, Response } from 'express'
import { errorMiddleware, type AppError } from './error.middleware'

function invoke(error: AppError) {
  let statusCode: number | undefined
  let body: unknown
  let forwardedError: unknown
  const response = {
    headersSent: false,
    status(status: number) {
      statusCode = status
      return this
    },
    json(value: unknown) {
      body = value
      return this
    },
  } as unknown as Response
  const next: NextFunction = (nextError?: unknown) => {
    forwardedError = nextError
  }

  errorMiddleware(error, {} as Request, response, next)
  return { statusCode, body, forwardedError }
}

test('does not expose internal server messages or codes', () => {
  const error = Object.assign(new Error('database credentials must remain private'), {
    status: 500,
    code: 'INTERNAL_DATABASE_CODE',
  })
  const result = invoke(error)

  assert.equal(result.statusCode, 500)
  assert.deepEqual(result.body, {
    error: {
      status: 500,
      message: 'Internal Server Error',
      timestamp: (result.body as { error: { timestamp: string } }).error.timestamp,
    },
  })
  assert.doesNotMatch(JSON.stringify(result.body), /credentials|INTERNAL_DATABASE_CODE/)
})

test('normalizes invalid error statuses and forwards after headers are sent', () => {
  const invalidStatus = Object.assign(new Error('internal detail'), { status: 200 })
  assert.equal(invoke(invalidStatus).statusCode, 500)

  const error = new Error('late error')
  let forwardedError: unknown
  const response = { headersSent: true } as Response
  errorMiddleware(error, {} as Request, response, ((nextError?: unknown) => {
    forwardedError = nextError
  }) as NextFunction)
  assert.equal(forwardedError, error)
})

test('preserves safe client error responses', () => {
  const error = Object.assign(new Error('Invalid request'), { status: 400 })
  const result = invoke(error)
  assert.equal(result.statusCode, 400)
  assert.deepEqual(result.body, {
    error: {
      status: 400,
      message: 'Invalid request',
      timestamp: (result.body as { error: { timestamp: string } }).error.timestamp,
    },
  })
})
