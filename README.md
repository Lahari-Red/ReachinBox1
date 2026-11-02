# ReachInbox — Full-stack Email Job Scheduler

A production-style email scheduler: an **Express + TypeScript** API that persists send requests in **Postgres**, schedules each email as a **BullMQ delayed job** in **Redis** (no cron anywhere), sends through **Ethereal SMTP** from multiple sender mailboxes, enforces **per-sender and per-campaign hourly limits** that are safe across many workers, alerts the user on **Slack** when a limit is hit, indexes everything in **Elasticsearch**, and exposes a **live Bull Board** queue dashboard. A **React + Tailwind** dashboard handles Google login, composing campaigns from a CSV, and tracking scheduled/sent emails.

```
reachinbox-scheduler/
├── docker-compose.yml        Postgres 16 · Redis 7 (AOF) · Elasticsearch 8
├── sample-leads.csv
├── backend/                  Express API + BullMQ worker (TypeScript)
│   ├── src/
│   │   ├── server.ts         API entry (optionally runs the worker in-process)
│   │   ├── worker.ts         standalone worker entry — scale horizontally
│   │   ├── app.ts            routes + Bull Board at /admin/queues
│   │   ├── config.ts         every tunable comes from env
│   │   ├── db/               pg pool, transactions, idempotent schema migration
│   │   ├── queue/            emailQueue (producer) · emailWorker (processor)
│   │   ├── services/         scheduler · rateLimiter · senders · search · slack
│   │   ├── routes/           auth · emails · slack
│   │   └── middleware/       JWT auth · error handling
│   └── scripts/load-test.ts  schedules 1000+ emails at the same instant
└── frontend/                 Vite + React 18 + TypeScript + Tailwind
    └── src/
        ├── api/              typed fetch client + endpoint functions
        ├── components/ui/    Button, Field, Modal, DataTable, StatusBadge, Spinner, EmptyState, Avatar
        ├── components/       Header, Tabs, EmailTable, ComposeModal, SlackConnect, SearchBar
        ├── context/          Auth + Toast providers
        ├── hooks/            usePolledQuery (live-refreshing tables)
        └── pages/            LoginPage, DashboardPage
```

---

## Quick start

### 1. Infrastructure
```bash
docker compose up -d          # postgres:5432, redis:6379, elasticsearch:9200
```

### 2. Backend
```bash
cd backend
cp .env.example .env          # fill in GOOGLE_CLIENT_ID (+ Slack, see below)
npm install
npm run dev                   # API + worker on http://localhost:4000
```
On first boot the backend creates its tables, the Elasticsearch index, and **3 Ethereal sender accounts** (persisted in Postgres so restarts reuse them). Their credentials are logged — log in at https://ethereal.email to see delivered mail. Each sent email in the dashboard also has a **"View on Ethereal"** link.

Run the worker as separate processes instead (any number of them):
```bash
RUN_WORKER_IN_API_PROCESS=false npm run dev     # API only
npm run dev:worker                               # worker #1
npm run dev:worker                               # worker #2 …
```
Production: `npm run build && npm start` / `npm run start:worker`.

Queue dashboard: **http://localhost:4000/admin/queues** (optional basic auth via `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD`).

### 3. Frontend
```bash
cd frontend
cp .env.example .env          # VITE_GOOGLE_CLIENT_ID
npm install
npm run dev                   # http://localhost:5173  (proxies /api → :4000)
```

### Environment setup

**Ethereal** — nothing to do; accounts are auto-created. To use specific accounts, create them at https://ethereal.email and set `ETHEREAL_ACCOUNTS=user1@ethereal.email:pass1,user2@ethereal.email:pass2`.

**Google OAuth** — Google Cloud Console → Credentials → *OAuth client ID (Web)*. Authorized JavaScript origin: `http://localhost:5173`. Put the same client id in `backend/.env` (`GOOGLE_CLIENT_ID`) and `frontend/.env` (`VITE_GOOGLE_CLIENT_ID`).

**Slack** — create an app at https://api.slack.com/apps → *OAuth & Permissions*:
- Bot scope: `incoming-webhook`
- Redirect URL: `https://<public-backend-url>/api/slack/callback` — Slack requires HTTPS, so for local dev expose the backend with `ngrok http 4000` (or cloudflared) and set `SLACK_REDIRECT_URI` to that URL.
- Copy *Client ID* / *Client Secret* into `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET`.

