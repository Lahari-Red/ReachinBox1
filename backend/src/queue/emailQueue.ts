import { Queue } from 'bullmq';
import { config } from '../config';
import { createRedis } from '../lib/redis';
import { createLogger } from '../lib/logger';
import { EmailJobData } from '../types';

const log = createLogger('queue');

export const EMAIL_QUEUE = 'email-send';

export const emailQueue = new Queue<EmailJobData>(EMAIL_QUEUE, {
  connection: createRedis(),
  defaultJobOptions: {
    attempts: config.worker.maxAttempts,
    backoff: { type: 'exponential', delay: 10_000 },
    removeOnComplete: { age: 7 * 24 * 3600, count: 50_000 },
    removeOnFail: { age: 14 * 24 * 3600 },
  },
});

/**
 * One delayed BullMQ job per email. jobId === emails.id (UUID), so adding the
 * same email twice is a no-op in BullMQ — this is the first idempotency layer.
 */
export async function enqueueEmails(items: { id: string; scheduledAt: Date }[]): Promise<void> {
  const CHUNK = 500;
  const now = Date.now();
  for (let i = 0; i < items.length; i += CHUNK) {
    const chunk = items.slice(i, i + CHUNK);
    await emailQueue.addBulk(
      chunk.map((it) => ({
        name: 'send-email',
        data: { emailId: it.id },
        opts: { jobId: it.id, delay: Math.max(0, it.scheduledAt.getTime() - now) },
      })),
    );
  }
  log.info(`enqueued ${items.length} delayed job(s)`);
}
