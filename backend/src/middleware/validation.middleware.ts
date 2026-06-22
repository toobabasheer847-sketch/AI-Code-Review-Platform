import { Request, Response, NextFunction } from 'express'
import { ZodSchema } from 'zod'

export function validationMiddleware(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    try {
      const validated = schema.parse(req.body)
      req.body = validated
      next()
    } catch (error) {
      res.status(400).json({ error: 'Validation failed', details: error })
    }
  }
}
