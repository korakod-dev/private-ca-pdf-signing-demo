// Data hook for pages: runs an API call, and runs it again whenever `deps` or the store's `dataVersion` change
// (persona switch, clock advance, fault change, reset, login/logout). Stale answers are ignored.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiError, ApiResult } from '../contracts/api-client';
import { useAppStore } from '../store';

export interface UseApiState<T> {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  /** Runs the call again without changing deps. */
  reload: () => void;
}

export function useApi<T>(fn: () => Promise<ApiResult<T>>, deps: readonly unknown[] = []): UseApiState<T> {
  const dataVersion = useAppStore((s) => s.dataVersion);
  const [state, setState] = useState<{ data: T | null; error: ApiError | null; loading: boolean }>({
    data: null,
    error: null,
    loading: true,
  });
  const [reloadTick, setReloadTick] = useState(0);

  // Always call the latest `fn` (it usually closes over props) without making it a dependency itself.
  const fnRef = useRef(fn);
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    // Keep the previous data while reloading so tables do not flash empty; only flip the loading flag.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- starting a fetch legitimately flips the loading flag
    setState((s) => ({ ...s, loading: true }));
    fnRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setState(result.ok ? { data: result.data, error: null, loading: false } : { data: null, error: result.error, loading: false });
      })
      .catch(() => {
        // The client reports failures as results; a throw means the transport broke. Show it as a network error.
        if (cancelled) return;
        setState({ data: null, error: { status: 0, code: 'NETWORK_ERROR', title: 'ติดต่อระบบไม่ได้', problem: null }, loading: false });
      });
    return () => {
      cancelled = true;
    };
    // `deps` is caller-supplied and spread on purpose (documented contract of this hook).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, dataVersion, reloadTick]);

  const reload = useCallback(() => setReloadTick((n) => n + 1), []);
  return { ...state, reload };
}
