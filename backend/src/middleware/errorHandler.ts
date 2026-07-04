import { Request, Response, NextFunction } from 'express'

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  console.error('[ERROR]', err.message ?? err, err.stack)
  res.status(500).json({ error: err.message ?? 'Internal server error' })
}
