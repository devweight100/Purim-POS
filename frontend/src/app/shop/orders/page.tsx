'use client';
import { formatListDateTime } from '@/lib/utils';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { baht, shopFetch, type ShopOrder } from '@/lib/shop/shop-api';
import { btn } from '@/components/shop/ShopShell';
import { StatusBadge } from '@/components/shop/StatusBadge';

const when = (iso: string) => formatListDateTime(iso); // online orders keep the time

/** ออเดอร์ของฉัน: newest first, status in plain words. */
export default function MyOrdersPage() {
  const [orders, setOrders] = useState<ShopOrder[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    shopFetch<ShopOrder[]>('/orders').then(setOrders, (e) => setErr(e.message));
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ออเดอร์ของฉัน</h1>
      {err && <p className="text-lg font-semibold text-red-800">{err}</p>}
      {!orders && !err && <p className="text-lg">กำลังโหลด…</p>}
      {orders?.length === 0 && (
        <div className="space-y-4 py-6 text-center">
          <p className="text-xl">ยังไม่มีออเดอร์</p>
          <Link href="/shop" className={btn.primary}>
            เลือกซื้อสินค้า
          </Link>
        </div>
      )}
      <ul className="space-y-3">
        {orders?.map((o) => (
          <li key={o.id}>
            <Link href={`/shop/orders/${o.id}`} data-testid="shop-order" className="block rounded-2xl border-2 border-slate-300 bg-white p-4 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-xl font-bold">{o.orderNo}</span>
                <StatusBadge status={o.status} label={o.statusLabel} />
              </div>
              <p className="mt-1 text-lg text-slate-700">
                {when(o.createdAt)} · {o.items.length} รายการ · {o.fulfillment === 'PICKUP' ? 'รับเองที่ร้าน' : 'ร้านไปส่ง'}
              </p>
              <p className="mt-1 text-xl font-extrabold">
                {baht(o.totalAmount)}
                {o.feePending ? ' + ค่าส่ง' : ''}
                {o.paid && <span className="ml-2 text-lg font-bold text-emerald-800">ชำระแล้ว</span>}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
