'use client';

import { useEffect, useState } from 'react';
import { shopFetch, type ShopQuote } from '@/lib/shop/shop-api';
import { applyQuotePrices, lineKey, useShopCart, useShopSession } from '@/lib/shop/shop-store';

/** Server prices of the cart (re-checked whenever the cart or the delivery choice changes). */
export function useQuote(fulfillment: 'PICKUP' | 'DELIVERY') {
  const lines = useShopCart((s) => s.lines);
  const level = useShopSession((s) => s.me?.member?.level ?? 1);
  const refreshMe = useShopSession((s) => s.refreshMe);
  const [quote, setQuote] = useState<ShopQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sig = JSON.stringify(lines.map((l) => [l.productId, l.unitId, l.quantity])) + fulfillment + level;

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      if (!lines.length) {
        setQuote(null);
        return;
      }
      shopFetch<ShopQuote>('/quote', { method: 'POST', body: { fulfillment, items: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity })) } }).then(
        (q) => {
          if (!alive) return;
          setQuote(q);
          setError(null);
          // keep the prices shown in the cart in line with the server
          applyQuotePrices(q);
          // priced at another level than the page knows (linked / changed meanwhile): learn who we are now
          if (q.level !== undefined && q.level !== level) void refreshMe();
        },
        (e) => alive && setError(e.message),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig covers lines + fulfillment + level
  }, [sig]);

  const problemOf = (key: string) => quote?.lines.find((l) => lineKey(l) === key && !l.ok)?.problem || null;
  return { quote, error, problemOf };
}
