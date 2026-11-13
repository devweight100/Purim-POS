'use client';

import { useEffect, useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import { LoadErrorState } from '@/components/common/LoadErrorState';
import { stockText } from '@/lib/mobile';
import { formatQty } from '@/lib/qty';
import { cn } from '@/lib/utils';
import type { LookupProduct, LookupResponse } from './types';
import { baht, Card, Chip, EmptyState, ListSkeleton } from './ui';
import { reloadMobileData, useMobileData } from './use-mobile-data';

type StockFilter = 'all' | 'low' | 'out';
const PAGE_SIZE = 20;

export const lookupUrl = (q: string, filter: StockFilter, page: number) =>
  `/products/lookup?q=${encodeURIComponent(q)}&filter=${filter}&page=${page}&limit=${PAGE_SIZE}`;

/** "สต็อก/ราคา": search products (name / SKU / barcode), stock with pack breakdown, price levels. */
export function StockTab({ onActiveUrl }: { onActiveUrl: (url: string) => void }) {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<StockFilter>('all');
  const [pages, setPages] = useState(1);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const firstUrl = lookupUrl(query, filter, 1);
  const first = useMobileData<LookupResponse>(firstUrl);
  const counts = first.data?.meta.counts;

  // the refresh button reloads the first page of what is on screen
  useEffect(() => onActiveUrl(firstUrl), [firstUrl, onActiveUrl]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const onType = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setQuery(v.trim());
      setPages(1);
    }, 300);
  };
  const clear = () => {
    if (timer.current) clearTimeout(timer.current);
    setText('');
    setQuery('');
    setPages(1);
  };

  const filters: { key: StockFilter; label: string }[] = [
    { key: 'all', label: 'ทั้งหมด' },
    { key: 'low', label: 'ใกล้หมด' },
    { key: 'out', label: 'หมด' },
  ];

  return (
    <div className="space-y-3">
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 space-y-2 bg-slate-50/95 px-4 pt-1 pb-2 backdrop-blur">
        <label className="relative block">
          <span className="sr-only">ค้นหาสินค้า</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            inputMode="search"
            enterKeyHint="search"
            autoComplete="off"
            value={text}
            onChange={(e) => onType(e.target.value)}
            placeholder="ชื่อสินค้า / รหัส / บาร์โค้ด"
            data-testid="stock-search"
            className="h-12 w-full rounded-xl border border-slate-300 bg-white pr-12 pl-10 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button type="button" onClick={clear} aria-label="ล้างคำค้นหา" className="absolute top-0 right-0 flex h-12 w-12 items-center justify-center text-slate-400">
              <X className="h-5 w-5" />
            </button>
          )}
        </label>
        <div className="flex gap-2" role="group" aria-label="กรองตามสต็อก">
          {filters.map((f) => (
            <Chip
              key={f.key}
              active={filter === f.key}
              onClick={() => {
                setFilter(f.key);
                setPages(1);
              }}
              testId={`stock-filter-${f.key}`}
            >
              {f.label}
              {counts ? <span className="ml-1 opacity-80">{counts[f.key].toLocaleString('th-TH')}</span> : null}
            </Chip>
          ))}
        </div>
      </div>

      {first.error && !first.data ? (
        <LoadErrorState message={first.error} onRetry={() => reloadMobileData(firstUrl)} retrying={first.loading} />
      ) : !first.data ? (
        <ListSkeleton />
      ) : first.data.data.length === 0 ? (
        <EmptyState>{query ? `ไม่พบสินค้าที่ตรงกับ “${query}”` : filter === 'all' ? 'ยังไม่มีสินค้า' : filter === 'low' ? 'ไม่มีสินค้าใกล้หมด' : 'ไม่มีสินค้าที่หมด'}</EmptyState>
      ) : (
        <>
          <p className="px-1 text-[13px] text-slate-500">
            พบ {first.data.meta.total.toLocaleString('th-TH')} รายการ · ใกล้หมด = คงเหลือไม่เกิน {formatQty(first.data.meta.lowStockThreshold)} (หน่วยฐาน)
          </p>
          {Array.from({ length: pages }, (_, i) => (
            <ResultPage
              key={i}
              url={i === 0 ? firstUrl : lookupUrl(query, filter, i + 1)}
              isLast={i === pages - 1}
              onMore={() => setPages(pages + 1)}
            />
          ))}
        </>
      )}
    </div>
  );
}

