import { InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, useId } from 'react';

const control =
  'w-full rounded-lg border border-ink-300 bg-white px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 disabled:bg-ink-100';

interface FieldShellProps {
  label: string;
  hint?: ReactNode;
  error?: string;
  id: string;
  children: ReactNode;
}

function FieldShell({ label, hint, error, id, children }: FieldShellProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium uppercase tracking-wide text-ink-500">
        {label}
      </label>
      {children}
      {error ? <p className="text-xs text-red-600">{error}</p> : hint && <p className="text-xs text-ink-500">{hint}</p>}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: ReactNode; error?: string };

export function Input({ label, hint, error, className = '', ...rest }: InputProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} id={id}>
      <input id={id} className={`${control} h-10 ${error ? 'border-red-400' : ''} ${className}`} {...rest} />
    </FieldShell>
  );
}

type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: ReactNode; error?: string };

export function Textarea({ label, hint, error, className = '', ...rest }: TextareaProps) {
  const id = useId();
  return (
    <FieldShell label={label} hint={hint} error={error} id={id}>
      <textarea id={id} className={`${control} min-h-[140px] resize-y ${error ? 'border-red-400' : ''} ${className}`} {...rest} />
    </FieldShell>
  );
}
