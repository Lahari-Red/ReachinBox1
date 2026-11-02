interface TabsProps<K extends string> {
  tabs: { key: K; label: string; count?: number }[];
  active: K;
  onChange: (key: K) => void;
}

export function Tabs<K extends string>({ tabs, active, onChange }: TabsProps<K>) {
  return (
    <div role="tablist" className="flex gap-1 rounded-xl bg-ink-100 p-1">
      {tabs.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.key)}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              selected ? 'bg-white text-ink-900 shadow-sm' : 'text-ink-500 hover:text-ink-900'
            }`}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={`rounded-full px-2 py-0.5 text-xs ${selected ? 'bg-brand-50 text-brand-700' : 'bg-white/70'}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