function ResultPage({ url, isLast, onMore }: { url: string; isLast: boolean; onMore: () => void }) {
  const { data, error, loading } = useMobileData<LookupResponse>(url);
  if (error && !data) return <LoadErrorState message={error} onRetry={() => reloadMobileData(url)} retrying={loading} />;
  if (!data) return <ListSkeleton rows={2} />;
  return (
    <>
      <ul className="space-y-3">
        {data.data.map((p) => (
          <li key={p.id}>
            <ProductCard p={p} canViewCost={data.canViewCost} />
          </li>
        ))}
      </ul>
      {isLast && data.meta.page < data.meta.totalPages && (
        <button
          type="button"
          onClick={onMore}
          className="min-h-12 w-full rounded-xl border border-slate-300 bg-white text-[15px] font-semibold text-indigo-700 active:bg-slate-100"
        >
          โหลดเพิ่ม ({(data.meta.total - data.meta.page * data.meta.limit).toLocaleString('th-TH')} รายการ)
        </button>
      )}
    </>
  );
}

const price = (v: number | null | undefined) => (v === null || v === undefined ? '–' : Number(v).toLocaleString('th-TH', { maximumFractionDigits: 2 }));

function ProductCard({ p, canViewCost }: { p: LookupProduct; canViewCost: boolean }) {
  const units = [
    { name: p.unit, size: 1, prices: p.prices },
    ...p.packs.map((u) => ({ name: u.name, size: u.factor, prices: u.prices })),
  ];
  // price levels that have a value on any unit (level 1 always)
  const levels = [0, 1, 2, 3, 4].filter((i) => i === 0 || units.some((u) => u.prices[i] !== null && u.prices[i] !== undefined));
  const level = p.stockLevel;

  return (
    <Card className="p-3.5" data-testid="stock-card">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h3 className="text-[16px] leading-snug font-bold text-slate-900">{p.name}</h3>
          <p className="mt-0.5 truncate text-[13px] text-slate-500">
            {p.sku}
            {p.category ? ` · ${p.category}` : ''}
            {p.barcodes[0] && p.barcodes[0] !== p.sku ? ` · ${p.barcodes[0]}` : ''}
          </p>
        </div>
        {level === 'out' && <span className="shrink-0 rounded-full bg-rose-100 px-2.5 py-1 text-[13px] font-bold text-rose-700">หมด</span>}
        {level === 'low' && <span className="shrink-0 rounded-full bg-amber-100 px-2.5 py-1 text-[13px] font-bold text-amber-800">ใกล้หมด</span>}
        {p.isBundle && <span className="shrink-0 rounded-full bg-violet-100 px-2.5 py-1 text-[13px] font-bold text-violet-700">ชุด</span>}
      </div>

      <div className={cn('mt-2 rounded-xl px-3 py-2', level === 'out' ? 'bg-rose-50' : level === 'low' ? 'bg-amber-50' : 'bg-slate-50')}>
        <p className="text-[12px] font-medium text-slate-500">คงเหลือ{p.isBundle ? ' (จัดชุดได้)' : ''}</p>
        <p className="text-[17px] font-extrabold text-slate-900 tabular-nums" data-testid="stock-text">
          {stockText(p.stock, p.unit, p.packs)}
        </p>
      </div>

      <table className="mt-2 w-full table-fixed text-[14px]">
        <thead>
          <tr className="text-[12px] text-slate-500">
            <th className="w-[30%] py-1 text-left font-medium">หน่วย</th>
            {levels.map((i) => (
              <th key={i} className="py-1 text-right font-medium">
                {levels.length === 1 ? 'ราคาขาย' : `ราคา ${i + 1}`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {units.map((u) => (
            <tr key={u.name + u.size} className="border-t border-slate-100">
              <td className="py-1.5 pr-1 text-slate-700">
                <span className="font-semibold">{u.name}</span>
                {u.size > 1 && <span className="block text-[12px] text-slate-500">= {formatQty(u.size, { grouping: true })} {p.unit}</span>}
              </td>
              {levels.map((i) => (
                <td key={i} className={cn('py-1.5 text-right tabular-nums', i === 0 ? 'font-bold text-slate-900' : 'text-slate-700')}>
                  {price(u.prices[i])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      {p.wholesalePrices.length > 0 && (
        <p className="mt-1.5 text-[13px] text-slate-600">
          ราคาส่ง:{' '}
          {p.wholesalePrices.map((w) => `ตั้งแต่ ${formatQty(w.minQuantity)} ${p.unit} ${baht(w.unitPrice)}`).join(' · ')}
        </p>
      )}
      {canViewCost && p.costPrice !== undefined && (
        <p className="mt-1.5 text-[13px] text-slate-600" data-testid="stock-cost">
          ทุน {baht(p.costPrice)} / {p.unit}
        </p>
      )}
    </Card>
  );
}
