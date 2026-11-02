import { useEffect, useState } from 'react';

/** Debounced search input; emits the trimmed query after the user pauses typing. */
export function SearchBar({ onSearch, placeholder }: { onSearch: (q: string) => void; placeholder?: string }) {
  const [value, setValue] = useState('');

  useEffect(() => {
    const id = setTimeout(() => onSearch(value.trim()), 350);
    return () => clearTimeout(id);
  }, [value, onSearch]);

  return (
    <div className="relative w-full sm:w-72">
      <svg className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-500" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <circle cx="11" cy="11" r="7" />
        <path d="m20 20-3.5-3.5" />
      </svg>
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder ?? 'Search emails…'}
        className="h-10 w-full rounded-lg border border-ink-300 bg-white pl-9 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20"
      />
    </div>
  );
}
