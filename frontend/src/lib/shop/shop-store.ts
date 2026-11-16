'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { loadToken, saveToken, shopFetch, ShopError, type ShopConfig, type ShopMe, type ShopProduct, type ShopUnit } from './shop-api';
import { ONLINE_LIMITS } from '@shared/online-shop';

export interface CartLine {
  productId: string;
  unitId: string | null;
  name: string;
  unitName: string;
  price: number;
  imageUrl: string | null;
  quantity: number;
}

export const lineKey = (l: { productId: string; unitId: string | null }) => `${l.productId}|${l.unitId ?? ''}`;

interface CartState {
  lines: CartLine[];
  fulfillment: 'PICKUP' | 'DELIVERY';
  add: (p: ShopProduct, unit: ShopUnit, qty: number) => void;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  setFulfillment: (f: 'PICKUP' | 'DELIVERY') => void;
}

const clampQty = (n: number) => Math.max(1, Math.min(ONLINE_LIMITS.maxQtyPerLine, Math.floor(n) || 1));

/** Cart on this phone (localStorage). Prices shown are re-checked by the server before ordering. */
export const useShopCart = create<CartState>()(
  persist(
    (set) => ({
      lines: [],
      fulfillment: 'PICKUP',
      add: (p, unit, qty) =>
        set((s) => {
          const key = lineKey({ productId: p.id, unitId: unit.id });
          const found = s.lines.find((l) => lineKey(l) === key);
          if (found) return { lines: s.lines.map((l) => (l === found ? { ...l, quantity: clampQty(l.quantity + qty), price: unit.price } : l)) };
          if (s.lines.length >= ONLINE_LIMITS.maxLines) return s;
          return { lines: [...s.lines, { productId: p.id, unitId: unit.id, name: p.name, unitName: unit.name, price: unit.price, imageUrl: p.imageUrl, quantity: clampQty(qty) }] };
        }),
      setQty: (key, qty) => set((s) => ({ lines: s.lines.map((l) => (lineKey(l) === key ? { ...l, quantity: clampQty(qty) } : l)) })),
      remove: (key) => set((s) => ({ lines: s.lines.filter((l) => lineKey(l) !== key) })),
      clear: () => set({ lines: [] }),
      setFulfillment: (fulfillment) => set({ fulfillment }),
    }),
    { name: 'purim-shop-cart', storage: createJSONStorage(() => localStorage), version: 1 },
  ),
);

type Liff = {
  init: (o: { liffId: string }) => Promise<void>;
  isLoggedIn: () => boolean;
  login: (o?: { redirectUri?: string }) => void;
  getIDToken: () => string | null;
  isInClient: () => boolean;
  closeWindow: () => void;
};

function loadLiffSdk(): Promise<Liff> {
  const w = window as unknown as { liff?: Liff };
  if (w.liff) return Promise.resolve(w.liff);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    s.async = true;
    s.onload = () => (w.liff ? resolve(w.liff) : reject(new Error('LIFF')));
    s.onerror = () => reject(new Error('LIFF'));
    document.head.appendChild(s);
  });
}

interface SessionState {
  status: 'loading' | 'ready' | 'closed' | 'error';
  error: string | null;
  config: ShopConfig | null;
  me: ShopMe | null;
  init: () => Promise<void>;
  refreshMe: () => Promise<void>;
  setMe: (me: ShopMe) => void;
}

let started = false;

/** Shop config + who the visitor is (LINE via LIFF, or the test profile on the shop's own network). */
export const useShopSession = create<SessionState>()((set, get) => ({
  status: 'loading',
  error: null,
  config: null,
  me: null,
  setMe: (me) => set({ me }),
  refreshMe: async () => {
    try {
      set({ me: await shopFetch<ShopMe>('/me') });
    } catch {
      /* keep */
    }
  },
  init: async () => {
    if (started) return;
    started = true;
    try {
      const config = await shopFetch<ShopConfig>('/config');
      set({ config });
      if (!config.open) {
        set({ status: 'closed' });
        return;
      }
      if (config.liffId) {
        const liff = await loadLiffSdk();
        await liff.init({ liffId: config.liffId });
        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }
        const idToken = liff.getIDToken();
        if (!idToken) throw new ShopError('เปิดจาก LINE ไม่สำเร็จ กรุณาปิดแล้วเปิดใหม่', 401);
        const s = await shopFetch<{ token: string; expiresAt: string } & ShopMe>('/session', { method: 'POST', body: { idToken } });
        saveToken(s.token, s.expiresAt);
        set({ me: { profile: s.profile, member: s.member, contact: s.contact, linkRequest: s.linkRequest }, status: 'ready' });
        return;
      }
      if (config.devLogin) {
        // test profile: reuse the stored one (it keeps its cart / orders), else a new one
        if (loadToken()) {
          try {
            set({ me: await shopFetch<ShopMe>('/me'), status: 'ready' });
            if (get().me?.profile.test) return;
          } catch {
            saveToken(null);
          }
        }
        const s = await shopFetch<{ token: string; expiresAt: string } & ShopMe>('/session', { method: 'POST', body: { dev: { id: 'tester', name: 'ลูกค้าทดสอบ' } } });
        saveToken(s.token, s.expiresAt);
        set({ me: { profile: s.profile, member: s.member, contact: s.contact, linkRequest: s.linkRequest }, status: 'ready' });
        return;
      }
      set({ status: 'closed' });
    } catch (e) {
      started = false;
      set({ status: 'error', error: e instanceof Error ? e.message : 'เปิดร้านไม่สำเร็จ' });
    }
  },
}));
