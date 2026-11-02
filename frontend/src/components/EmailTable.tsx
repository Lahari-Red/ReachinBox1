import type { EmailItem, TabKey } from '../types';
import { formatDateTime, relativeTime } from '../utils/format';
import { Column, DataTable } from './ui/DataTable';
import { EmptyState } from './ui/EmptyState';
import { StatusBadge } from './ui/StatusBadge';

const recipientCol: Column<EmailItem> = {
  key: 'email',
  header: 'Email',
  render: (e) => (
    <div className="min-w-[180px]">
      <p className="font-medium text-ink-900">{e.recipient}</p>
      <p className="text-xs text-ink-500">from {e.sender_email}</p>
    </div>
  ),
};

const subjectCol: Column<EmailItem> = {
  key: 'subject',
  header: 'Subject',
  render: (e) => <span className="line-clamp-1 max-w-xs text-ink-700">{e.subject}</span>,
};

const statusCol: Column<EmailItem> = {
  key: 'status',
  header: 'Status',
  render: (e) => <StatusBadge status={e.status} title={e.error ?? undefined} />,
};

const columnsByTab: Record<TabKey, Column<EmailItem>[]> = {
  scheduled: [
    recipientCol,
    subjectCol,
    {
      key: 'time',
      header: 'Scheduled time',
      className: 'whitespace-nowrap',
      render: (e) => (
        <div>
          <p>{formatDateTime(e.scheduled_at)}</p>
          <p className="text-xs text-ink-500">{relativeTime(e.scheduled_at)}</p>
        </div>
      ),
    },
    statusCol,
  ],
  sent: [
    recipientCol,
    subjectCol,
    {
      key: 'time',
      header: 'Sent time',
      className: 'whitespace-nowrap',
      render: (e) => formatDateTime(e.sent_at),
    },
    statusCol,
    {
      key: 'preview',
      header: '',
      className: 'text-right',
      render: (e) =>
        e.preview_url ? (
          <a href={e.preview_url} target="_blank" rel="noreferrer" className="text-xs font-medium text-brand-600 hover:underline">
            View on Ethereal ↗
          </a>
        ) : e.error ? (
          <span className="text-xs text-red-600" title={e.error}>
            {e.error.slice(0, 40)}
          </span>
        ) : null,
    },
  ],
};

const emptyCopy: Record<TabKey, { title: string; description: string }> = {
  scheduled: { title: 'No scheduled emails', description: 'Compose a new email and upload a list of leads to get started.' },
  sent: { title: 'Nothing sent yet', description: 'Emails will show up here as soon as the scheduler delivers them.' },
};

export function EmailTable({ tab, rows, loading }: { tab: TabKey; rows: EmailItem[]; loading: boolean }) {
  return (
    <DataTable
      columns={columnsByTab[tab]}
      rows={rows}
      rowKey={(r) => r.id}
      loading={loading}
      empty={<EmptyState {...emptyCopy[tab]} />}
    />
  );
}
