import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import { config } from './config';
import { errorHandler } from './middleware/errors';
import { emailQueue } from './queue/emailQueue';
import authRoutes from './routes/auth';
import emailRoutes from './routes/emails';
import slackRoutes from './routes/slack';

/** Optional basic auth for the queue dashboard (set BULL_BOARD_USER / BULL_BOARD_PASSWORD). */
function boardAuth(req: Request, res: Response, next: NextFunction) {
  const { user, password } = config.bullBoard;
  if (!user) return next();
  const [type, encoded] = (req.headers.authorization ?? '').split(' ');
  const [u, p] = Buffer.from(encoded ?? '', 'base64').toString().split(':');
  if (type === 'Basic' && u === user && p === password) return next();
  res.setHeader('WWW-Authenticate', 'Basic realm="queues"').status(401).send('Auth required');
}

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.frontendUrl, credentials: true }));
  app.use(express.json({ limit: '10mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/auth', authRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/slack', slackRoutes);

  // Live BullMQ dashboard
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues');
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
  app.use('/admin/queues', boardAuth, serverAdapter.getRouter());

  app.use(errorHandler);
  return app;
}
