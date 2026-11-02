/**
 * Standalone worker process. Run as many of these as you like (on one or many
 * machines) — rate limits, send gates and job claims all live in Redis/Postgres.
 */
import { bootstrapInfra, onShutdown } from './bootstrap';
import { createLogger } from './lib/logger';
import { createEmailWorker } from './queue/emailWorker';
import { reconcilePendingJobs } from './services/scheduler';

const log = createLogger('worker-main');

async function main() {
  await bootstrapInfra();
  await reconcilePendingJobs();
  const worker = createEmailWorker();
  onShutdown([() => worker.close()]);
}

main().catch((err) => {
  log.error('fatal worker error', err);
  process.exit(1);
});
