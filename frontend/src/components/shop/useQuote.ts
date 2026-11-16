'use client';

import { useEffect, useState } from 'react';
import { shopFetch, type ShopQuote } from '@/lib/shop/shop-api';
import { lineKey, useShopCart } from '@/lib/shop/shop-store';

/** Server prices of the cart (re-checked whenever the cart or the delivery choice changes). */
export function useQuote(fulfillment: 'PICKUP' | 'DELIVERY') {
  const lines = useShopCart((s) => s.lines);
  const [quote, setQuote] = useState<ShopQuote | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sig = JSON.stringify(lines.map((l) => [l.productId, l.unitId, l.quantity])) + fulfillment;

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
          const s = useShopCart.getState();
          const priceOf = new Map(q.lines.filter((l) => l.ok).map((l) => [lineKey(l), l.unitPrice]));
          if (s.lines.some((l) => priceOf.has(lineKey(l)) && priceOf.get(lineKey(l)) !== l.price)) {
            useShopCart.setState({ lines: s.lines.map((l) => (priceOf.has(lineKey(l)) ? { ...l, price: priceOf.get(lineKey(l))! } : l)) });
          }
        },
        (e) => alive && setError(e.message),
      );
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- sig covers lines + fulfillment
  }, [sig]);

  const problemOf = (key: string) => quote?.lines.find((l) => lineKey(l) === key && !l.ok)?.problem || null;
  return { quote, error, problemOf };
}
