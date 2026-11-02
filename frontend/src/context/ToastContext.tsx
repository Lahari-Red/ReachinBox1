import { createContext, ReactNode, useCallback, useContext, useState } from 'react';

type ToastKind = 'success' | 'error' | 'info';
interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

const ToastContext = createContext<((message: string, kind?: ToastKind) => void) | null>(null);

const styles: Record<ToastKind, string> = {
  success: 'border-brand-500/30 bg-white text-ink-900 [&>span]:bg-brand-500',
  error: 'border-red-500/30 bg-white text-ink-900 [&>span]:bg-red-500',
  info: 'border-ink-300 bg-white text-ink-900 [&>span]:bg-ink-500',
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const show = useCallback((message: string, kind: ToastKind = 'info') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, kind, message }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`animate-toast-in pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 text-sm shadow-card ${styles[t.kind]}`}
          >
            <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" />
            <p>{t.message}</p>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
