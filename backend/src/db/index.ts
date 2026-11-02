import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { createLogger } from '../lib/logger';

const log = createLogger('db');

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export const query = <T = any>(text: string, params?: unknown[]) =>
  pool.query<T & Record<string, any>>(text, params);

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id          SERIAL PRIMARY KEY,
  google_id   TEXT UNIQUE NOT NULL,
  email       TEXT NOT NULL,
  name        TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS senders (
  id          SERIAL PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  smtp_host   TEXT NOT NULL,
  smtp_port   INT  NOT NULL,
  smtp_user   TEXT NOT NULL,
  smtp_pass   TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS campaigns (
  id               SERIAL PRIMARY KEY,
  user_id          INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL,
  body             TEXT NOT NULL,
  start_time       TIMESTAMPTZ NOT NULL,
  delay_between_ms INT NOT NULL,
  hourly_limit     INT NOT NULL,
  total            INT NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emails (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id   INT  NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  user_id       INT  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sender_id     INT  NOT NULL REFERENCES senders(id),
  seq           INT  NOT NULL,
  recipient     TEXT NOT NULL,
  subject       TEXT NOT NULL,
  body          TEXT NOT NULL,
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'scheduled'
                CHECK (status IN ('scheduled','rate_limited','sending','sent','failed')),
  attempts      INT  NOT NULL DEFAULT 0,
  sent_at       TIMESTAMPTZ,
  message_id    TEXT,
  preview_url   TEXT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, recipient)
);

CREATE INDEX IF NOT EXISTS emails_user_status_idx ON emails (user_id, status, scheduled_at);
CREATE INDEX IF NOT EXISTS emails_pending_idx ON emails (status) WHERE status IN ('scheduled','rate_limited','sending');

CREATE TABLE IF NOT EXISTS slack_integrations (
  user_id      INT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  team_id      TEXT,
  team_name    TEXT,
  channel      TEXT,
  webhook_url  TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

/** Idempotent schema setup; advisory lock so API + worker booting together don't race. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(424242)');
    await client.query(SCHEMA);
    log.info('schema ready');
  } finally {
    await client.query('SELECT pg_advisory_unlock(424242)').catch(() => undefined);
    client.release();
  }
}
