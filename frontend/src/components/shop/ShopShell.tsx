'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { useShopCart, useShopSession } from '@/lib/shop/shop-store';
import { baht } from '@/lib/shop/shop-api';

/** Big, plain button styles shared by the shop pages (>= 48 px tall, high contrast). */
export const btn = {
  primary: 'inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-emerald-800 px-5 text-xl font-bold text-white active:bg-emerald-900 disabled:bg-slate-400 disabled:text-white focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400',
  secondary: 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-slate-800 bg-white px-4 text-lg font-bold text-slate-900 active:bg-slate-100 disabled:opacity-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400',
  danger: 'inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border-2 border-red-700 bg-white px-4 text-lg font-bold text-red-700 active:bg-red-50 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400',
};

function useHydrated() {
  const [ok, setOk] = useState(false);
  useEffect(() => setOk(true), []);
  return ok;
}

export function ShopShell({ children }: { children: React.ReactNode }) {
  const { status, error, config, me, init } = useShopSession();
  const path = usePathname();
  const router = useRouter();
  const hydrated = useHydrated();
  const lines = useShopCart((s) => s.lines);
  const count = lines.length;
  const total = useMemo(() => lines.reduce((s, l) => s + l.price * l.quantity, 0), [lines]);

  useEffect(() => {
    void init();
  }, [init]);

  const isHome = path === '/shop' || path === '/shop/';
  const showCartBar = hydrated && status === 'ready' && count > 0 && !/^\/shop\/(cart|checkout|orders)/.test(path);

  return (
    <div className="min-h-dvh w-full bg-slate-50 text-[18px] leading-relaxed text-slate-900">
      <header className="sticky top-0 z-30 border-b-2 border-emerald-900 bg-emerald-800 text-white">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-3 py-2">
          {!isHome ? (
            <button type="button" onClick={() => (window.history.length > 1 ? router.back() : router.push('/shop'))} className="flex min-h-12 min-w-12 items-center justify-center rounded-xl text-2xl font-bold active:bg-emerald-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400" aria-label="ย้อนกลับ">
              ‹
            </button>
          ) : null}
          <Link href="/shop" className="min-w-0 flex-1 truncate text-xl font-bold">
            {config?.storeName || 'ร้านค้า'}
          </Link>
          {status === 'ready' && (
            <Link href="/shop/orders" className="flex min-h-12 shrink-0 items-center rounded-xl border-2 border-white/80 px-3 text-base font-bold active:bg-emerald-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400">
              ออเดอร์ของฉัน
            </Link>
          )}
        </div>
      </header>
      {me?.profile.test && (
        <div className="bg-amber-200 px-3 py-1 text-center text-base font-semibold text-amber-950" role="note">
          โหมดทดสอบ (ยังไม่ได้ตั้งค่า LINE) — ลูกค้าจริงจะไม่เห็นแถบนี้
        </div>
      )}
      <main className={`mx-auto w-full max-w-xl px-3 pb-6 pt-3 ${showCartBar ? 'pb-28' : ''}`}>
        {status === 'loading' && <p className="py-16 text-center text-xl font-semibold text-slate-700">กำลังเปิดร้าน…</p>}
        {status === 'closed' && (
          <div className="py-16 text-center">
            <p className="text-2xl font-bold">ร้านยังไม่เปิดรับออเดอร์ออนไลน์</p>
            {config?.storePhone && (
              <a href={`tel:${config.storePhone}`} className={`${btn.primary} mt-6`}>
                โทรหาร้าน {config.storePhone}
              </a>
            )}
          </div>
        )}
        {status === 'error' && (
          <div className="py-16 text-center">
            <p className="text-2xl font-bold text-red-800">{error}</p>
            <button type="button" className={`${btn.primary} mt-6`} onClick={() => window.location.reload()}>
              ลองใหม่
            </button>
          </div>
        )}
        {status === 'ready' && children}
      </main>
      {showCartBar && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t-2 border-slate-300 bg-white/95 px-3 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 shadow-[0_-4px_16px_rgba(0,0,0,0.12)]">
          <Link href="/shop/cart" data-testid="shop-cart-bar" className={`${btn.primary} mx-auto flex w-full max-w-xl justify-between`}>
            <span>🛒 ดูตะกร้า ({count} รายการ)</span>
            <span>{baht(total)}</span>
          </Link>
        </div>
      )}
    </div>
  );
}
