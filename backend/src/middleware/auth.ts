import { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export interface AuthedRequest extends Request {
  userId?: number;
}

export const signSession = (userId: number) =>
  jwt.sign({ sub: userId, purpose: 'session' }, config.jwtSecret, { expiresIn: '7d' });

export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try {
    const payload = jwt.verify(token, config.jwtSecret) as jwt.JwtPayload;
    if (payload.purpose !== 'session') throw new Error('wrong token type');
    req.userId = Number(payload.sub);
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please sign in again' });
  }
}
