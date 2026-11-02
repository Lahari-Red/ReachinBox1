import { useState } from 'react';
import { slackApi } from '../api/endpoints';
import { useToast } from '../context/ToastContext';
import { usePolledQuery } from '../hooks/usePolledQuery';
import { Button } from './ui/Button';

export function SlackConnect() {
  const toast = useToast();
  const { data, refetch } = usePolledQuery(slackApi.status, [], 0);
  const [busy, setBusy] = useState<'connect' | 'test' | 'disconnect' | null>(null);

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const connect = () =>
    run('connect', async () => {
      const { url } = await slackApi.installUrl();
      window.location.href = url; // real OAuth authorize flow; Slack redirects back to the API callback
    });

  if (!data) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-ink-100 bg-white px-4 py-3 shadow-card">
      <SlackLogo />
      <div className="mr-auto min-w-0">
        <p className="text-sm font-medium">Slack alerts</p>
        <p className="truncate text-xs text-ink-500">
          {data.connected
            ? `Connected to ${data.teamName ?? 'workspace'} ${data.channel ?? ''} — notified when a sender hits its hourly limit`
            : data.configured
              ? 'Get a Slack message the moment a sender hits its hourly limit'
              : 'Slack app credentials not configured on the server'}
        </p>
      </div>
      {data.connected ? (
        <>
          <Button size="sm" variant="secondary" loading={busy === 'test'} onClick={() => run('test', async () => {
            await slackApi.test();
            toast('Test message sent to Slack', 'success');
          })}>
            Send test
          </Button>
          <Button size="sm" variant="danger" loading={busy === 'disconnect'} onClick={() => run('disconnect', async () => {
            await slackApi.disconnect();
            toast('Slack disconnected', 'info');
            await refetch();
          })}>
            Disconnect
          </Button>
        </>
      ) : (
        <Button size="sm" variant="secondary" disabled={!data.configured} loading={busy === 'connect'} onClick={connect}>
          Connect Slack
        </Button>
      )}
    </div>
  );
}

function SlackLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 54 54" aria-hidden>
      <path fill="#E01E5A" d="M19.7 32.1a5 5 0 1 1-5-5h5v5Zm2.5 0a5 5 0 0 1 10 0v12.4a5 5 0 1 1-10 0V32.1Z" />
      <path fill="#36C5F0" d="M27.2 12.1a5 5 0 1 1 5-5v5h-5Zm0 2.5a5 5 0 0 1 0 10H14.7a5 5 0 1 1 0-10h12.5Z" />
      <path fill="#2EB67D" d="M47.1 19.6a5 5 0 1 1 5 5h-5v-5Zm-2.5 0a5 5 0 0 1-10 0V7.1a5 5 0 1 1 10 0v12.5Z" />
      <path fill="#ECB22E" d="M39.6 39.5a5 5 0 1 1-5 5v-5h5Zm0-2.5a5 5 0 0 1 0-10h12.5a5 5 0 1 1 0 10H39.6Z" />
    </svg>
  );
}
