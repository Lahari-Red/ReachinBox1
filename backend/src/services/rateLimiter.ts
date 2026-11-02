import type { Result } from 'ioredis';
import { config } from '../config';
import { redis } from '../lib/redis';

export const HOUR_MS = 60 * 60 * 1000;

export const hourWindow = (ts: number) => Math.floor(ts / HOUR_MS) * HOUR_MS;

/**
 * Atomically checks BOTH hourly budgets and consumes one unit from each only if
 * both have room. Running as a Lua script makes the check-and-increment a single
 * Redis operation, so it is correct with any number of workers / processes.
 *
 * KEYS[1] sender counter, KEYS[2] campaign counter
 * ARGV[1] sender limit,   ARGV[2] campaign limit, ARGV[3] ttl ms
 * returns  1 = reserved, -1 = sender limit hit, -2 = campaign limit hit
 */
const RESERVE_LUA = `
local s = tonumber(redis.call('GET', KEYS[1]) or '0')
local c = tonumber(redis.call('GET', KEYS[2]) or '0')
if s >= tonumber(ARGV[1]) then return -1 end
if c >= tonumber(ARGV[2]) then return -2 end
redis.call('INCR', KEYS[1]); redis.call('PEXPIRE', KEYS[1], ARGV[3])
redis.call('INCR', KEYS[2]); redis.call('PEXPIRE', KEYS[2], ARGV[3])
return 1
`;

/**
 * Per-sender send gate (minimum delay between two emails from the same mailbox).
 * Uses Redis TIME so all instances share one clock. Each caller atomically books
 * the next free send instant and gets back how long to wait for it.
 *
 * KEYS[1] gate key, ARGV[1] gap ms → returns ms to wait (0 = send now)
 */
const GATE_LUA = `
local t = redis.call('TIME')
local now = tonumber(t[1]) * 1000 + math.floor(tonumber(t[2]) / 1000)
local gap = tonumber(ARGV[1])
local nextAt = tonumber(redis.call('GET', KEYS[1]) or '0')
local sendAt = math.max(now, nextAt)
redis.call('SET', KEYS[1], sendAt + gap, 'PX', gap * 20 + 60000)
return sendAt - now
`;

declare module 'ioredis' {
  interface RedisCommander<Context> {
    bookSendGate(gateKey: string, gapMs: number): Result<number, Context>;
    reserveHourlySlot(
      senderKey: string,
      campaignKey: string,
      senderLimit: number,
      campaignLimit: number,
      ttlMs: number,
    ): Result<number, Context>;
  }
}
redis.defineCommand('reserveHourlySlot', { numberOfKeys: 2, lua: RESERVE_LUA });
redis.defineCommand('bookSendGate', { numberOfKeys: 1, lua: GATE_LUA });

/** Books the sender's next send instant; returns milliseconds the caller must wait. */
export async function bookSendGate(senderId: number): Promise<number> {
  const gap = config.worker.minDelayBetweenEmailsMs;
  if (gap <= 0) return 0;
  return redis.bookSendGate(`gate:sender:${senderId}`, gap);
}

export type LimitScope = 'sender' | 'campaign';

export type ReserveResult =
  | { ok: true }
  | { ok: false; scope: LimitScope; limit: number; scopeId: number; window: number };

export async function reserveSlot(params: {
  senderId: number;
  campaignId: number;
  campaignLimit: number;
  now?: number;
}): Promise<ReserveResult> {
  const window = hourWindow(params.now ?? Date.now());
  const senderLimit = config.worker.maxEmailsPerHourPerSender;
  const campaignLimit = params.campaignLimit;
  const ttl = 2 * HOUR_MS;

  const r = await redis.reserveHourlySlot(
    `rl:sender:${params.senderId}:${window}`,
    `rl:campaign:${params.campaignId}:${window}`,
    senderLimit,
    campaignLimit,
    ttl,
  );
  if (r === 1) return { ok: true };
  return r === -1
    ? { ok: false, scope: 'sender', limit: senderLimit, scopeId: params.senderId, window }
    : { ok: false, scope: 'campaign', limit: campaignLimit, scopeId: params.campaignId, window };
}

/**
 * Picks a slot in a FUTURE window for a job that hit its limit.
 * A per-scope cursor hands out positions in the order jobs are deferred, so
 * deferred jobs keep their relative order and are packed `limit` per hour,
 * spaced by the minimum send delay — they don't all stampede at hh:00:00.
 */
export async function nextAvailableSlot(scope: LimitScope, scopeId: number, limit: number, window: number) {
  const nextWindow = window + HOUR_MS;
  const cursorKey = `rl:cursor:${scope}:${scopeId}:${nextWindow}`;
  const n = await redis.incr(cursorKey);
  if (n === 1) await redis.pexpire(cursorKey, 48 * HOUR_MS);

  const idx = n - 1;
  const hoursAhead = Math.floor(idx / limit);
  const posInHour = idx % limit;
  const spacing = Math.min(config.worker.minDelayBetweenEmailsMs, Math.floor(HOUR_MS / Math.max(limit, 1)));
  return nextWindow + hoursAhead * HOUR_MS + posInHour * spacing;
}

/** Returns true only for the first caller per scope+window — one Slack alert per limit hit. */
export async function shouldNotifyLimitHit(scope: LimitScope, scopeId: number, window: number) {
  const res = await redis.set(`rl:notified:${scope}:${scopeId}:${window}`, '1', 'PX', 2 * HOUR_MS, 'NX');
  return res === 'OK';
}
