import { NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { createLogger } from '../lib/logger';

const log = createLogger('http');

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** Wraps async handlers so rejected promises reach the error middleware. */
export const asyncHandler =
  (fn: (req: any, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: 'Validation failed', details: err.flatten().fieldErrors });
  }
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  log.error('unhandled error', err);
  res.status(500).json({ error: 'Internal server error' });
}
