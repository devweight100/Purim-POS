'use client';

import { Tags } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { useCartStore } from '@/lib/store/cart-store';
import { canUseWalkInLevel, usePosLevels } from '@/lib/pos/pos-add';
import type { PriceLevel } from '@shared/price-level';

/**
 * Price level of the bill next to the customer (docs/pos-price-level.md): "ราคา: ส่ง" for a member (the member's
 * level); for a walk-in bill a select to sell at another level without naming the customer.
 */
export function PosLevelControl({ className }: { className?: string }) {
  const customerId = useCartStore((s) => s.customerId);
  const level = useCartStore((s) => s.priceLevel);
  const { names, used, short } = usePosLevels();

  if (customerId) {
    return (
      <span data-testid="pos-price-level" data-level={level} className={cn('inline-flex items-center gap-1 text-sub', level > 1 ? 'font-medium text-sky-700' : 'text-muted-foreground', className)}>
        <Tags className="size-3.5" aria-hidden />
        ราคา: {short(level)}
      </span>
    );
  }
  const levels = used.includes(level) ? used : [...used, level].sort();
  return (
    <label className={cn('inline-flex items-center gap-1.5 text-sub text-muted-foreground', className)} title="ระดับราคาของบิลลูกค้าทั่วไป">
      <Tags className="size-3.5" aria-hidden />
      <span>ราคา:</span>
      <select
        data-testid="pos-walkin-level"
        data-level={level}
        aria-label="ระดับราคาลูกค้าทั่วไป"
        value={level}
        onChange={(e) => {
          const l = Number(e.target.value) as PriceLevel;
          if (!canUseWalkInLevel(l)) {
            toast.error('ขายราคานี้ให้ลูกค้าทั่วไปต้องมีสิทธิ์ให้ส่วนลด');
            return;
          }
          useCartStore.getState().setWalkInLevel(l);
          toast.info(`บิลนี้ใช้${names[l]}`);
        }}
        className={cn(
          'h-8 rounded-lg border bg-white px-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-sky-300',
          level > 1 ? 'border-sky-300 font-medium text-sky-800' : 'border-slate-300 text-slate-800',
        )}
      >
        {levels.map((l) => (
          <option key={l} value={l} disabled={!canUseWalkInLevel(l)}>
            {names[l]}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Small note on a cart line charged at another level than the bill (fallback: "ราคา: ปลีก"). */
export function LineLevelNote({ lineLevel, className }: { lineLevel?: number; className?: string }) {
  const billLevel = useCartStore((s) => s.priceLevel);
  const { short } = usePosLevels();
  if (!lineLevel || lineLevel === billLevel) return null;
  return (
    <span data-testid="pos-line-level" className={cn('text-sub text-amber-700', className)} title="สินค้านี้ไม่มีราคาระดับของบิล จึงใช้ราคานี้">
      ราคา: {short(lineLevel)}
    </span>
  );
}
