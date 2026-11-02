import { useEffect, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { Avatar } from './ui/Avatar';

export function Header() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  if (!user) return null;
  const name = user.name ?? user.email;

  return (
    <header className="sticky top-0 z-30 border-b border-ink-100 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-sm font-bold text-white">R</span>
          <span className="font-semibold">ReachInbox</span>
          <span className="hidden rounded-md bg-ink-100 px-2 py-0.5 text-xs text-ink-500 sm:inline">Scheduler</span>
        </div>

        <div ref={ref} className="relative">
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-3 rounded-full py-1 pl-1 pr-3 hover:bg-ink-100"
            aria-haspopup="menu"
            aria-expanded={open}
          >
            <Avatar src={user.avatarUrl} name={name} />
            <span className="hidden text-left sm:block">
              <span className="block text-sm font-medium leading-tight">{name}</span>
              <span className="block text-xs leading-tight text-ink-500">{user.email}</span>
            </span>
          </button>
          {open && (
            <div role="menu" className="absolute right-0 mt-2 w-56 rounded-xl border border-ink-100 bg-white p-1 shadow-card">
              <div className="px-3 py-2 sm:hidden">
                <p className="text-sm font-medium">{name}</p>
                <p className="text-xs text-ink-500">{user.email}</p>
              </div>
              <button
                role="menuitem"
                onClick={logout}
                className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50"
              >
                Log out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
