import { Request, Response, NextFunction } from 'express'
import logger from '@/utils/logger'

export interface AppError extends Error {
  status?: number
  code?: string
}

export function errorMiddleware(
  error: AppError,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (res.headersSent) {
    _next(error)
    return
  }

  const requestedStatus = error.status
  const status =
    Number.isInteger(requestedStatus) && requestedStatus! >= 400 && requestedStatus! < 600
      ? requestedStatus!
      : 500
  const message = status >= 500 ? 'Internal Server Error' : error.message || 'Request failed'

  if (status >= 500) {
    logger.error(
      { errorType: error instanceof Error ? error.name : 'UnknownError' },
      'Unhandled API request error'
    )
  }

  res.status(status).json({
    error: {
      status,
      message,
      ...(status < 500 && error.code ? { code: error.code } : {}),
      timestamp: new Date().toISOString(),
    },
  })
}
