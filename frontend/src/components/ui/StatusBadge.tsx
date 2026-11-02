import type { EmailStatus } from '../../types';

const config: Record<EmailStatus, { label: string; cls: string }> = {
  scheduled: { label: 'Scheduled', cls: 'bg-sky-50 text-sky-700 ring-sky-600/20' },
  rate_limited: { label: 'Rate limited', cls: 'bg-amber-50 text-amber-700 ring-amber-600/20' },
  sending: { label: 'Sending', cls: 'bg-violet-50 text-violet-700 ring-violet-600/20' },
  sent: { label: 'Sent', cls: 'bg-brand-50 text-brand-700 ring-brand-600/20' },
  failed: { label: 'Failed', cls: 'bg-red-50 text-red-700 ring-red-600/20' },
};

export function StatusBadge({ status, title }: { status: EmailStatus; title?: string }) {
  const c = config[status];
  return (
    <span title={title} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${c.cls}`}>
      {c.label}
    </span>
  );
}
