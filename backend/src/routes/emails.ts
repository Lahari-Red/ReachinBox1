import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config';
import { AuthedRequest, requireAuth } from '../middleware/auth';
import { asyncHandler, HttpError } from '../middleware/errors';
import { getStats, listEmails, scheduleCampaign } from '../services/scheduler';
import { searchEmails } from '../services/search';
import { listSenders } from '../services/senders';
import { DONE_STATUSES, PENDING_STATUSES } from '../types';

const router = Router();
router.use(requireAuth);

const scheduleSchema = z.object({
  subject: z.string().trim().min(1, 'Subject is required').max(998),
  body: z.string().trim().min(1, 'Body is required').max(100_000),
  recipients: z.array(z.string().trim().email()).min(1, 'At least one recipient').max(50_000),
  startTime: z.coerce.date(),
  delayBetweenMs: z.number().int().min(0).max(24 * 3600_000).default(2000),
  hourlyLimit: z.number().int().min(1).max(100_000).default(config.worker.defaultCampaignHourlyLimit),
});

router.post(
  '/schedule',
  asyncHandler(async (req: AuthedRequest, res) => {
    const input = scheduleSchema.parse(req.body);
    // Allow small clock drift between browser and server; anything in the past sends ASAP.
    if (input.startTime.getTime() < Date.now() - 24 * 3600_000) {
      throw new HttpError(400, 'startTime is more than a day in the past');
    }
    const result = await scheduleCampaign({ userId: req.userId!, ...input });
    res.status(201).json(result);
  }),
);

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

router.get(
  '/scheduled',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { page, pageSize } = pageSchema.parse(req.query);
    res.json(await listEmails(req.userId!, PENDING_STATUSES, page, pageSize));
  }),
);

router.get(
  '/sent',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { page, pageSize } = pageSchema.parse(req.query);
    res.json(await listEmails(req.userId!, DONE_STATUSES, page, pageSize));
  }),
);

router.get(
  '/stats',
  asyncHandler(async (req: AuthedRequest, res) => res.json(await getStats(req.userId!))),
);

router.get(
  '/search',
  asyncHandler(async (req: AuthedRequest, res) => {
    const { q, status } = z.object({ q: z.string().default(''), status: z.string().optional() }).parse(req.query);
    try {
      res.json({ items: await searchEmails(req.userId!, q.trim(), status) });
    } catch (err) {
      throw new HttpError(503, (err as Error).message);
    }
  }),
);

router.get(
  '/senders',
  asyncHandler(async (_req, res) => {
    const senders = await listSenders();
    res.json({
      items: senders.map((s) => ({ id: s.id, email: s.email })),
      limits: {
        maxPerHourPerSender: config.worker.maxEmailsPerHourPerSender,
        minDelayBetweenEmailsMs: config.worker.minDelayBetweenEmailsMs,
        concurrency: config.worker.concurrency,
      },
    });
  }),
);

export default router;
