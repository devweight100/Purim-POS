'use client';

import Link from 'next/link';
import { lineKey, useShopCart, useShopSession } from '@/lib/shop/shop-store';
import { baht } from '@/lib/shop/shop-api';
import { ProductPhoto, QtyStepper } from '@/components/shop/ProductCard';
import { btn } from '@/components/shop/ShopShell';
import { useQuote } from '@/components/shop/useQuote';
import { useHydrated } from '@/lib/shop/use-hydrated';

/** Cart: change quantities, remove, totals with the delivery fee (or "ร้านจะแจ้ง"). */
export default function ShopCartPage() {
  const { lines, setQty, remove } = useShopCart();
  const member = useShopSession((s) => s.me?.member);
  const config = useShopSession((s) => s.config);
  const hydrated = useHydrated();
  const { quote, error, problemOf } = useQuote('PICKUP');
  if (!hydrated) return null;

  if (!lines.length) {
    return (
      <div className="space-y-4 py-10 text-center">
        <p className="text-2xl font-bold">ตะกร้ายังว่าง</p>
        <Link href="/shop" className={btn.primary}>
          เลือกซื้อสินค้า
        </Link>
      </div>
    );
  }
  const hasProblem = !!quote?.lines.some((l) => !l.ok);
  const subtotal = quote ? quote.subtotal : lines.reduce((s, l) => s + l.price * l.quantity, 0);
  const deliveryText = member?.deliveryFee != null ? baht(member.deliveryFee) : 'ร้านจะแจ้ง';

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ตะกร้าของฉัน ({lines.length} รายการ)</h1>
      <ul className="space-y-3">
        {lines.map((l) => {
          const key = lineKey(l);
          const problem = problemOf(key);
          return (
            <li key={key} data-testid="shop-cart-line" className={`rounded-2xl border-2 bg-white p-3 ${problem ? 'border-red-600' : 'border-slate-200'}`}>
              <div className="flex gap-3">
                <ProductPhoto src={l.imageUrl} alt={l.name} size="h-20 w-20" />
                <div className="min-w-0 flex-1">
                  <p className="break-words text-xl font-bold leading-snug">{l.name}</p>
                  <p className="text-lg text-slate-800">
                    {baht(l.price)} / {l.unitName}
                  </p>
                  <p className="text-xl font-extrabold">รวม {baht(l.price * l.quantity)}</p>
                </div>
              </div>
              {problem && <p className="mt-2 text-lg font-bold text-red-800">{problem}</p>}
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
                <QtyStepper value={l.quantity} onChange={(n) => setQty(key, n)} label={l.name} />
                <button type="button" className={btn.danger} onClick={() => remove(key)}>
                  ลบออก
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <section className="space-y-2 rounded-2xl border-2 border-slate-300 bg-white p-4 text-xl" aria-label="สรุปยอด">
        <div className="flex justify-between gap-3">
          <span>ค่าสินค้า</span>
          <b data-testid="shop-cart-subtotal">{baht(subtotal)}</b>
        </div>
        {config?.allowDelivery && (
          <div className="flex justify-between gap-3 text-lg">
            <span>ค่าส่ง (ถ้าให้ร้านไปส่ง)</span>
            <b>{deliveryText}</b>
          </div>
        )}
        {config?.allowPickup && (
          <div className="flex justify-between gap-3 text-lg">
            <span>รับเองที่ร้าน</span>
            <b>ไม่มีค่าส่ง</b>
          </div>
        )}
        <div className="flex justify-between gap-3 border-t-2 border-slate-200 pt-2 text-2xl">
          <span className="font-bold">ยอดรวม</span>
          <b className="text-emerald-800">{baht(subtotal)}{config?.allowDelivery ? ' + ค่าส่ง' : ''}</b>
        </div>
      </section>
      {error && <p className="text-lg font-semibold text-red-800">{error}</p>}
      {hasProblem && <p className="text-lg font-bold text-red-800">กรุณาลบรายการที่สั่งไม่ได้ออกก่อน</p>}
      <Link href="/shop/checkout" aria-disabled={hasProblem} className={`${btn.primary} w-full ${hasProblem ? 'pointer-events-none bg-slate-400' : ''}`}>
        สั่งซื้อ
      </Link>
      <Link href="/shop" className={`${btn.secondary} w-full`}>
        เลือกซื้อเพิ่ม
      </Link>
    </div>
  );
}
