import nodemailer, { Transporter } from 'nodemailer';
import { config } from '../config';
import { query } from '../db';
import { createLogger } from '../lib/logger';
import { Sender } from '../types';

const log = createLogger('senders');

export async function listSenders(): Promise<Sender[]> {
  const { rows } = await query<Sender>('SELECT * FROM senders ORDER BY id');
  return rows;
}

async function upsertSender(user: string, pass: string, host: string, port: number) {
  await query(
    `INSERT INTO senders (email, smtp_host, smtp_port, smtp_user, smtp_pass)
     VALUES ($1, $2, $3, $1, $4)
     ON CONFLICT (email) DO UPDATE SET smtp_pass = EXCLUDED.smtp_pass,
       smtp_host = EXCLUDED.smtp_host, smtp_port = EXCLUDED.smtp_port`,
    [user, host, port, pass],
  );
}

/**
 * Makes sure there are sender mailboxes to send from.
 *  - ETHEREAL_ACCOUNTS="a@ethereal.email:pass,b@ethereal.email:pass" → used as-is
 *  - otherwise auto-create ETHEREAL_SENDER_COUNT Ethereal accounts once and persist
 *    them in Postgres, so restarts reuse the same mailboxes.
 */
export async function ensureSenders(): Promise<Sender[]> {
  if (config.ethereal.accounts) {
    for (const pair of config.ethereal.accounts.split(',').map((s) => s.trim()).filter(Boolean)) {
      const idx = pair.indexOf(':');
      if (idx < 1) throw new Error(`Invalid ETHEREAL_ACCOUNTS entry "${pair}" (expected user:pass)`);
      await upsertSender(pair.slice(0, idx), pair.slice(idx + 1), config.ethereal.host, config.ethereal.port);
    }
  }

  let senders = await listSenders();
  const missing = config.ethereal.autoCreateCount - senders.length;
  if (!config.ethereal.accounts && missing > 0) {
    log.info(`creating ${missing} Ethereal test account(s)…`);
    for (let i = 0; i < missing; i++) {
      const acct = await nodemailer.createTestAccount();
      await upsertSender(acct.user, acct.pass, acct.smtp.host, acct.smtp.port);
      log.info(`created sender ${acct.user} (login at https://ethereal.email with this user/pass)`);
    }
    senders = await listSenders();
  }

  if (senders.length === 0) throw new Error('No sender mailboxes configured');
  log.info(`${senders.length} sender(s): ${senders.map((s) => s.email).join(', ')}`);
  return senders;
}

const transporters = new Map<number, Transporter>();

export function getTransporter(sender: Sender): Transporter {
  let t = transporters.get(sender.id);
  if (!t) {
    t = nodemailer.createTransport({
      host: sender.smtp_host,
      port: sender.smtp_port,
      secure: sender.smtp_port === 465,
      auth: { user: sender.smtp_user, pass: sender.smtp_pass },
      pool: true,
      maxConnections: 2,
    });
    transporters.set(sender.id, t);
  }
  return t;
}

export async function getSender(id: number): Promise<Sender | null> {
  const { rows } = await query<Sender>('SELECT * FROM senders WHERE id = $1', [id]);
  return rows[0] ?? null;
}

export async function closeTransporters() {
  for (const t of transporters.values()) t.close();
  transporters.clear();
}