| Variable | Default | Meaning |
|---|---|---|
| `WORKER_CONCURRENCY` | `5` | parallel jobs per worker process |
| `MIN_DELAY_BETWEEN_EMAILS_MS` | `2000` | min gap between two sends **from the same sender** |
| `MAX_EMAILS_PER_HOUR_PER_SENDER` | `200` | hard per-mailbox hourly ceiling |
| `DEFAULT_CAMPAIGN_HOURLY_LIMIT` | `100` | used if a request omits `hourlyLimit` |
| `MAX_SEND_ATTEMPTS` | `3` | SMTP retries (exponential backoff from 10 s) |
| `ETHEREAL_SENDER_COUNT` | `3` | sender mailboxes auto-created when `ETHEREAL_ACCOUNTS` is empty |

---

## Deploying (Render + Vercel)

1. **Push the repo to GitHub.**
2. **Backend: Render** → *New → Blueprint* → select the repo. `render.yaml` creates the API (with the worker in-process), Redis and Postgres.
3. **Elasticsearch:** create a free sandbox on [Bonsai](https://bonsai.io) (or an Elastic Cloud trial) and set `ELASTICSEARCH_URL` on the API service to its full URL, including credentials.
4. **Frontend: Vercel** → import the repo, *Root Directory* = `frontend`, framework *Vite*. Env vars:
   `VITE_API_URL=https://<api>.onrender.com`, `VITE_GOOGLE_CLIENT_ID=…`, `VITE_BULL_BOARD_URL=https://<api>.onrender.com/admin/queues`
5. **Back on Render**, set `BACKEND_URL`, `FRONTEND_URL` (the Vercel URL, used for CORS and the Slack redirect back), `GOOGLE_CLIENT_ID`, the Slack keys, and `SLACK_REDIRECT_URI=https://<api>.onrender.com/api/slack/callback`. Then redeploy.
6. **Google Console:** add the Vercel URL to *Authorized JavaScript origins*. **Slack app:** add the Render callback URL to *Redirect URLs*. Render serves HTTPS, so no ngrok is needed in production.
7. **Protect the queue dashboard:** set `BULL_BOARD_USER` / `BULL_BOARD_PASSWORD`, since it will be publicly reachable.

> Render's **free** web plan sleeps after 15 minutes idle, and free Key Value has no disk persistence. Either would break on-time sends and the restart guarantee, so the blueprint uses the small paid tiers (about $7 per month each, prorated). For a short demo window you can switch to free plans, as long as you keep the service awake while recording.

---

## Architecture

```
 React dashboard ──► Express API ──► Postgres (source of truth: campaigns, emails, users, senders, slack)
                         │    └────► Elasticsearch (search read-model, best-effort)
                         ▼
                  BullMQ queue "email-send"  (Redis, AOF)
                  one DELAYED job per email, jobId = email UUID
                         ▼
     Worker(s) ── hourly budget (Redis Lua) ── send gate (Redis Lua) ── atomic DB claim ── SMTP (Ethereal)
                         │ limit hit
                         └──► re-delay into next window  +  Slack webhook (once per window)
```

### How scheduling works
1. `POST /api/emails/schedule` validates input (zod), de-duplicates recipients, and in **one transaction** inserts the campaign plus one `emails` row per recipient. Row *i* gets `scheduled_at = startTime + i × delayBetweenMs` and a sender assigned **round-robin** across mailboxes.
2. After commit, one BullMQ job per email is added with `delay = scheduled_at − now` and **`jobId = email.id`** (bulk-added in chunks of 500 — 1000 emails schedule in ~0.6 s).
3. BullMQ promotes the job when its time comes; the worker loads the row and sends.

There is **no cron, no polling loop, no `repeat` jobs** — timing comes purely from BullMQ's delayed-job sorted set. (`cron-parser` appears in `node_modules` only as an internal dependency of BullMQ for its *repeatable* jobs feature, which this project does not use.)

### Persistence across restarts
- **Redis** holds every delayed job and runs with AOF (`appendonly yes`), so a process or Redis restart loses nothing. When the API/worker comes back, overdue jobs are promoted and sent immediately; future ones fire on time.
- **Postgres** is the source of truth. On every boot, `reconcilePendingJobs()` compares pending rows with the queue and **re-enqueues any email that has no live job** (covers a crash between DB commit and enqueue, or even a fully wiped Redis) using the original `scheduled_at`.
- **Graceful shutdown** (`SIGTERM`/`SIGINT`) calls `worker.close()`, which waits for in-flight sends before exiting.

### Idempotency — an email is never sent twice
1. **Queue level:** `jobId = email UUID`, so enqueueing the same email again (reconcile, retries, double submits) is a no-op in BullMQ.
2. **Row state check:** the worker skips rows already `sent`, `failed` or `sending`.
3. **Atomic claim:** right before SMTP, `UPDATE emails SET status='sending' WHERE id=$1 AND status IN ('scheduled','rate_limited') RETURNING id`. Only one worker anywhere can win that transition.
4. **Stable `Message-ID`** (`<email-uuid@reachinbox-scheduler>`) so a provider can de-dupe too.
5. **Crash mid-send:** a row stuck in `sending` for >2 min is marked `failed` on boot rather than retried. We can't know whether the SMTP server accepted it, and for outbound email *at-most-once* is the safer trade-off than a possible duplicate.
6. Recipients are unique per campaign (`UNIQUE (campaign_id, recipient)`).

### Concurrency
Workers run with `concurrency = WORKER_CONCURRENCY`, and you can run as many worker processes as you want. Everything shared lives in Redis or Postgres (claims, counters, gates), never in memory, so parallel jobs and multiple instances are safe. Different senders send truly in parallel; sends from the same sender are serialized by the send gate below.

### Delay between emails (two layers)
- **Campaign spacing (user-chosen in Compose):** each email's `scheduled_at` is staggered by `delayBetweenMs`.
- **Provider throttle (`MIN_DELAY_BETWEEN_EMAILS_MS`, default 2 s per sender):** a Redis Lua script stores each sender's next free send instant. A worker atomically books the next instant and sleeps until it arrives. The script uses Redis `TIME`, so all instances share one clock. This guarantees ≥ 2 s between send starts from the same mailbox, no matter how many workers or instances are running. I chose this over BullMQ's global `limiter` because that limiter is queue-wide (it would serialize *all* senders) and it would also throttle jobs that only need to be re-delayed.

### Hourly rate limiting
Two budgets are checked **in a single atomic Lua script** per send:
- `rl:sender:{senderId}:{hourWindow}` ≤ `MAX_EMAILS_PER_HOUR_PER_SENDER` (env)
- `rl:campaign:{campaignId}:{hourWindow}` ≤ the campaign's **Hourly limit** from the Compose form

The script increments both counters only if both have room, so the check-and-consume step can't race across workers. Keys expire after 2 h.

**When a limit is hit**, the job is **not dropped or failed**:
1. A per-scope cursor (`rl:cursor:{scope}:{id}:{nextWindow}`, Redis `INCR`) gives the job the next free position. Position *n* maps to `nextWindow + ⌊n/limit⌋ h + (n mod limit) × minDelay`. Deferred jobs therefore **keep their relative order** and get packed exactly `limit` per hour into the following hours, instead of all stampeding at hh:00.
2. The row becomes `rate_limited` with its new `scheduled_at` (visible in the dashboard), and the job is moved back to BullMQ's delayed set (`job.moveToDelayed` + `DelayedError`). This does not count as a failed attempt.
3. **Slack:** the first job to hit a given scope in a given hour wins a `SET NX` key and sends exactly one alert to the owner's Slack.

### Behaviour under load (1000+ emails at the same time)
Verified locally with `scripts/load-test.ts` (1000 recipients, `delayBetweenMs=0`, campaign limit 50/h):
- API accepted and enqueued all 1000 in **0.58 s** (one transaction plus bulk `addBulk`).
- **50 sent** in the current hour. The other **950 were re-delayed and spread evenly at 50 per hour over the next 19 hours**, in original order.
- **1 Slack notification** fired (deduped per scope per window), not 950.
- Jobs that are waiting don't hold a worker slot. They sit in Redis's delayed sorted set, so memory and CPU stay flat no matter how far ahead the backlog extends.

### Slack integration
- **Connect:** dashboard *Connect Slack* → `GET /api/slack/install-url` → browser goes to `slack.com/oauth/v2/authorize` (scope `incoming-webhook`, `state` = signed 10-minute JWT carrying the user id) → Slack redirects to `/api/slack/callback` → the backend exchanges the code via `oauth.v2.access` and stores the webhook **per user** in `slack_integrations` → posts a "connected" message → redirects back to the dashboard.
- **Notify:** the integration is looked up **on every alert, with no cache**, so connecting or disconnecting takes effect immediately without a redeploy. No integration means no notification and no error.
- **Disconnect/revocation:** the *Disconnect* button deletes the row. If Slack answers 404/410/`no_service` (app removed, channel deleted), the stale integration is dropped automatically. *Send test* posts a test message on demand.

### Search (Elasticsearch)
Every email is indexed at schedule time and updated when its status changes (`rate_limited`, `sent`, `failed`). `GET /api/emails/search?q=&status=` runs a fuzzy `multi_match` over recipient^3, subject^2 and body, always filtered to the current user. The dashboard search box uses it. Elasticsearch is treated as a **read model**: if it's down, scheduling and sending carry on unaffected, and the backend retries the connection every 30 s.

### Auth
Google Identity Services runs the real Google OAuth consent flow in the browser and returns a Google-signed ID token. The backend verifies the signature and audience with `google-auth-library`, upserts the user, and issues a 7-day session JWT. The header shows the user's name, email and avatar, plus Logout.

---

## API

| Method | Path | Notes |
|---|---|---|
| POST | `/api/auth/google` | `{ credential }` → `{ token, user }` |
| GET | `/api/auth/me` | current user |
| POST | `/api/emails/schedule` | `{ subject, body, recipients[], startTime, delayBetweenMs, hourlyLimit }` |
| GET | `/api/emails/scheduled?page&pageSize` | scheduled + rate_limited + sending |
| GET | `/api/emails/sent?page&pageSize` | sent + failed |
| GET | `/api/emails/stats` | counts by status |
| GET | `/api/emails/search?q&status` | Elasticsearch |
| GET | `/api/emails/senders` | sender mailboxes + active limits |
| GET | `/api/slack/status` · `/install-url` · `/callback` | OAuth flow |
| POST / DELETE | `/api/slack/test` · `/api/slack` | test message · disconnect |
| GET | `/admin/queues` | Bull Board |

---

## Features implemented

**Backend**
- [x] Scheduler: BullMQ delayed jobs, one per email, no cron
- [x] Postgres persistence with transactional campaign creation
- [x] Restart safety: Redis AOF, boot-time reconcile against Postgres, graceful shutdown
- [x] Idempotency: jobId = email id, atomic DB claim, stable Message-ID, at-most-once on crash
- [x] Multiple Ethereal senders with round-robin assignment, auto-provisioned and persisted
- [x] Configurable worker concurrency; multi-process workers
- [x] Min delay between sends per sender (Redis Lua gate)
- [x] Hourly limits per sender (env) and per campaign (user input), Redis Lua, multi-instance safe
- [x] Over-limit jobs re-delayed into following windows, order preserved, never dropped
- [x] Slack OAuth (real `oauth.v2.access`), per-user webhook, live alert on limit hit, disconnect/reconnect without redeploy
- [x] Elasticsearch indexing and search
- [x] Live Bull Board dashboard
- [x] SMTP retries with exponential backoff; final failures recorded with their error

**Frontend**
- [x] Real Google login → dashboard; header with name, email, avatar and logout
- [x] Scheduled / Sent tabs with live counts; stats cards
- [x] Compose modal: subject, body, CSV/TXT upload (drag & drop) with detected-address count and duplicate removal, start time, delay, hourly limit, send-time preview
- [x] Tables with loading states, empty states, status badges, pagination, Ethereal preview links; auto-refresh every 5 s
- [x] Search box (Elasticsearch), Connect/Test/Disconnect Slack
- [x] Toasts for success and errors; inline form validation
- [x] Reusable typed UI components; typed API layer

---

## Verified scenarios (run locally before submission)

| Scenario | Result |
|---|---|
| 10 emails, 2 senders, limit 3/sender/h | 6 sent (3 each, ≥500 ms apart per sender); 4 → `rate_limited` at 19:00:00.000 / 19:00:00.500 per sender |
| `SIGKILL` the server 12 s before 4 emails were due, restart after they were overdue | All 4 sent once on restart; 0 duplicate Message-IDs |
| Stop server **and `FLUSHALL` Redis**, restart before the due time | Reconcile re-enqueued from Postgres; email delivered 260 ms after its scheduled time |
| 1000 emails at the same instant, campaign limit 50/h | Enqueued in 0.58 s; 50 sent, 950 spread 50/h over 19 h; 1 Slack alert |
| Elasticsearch down | Scheduling and sending unaffected; search returns 503 with a clear message |

## Assumptions & trade-offs
- **Figma:** the brief's Figma link wasn't available to me, so the UI follows the requirements (header, tabs, compose modal, tables) with a clean, consistent design system. Visual tweaks to match the exact Figma would be simple, since styling lives in shared components and the Tailwind theme.
- **At-most-once on crash mid-SMTP:** I preferred marking the email failed over risking a duplicate (see Idempotency).
- **Hour windows are clock hours (UTC)**, not rolling 60-minute windows. This is simpler and cheaper, at the cost of allowing up to 2× the limit across a boundary (e.g. 59th minute plus 0th minute). A sliding-window ZSET would fix that if needed.
- **Campaign hourly limit is per campaign**, while the per-sender env limit protects each mailbox across all campaigns. Both must have room.
- **Min-delay measures send starts**, not SMTP completion.
- **Sessions are stateless JWTs** in `localStorage`; logout discards the token. HttpOnly cookies would be the next hardening step.
- **Bull Board is open by default** in dev; set `BULL_BOARD_USER`/`BULL_BOARD_PASSWORD` to protect it.
- **Redis Cluster:** the Lua script touches two keys; on a cluster they'd need a shared hash tag. Not needed on a single Redis.
- **Slack webhooks** post to the channel the user picked during OAuth. A bot token with `chat:write` would allow changing channels later.
