import { query, withTransaction } from '../db';
import { createLogger } from '../lib/logger';
import { emailQueue, enqueueEmails } from '../queue/emailQueue';
import { EmailRow, EmailStatus } from '../types';
import { listSenders } from './senders';
import { indexEmails, toDoc, updateEmailDoc } from './search';

const log = createLogger('scheduler');

export interface ScheduleInput {
  userId: number;
  subject: string;
  body: string;
  recipients: string[];
  startTime: Date;
  delayBetweenMs: number;
  hourlyLimit: number;
}

/**
 * 1. Persist campaign + one row per recipient in a single transaction
 *    (Postgres is the source of truth).
 * 2. After commit, add one delayed BullMQ job per row.
 * If step 2 fails or the process dies in between, `reconcilePendingJobs`
 * re-enqueues on next boot — nothing is lost.
 */
export async function scheduleCampaign(input: ScheduleInput) {
  const recipients = Array.from(new Set(input.recipients.map((r) => r.trim().toLowerCase())));
  const senders = await listSenders();
  if (senders.length === 0) throw new Error('No senders available');

  const start = input.startTime.getTime();
  const seqs: number[] = [];
  const senderIds: number[] = [];
  const times: Date[] = [];
  recipients.forEach((_, i) => {
    seqs.push(i);
    senderIds.push(senders[i % senders.length].id); // round-robin across mailboxes
    times.push(new Date(start + i * input.delayBetweenMs));
  });

  const { campaignId, rows } = await withTransaction(async (client) => {
    const c = await client.query<{ id: number }>(
      `INSERT INTO campaigns (user_id, subject, body, start_time, delay_between_ms, hourly_limit, total)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [input.userId, input.subject, input.body, input.startTime, input.delayBetweenMs, input.hourlyLimit, recipients.length],
    );
    const campaignId = c.rows[0].id;
    const inserted = await client.query<EmailRow>(
      `INSERT INTO emails (campaign_id, user_id, sender_id, seq, recipient, subject, body, scheduled_at)
       SELECT $1, $2, s.sender_id, s.seq, s.recipient, $3, $4, s.scheduled_at
       FROM unnest($5::int[], $6::int[], $7::text[], $8::timestamptz[])
            AS s(sender_id, seq, recipient, scheduled_at)
       RETURNING *`,
      [campaignId, input.userId, input.subject, input.body, senderIds, seqs, recipients, times],
    );
    return { campaignId, rows: inserted.rows };
  });

  await enqueueEmails(rows.map((r) => ({ id: r.id, scheduledAt: r.scheduled_at })));

  const senderEmail = new Map(senders.map((s) => [s.id, s.email]));
  void indexEmails(rows.map((r) => toDoc(r, senderEmail.get(r.sender_id))));

  log.info(`campaign ${campaignId}: ${rows.length} email(s) from ${input.startTime.toISOString()}`);
  return {
    campaignId,
    count: rows.length,
    firstSendAt: rows[0]?.scheduled_at,
    lastSendAt: rows[rows.length - 1]?.scheduled_at,
  };
}

export async function listEmails(userId: number, statuses: EmailStatus[], page: number, pageSize: number) {
  const done = statuses.every((s) => s === 'sent' || s === 'failed');
  const order = done ? 'COALESCE(e.sent_at, e.updated_at) DESC' : 'e.scheduled_at ASC, e.seq ASC';
  const { rows } = await query(
    `SELECT e.id, e.recipient, e.subject, e.status, e.scheduled_at, e.sent_at, e.error,
            e.preview_url, e.attempts, e.campaign_id, s.email AS sender_email,
            COUNT(*) OVER() AS total_count
     FROM emails e JOIN senders s ON s.id = e.sender_id
     WHERE e.user_id = $1 AND e.status = ANY($2)
     ORDER BY ${order}
     LIMIT $3 OFFSET $4`,
    [userId, statuses, pageSize, (page - 1) * pageSize],
  );
  const total = rows[0] ? Number(rows[0].total_count) : 0;
  return { items: rows.map(({ total_count, ...r }) => r), total, page, pageSize };
}

export async function getStats(userId: number) {
  const { rows } = await query<{ status: string; n: string }>(
    'SELECT status, COUNT(*) AS n FROM emails WHERE user_id = $1 GROUP BY status',
    [userId],
  );
  const stats: Record<string, number> = { scheduled: 0, rate_limited: 0, sending: 0, sent: 0, failed: 0 };
  rows.forEach((r) => (stats[r.status] = Number(r.n)));
  return stats;
}

/**
 * Runs on every boot. Makes Postgres and Redis agree:
 *  - rows still pending with no live BullMQ job (e.g. Redis was flushed, or we died
 *    between DB commit and enqueue) are re-enqueued with their original scheduled_at;
 *  - rows stuck in 'sending' (process killed mid-SMTP) are marked failed rather than
 *    retried — we can't know if the provider accepted it, and at-most-once is the
 *    safer default for outbound email.
 */
export async function reconcilePendingJobs(): Promise<void> {
  const stuck = await query<{ id: string }>(
    `UPDATE emails SET status = 'failed', error = 'Interrupted during SMTP send; not retried to avoid duplicates',
       updated_at = now()
     WHERE status = 'sending' AND updated_at < now() - interval '2 minutes'
     RETURNING id`,
  );
  stuck.rows.forEach((r) => void updateEmailDoc(r.id, { status: 'failed' }));
  if (stuck.rowCount) log.warn(`marked ${stuck.rowCount} interrupted send(s) as failed`);

  const { rows } = await query<{ id: string; scheduled_at: Date }>(
    `SELECT id, scheduled_at FROM emails WHERE status IN ('scheduled','rate_limited') ORDER BY scheduled_at`,
  );
  const missing: { id: string; scheduledAt: Date }[] = [];
  const BATCH = 200;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const states = await Promise.all(
      batch.map(async (r) => {
        const job = await emailQueue.getJob(r.id);
        if (!job) return 'missing';
        const state = await job.getState();
        if (state === 'completed' || state === 'failed') {
          await job.remove(); // stale job record would block re-adding the same jobId
          return 'missing';
        }
        return state;
      }),
    );
    batch.forEach((r, idx) => states[idx] === 'missing' && missing.push({ id: r.id, scheduledAt: r.scheduled_at }));
  }

  if (missing.length) {
    log.warn(`re-enqueueing ${missing.length} pending email(s) that had no queue job`);
    await enqueueEmails(missing);
  }
  log.info(`reconcile done: ${rows.length} pending, ${missing.length} re-enqueued`);
}
