import IORedis, { Redis } from 'ioredis';
import { config } from '../config';

/**
 * BullMQ requires maxRetriesPerRequest = null on its connections.
 * Each Queue / Worker gets its own connection; `redis` is a shared
 * connection for our own counters (rate limits, notification dedupe).
 */
export const createRedis = (): Redis =>
  new IORedis(config.redisUrl, { maxRetriesPerRequest: null, enableReadyCheck: true });

export const redis = createRedis();
