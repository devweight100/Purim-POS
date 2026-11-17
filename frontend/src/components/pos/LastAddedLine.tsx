'use client';

import { useCartStore } from '@/lib/store/cart-store';
import { formatQty } from '@/lib/qty';

/**
 * "ล่าสุด: <name> × <qty in the bill> <unit> (รายการที่ N)" - confirmation of the last scan / add next to the
 * total, so the cashier sees it registered without looking at the list. Subscribes on its own (small re-render).
 */
export function LastAddedLine({ className = '' }: { className?: string }) {
  const info = useCartStore((s) => {
    const lt = s.lastTouched;
    if (!lt) return null;
    const idx = s.items.findIndex((i) => i.productId === lt.productId && i.unitId === lt.unitId);
    if (idx < 0) return null;
    const it = s.items[idx];
    return `${it.name}\u0000${formatQty(it.quantity)}\u0000${it.unitName}\u0000${idx + 1}\u0000${lt.seq}`;
  });
  if (!info) return null;
  const [name, qty, unit, n] = info.split('\u0000');
  return (
    <div
      data-testid="pos-last-added"
      role="status"
      aria-live="polite"
      className={`flex min-w-0 items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-bold border-emerald-300 bg-emerald-50 text-emerald-950 ${className}`}
      title={`ล่าสุด: ${name} × ${qty} ${unit} (รายการที่ ${n})`}
    >
      <span className="shrink-0 rounded bg-emerald-700 px-1.5 py-0.5 text-[11px] text-white">ล่าสุด:</span>
      <span className="min-w-0 truncate">{name}</span>
      <span className="shrink-0 whitespace-nowrap">× {qty} {unit}</span>
      <span className="shrink-0 whitespace-nowrap font-semibold opacity-80">(รายการที่ {n})</span>
    </div>
  );
}
