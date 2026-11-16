'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { ONLINE_LIMITS } from '@shared/online-shop';
import { baht, shopFetch, type ShopOrder } from '@/lib/shop/shop-api';
import { useShopCart, useShopSession } from '@/lib/shop/shop-store';
import { btn } from '@/components/shop/ShopShell';
import { useQuote } from '@/components/shop/useQuote';

const field = 'mt-1 block w-full rounded-2xl border-2 border-slate-500 bg-white px-4 py-3 text-xl focus:border-emerald-700 focus:outline-none';

/** Checkout: pickup or delivery, name / phone / address (remembered), note, totals, confirm. */
export default function ShopCheckoutPage() {
  const router = useRouter();
  const { config, me, refreshMe } = useShopSession();
  const { lines, fulfillment, setFulfillment, clear } = useShopCart();
  const [hydrated, setHydrated] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setHydrated(true);
    setName(me?.contact.name || '');
    setPhone(me?.contact.phone || '');
    setAddress(me?.contact.address || '');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fill once from the remembered contact
  }, []);
  // a way the shop does not offer is never preselected
  const way = fulfillment === 'DELIVERY' && !config?.allowDelivery ? 'PICKUP' : fulfillment === 'PICKUP' && !config?.allowPickup ? 'DELIVERY' : fulfillment;
  const { quote, error: quoteErr } = useQuote(way);

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

  const submit = async () => {
    setErr(null);
    if (!name.trim()) return setErr('กรุณากรอกชื่อ');
    if (phone.replace(/\D/g, '').length < 9) return setErr('กรุณากรอกเบอร์โทรให้ครบ');
    if (way === 'DELIVERY' && address.trim().length < 5) return setErr('กรุณากรอกที่อยู่สำหรับส่งของ');
    setBusy(true);
    try {
      const o = await shopFetch<ShopOrder>('/orders', {
        method: 'POST',
        body: { fulfillment: way, contactName: name, contactPhone: phone, address, note, items: lines.map((l) => ({ productId: l.productId, unitId: l.unitId, quantity: l.quantity })) },
      });
      clear();
      void refreshMe();
      router.replace(`/shop/orders/${o.id}?new=1`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'สั่งไม่สำเร็จ');
      setBusy(false);
    }
  };

  const choice = (value: 'PICKUP' | 'DELIVERY', title: string, sub: string) => (
    <label className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-2xl border-2 p-3 ${way === value ? 'border-emerald-800 bg-emerald-50' : 'border-slate-300 bg-white'}`}>
      <input type="radio" name="way" value={value} checked={way === value} onChange={() => setFulfillment(value)} className="h-7 w-7 accent-emerald-800" />
      <span>
        <span className="block text-xl font-bold">{title}</span>
        <span className="block text-lg text-slate-700">{sub}</span>
      </span>
    </label>
  );

  const feeText = quote ? (quote.feePending ? 'ร้านจะแจ้ง' : baht(quote.deliveryFee || 0)) : '…';
  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">สั่งซื้อ</h1>
      <fieldset className="space-y-3">
        <legend className="mb-2 text-xl font-bold">รับของอย่างไร</legend>
        {config?.allowPickup && choice('PICKUP', 'รับเองที่ร้าน', 'ไม่มีค่าส่ง')}
        {config?.allowDelivery && choice('DELIVERY', 'ให้ร้านไปส่ง', me?.member?.deliveryFee != null ? `ค่าส่ง ${baht(me.member.deliveryFee)}` : 'ร้านจะแจ้งค่าส่งให้ทราบ')}
      </fieldset>
      <div className="space-y-4">
        <label className="block text-xl font-bold">
          ชื่อผู้สั่ง
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={ONLINE_LIMITS.nameMax} />
        </label>
        <label className="block text-xl font-bold">
          เบอร์โทร
          <input className={field} value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" maxLength={20} />
        </label>
        {way === 'DELIVERY' && (
          <label className="block text-xl font-bold">
            ที่อยู่ส่งของ
            <textarea className={`${field} min-h-28`} value={address} onChange={(e) => setAddress(e.target.value)} autoComplete="street-address" maxLength={ONLINE_LIMITS.addressMax} placeholder="บ้านเลขที่ ซอย ถนน จุดสังเกต" />
          </label>
        )}
        <label className="block text-xl font-bold">
          หมายเหตุถึงร้าน (ถ้ามี)
          <textarea className={`${field} min-h-20`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={ONLINE_LIMITS.noteMax} />
        </label>
      </div>
      <section className="space-y-2 rounded-2xl border-2 border-slate-300 bg-white p-4 text-xl" aria-label="สรุปยอด">
        <div className="flex justify-between gap-3">
          <span>ค่าสินค้า ({lines.length} รายการ)</span>
          <b>{quote ? baht(quote.subtotal) : '…'}</b>
        </div>
        <div className="flex justify-between gap-3">
          <span>ค่าส่ง</span>
          <b data-testid="shop-checkout-fee">{way === 'PICKUP' ? 'ไม่มี' : feeText}</b>
        </div>
        <div className="flex justify-between gap-3 border-t-2 border-slate-200 pt-2 text-2xl">
          <span className="font-bold">ยอดรวม</span>
          <b className="text-emerald-800" data-testid="shop-checkout-total">
            {quote ? baht(quote.total) : '…'}
            {quote?.feePending && way === 'DELIVERY' ? ' + ค่าส่ง' : ''}
          </b>
        </div>
        <p className="text-base text-slate-700">ชำระเงินเมื่อร้านยืนยันออเดอร์ (โอนพร้อมเพย์ หรือจ่ายที่ร้าน)</p>
      </section>
      {(err || quoteErr) && (
        <p role="alert" className="rounded-xl bg-red-50 p-3 text-lg font-bold text-red-800">
          {err || quoteErr}
        </p>
      )}
      <button type="button" className={`${btn.primary} w-full`} disabled={busy || !quote || quote.lines.some((l) => !l.ok)} onClick={() => void submit()}>
        {busy ? 'กำลังส่งออเดอร์…' : 'ยืนยันสั่งซื้อ'}
      </button>
    </div>
  );
}
