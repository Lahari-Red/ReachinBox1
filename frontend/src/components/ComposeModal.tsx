import { ChangeEvent, DragEvent, FormEvent, useState } from 'react';
import { ApiError } from '../api/client';
import { emailApi } from '../api/endpoints';
import { useToast } from '../context/ToastContext';
import { parseLeads, readFileText } from '../utils/parseLeads';
import { toLocalInputValue } from '../utils/format';
import { Button } from './ui/Button';
import { Input, Textarea } from './ui/Field';
import { Modal } from './ui/Modal';

interface Props {
  open: boolean;
  onClose: () => void;
  onScheduled: () => void;
}

interface FormState {
  subject: string;
  body: string;
  startTime: string;
  delaySeconds: string;
  hourlyLimit: string;
}

const initialForm = (): FormState => ({
  subject: '',
  body: '',
  startTime: toLocalInputValue(new Date(Date.now() + 60_000)),
  delaySeconds: '2',
  hourlyLimit: '100',
});

export function ComposeModal({ open, onClose, onScheduled }: Props) {
  const toast = useToast();
  const [form, setForm] = useState<FormState>(initialForm);
  const [fileName, setFileName] = useState<string | null>(null);
  const [leads, setLeads] = useState<string[]>([]);
  const [dupes, setDupes] = useState(0);
  const [errors, setErrors] = useState<Partial<Record<keyof FormState | 'leads', string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);

  const set = (k: keyof FormState) => (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const reset = () => {
    setForm(initialForm());
    setFileName(null);
    setLeads([]);
    setDupes(0);
    setErrors({});
  };

  const handleFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { emails, duplicates } = parseLeads(await readFileText(file));
      setFileName(file.name);
      setLeads(emails);
      setDupes(duplicates);
      setErrors((e) => ({ ...e, leads: emails.length ? undefined : 'No email addresses found in this file' }));
    } catch {
      toast('Could not read that file', 'error');
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    void handleFile(e.dataTransfer.files[0]);
  };

  const validate = () => {
    const next: typeof errors = {};
    if (!form.subject.trim()) next.subject = 'Subject is required';
    if (!form.body.trim()) next.body = 'Body is required';
    if (!leads.length) next.leads = 'Upload a CSV or text file with at least one email';
    if (!form.startTime || Number.isNaN(new Date(form.startTime).getTime())) next.startTime = 'Pick a start time';
    if (!(Number(form.delaySeconds) >= 0)) next.delaySeconds = 'Must be 0 or more';
    if (!(Number(form.hourlyLimit) >= 1)) next.hourlyLimit = 'Must be at least 1';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    try {
      const res = await emailApi.schedule({
        subject: form.subject.trim(),
        body: form.body,
        recipients: leads,
        startTime: new Date(form.startTime).toISOString(),
        delayBetweenMs: Math.round(Number(form.delaySeconds) * 1000),
        hourlyLimit: Math.floor(Number(form.hourlyLimit)),
      });
      toast(`Scheduled ${res.count} email${res.count === 1 ? '' : 's'}`, 'success');
      reset();
      onScheduled();
      onClose();
    } catch (err) {
      toast(err instanceof ApiError ? err.message : 'Failed to schedule emails', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const delayMs = Number(form.delaySeconds) * 1000;
  const lastAt = leads.length && form.startTime ? new Date(new Date(form.startTime).getTime() + (leads.length - 1) * delayMs) : null;

  return (
    <Modal
      open={open}
      title="Compose new email"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={submitting}>
            Schedule{leads.length ? ` ${leads.length}` : ''}
          </Button>
        </>
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <Input label="Subject" placeholder="Quick question about {company}" value={form.subject} onChange={set('subject')} error={errors.subject} />
        <Textarea label="Body" placeholder="Hi there,…" value={form.body} onChange={set('body')} error={errors.body} />

        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium uppercase tracking-wide text-ink-500">Leads</span>
          <label
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={`flex cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed px-4 py-6 text-center transition-colors ${
              dragging ? 'border-brand-500 bg-brand-50' : errors.leads ? 'border-red-300' : 'border-ink-300 hover:border-brand-500'
            }`}
          >
            <input type="file" accept=".csv,.txt,text/csv,text/plain" className="sr-only" onChange={(e) => void handleFile(e.target.files?.[0])} />
            {fileName ? (
              <>
                <p className="text-sm font-medium">{fileName}</p>
                <p className="text-sm text-brand-700">
                  <strong>{leads.length}</strong> email address{leads.length === 1 ? '' : 'es'} detected
                  {dupes > 0 && <span className="text-ink-500"> · {dupes} duplicate{dupes === 1 ? '' : 's'} removed</span>}
                </p>
                <p className="text-xs text-ink-500">Click or drop to replace</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">Upload CSV or TXT</p>
                <p className="text-xs text-ink-500">Drop a file here or click to browse — any column layout works</p>
              </>
            )}
          </label>
          {errors.leads && <p className="text-xs text-red-600">{errors.leads}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Input label="Start time" type="datetime-local" value={form.startTime} onChange={set('startTime')} error={errors.startTime} />
          <Input label="Delay between emails (s)" type="number" min={0} step={0.5} value={form.delaySeconds} onChange={set('delaySeconds')} error={errors.delaySeconds} />
          <Input label="Hourly limit" type="number" min={1} value={form.hourlyLimit} onChange={set('hourlyLimit')} error={errors.hourlyLimit} />
        </div>

        {lastAt && (
          <p className="rounded-lg bg-ink-50 px-3 py-2 text-xs text-ink-500">
            Sends are staggered {form.delaySeconds}s apart; the last one is planned for{' '}
            <span className="font-medium text-ink-700">{lastAt.toLocaleString()}</span>. Anything over {form.hourlyLimit}/hour automatically rolls
            into the next hour.
          </p>
        )}
        <button type="submit" className="hidden" />
      </form>
    </Modal>
  );
}
