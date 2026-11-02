import jwt from 'jsonwebtoken';
import { config } from '../config';
import { query } from '../db';
import { createLogger } from '../lib/logger';

const log = createLogger('slack');

export const slackConfigured = () => Boolean(config.slack.clientId && config.slack.clientSecret);

/** The OAuth `state` is a short-lived signed token carrying the user id (CSRF + user binding). */
export function buildInstallUrl(userId: number): string {
  const state = jwt.sign({ sub: userId, purpose: 'slack-oauth' }, config.jwtSecret, { expiresIn: '10m' });
  const params = new URLSearchParams({
    client_id: config.slack.clientId,
    scope: 'incoming-webhook',
    redirect_uri: config.slack.redirectUri,
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params}`;
}

export function verifyState(state: string): number {
  const payload = jwt.verify(state, config.jwtSecret) as jwt.JwtPayload;
  if (payload.purpose !== 'slack-oauth') throw new Error('Invalid OAuth state');
  return Number(payload.sub);
}

interface SlackOAuthResponse {
  ok: boolean;
  error?: string;
  team?: { id: string; name: string };
  incoming_webhook?: { url: string; channel: string };
}

export async function exchangeCodeAndStore(userId: number, code: string): Promise<void> {
  const res = await fetch('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: config.slack.clientId,
      client_secret: config.slack.clientSecret,
      code,
      redirect_uri: config.slack.redirectUri,
    }),
  });
  const data = (await res.json()) as SlackOAuthResponse;
  if (!data.ok || !data.incoming_webhook) throw new Error(`Slack OAuth failed: ${data.error ?? 'no webhook'}`);

  await query(
    `INSERT INTO slack_integrations (user_id, team_id, team_name, channel, webhook_url)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (user_id) DO UPDATE SET team_id = EXCLUDED.team_id, team_name = EXCLUDED.team_name,
       channel = EXCLUDED.channel, webhook_url = EXCLUDED.webhook_url, created_at = now()`,
    [userId, data.team?.id ?? null, data.team?.name ?? null, data.incoming_webhook.channel, data.incoming_webhook.url],
  );
  log.info(`user ${userId} connected Slack (${data.team?.name} ${data.incoming_webhook.channel})`);
}

export async function getIntegration(userId: number) {
  const { rows } = await query<{ team_name: string | null; channel: string | null; webhook_url: string; created_at: Date }>(
    'SELECT team_name, channel, webhook_url, created_at FROM slack_integrations WHERE user_id = $1',
    [userId],
  );
  return rows[0] ?? null;
}

export async function disconnect(userId: number) {
  await query('DELETE FROM slack_integrations WHERE user_id = $1', [userId]);
}

/**
 * Looks up the integration on every call (no caching), so connecting/disconnecting
 * takes effect immediately without a redeploy. Never throws.
 */
export async function notifyUser(userId: number, text: string, blocks?: unknown[]): Promise<boolean> {
  try {
    const integration = await getIntegration(userId);
    if (!integration) return false;

    const res = await fetch(integration.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, blocks }),
    });
    if (res.ok) return true;

    const body = await res.text();
    // Webhook revoked / app uninstalled / channel deleted → drop the stale integration.
    if ([403, 404, 410].includes(res.status) || /no_service|invalid_token|channel_is_archived/.test(body)) {
      log.warn(`webhook for user ${userId} is no longer valid (${res.status} ${body}); disconnecting`);
      await disconnect(userId);
    } else {
      log.warn(`Slack webhook returned ${res.status}: ${body}`);
    }
    return false;
  } catch (err) {
    log.warn(`Slack notify failed for user ${userId}`, err);
    return false;
  }
}
