'use client';

import Link from 'next/link';
import { useState } from 'react';
import { shopFetch, type ShopMe } from '@/lib/shop/shop-api';
import { useShopSession } from '@/lib/shop/shop-store';
import { btn } from '@/components/shop/ShopShell';

/** Regular customers ask the shop to link this LINE account to their member record (staff approve). */
export default function ShopLinkPage() {
  const { me, setMe } = useShopSession();
  const [phone, setPhone] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (me?.member) {
    return (
      <div className="space-y-4 py-6 text-center">
        <p className="text-2xl font-bold">บัญชีนี้เป็นสมาชิกแล้ว</p>
        <p className="text-xl">
          {me.member.name} — {me.member.levelName}
        </p>
        <Link href="/shop" className={btn.primary}>
          ไปเลือกซื้อสินค้า
        </Link>
      </div>
    );
  }
  const pending = me?.linkRequest?.status === 'PENDING';

  const submit = async () => {
    setErr(null);
    setBusy(true);
    try {
      setMe(await shopFetch<ShopMe>('/link', { method: 'POST', body: { phone } }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'ส่งไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">ผูกบัญชีลูกค้าประจำ</h1>
      <p className="text-xl">ลูกค้าประจำของร้านกรอกเบอร์โทรที่ให้ร้านไว้ ร้านจะตรวจสอบแล้วเปิดราคาของคุณให้ (ปกติภายในวันทำการ)</p>
      {pending ? (
        <div className="rounded-2xl border-2 border-amber-500 bg-amber-50 p-4 text-xl" role="status">
          ส่งคำขอแล้ว (เบอร์ {me?.linkRequest?.phone}) รอร้านตรวจสอบ
        </div>
      ) : (
        <>
          {me?.linkRequest?.status === 'REJECTED' && (
            <p className="rounded-2xl bg-red-50 p-3 text-lg font-semibold text-red-800">
              คำขอครั้งก่อนไม่ผ่าน{me.linkRequest.note ? `: ${me.linkRequest.note}` : ''} — ส่งใหม่ได้ หรือโทรถามร้าน
            </p>
          )}
          <label className="block text-xl font-bold">
            เบอร์โทรของคุณ
            <input
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              maxLength={20}
              className="mt-1 block h-14 w-full rounded-2xl border-2 border-slate-500 bg-white px-4 text-2xl focus:border-emerald-700 focus:outline-none"
            />
          </label>
          {err && (
            <p role="alert" className="text-lg font-bold text-red-800">
              {err}
            </p>
          )}
          <button type="button" className={`${btn.primary} w-full`} disabled={busy || phone.replace(/\D/g, '').length < 9} onClick={() => void submit()}>
            ส่งคำขอ
          </button>
        </>
      )}
      <Link href="/shop" className={`${btn.secondary} w-full`}>
        กลับไปหน้าร้าน
      </Link>
    </div>
  );
}
