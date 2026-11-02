import { createApp } from './app';
import { bootstrapInfra, onShutdown } from './bootstrap';
import { config } from './config';
import { createLogger } from './lib/logger';
import { createEmailWorker } from './queue/emailWorker';
import { reconcilePendingJobs } from './services/scheduler';

const log = createLogger('server');

async function main() {
  await bootstrapInfra();
  await reconcilePendingJobs();

  const server = createApp().listen(config.port, () => {
    log.info(`API on ${config.backendUrl}  ·  queue dashboard ${config.backendUrl}/admin/queues`);
  });

  const closers: (() => Promise<unknown>)[] = [
    () => new Promise((resolve) => server.close(resolve)),
  ];
  if (config.worker.runInApiProcess) {
    const worker = createEmailWorker();
    closers.unshift(() => worker.close());
  } else {
    log.info('RUN_WORKER_IN_API_PROCESS=false — start workers with `npm run start:worker`');
  }
  onShutdown(closers);
}

main().catch((err) => {
  log.error('fatal startup error', err);
  process.exit(1);
});
