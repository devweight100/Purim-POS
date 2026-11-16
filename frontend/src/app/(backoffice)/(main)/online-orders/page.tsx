'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShoppingBag, Link2, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatCurrency } from '@/lib/utils';
import { useOnlineCounts } from '@/lib/online-orders';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { ONLINE_STATUS_LABELS, type OnlineOrderStatus } from '@shared/online-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { OnlineOrderDetail, StatusPill } from '@/components/online-orders/OnlineOrderDetail';
import { LinkRequests } from '@/components/online-orders/LinkRequests';
import { cn } from '@/lib/utils';

interface OnlineOrderRow {
  id: string;
  orderNo: string;
  status: OnlineOrderStatus;
  fulfillment: 'PICKUP' | 'DELIVERY';
  contactName: string;
  contactPhone: string;
  customer: { id: string; name: string } | null;
  itemCount: number;
  subtotal: number;
  deliveryFee: number | null;
  totalAmount: number;
  paid: boolean;
  createdAt: string;
}

const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'ต้องจัดการ' },
  { value: 'NEW', label: 'ใหม่' },
  { value: 'payable', label: 'รอรับเงิน' },
  { value: 'DONE', label: 'เสร็จแล้ว' },
  { value: 'CANCELLED', label: 'ยกเลิก' },
  { value: 'all', label: 'ทั้งหมด' },
];

const when = (iso: string) => new Date(iso).toLocaleString('th-TH', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function OnlineOrdersInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'links' ? 'links' : 'orders';
  const counts = useOnlineCounts((s) => s.counts);
  const refreshCounts = useOnlineCounts((s) => s.refresh);
  const [filter, setFilter] = useState('open');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 300);
  const [rows, setRows] = useState<OnlineOrderRow[] | null>(null);
  const [selected, setSelected] = useState<string | null>(params.get('id'));
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams({ status: filter, limit: '100' });
      if (q.trim()) qs.set('search', q.trim());
      const r = await apiFetch<{ data: OnlineOrderRow[] }>(`/online-shop/orders?${qs}`);
      setRows(r.data);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'โหลดไม่สำเร็จ');
    }
  }, [filter, q]);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  // new orders / changes from other screens (realtime "onlineOrder" events relayed by ClientDbSync)
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    const on = (e: Event) => {
      if ((e as CustomEvent<{ entity?: string }>).detail?.entity !== 'onlineOrder') return;
      clearTimeout(t);
      t = setTimeout(() => void load(), 500);
    };
    window.addEventListener('purim:realtime', on);
    return () => {
      clearTimeout(t);
      window.removeEventListener('purim:realtime', on);
    };
  }, [load]);

  const setTab = (t: 'orders' | 'links') => router.replace(t === 'links' ? '/online-orders?tab=links' : '/online-orders');
  const changed = () => {
    void load();
    void refreshCounts();
  };

  return (
    <div className="p-edge sm:p-6 space-y-4 max-w-[1500px] mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-btn">
        <div>
          <h1 className="text-2xl font-black text-slate-900 flex items-center gap-2">
            <ShoppingBag className="w-6 h-6 text-emerald-700" /> ออเดอร์ออนไลน์ (LINE)
          </h1>
          <p className="text-sm text-slate-500">ลูกค้าสั่งจากหน้าร้านออนไลน์ใน LINE — ตรวจรายการ ใส่ค่าส่ง กดรับ แล้วไปรับเงินที่หน้าขาย (บิลพัก)</p>
        </div>
        <div className="flex gap-btn" role="tablist" aria-label="หัวข้อ">
          <Button role="tab" aria-selected={tab === 'orders'} variant={tab === 'orders' ? 'default' : 'outline'} onClick={() => setTab('orders')} className="gap-2">
            <ShoppingBag className="w-4 h-4" /> ออเดอร์{counts?.new ? <span className="rounded-full bg-rose-600 text-white px-1.5 text-xs">{counts.new}</span> : null}
          </Button>
          <Button role="tab" aria-selected={tab === 'links'} variant={tab === 'links' ? 'default' : 'outline'} onClick={() => setTab('links')} className="gap-2">
            <Link2 className="w-4 h-4" /> คำขอผูกสมาชิก{counts?.linkRequests ? <span className="rounded-full bg-rose-600 text-white px-1.5 text-xs">{counts.linkRequests}</span> : null}
          </Button>
        </div>
      </div>

      {tab === 'links' ? (
        <LinkRequests onChanged={() => void refreshCounts()} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)]">
          <section aria-label="รายการออเดอร์" className={cn('space-y-3 min-w-0', selected && 'hidden xl:block')}>
            <div className="flex flex-wrap gap-btn">
              {FILTERS.map((f) => (
                <Button key={f.value} size="sm" variant={filter === f.value ? 'default' : 'outline'} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                  {f.label}
                  {f.value === 'NEW' && counts?.new ? ` (${counts.new})` : ''}
                  {f.value === 'payable' && counts?.payable ? ` (${counts.payable})` : ''}
                </Button>
              ))}
            </div>
            <div className="flex gap-btn">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาเลขออเดอร์ / ชื่อ / เบอร์" aria-label="ค้นหาออเดอร์" />
              <Button variant="outline" onClick={() => changed()} aria-label="โหลดใหม่" title="โหลดใหม่">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
            {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
            {rows?.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">ไม่มีออเดอร์ในหัวข้อนี้</p>}
            <ul className="space-y-2">
              {rows?.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    data-testid="online-order-row"
                    onClick={() => setSelected(r.id)}
                    aria-current={selected === r.id}
                    className={cn(
                      'w-full rounded-xl border bg-white p-3 text-left shadow-xs transition hover:border-emerald-400 focus-visible:outline-2 focus-visible:outline-sky-500',
                      selected === r.id ? 'border-emerald-600 ring-2 ring-emerald-200' : 'border-slate-200',
                    )}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-black text-slate-900">{r.orderNo}</span>
                      <StatusPill status={r.status} paid={r.paid} />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span className="text-slate-700 min-w-0 truncate">
                        {r.customer?.name || r.contactName} · {r.fulfillment === 'PICKUP' ? 'รับที่ร้าน' : 'ส่งของ'} · {r.itemCount} รายการ
                      </span>
                      <span className="font-mono font-bold">
                        {formatCurrency(r.totalAmount)}
                        {r.deliveryFee === null && r.fulfillment === 'DELIVERY' ? ' + ค่าส่ง?' : ''}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">{when(r.createdAt)}</div>
                  </button>
                </li>
              ))}
            </ul>
          </section>
          <section aria-label="รายละเอียดออเดอร์" className={cn('min-w-0', !selected && 'hidden xl:block')}>
            {selected ? (
              <OnlineOrderDetail id={selected} onBack={() => setSelected(null)} onChanged={changed} />
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-500">เลือกออเดอร์ทางซ้ายเพื่อดูรายละเอียด</div>
            )}
          </section>
        </div>
      )}
      <p className="text-xs text-slate-500">สถานะ: {Object.values(ONLINE_STATUS_LABELS).join(' → ')}</p>
    </div>
  );
}

export default function OnlineOrdersPage() {
  return (
    <Suspense fallback={null}>
      <OnlineOrdersInner />
    </Suspense>
  );
}
