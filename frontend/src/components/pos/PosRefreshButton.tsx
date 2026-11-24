'use client';

import { RefreshCw } from 'lucide-react';
import { refreshPosData } from '@/lib/pos/pos-refresh';
import { syncClock, useSyncStatus } from '@/lib/sync-status';

/**
 * F5 "รีเฟรชข้อมูล" with the time the catalogue last came from the server (docs/pos-keys-refresh.md).
 * Changes made in the back office arrive by themselves within seconds; F5 forces a full reload of the catalogue,
 * customers and settings (cart, held bills and unsent bills are kept).
 */
export function PosRefreshButton({ className = '' }: { className?: string }) {
  const lastSyncAt = useSyncStatus((s) => s.lastSyncAt);
  const refreshing = useSyncStatus((s) => s.refreshing);
  const clock = syncClock(lastSyncAt);
  return (
    <button
      type="button"
      data-testid="pos-refresh"
      onClick={() => void refreshPosData()}
      disabled={refreshing}
      title={`รีเฟรชข้อมูลสินค้า ลูกค้า และการตั้งค่าจากเซิร์ฟเวอร์ (F5) — ซิงค์ล่าสุด ${clock}; ตะกร้าและบิลพักไม่หาย`}
      aria-label={`รีเฟรชข้อมูล (F5) ซิงค์ล่าสุด ${clock}`}
      className={`flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 shadow-2xs transition-colors hover:bg-slate-50 disabled:opacity-60 ${className}`}
    >
      <RefreshCw className={`h-3.5 w-3.5 text-slate-500 ${refreshing ? 'animate-spin motion-reduce:animate-none' : ''}`} />
      <span className="hidden xl:inline">รีเฟรชข้อมูล</span>
      <span className="rounded border border-slate-300 bg-slate-50 px-1 py-0.5 font-mono text-[10px] text-slate-700">F5</span>
      <span data-testid="pos-last-sync" className="font-normal tabular-nums text-slate-500">{clock}</span>
    </button>
  );
}
