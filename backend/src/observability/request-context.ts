import { randomUUID } from 'node:crypto'
import type { IncomingHttpHeaders } from 'node:http'
import type { NextFunction, Request, Response } from 'express'

const safeId = /^[A-Za-z0-9._-]{1,128}$/

export function readRequestId(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate && safeId.test(candidate) ? candidate : undefined
}

export function assignRequestContext(
  headers: IncomingHttpHeaders
): { requestId: string; correlationId: string } {
  const requestId = readRequestId(headers, 'x-request-id') ?? randomUUID()
  const correlationId = readRequestId(headers, 'x-correlation-id') ?? requestId
  return { requestId, correlationId }
}

export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const context = assignRequestContext(req.headers)
  req.id = context.requestId
  req.correlationId = context.correlationId
  res.setHeader('x-request-id', context.requestId)
  res.setHeader('x-correlation-id', context.correlationId)
  next()
}

export function requestLogBindings(req: Request): {
  requestId: string | undefined
  correlationId: string | undefined
  method: string
  route: string
} {
  const url = req.originalUrl || req.url || ''
  const route = req.route?.path
    ? `${req.baseUrl || ''}${req.route.path}`
    : url.split('?')[0]
  return {
    requestId: typeof req.id === 'string' ? req.id : undefined,
    correlationId: req.correlationId,
    method: req.method,
    route,
  }
}

declare module 'http' {
  interface IncomingMessage {
    correlationId?: string
  }
}
