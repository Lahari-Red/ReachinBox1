import { DelayedError, Job, Worker } from 'bullmq';
import nodemailer from 'nodemailer';
import { config } from '../config';
import { query } from '../db';
import { createLogger } from '../lib/logger';
import { createRedis } from '../lib/redis';
import { EmailForSend, EmailJobData } from '../types';
import { bookSendGate, nextAvailableSlot, reserveSlot, shouldNotifyLimitHit } from '../services/rateLimiter';
import { getSender, getTransporter } from '../services/senders';
import { updateEmailDoc } from '../services/search';
import { notifyUser } from '../services/slack';
import { EMAIL_QUEUE } from './emailQueue';

const log = createLogger('worker');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function loadEmail(id: string): Promise<EmailForSend | null> {
  const { rows } = await query<EmailForSend>(
    `SELECT e.*, c.hourly_limit, s.email AS sender_email
     FROM emails e
     JOIN campaigns c ON c.id = e.campaign_id
     JOIN senders s ON s.id = e.sender_id
     WHERE e.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

const toHtml = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

async function deferToNextWindow(job: Job<EmailJobData>, token: string | undefined, email: EmailForSend,
  limit: Exclude<Awaited<ReturnType<typeof reserveSlot>>, { ok: true }>) {
  const at = await nextAvailableSlot(limit.scope, limit.scopeId, limit.limit, limit.window);
  await query(
    `UPDATE emails SET status = 'rate_limited', scheduled_at = $2, updated_at = now()
     WHERE id = $1 AND status IN ('scheduled','rate_limited')`,
    [email.id, new Date(at)],
  );
  void updateEmailDoc(email.id, { status: 'rate_limited', scheduled_at: new Date(at).toISOString() });

  if (await shouldNotifyLimitHit(limit.scope, limit.scopeId, limit.window)) {
    const who = limit.scope === 'sender'
      ? `sender *${email.sender_email}*`
      : `campaign #${email.campaign_id} (“${email.subject}”)`;
    const resume = new Date(limit.window + 3600_000).toISOString().replace('T', ' ').slice(0, 16);
    const text = `:warning: Hourly limit reached for ${who}: ${limit.limit} emails/hour. ` +
      `Remaining emails were not dropped — they are rescheduled from ${resume} UTC onward.`;
    const sent = await notifyUser(email.user_id, text);
    log.info(`limit hit (${limit.scope} ${limit.scopeId}); slack notified=${sent}`);
  }

  await job.moveToDelayed(at, token);
  throw new DelayedError(); // tells BullMQ the job was re-delayed, not failed
}

export async function processEmailJob(job: Job<EmailJobData>, token?: string) {
  const email = await loadEmail(job.data.emailId);
  if (!email) return { skipped: 'not-found' };

  // Idempotency layer 2: a row that is already final (or being sent by someone else) is never re-sent.
  if (email.status === 'sent' || email.status === 'failed' || email.status === 'sending') {
    return { skipped: email.status };
  }

  // Hourly budgets (per sender + per campaign) — Redis, atomic, multi-instance safe.
  const slot = await reserveSlot({ senderId: email.sender_id, campaignId: email.campaign_id, campaignLimit: email.hourly_limit });
  if (!slot.ok) return deferToNextWindow(job, token, email, slot);

  // Minimum gap between sends from the same mailbox (provider throttling).
  const wait = await bookSendGate(email.sender_id);
  if (wait > 0) {
    await sleep(wait);
    await job.extendLock(token ?? '', 30_000).catch(() => undefined);
  }

  // Idempotency layer 3: atomic claim. Only one worker can flip scheduled → sending.
  const claim = await query(
    `UPDATE emails SET status = 'sending', attempts = attempts + 1, updated_at = now()
     WHERE id = $1 AND status IN ('scheduled','rate_limited') RETURNING id`,
    [email.id],
  );
  if (claim.rowCount === 0) return { skipped: 'claimed-elsewhere' };

  const sender = await getSender(email.sender_id);
  if (!sender) throw new Error(`Sender ${email.sender_id} missing`);

  try {
    const info = await getTransporter(sender).sendMail({
      from: `"ReachInbox Scheduler" <${sender.email}>`,
      to: email.recipient,
      subject: email.subject,
      text: email.body,
      html: toHtml(email.body),
      messageId: `<${email.id}@reachinbox-scheduler>`, // stable per email → provider-side dedupe
    });
    const previewUrl = nodemailer.getTestMessageUrl(info) || null;

    const { rows } = await query<{ sent_at: Date }>(
      `UPDATE emails SET status = 'sent', sent_at = now(), message_id = $2, preview_url = $3,
         error = NULL, updated_at = now()
       WHERE id = $1 RETURNING sent_at`,
      [email.id, info.messageId, previewUrl],
    );
    void updateEmailDoc(email.id, { status: 'sent', sent_at: rows[0].sent_at.toISOString() });
    log.info(`sent ${email.id} → ${email.recipient} via ${sender.email}`);
    return { sent: true, messageId: info.messageId, previewUrl };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const isFinal = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await query(
      `UPDATE emails SET status = $2, error = $3, sent_at = CASE WHEN $2 = 'failed' THEN now() ELSE sent_at END,
         updated_at = now() WHERE id = $1`,
      [email.id, isFinal ? 'failed' : 'scheduled', message],
    );
    if (isFinal) void updateEmailDoc(email.id, { status: 'failed' });
    log.warn(`send ${email.id} failed (attempt ${job.attemptsMade + 1}, final=${isFinal}): ${message}`);
    throw err; // BullMQ retries with exponential backoff
  }
}

export function createEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE, processEmailJob, {
    connection: createRedis(),
    concurrency: config.worker.concurrency,
    // Longer than the worst-case gate wait so a sleeping job isn't marked stalled.
    lockDuration: Math.max(30_000, config.worker.minDelayBetweenEmailsMs * config.worker.concurrency * 2),
  });

  worker.on('ready', () =>
    log.info(`worker ready (concurrency=${config.worker.concurrency}, ` +
      `minDelay=${config.worker.minDelayBetweenEmailsMs}ms/sender, ` +
      `maxPerHourPerSender=${config.worker.maxEmailsPerHourPerSender})`));
  worker.on('error', (err) => log.error('worker error', err));
  worker.on('failed', (job, err) => job && log.warn(`job ${job.id} failed: ${err.message}`));
  return worker;
}
