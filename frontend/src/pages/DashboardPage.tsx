import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { emailApi } from '../api/endpoints';
import { ComposeModal } from '../components/ComposeModal';
import { EmailTable } from '../components/EmailTable';
import { Header } from '../components/Header';
import { SearchBar } from '../components/SearchBar';
import { SlackConnect } from '../components/SlackConnect';
import { Tabs } from '../components/Tabs';
import { Button } from '../components/ui/Button';
import { useToast } from '../context/ToastContext';
import { usePolledQuery } from '../hooks/usePolledQuery';
import type { EmailItem, EmailStats, SearchHit, TabKey } from '../types';

const PAGE_SIZE = 25;
const TAB_STATUSES: Record<TabKey, string> = { scheduled: 'scheduled,rate_limited,sending', sent: 'sent,failed' };
const BULL_BOARD_URL = import.meta.env.VITE_BULL_BOARD_URL ?? 'http://localhost:4000/admin/queues';

const hitToItem = (h: SearchHit): EmailItem => ({
  ...h,
  error: null,
  preview_url: null,
  attempts: 0,
  campaign_id: 0,
  sender_email: h.sender_email ?? '—',
});

const sum = (s: EmailStats | null, keys: (keyof EmailStats)[]) => (s ? keys.reduce((n, k) => n + (s[k] ?? 0), 0) : undefined);

export function DashboardPage() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [tab, setTab] = useState<TabKey>('scheduled');
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState('');
  const [composeOpen, setComposeOpen] = useState(false);

  // Slack OAuth redirect lands here with ?slack=connected|denied|error
  useEffect(() => {
    const slack = params.get('slack');
    if (!slack) return;
    const messages = {
      connected: ['Slack connected — you will be alerted when hourly limits are hit', 'success'],
      denied: ['Slack connection was cancelled', 'info'],
      error: ['Could not connect Slack. Please try again.', 'error'],
    } as const;
    const [msg, kind] = messages[slack as keyof typeof messages] ?? messages.error;
    toast(msg, kind);
    params.delete('slack');
    setParams(params, { replace: true });
  }, [params, setParams, toast]);

  const stats = usePolledQuery(emailApi.stats, [], 5000);
  const list = usePolledQuery(
    async () => {
      if (query) {
        const { items } = await emailApi.search(query, TAB_STATUSES[tab]);
        return { items: items.map(hitToItem), total: items.length, page: 1, pageSize: items.length };
      }
      return emailApi.list(tab, page, PAGE_SIZE);
    },
    [tab, page, query],
    query ? 0 : 5000,
  );

  useEffect(() => {
    if (list.error) toast(list.error, 'error');
  }, [list.error, toast]);

  const changeTab = (t: TabKey) => {
    setTab(t);
    setPage(1);
  };
  const onSearch = useCallback((q: string) => {
    setQuery(q);
    setPage(1);
  }, []);

  const refresh = () => {
    void stats.refetch();
    void list.refetch();
  };

  const totalPages = list.data ? Math.max(1, Math.ceil(list.data.total / PAGE_SIZE)) : 1;
  const s = stats.data;

  return (
    <div className="min-h-screen">
      <Header />
      <main className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Email scheduler</h1>
            <p className="mt-1 text-sm text-ink-500">Schedule outreach, watch it go out, never send twice.</p>
          </div>
          <div className="flex gap-2">
            <a href={BULL_BOARD_URL} target="_blank" rel="noreferrer">
              <Button variant="secondary">Queue dashboard ↗</Button>
            </a>
            <Button onClick={() => setComposeOpen(true)}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M12 5v14M5 12h14" /></svg>
              Compose New Email
            </Button>
          </div>
        </div>

        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatCard label="Scheduled" value={s?.scheduled} />
          <StatCard label="Rate limited" value={s?.rate_limited} tone="amber" />
          <StatCard label="Sent" value={s?.sent} tone="green" />
          <StatCard label="Failed" value={s?.failed} tone="red" />
        </section>

        <SlackConnect />

        <section className="overflow-hidden rounded-2xl border border-ink-100 bg-white shadow-card">
          <div className="flex flex-col gap-3 border-b border-ink-100 p-4 sm:flex-row sm:items-center sm:justify-between">
            <Tabs
              active={tab}
              onChange={changeTab}
              tabs={[
                { key: 'scheduled', label: 'Scheduled Emails', count: sum(s, ['scheduled', 'rate_limited', 'sending']) },
                { key: 'sent', label: 'Sent Emails', count: sum(s, ['sent', 'failed']) },
              ]}
            />
            <SearchBar onSearch={onSearch} placeholder="Search recipient, subject, body…" />
          </div>

          <EmailTable tab={tab} rows={list.data?.items ?? []} loading={list.loading} />

          {!query && list.data && list.data.total > PAGE_SIZE && (
            <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3 text-sm text-ink-500">
              <span>
                Page {page} of {totalPages} · {list.data.total} emails
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>Next</Button>
              </div>
            </div>
          )}
        </section>
      </main>

      <ComposeModal open={composeOpen} onClose={() => setComposeOpen(false)} onScheduled={refresh} />
    </div>
  );
}

function StatCard({ label, value, tone = 'slate' }: { label: string; value?: number; tone?: 'slate' | 'green' | 'amber' | 'red' }) {
  const dot = { slate: 'bg-sky-500', green: 'bg-brand-500', amber: 'bg-amber-500', red: 'bg-red-500' }[tone];
  return (
    <div className="rounded-xl border border-ink-100 bg-white px-4 py-3 shadow-card">
      <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-ink-500">
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        {label}
      </p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value ?? '–'}</p>
    </div>
  );
}
