'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { shopFetch, type ShopCategory } from '@/lib/shop/shop-api';
import { useShopSession } from '@/lib/shop/shop-store';
import { ProductPhoto } from '@/components/shop/ProductCard';
import { SearchBox } from '@/components/shop/SearchBox';

/** Home: big search box + category tiles with a product photo. */
export default function ShopHome() {
  const router = useRouter();
  const { config, me } = useShopSession();
  const [cats, setCats] = useState<ShopCategory[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    shopFetch<ShopCategory[]>('/categories').then(setCats, (e) => setErr(e.message));
  }, []);

  return (
    <div className="space-y-4">
      {config?.notice && <p className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 text-lg font-semibold text-amber-950">{config.notice}</p>}
      <div className="rounded-2xl bg-white p-3 text-lg">
        {me?.member ? (
          <p>
            สวัสดี <b>{me.member.name}</b> — ราคาที่เห็นเป็น <b className="text-emerald-800">{me.member.levelName}</b>
          </p>
        ) : (
          <p>
            สวัสดี <b>{me?.profile.name}</b>{' '}
            <Link href="/shop/link" className="font-bold text-emerald-800 underline underline-offset-4">
              เป็นลูกค้าประจำ? กดผูกบัญชีเพื่อดูราคาของคุณ
            </Link>
          </p>
        )}
      </div>
      <SearchBox onSearch={(q) => router.push(q ? `/shop/products?q=${encodeURIComponent(q)}` : '/shop/products')} />
      <h2 className="pt-1 text-2xl font-bold">เลือกหมวดสินค้า</h2>
      {err && <p className="text-lg font-semibold text-red-800">{err}</p>}
      {!cats && !err && <p className="text-lg text-slate-700">กำลังโหลด…</p>}
      <div className="grid grid-cols-2 gap-3">
        <Link href="/shop/products" className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-emerald-800 bg-emerald-50 p-3 text-center text-xl font-bold text-emerald-900 focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400">
          <span className="text-5xl" aria-hidden>🛍️</span>
          สินค้าทั้งหมด
        </Link>
        {cats?.map((c) => (
          <Link
            key={c.id}
            href={`/shop/products?category=${encodeURIComponent(c.id)}&name=${encodeURIComponent(c.name)}`}
            data-testid="shop-category"
            className="flex min-h-36 flex-col items-center gap-2 rounded-2xl border-2 border-slate-300 bg-white p-3 text-center focus-visible:outline focus-visible:outline-4 focus-visible:outline-amber-400"
          >
            <ProductPhoto src={c.imageUrl} alt="" size="h-24 w-24" />
            <span className="break-words text-xl font-bold leading-snug">{c.name}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
