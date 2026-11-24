import { create } from 'zustand';

/**
 * When this screen last got the product catalogue from the server (full load or delta, docs/pos-keys-refresh.md).
 * The POS shows it next to the F5 "รีเฟรชข้อมูล" button; null = not yet (or only the offline copy so far).
 */
export const useSyncStatus = create<{ lastSyncAt: number | null; refreshing: boolean }>(() => ({ lastSyncAt: null, refreshing: false }));

export function noteCatalogueSynced(at = Date.now()) {
  useSyncStatus.setState({ lastSyncAt: at });
}

/** 14:05:32 (Thai clock, 24 h) */
export function syncClock(at: number | null): string {
  if (!at) return '-';
  const d = new Date(at);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
