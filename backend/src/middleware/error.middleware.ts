import { Request, Response, NextFunction } from 'express'

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
  void _next
  const status = error.status || 500
  const message = error.message || 'Internal Server Error'

  res.status(status).json({
    error: {
      status,
      message,
      code: error.code,
      timestamp: new Date().toISOString(),
    },
  })
}
