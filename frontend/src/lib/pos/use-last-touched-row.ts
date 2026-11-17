'use client';

import { useEffect, useRef, type RefObject } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { cartLineKey } from '@/lib/store/cart-last-touched';
import type { CartItem } from '@/lib/types';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** Short flash of the touched row and a bump of its quantity cell (Web Animations: no React re-render). */
function flashRow(row: HTMLElement) {
  if (typeof row.animate !== 'function') return;
  row.animate(
    [
      { backgroundColor: '#6ee7b7', offset: 0 }, // emerald-300
      { backgroundColor: '#a7f3d0', offset: 0.35 }, // emerald-200
      { backgroundColor: '#ecfdf5', offset: 1 }, // emerald-50 (the static highlight)
    ],
    { duration: 700, easing: 'ease-out' },
  );
  const qty = row.querySelector<HTMLElement>('[data-qty-cell]');
  qty?.animate(
    [{ transform: 'scale(1)' }, { transform: 'scale(1.18)', offset: 0.3 }, { transform: 'scale(1)' }],
    { duration: 450, easing: 'ease-out' },
  );
}

/**
 * Cart list behaviour of the last touched line (both POS layouts): on every touch the row is scrolled into view
 * (nearest, smooth unless reduced motion; scrollIntoView never moves the keyboard focus, so the scanner / search
 * input keeps it) and flashes. Cart changes that are not a touch (bill recalled, line removed) keep the old
 * behaviour of showing the end of the list.
 */
export function useLastTouchedRow(listRef: RefObject<HTMLElement | null>, bottomRef: RefObject<HTMLElement | null>, items: CartItem[]) {
  const lastTouched = useCartStore((s) => s.lastTouched);
  const seenSeq = useRef(lastTouched?.seq ?? 0);

  useEffect(() => {
    const seq = lastTouched?.seq ?? 0;
    const touched = seq !== seenSeq.current && !!lastTouched;
    seenSeq.current = seq;
    const reduced = prefersReducedMotion();
    if (touched && lastTouched) {
      const key = cartLineKey(lastTouched);
      const row = Array.from(listRef.current?.querySelectorAll<HTMLElement>('[data-line-key]') ?? []).find((el) => el.dataset.lineKey === key);
      if (row) {
        row.scrollIntoView({ block: 'nearest', behavior: reduced ? 'auto' : 'smooth' });
        if (!reduced) flashRow(row);
        return;
      }
    }
    if (items.length > 0 && bottomRef.current) bottomRef.current.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  }, [items, lastTouched, listRef, bottomRef]);

  return lastTouched;
}
