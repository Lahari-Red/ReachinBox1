import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { z } from 'zod';
import { config } from '../config';
import { query } from '../db';
import { AuthedRequest, requireAuth, signSession } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { User } from '../types';

const router = Router();
const google = new OAuth2Client(config.google.clientId);

const publicUser = (u: User) => ({ id: u.id, email: u.email, name: u.name, avatarUrl: u.avatar_url });

/**
 * The frontend runs Google's OAuth consent flow (Google Identity Services) and
 * posts the resulting ID token here. We verify its signature + audience with
 * Google, upsert the user and issue our own session JWT.
 */
router.post(
  '/google',
  asyncHandler(async (req, res) => {
    const { credential } = z.object({ credential: z.string().min(10) }).parse(req.body);
    if (!config.google.clientId) throw new HttpError(500, 'GOOGLE_CLIENT_ID is not configured');

    const ticket = await google
      .verifyIdToken({ idToken: credential, audience: config.google.clientId })
      .catch(() => {
        throw new HttpError(401, 'Invalid Google credential');
      });
    const p = ticket.getPayload();
    if (!p?.sub || !p.email) throw new HttpError(401, 'Google account has no email');

    const { rows } = await query<User>(
      `INSERT INTO users (google_id, email, name, avatar_url) VALUES ($1,$2,$3,$4)
       ON CONFLICT (google_id) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name,
         avatar_url = EXCLUDED.avatar_url
       RETURNING *`,
      [p.sub, p.email, p.name ?? p.email, p.picture ?? null],
    );
    res.json({ token: signSession(rows[0].id), user: publicUser(rows[0]) });
  }),
);

router.get(
  '/me',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const { rows } = await query<User>('SELECT * FROM users WHERE id = $1', [req.userId]);
    if (!rows[0]) throw new HttpError(401, 'User no longer exists');
    res.json({ user: publicUser(rows[0]) });
  }),
);

// Sessions are stateless JWTs; the client discards its token. Endpoint kept for symmetry.
router.post('/logout', (_req, res) => res.json({ ok: true }));

export default router;
