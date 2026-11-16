'use client';

import Link from 'next/link';
import { use, useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ONLINE_STATUS_CUSTOMER } from '@shared/online-shop';
import { baht, shopFetch, type ShopOrder } from '@/lib/shop/shop-api';
import { useShopSession } from '@/lib/shop/shop-store';
import { btn } from '@/components/shop/ShopShell';
import { StatusBadge } from '@/components/shop/StatusBadge';
import { ShopQr } from '@/components/shop/ShopQr';

/** Order confirmation / detail: status, items, totals, PromptPay QR once the shop accepted it. */
export default function ShopOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const fresh = useSearchParams().get('new') === '1';
  const phone = useShopSession((s) => s.config?.storePhone);
  const [o, setO] = useState<ShopOrder | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => shopFetch<ShopOrder>(`/orders/${encodeURIComponent(id)}`).then(setO, (e) => setErr(e.message)), [id]);
  useEffect(() => {
    void load();
    // the shop may accept while the customer looks at the page
    const t = setInterval(() => void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  if (err && !o) return <p className="py-10 text-center text-xl font-bold text-red-800">{err}</p>;
  if (!o) return <p className="py-10 text-center text-xl">กำลังโหลด…</p>;

  const cancel = async () => {
    if (!window.confirm('ยกเลิกออเดอร์นี้?')) return;
    setBusy(true);
    try {
      setO(await shopFetch<ShopOrder>(`/orders/${o.id}/cancel`, { method: 'POST' }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ยกเลิกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      {fresh && (
        <div className="rounded-2xl border-2 border-emerald-700 bg-emerald-50 p-4 text-center" role="status">
          <p className="text-2xl font-extrabold text-emerald-900">ส่งออเดอร์แล้ว ✓</p>
          <p className="text-lg">ร้านจะยืนยันและแจ้งยอดทาง LINE</p>
        </div>
      )}
      <div className="rounded-2xl border-2 border-slate-300 bg-white p-4">
        <p className="text-lg text-slate-700">เลขที่ออเดอร์</p>
        <p className="text-3xl font-extrabold tracking-wide" data-testid="shop-order-no">{o.orderNo}</p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <StatusBadge status={o.status} label={o.statusLabel} />
          {o.paid && <span className="text-lg font-bold text-emerald-800">ชำระเงินแล้ว</span>}
        </div>
        <p className="mt-2 text-xl font-semibold">{ONLINE_STATUS_CUSTOMER[o.status]}</p>
        {o.rejectReason && <p className="mt-1 text-lg font-bold text-red-800">เหตุผล: {o.rejectReason}</p>}
      </div>

      {o.payment && (
        <section className="rounded-2xl border-2 border-sky-700 bg-white p-4 text-center" aria-label="ชำระเงิน">
          <h2 className="mb-2 text-2xl font-bold">สแกนจ่ายด้วยพร้อมเพย์</h2>
          <ShopQr payload={o.payment.payload} amount={o.payment.amount} accountName={o.payment.accountName} maskedId={o.payment.maskedId} />
          <p className="mt-2 text-lg text-slate-700">ยอดเงินตั้งไว้แล้ว โอนแล้วแจ้งร้านทาง LINE หรือจ่ายที่ร้านก็ได้</p>
        </section>
      )}

      <section className="rounded-2xl border-2 border-slate-300 bg-white p-4" aria-label="รายการ">
        <h2 className="text-xl font-bold">รายการสินค้า</h2>
        <ul className="divide-y-2 divide-slate-100">
          {o.items.map((i, n) => (
            <li key={n} className="flex justify-between gap-3 py-2 text-lg">
              <span className="min-w-0 break-words">
                {i.name}
                <span className="block text-slate-700">
                  {i.quantity.toLocaleString('th-TH')} {i.unitName} × {baht(i.unitPrice)}
                </span>
              </span>
              <b className="shrink-0">{baht(i.total)}</b>
            </li>
          ))}
        </ul>
        <div className="mt-2 space-y-1 border-t-2 border-slate-200 pt-2 text-xl">
          <div className="flex justify-between">
            <span>ค่าสินค้า</span>
            <b>{baht(o.subtotal)}</b>
          </div>
          <div className="flex justify-between">
            <span>ค่าส่ง</span>
            <b>{o.fulfillment === 'PICKUP' ? 'ไม่มี (รับที่ร้าน)' : o.feePending ? 'ร้านจะแจ้ง' : baht(o.deliveryFee || 0)}</b>
          </div>
          <div className="flex justify-between text-2xl">
            <span className="font-bold">ยอดรวม</span>
            <b className="text-emerald-800" data-testid="shop-order-total">
              {baht(o.totalAmount)}
              {o.feePending ? ' + ค่าส่ง' : ''}
            </b>
          </div>
        </div>
      </section>

      <section className="rounded-2xl bg-white p-4 text-lg" aria-label="ผู้สั่ง">
        <p>
          <b>{o.fulfillment === 'PICKUP' ? 'รับเองที่ร้าน' : 'ให้ร้านไปส่ง'}</b> · {o.contactName} · {o.contactPhone}
        </p>
        {o.address && <p className="text-slate-700">{o.address}</p>}
        {o.note && <p className="text-slate-700">หมายเหตุ: {o.note}</p>}
      </section>

      {err && <p className="text-lg font-bold text-red-800">{err}</p>}
      {o.status === 'NEW' && (
        <button type="button" className={`${btn.danger} w-full`} disabled={busy} onClick={() => void cancel()}>
          ยกเลิกออเดอร์
        </button>
      )}
      {phone && (
        <a href={`tel:${phone}`} className={`${btn.secondary} w-full`}>
          โทรหาร้าน {phone}
        </a>
      )}
      <Link href="/shop" className={`${btn.primary} w-full`}>
        กลับไปหน้าร้าน
      </Link>
    </div>
  );
}
