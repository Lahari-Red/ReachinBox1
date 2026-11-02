import { useCallback, useEffect, useRef, useState } from 'react';

interface State<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/**
 * Loads data and re-polls on an interval (pauses while the tab is hidden).
 * Keeps showing the previous data during refreshes so tables don't flicker.
 */
export function usePolledQuery<T>(fetcher: () => Promise<T>, deps: unknown[], intervalMs = 5000) {
  const [state, setState] = useState<State<T>>({ data: null, loading: true, error: null });
  const fetchRef = useRef(fetcher);
  fetchRef.current = fetcher;

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fetchRef.current();
      setState({ data, loading: false, error: null });
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
    }
  }, []);

  useEffect(() => {
    setState({ data: null, loading: true, error: null });
    void load();
    if (!intervalMs) return;
    const id = setInterval(() => document.visibilityState === 'visible' && void load(), intervalMs);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, intervalMs, ...deps]);

  return { ...state, refetch: load };
}
