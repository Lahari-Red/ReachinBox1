import 'dotenv/config';

const str = (key: string, fallback = ''): string => process.env[key] ?? fallback;

const int = (key: string, fallback: number): number => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Env ${key} must be a number, got "${raw}"`);
  return Math.floor(n);
};

const bool = (key: string, fallback: boolean): boolean => {
  const raw = process.env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes'].includes(raw.toLowerCase());
};

const backendUrl = str('BACKEND_URL', 'http://localhost:4000');

export const config = {
  port: int('PORT', 4000),
  backendUrl,
  frontendUrl: str('FRONTEND_URL', 'http://localhost:5173'),
  jwtSecret: str('JWT_SECRET', 'dev-only-secret-change-me'),

  databaseUrl: str('DATABASE_URL', 'postgres://postgres:postgres@localhost:5432/reachinbox'),
  redisUrl: str('REDIS_URL', 'redis://localhost:6379'),
  elasticUrl: str('ELASTICSEARCH_URL', 'http://localhost:9200'),
  elasticIndex: str('ELASTICSEARCH_INDEX', 'emails'),

  google: {
    clientId: str('GOOGLE_CLIENT_ID'),
  },

  slack: {
    clientId: str('SLACK_CLIENT_ID'),
    clientSecret: str('SLACK_CLIENT_SECRET'),
    redirectUri: str('SLACK_REDIRECT_URI', `${backendUrl}/api/slack/callback`),
  },

  worker: {
    /** How many jobs a single worker process handles in parallel. */
    concurrency: int('WORKER_CONCURRENCY', 5),
    /** Global minimum gap between two SMTP sends (BullMQ limiter, Redis-backed). */
    minDelayBetweenEmailsMs: int('MIN_DELAY_BETWEEN_EMAILS_MS', 2000),
    /** Hard ceiling per sender mailbox per clock hour. */
    maxEmailsPerHourPerSender: int('MAX_EMAILS_PER_HOUR_PER_SENDER', 200),
    /** Default per-campaign limit when the request does not specify one. */
    defaultCampaignHourlyLimit: int('DEFAULT_CAMPAIGN_HOURLY_LIMIT', 100),
    maxAttempts: int('MAX_SEND_ATTEMPTS', 3),
    /** Run the BullMQ worker inside the API process (handy for local dev). */
    runInApiProcess: bool('RUN_WORKER_IN_API_PROCESS', true),
  },

  ethereal: {
    /** Optional "user:pass,user:pass" list of existing Ethereal accounts. */
    accounts: str('ETHEREAL_ACCOUNTS'),
    /** If no accounts are given, this many are auto-created on first boot and persisted. */
    autoCreateCount: int('ETHEREAL_SENDER_COUNT', 3),
    host: str('ETHEREAL_HOST', 'smtp.ethereal.email'),
    port: int('ETHEREAL_PORT', 587),
  },

  bullBoard: {
    user: str('BULL_BOARD_USER'),
    password: str('BULL_BOARD_PASSWORD'),
  },
} as const;

export type AppConfig = typeof config;
