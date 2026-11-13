'use client';

import { useEffect, useReducer } from 'react';
import { apiFetch } from '@/lib/api';
import { errorMessage } from '@/components/common/LoadErrorState';

/**
 * Read-only GETs of the mobile summary page with the last response kept in memory (per URL), so
 * switching tabs shows the previous figures at once instead of loading again. Only the server's
 * answer is kept (nothing in browser storage). A response older than MAX_AGE_MS is fetched again
 * when its tab is shown; the refresh button fetches the active tab's data now.
 */
const MAX_AGE_MS = 5 * 60_000;

interface Entry {
  data?: unknown;
  error?: string;
  at?: number;
  loading?: boolean;
}

const cache = new Map<string, Entry>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

async function load(url: string) {
  const prev = cache.get(url) || {};
  cache.set(url, { ...prev, loading: true, error: undefined });
  notify();
  try {
    const data = await apiFetch<unknown>(url);
    cache.set(url, { data, at: Date.now(), loading: false });
  } catch (err) {
    cache.set(url, { ...cache.get(url), loading: false, error: errorMessage(err, 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้') });
  }
  notify();
}

/** Fetches `url` now (refresh button / retry). */
export function reloadMobileData(url: string | null) {
  if (url) void load(url);
}

/** Time of the newest response in memory (for "อัปเดตล่าสุด"). */
export function lastMobileUpdate(): number | null {
  let max = 0;
  for (const e of cache.values()) if (e.at && e.at > max) max = e.at;
  return max || null;
}

export function forgetMobileData() {
  cache.clear();
  notify();
}

/** Re-renders on every cache change: whether a request is running and the newest response time. */
export function useMobileStatus(): { loading: boolean; updatedAt: number | null } {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, []);
  let loading = false;
  for (const e of cache.values()) if (e.loading) loading = true;
  return { loading, updatedAt: lastMobileUpdate() };
}

export function useMobileData<T>(url: string | null): { data: T | undefined; error: string | undefined; loading: boolean; at: number | undefined } {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => {
    listeners.add(rerender);
    return () => {
      listeners.delete(rerender);
    };
  }, []);
  useEffect(() => {
    if (!url) return;
    const e = cache.get(url);
    if (e?.loading) return;
    if (e?.data !== undefined && e.at && Date.now() - e.at < MAX_AGE_MS) return;
    void load(url);
  }, [url]);
  const e = url ? cache.get(url) : undefined;
  return {
    data: e?.data as T | undefined,
    error: e?.error,
    // nothing yet = loading (the effect starts the request right after this render)
    loading: Boolean(url) && (!e || Boolean(e.loading)),
    at: e?.at,
  };
}
