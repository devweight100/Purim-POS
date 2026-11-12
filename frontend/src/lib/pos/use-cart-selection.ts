'use client';

import { useEffect, useRef, useState } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import type { CartItem } from '@/lib/types';
import { scrollCartRowIntoView, type PosVariant } from './pos-variant';

/**
 * The highlighted cart row (target of F2/F3/F4, +/-, Delete, arrow keys). A newly added row becomes
 * the selected one; when rows are removed the selection stays inside the cart.
 */
export function useCartSelection(items: CartItem[], variant: PosVariant) {
  const itemsLength = items.length;
  const [rawIndex, setRawIndex] = useState(0);
  const [prevLength, setPrevLength] = useState(itemsLength);
  // Adjust during render when the number of rows changes (React's "state from previous render" pattern)
  if (prevLength !== itemsLength) {
    setPrevLength(itemsLength);
    if (itemsLength > prevLength) setRawIndex(itemsLength - 1);
    else if (rawIndex >= itemsLength) setRawIndex(Math.max(0, itemsLength - 1));
  }
  const selectedIndex = Math.min(rawIndex, Math.max(0, itemsLength - 1));

  // Scroll a newly added row into view
  const prevLengthForScroll = useRef(itemsLength);
  useEffect(() => {
    if (itemsLength > prevLengthForScroll.current) {
      scrollCartRowIntoView(variant, itemsLength - 1, 50);
    }
    prevLengthForScroll.current = itemsLength;
  }, [itemsLength, variant]);

  // Keep the end of the cart list in view when the cart changes
  const cartBottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (items.length > 0 && cartBottomRef.current) {
      cartBottomRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [items]);

  /** Arrow keys: move the selection one row and scroll it into view. */
  const moveSelection = (delta: 1 | -1) => {
    const count = useCartStore.getState().items.length;
    if (count === 0) return;
    // updater form: two key presses before the next render still move two rows
    setRawIndex((prev) => {
      const current = Math.min(prev, count - 1);
      const next = delta > 0 ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
      scrollCartRowIntoView(variant, next, 15);
      return next;
    });
  };

  return { selectedIndex, setSelectedIndex: setRawIndex, moveSelection, cartBottomRef };
}

export type CartSelection = ReturnType<typeof useCartSelection>;
