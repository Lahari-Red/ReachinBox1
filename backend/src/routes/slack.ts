import { Router } from 'express';
import { config } from '../config';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { createLogger } from '../lib/logger';
import * as slack from '../services/slack';

const router = Router();
const log = createLogger('slack-route');

router.get(
  '/status',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const i = await slack.getIntegration(req.userId!);
    res.json({
      configured: slack.slackConfigured(),
      connected: Boolean(i),
      teamName: i?.team_name ?? null,
      channel: i?.channel ?? null,
    });
  }),
);

/** Returns the Slack authorize URL; the frontend navigates the browser there. */
router.get(
  '/install-url',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    if (!slack.slackConfigured()) throw new HttpError(501, 'Slack app credentials are not configured on the server');
    res.json({ url: slack.buildInstallUrl(req.userId!) });
  }),
);

/** Slack redirects here after the user approves. Public route — user is bound via the signed `state`. */
router.get('/callback', async (req, res) => {
  const back = (status: string) => res.redirect(`${config.frontendUrl}/dashboard?slack=${status}`);
  const { code, state, error } = req.query as Record<string, string | undefined>;
  if (error) return back('denied');
  if (!code || !state) return back('error');
  try {
    const userId = slack.verifyState(state);
    await slack.exchangeCodeAndStore(userId, code);
    await slack.notifyUser(userId, ':white_check_mark: ReachInbox Scheduler connected. You will get an alert here whenever a sender hits its hourly limit.');
    back('connected');
  } catch (err) {
    log.warn('callback failed', err);
    back('error');
  }
});

router.post(
  '/test',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    const ok = await slack.notifyUser(req.userId!, ':bell: Test notification from ReachInbox Scheduler.');
    if (!ok) throw new HttpError(400, 'Slack is not connected (or the webhook was revoked)');
    res.json({ ok });
  }),
);

router.delete(
  '/',
  requireAuth,
  asyncHandler(async (req: AuthedRequest, res) => {
    await slack.disconnect(req.userId!);
    res.json({ ok: true });
  }),
);

export default router;
