import { migrate, pool } from './db';
import { createLogger } from './lib/logger';
import { redis } from './lib/redis';
import { emailQueue } from './queue/emailQueue';
import { ensureIndex } from './services/search';
import { closeTransporters, ensureSenders } from './services/senders';

const log = createLogger('boot');

/** Shared startup for both the API and standalone worker processes. */
export async function bootstrapInfra() {
  await migrate();
  await ensureIndex();
  await ensureSenders();
}

type Closer = () => Promise<unknown>;

/**
 * Graceful shutdown: stop taking new work, let in-flight jobs finish (worker.close
 * waits for them), then release connections. Delayed jobs simply stay in Redis.
 */
export function onShutdown(closers: Closer[]) {
  let closing = false;
  const handler = async (signal: string) => {
    if (closing) return;
    closing = true;
    log.info(`${signal} received, shutting down gracefully…`);
    for (const close of closers) await close().catch((e) => log.warn('close error', e));
    await emailQueue.close().catch(() => undefined);
    await closeTransporters();
    await redis.quit().catch(() => undefined);
    await pool.end().catch(() => undefined);
    log.info('bye');
    process.exit(0);
  };
  process.on('SIGINT', () => void handler('SIGINT'));
  process.on('SIGTERM', () => void handler('SIGTERM'));
}
