/**
 * Schedules N emails for (almost) the same instant to demonstrate behaviour under load.
 *   npx tsx scripts/load-test.ts <session-jwt> [count=1000] [hourlyLimit=50]
 * Grab the JWT from the browser's localStorage key "ri_token" after logging in.
 * Watch /admin/queues: jobs beyond the hourly limit move to "delayed" for the next window.
 */
const [token, countArg = '1000', limitArg = '50'] = process.argv.slice(2);
if (!token) {
  console.error('usage: tsx scripts/load-test.ts <jwt> [count] [hourlyLimit]');
  process.exit(1);
}
const api = process.env.API_URL ?? 'http://localhost:4000';
const count = Number(countArg);

(async () => {
  const recipients = Array.from({ length: count }, (_, i) => `lead${i + 1}@example.com`);
  const res = await fetch(`${api}/api/emails/schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      subject: `Load test ${new Date().toISOString()}`,
      body: 'Hello from the load test.',
      recipients,
      startTime: new Date(Date.now() + 5_000).toISOString(),
      delayBetweenMs: 0,
      hourlyLimit: Number(limitArg),
    }),
  });
  console.log(res.status, await res.json());
})();
