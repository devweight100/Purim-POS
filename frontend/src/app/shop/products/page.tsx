'use client';

import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { shopFetch, type ShopProduct } from '@/lib/shop/shop-api';
import { ProductCard } from '@/components/shop/ProductCard';
import { SearchBox } from '@/components/shop/SearchBox';
import { btn } from '@/components/shop/ShopShell';
import { useShopSession } from '@/lib/shop/shop-store';

interface Page {
  items: ShopProduct[];
  total: number;
  hasMore: boolean;
  page: number;
}

function ProductList() {
  const params = useSearchParams();
  const router = useRouter();
  const q = params.get('q') || '';
  const category = params.get('category') || '';
  const categoryName = params.get('name') || '';
  const level = useShopSession((s) => s.me?.member?.level ?? 1);
  const [items, setItems] = useState<ShopProduct[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const seq = useRef(0);

  const load = useCallback(
    async (p: number) => {
      const my = ++seq.current;
      setLoading(true);
      setErr(null);
      try {
        const qs = new URLSearchParams({ page: String(p), limit: '20' });
        if (q) qs.set('q', q);
        if (category) qs.set('categoryId', category);
        const r = await shopFetch<Page>(`/products?${qs}`);
        if (my !== seq.current) return;
        setItems((prev) => (p === 1 ? r.items : [...prev, ...r.items]));
        setPage(p);
        setHasMore(r.hasMore);
        setTotal(r.total);
      } catch (e) {
        if (my === seq.current) setErr(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
      } finally {
        if (my === seq.current) setLoading(false);
      }
    },
    [q, category],
  );

  useEffect(() => {
    const t = setTimeout(() => void load(1), 0); // (not inside the effect body: load sets state)
    return () => clearTimeout(t);
  }, [load, level]);

  const title = q ? `ค้นหา "${q}"` : categoryName || 'สินค้าทั้งหมด';
  return (
    <div className="space-y-3">
      <SearchBox
        key={q}
        initial={q}
        onSearch={(text) => {
          const next = new URLSearchParams();
          if (text) next.set('q', text);
          router.replace(`/shop/products${next.size ? `?${next}` : ''}`);
        }}
      />
      <h1 className="text-2xl font-bold">
        {title}
        {total !== null && <span className="ml-2 text-lg font-semibold text-slate-600">({total.toLocaleString('th-TH')} รายการ)</span>}
      </h1>
      {err && <p className="text-lg font-semibold text-red-800">{err}</p>}
      {!loading && total === 0 && <p className="rounded-2xl bg-white p-4 text-lg">ไม่พบสินค้า ลองพิมพ์คำอื่น หรือเลือกหมวดจากหน้าแรก</p>}
      <div className="space-y-3">
        {items.map((p) => (
          <ProductCard key={`${p.id}-${level}`} product={p} />
        ))}
      </div>
      {loading && <p className="py-4 text-center text-lg text-slate-700">กำลังโหลด…</p>}
      {hasMore && !loading && (
        <button type="button" className={`${btn.secondary} w-full`} onClick={() => void load(page + 1)}>
          ดูสินค้าเพิ่ม
        </button>
      )}
    </div>
  );
}

export default function ShopProductsPage() {
  return (
    <Suspense fallback={<p className="py-8 text-center text-lg">กำลังโหลด…</p>}>
      <ProductList />
    </Suspense>
  );
}
