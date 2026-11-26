'use client';

import { Suspense, useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ShoppingBag, Link2, RefreshCw } from 'lucide-react';
import { apiFetch } from '@/lib/api';
import { formatCurrency, formatListDateTime } from '@/lib/utils';
import { useOnlineCounts } from '@/lib/online-orders';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import type { OnlineOrderStatus } from '@shared/online-shop';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ClaimBadge, OnlineOrderDetail, StatusPill } from '@/components/online-orders/OnlineOrderDetail';
import { useAuthStore } from '@/lib/store/auth-store';
import type { OnlineClaim, OnlinePicked } from '@/lib/online-order-actions';
import { onlineOrderStep } from '@/lib/online-order-steps';
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
  claim: OnlineClaim | null;
  picked: OnlinePicked | null;
}

const FILTERS: { value: string; label: string }[] = [
  { value: 'open', label: 'ต้องจัดการ' },
  { value: 'NEW', label: 'ใหม่' },
  { value: 'payable', label: 'รอรับเงิน' },
  { value: 'READY', label: 'จัดเสร็จ' },
  { value: 'DONE', label: 'เสร็จแล้ว' },
  { value: 'CANCELLED', label: 'ยกเลิก' },
  { value: 'all', label: 'ทั้งหมด' },
];

const when = (iso: string) => formatListDateTime(iso); // online orders list keeps the time (round 4)

function OnlineOrdersInner() {
  const params = useSearchParams();
  const router = useRouter();
  const tab = params.get('tab') === 'links' ? 'links' : 'orders';
  const counts = useOnlineCounts((s) => s.counts);
  const meId = useAuthStore((s) => s.user?.id);
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
  const [last, setLast] = useState<string | null>(params.get('id'));
  const openOrder = (id: string) => {
    setLast(id);
    setSelected(id);
  };
  // back to the list: the row keeps the focus / highlight and the list its scroll position
  const closeOrder = () => {
    const id = selected;
    setSelected(null);
    if (params.get('id')) router.replace('/online-orders', { scroll: false });
    setTimeout(() => document.querySelector<HTMLElement>(`[data-testid="online-order-row"][data-id="${id}"]`)?.focus({ preventScroll: true }), 50);
  };
  // ↑ / ↓ move between rows (Enter opens: the row is a button)
  const rowKeys = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="online-order-row"]'));
    if (!all.length) return;
    e.preventDefault();
    const i = all.indexOf(document.activeElement as HTMLElement);
    const next = i < 0 ? 0 : Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
    all[next].focus();
    all[next].scrollIntoView({ block: 'nearest' });
  };
  const changed = () => {
    void load();
    void refreshCounts();
  };

  return (
    <div className="page-shell">
      <div className="flex flex-wrap items-center justify-between gap-btn">
        <div>
          <h1 className="page-title">
            <ShoppingBag /> ออเดอร์ออนไลน์ (LINE)
          </h1>
          <p className="page-subtitle">ลูกค้าสั่งจากหน้าร้านออนไลน์ใน LINE — กดออเดอร์เพื่อเปิดหน้าต่างเต็มจอ แล้วทำตามขั้นตอน: รับงาน → จัดของ → จัดเสร็จ → (ส่ง) → เสร็จ · รับเงินได้ทุกขั้นตอน</p>
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
        <section aria-label="รายการออเดอร์" className="space-y-3 min-w-0">
          <div className="flex flex-wrap items-center gap-btn">
            {FILTERS.map((f) => (
              <Button key={f.value} variant={filter === f.value ? 'default' : 'outline'} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
                {f.label}
                {f.value === 'NEW' && counts?.new ? ` (${counts.new})` : ''}
                {f.value === 'payable' && counts?.payable ? ` (${counts.payable})` : ''}
                {f.value === 'READY' && counts?.statuses?.READY ? ` (${counts.statuses.READY})` : ''}
              </Button>
            ))}
            <div className="flex min-w-[260px] flex-1 gap-btn">
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ค้นหาเลขออเดอร์ / ชื่อ / เบอร์" aria-label="ค้นหาออเดอร์" />
              <Button variant="outline" onClick={() => changed()} aria-label="โหลดใหม่" title="โหลดใหม่">
                <RefreshCw className="w-4 h-4" />
              </Button>
            </div>
          </div>
          {error && <p className="text-sm font-semibold text-rose-700">{error}</p>}
          {rows?.length === 0 && <p className="rounded-xl border border-dashed border-slate-300 bg-white p-6 text-center text-slate-500">ไม่มีออเดอร์ในหัวข้อนี้</p>}
          {!!rows?.length && <p className="text-sub text-muted-foreground">↑ ↓ เลือกออเดอร์ · Enter เปิด · ในหน้าต่างออเดอร์ Enter = ทำขั้นต่อไป · Esc กลับมาที่รายการ</p>}
          <ul className="space-y-2" onKeyDown={rowKeys}>
            {rows?.map((r) => {
              // a new order nobody has taken yet stands out
              const fresh = r.status === 'NEW' && !r.claim;
              const step = onlineOrderStep({ status: r.status, fulfillment: r.fulfillment, paid: r.paid });
              const open = r.status !== 'DONE' && r.status !== 'CANCELLED';
              return (
                <li key={r.id}>
                  <button
                    type="button"
                    data-testid="online-order-row"
                    data-id={r.id}
                    onClick={() => openOrder(r.id)}
                    aria-current={last === r.id}
                    className={cn(
                      'w-full rounded-xl border bg-white px-4 py-3 text-left shadow-xs transition hover:border-indigo-400 focus-visible:outline-2 focus-visible:outline-sky-500 focus-visible:bg-sky-50',
                      'grid gap-x-4 gap-y-1 grid-cols-[minmax(0,1fr)_auto] lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,300px)_minmax(130px,auto)] lg:items-center',
                      last === r.id ? 'border-indigo-500 ring-2 ring-indigo-100' : fresh ? 'border-amber-400 border-l-8 bg-amber-50' : 'border-slate-200',
                    )}
                  >
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-900">{r.orderNo}</span>
                      <span className="block text-xs text-slate-500">{when(r.createdAt)}</span>
                    </span>
                    <span className="min-w-0 lg:order-none order-3 col-span-2 lg:col-span-1">
                      <span className="block truncate text-slate-700">
                        {r.customer?.name || r.contactName} · {r.fulfillment === 'PICKUP' ? 'รับที่ร้าน' : 'ส่งของ'} · {r.itemCount} รายการ
                      </span>
                      <span className="mt-1 flex flex-wrap gap-1"><ClaimBadge claim={r.claim} meId={meId} status={r.status} picked={r.picked} /></span>
                    </span>
                    <span className="flex min-w-0 flex-wrap items-center gap-2 justify-end lg:justify-start order-2 lg:order-none col-span-2 lg:col-span-1">
                      <StatusPill status={r.status} paid={r.paid} />
                      <span data-testid="row-next-step" className={cn('text-sm font-semibold whitespace-nowrap', open ? 'text-indigo-700' : 'text-slate-500')}>
                        {open ? `→ ${step.todo}` : step.todo}
                      </span>
                    </span>
                    <span className="text-right tabular-nums font-bold whitespace-nowrap order-1 lg:order-none">
                      {formatCurrency(r.totalAmount)}
                      {r.deliveryFee === null && r.fulfillment === 'DELIVERY' ? ' + ค่าส่ง?' : ''}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {selected && <OnlineOrderDetail id={selected} onBack={closeOrder} onChanged={changed} />}
        </section>
      )}
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
