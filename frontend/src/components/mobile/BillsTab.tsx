'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Search, X } from 'lucide-react';
import { bangkokDayStart, DAY_MS } from '@shared/bangkok-date';
import { LoadErrorState } from '@/components/common/LoadErrorState';
import { formatQty } from '@/lib/qty';
import { cn } from '@/lib/utils';
import type { MobileOrderDetail, MobileOrderList, MobileOrderListRow } from './types';
import { baht, Card, EmptyState, fmtDateTime, ListSkeleton, PAYMENT_LABELS, SectionTitle } from './ui';
import { reloadMobileData, useMobileData } from './use-mobile-data';

const PAGE_SIZE = 20;
const n = (v: unknown) => Number(v) || 0;

export function ordersUrl(search: string, day: string, page: number) {
  const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
  if (search) params.set('search', search);
  if (day) {
    const start = bangkokDayStart(day);
    if (Number.isFinite(start)) {
      params.set('startDate', new Date(start).toISOString());
      params.set('endDate', new Date(start + DAY_MS - 1).toISOString());
    }
  }
  return `/orders?${params.toString()}`;
}

/** "บิล": recent bills, newest first, read-only detail. */
export function BillsTab({ onActiveUrl }: { onActiveUrl: (url: string) => void }) {
  const [text, setText] = useState('');
  const [search, setSearch] = useState('');
  const [day, setDay] = useState('');
  const [pages, setPages] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const firstUrl = ordersUrl(search, day, 1);
  const first = useMobileData<MobileOrderList>(firstUrl);
  useEffect(() => onActiveUrl(firstUrl), [firstUrl, onActiveUrl]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // the phone's back button closes the bill instead of leaving the page
  useEffect(() => {
    const onPop = () => setOpenId(null);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const openBill = (id: string) => {
    window.history.pushState({ mobileBill: id }, '');
    setOpenId(id);
  };
  const closeBill = () => {
    if (window.history.state?.mobileBill) window.history.back();
    else setOpenId(null);
  };

  const onType = (v: string) => {
    setText(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearch(v.trim());
      setPages(1);
    }, 300);
  };

  return (
    <div className="space-y-3">
      <div className="sticky top-[calc(3.5rem+env(safe-area-inset-top))] z-10 -mx-4 space-y-2 bg-slate-50/95 px-4 pt-1 pb-2 backdrop-blur">
        <label className="relative block">
          <span className="sr-only">ค้นหาบิล</span>
          <Search className="pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2 text-slate-400" aria-hidden />
          <input
            type="search"
            enterKeyHint="search"
            autoComplete="off"
            value={text}
            onChange={(e) => onType(e.target.value)}
            placeholder="เลขที่บิล / ชื่อหรือเบอร์ลูกค้า"
            data-testid="bill-search"
            className="h-12 w-full rounded-xl border border-slate-300 bg-white pr-12 pl-10 text-base outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 [&::-webkit-search-cancel-button]:hidden"
          />
          {text && (
            <button
              type="button"
              aria-label="ล้างคำค้นหา"
              onClick={() => {
                if (timer.current) clearTimeout(timer.current);
                setText('');
                setSearch('');
                setPages(1);
              }}
              className="absolute top-0 right-0 flex h-12 w-12 items-center justify-center text-slate-400"
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </label>
        <div className="flex items-center gap-2">
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-xl border border-slate-300 bg-white px-3">
            <span className="shrink-0 text-[14px] text-slate-500">วันที่</span>
            <input
              type="date"
              value={day}
              onChange={(e) => {
                setDay(e.target.value);
                setPages(1);
              }}
              data-testid="bill-date"
              className="min-w-0 flex-1 bg-transparent text-base text-slate-900 outline-none"
            />
          </label>
          {day && (
            <button
              type="button"
              onClick={() => {
                setDay('');
                setPages(1);
              }}
              className="min-h-11 shrink-0 rounded-xl border border-slate-300 bg-white px-3 text-[14px] font-semibold text-slate-700"
            >
              ทุกวัน
            </button>
          )}
        </div>
      </div>

      {first.error && !first.data ? (
        <LoadErrorState message={first.error} onRetry={() => reloadMobileData(firstUrl)} retrying={first.loading} />
      ) : !first.data ? (
        <ListSkeleton />
      ) : first.data.data.length === 0 ? (
        <EmptyState>{search || day ? 'ไม่พบบิลตามเงื่อนไข' : 'ยังไม่มีบิล'}</EmptyState>
      ) : (
        <>
          <p className="px-1 text-[13px] text-slate-500">ทั้งหมด {first.data.meta.total.toLocaleString('th-TH')} บิล (ล่าสุดอยู่บน)</p>
          {Array.from({ length: pages }, (_, i) => (
            <BillPage key={i} url={i === 0 ? firstUrl : ordersUrl(search, day, i + 1)} isLast={i === pages - 1} onMore={() => setPages(pages + 1)} onOpen={openBill} />
          ))}
        </>
      )}

      {openId && <BillDetail id={openId} onClose={closeBill} />}
    </div>
  );
}

function statusOf(o: MobileOrderListRow): { label: string; cls: string } | null {
  if (o.status === 'VOIDED' || o.status === 'CANCELLED') return { label: 'ยกเลิกแล้ว', cls: 'bg-rose-100 text-rose-700' };
  if (o.status === 'REFUNDED') return { label: 'คืนเงินแล้ว', cls: 'bg-rose-100 text-rose-700' };
  if (n(o.returnedAmount) > 0 || (o.returns && o.returns.length > 0)) return { label: 'มีคืนสินค้า', cls: 'bg-amber-100 text-amber-800' };
  if (o.status === 'PENDING') return { label: 'รอดำเนินการ', cls: 'bg-slate-100 text-slate-700' };
  return null;
}

function BillPage({ url, isLast, onMore, onOpen }: { url: string; isLast: boolean; onMore: () => void; onOpen: (id: string) => void }) {
  const { data, error, loading } = useMobileData<MobileOrderList>(url);
  if (error && !data) return <LoadErrorState message={error} onRetry={() => reloadMobileData(url)} retrying={loading} />;
  if (!data) return <ListSkeleton rows={2} />;
  return (
    <>
      <ul className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        {data.data.map((o, i) => {
          const st = statusOf(o);
          const methods = [...new Set((o.payments || []).map((p) => PAYMENT_LABELS[p.method] || p.method))];
          return (
            <li key={o.id} className={cn(i > 0 && 'border-t border-slate-100')}>
              <button type="button" onClick={() => onOpen(o.id)} className="flex min-h-16 w-full items-center gap-3 px-3.5 py-3 text-left active:bg-slate-50" data-testid="bill-row">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-x-2 text-[15px] font-bold text-slate-900">
                    <span className="truncate">{o.orderNumber}</span>
                    {st && <span className={cn('rounded-full px-2 py-0.5 text-[12px] font-bold', st.cls)}>{st.label}</span>}
                  </p>
                  <p className="truncate text-[13px] text-slate-500">
                    {fmtDateTime(o.createdAt)}
                    {o.customer?.name ? ` · ${o.customer.name}` : ''}
                    {methods.length ? ` · ${methods.join(', ')}` : ''}
                  </p>
                </div>
                <span className={cn('shrink-0 text-[16px] font-extrabold tabular-nums', o.status === 'VOIDED' ? 'text-slate-400 line-through' : 'text-slate-900')}>{baht(o.totalAmount)}</span>
                <ChevronRight className="h-5 w-5 shrink-0 text-slate-300" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
      {isLast && data.meta.page < data.meta.totalPages && (
        <button type="button" onClick={onMore} className="min-h-12 w-full rounded-xl border border-slate-300 bg-white text-[15px] font-semibold text-indigo-700 active:bg-slate-100">
          โหลดเพิ่ม
        </button>
      )}
    </>
  );
}

const REFUND_LABELS: Record<string, string> = { CASH: 'คืนเงินสด', TRANSFER: 'โอนคืน', DEBT_REDUCTION: 'ลดหนี้' };

/** Full-screen, read-only bill (no void / return / edit). */
function BillDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const url = `/orders/${encodeURIComponent(id)}`;
  const { data: o, error, loading } = useMobileData<MobileOrderDetail>(url);
  const st = o ? statusOf(o) : null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-50" role="dialog" aria-modal="true" aria-label="รายละเอียดบิล" data-testid="bill-detail">
      <header className="flex h-14 shrink-0 items-center gap-1 border-b border-slate-200 bg-white px-1">
        <button type="button" onClick={onClose} className="flex h-11 min-w-11 items-center gap-1 rounded-xl px-2 text-[15px] font-semibold text-indigo-700" aria-label="กลับ">
          <ChevronLeft className="h-6 w-6" /> กลับ
        </button>
        <h2 className="min-w-0 flex-1 truncate text-center text-[16px] font-bold text-slate-900">{o?.orderNumber || 'รายละเอียดบิล'}</h2>
        <span className="w-[72px]" />
      </header>
      <div className="flex-1 overflow-y-auto px-4 py-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        {error && !o ? (
          <LoadErrorState message={error} onRetry={() => reloadMobileData(url)} retrying={loading} />
        ) : !o ? (
          <ListSkeleton rows={3} />
        ) : (
          <div className="mx-auto max-w-lg space-y-3">
            <Card className="space-y-1 text-[15px]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">วันที่</span>
                <span className="font-semibold text-slate-900">{fmtDateTime(o.createdAt)}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">สถานะ</span>
                <span className={cn('rounded-full px-2 py-0.5 text-[13px] font-bold', st ? st.cls : 'bg-emerald-100 text-emerald-700')} data-testid="bill-status">
                  {st ? st.label : 'สำเร็จ'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">พนักงานขาย</span>
                <span className="truncate text-slate-900">{o.user?.fullName || o.user?.username || '-'}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="text-slate-500">ลูกค้า</span>
                <span className="truncate text-slate-900">{o.customer?.name ? `${o.customer.name}${o.customer.phone ? ` (${o.customer.phone})` : ''}` : 'ลูกค้าทั่วไป'}</span>
              </div>
              {o.voidReason && <p className="mt-1 rounded-lg bg-rose-50 px-2 py-1 text-[14px] text-rose-700">เหตุผลที่ยกเลิก: {o.voidReason}</p>}
              {o.note && <p className="mt-1 text-[14px] text-slate-600">หมายเหตุ: {o.note}</p>}
            </Card>

            <Card>
              <SectionTitle>รายการสินค้า ({(o.items || []).length})</SectionTitle>
              <ul className="divide-y divide-slate-100" data-testid="bill-items">
                {(o.items || []).map((it) => (
                  <li key={it.id} className="py-2">
                    <div className="flex items-start justify-between gap-3">
                      <p className="min-w-0 flex-1 text-[15px] font-semibold text-slate-800">{it.product?.name || '-'}</p>
                      <span className="shrink-0 text-[15px] font-bold tabular-nums text-slate-900">{baht(it.total)}</span>
                    </div>
                    <p className="text-[13px] text-slate-500">
                      {formatQty(it.quantity, { grouping: true })} {it.unitName || it.product?.unit || ''} × {baht(it.unitPrice)}
                      {n(it.discountAmount) > 0 && <span className="text-rose-600"> · ส่วนลด {baht(it.discountAmount)}</span>}
                    </p>
                  </li>
                ))}
              </ul>
              <dl className="mt-2 space-y-1 border-t border-slate-200 pt-2 text-[15px]">
                <Row label="รวมเป็นเงิน" value={baht(o.subtotal)} />
                {n(o.discountAmount) > 0 && <Row label="ส่วนลดท้ายบิล" value={`-${baht(o.discountAmount)}`} tone="text-rose-600" />}
                {n(o.vatAmount) > 0 && <Row label={`VAT ${formatQty(o.vatRate)}% (รวมในราคา)`} value={baht(o.vatAmount)} />}
                <Row label="ยอดสุทธิ" value={baht(o.totalAmount)} bold />
                {n(o.returnedAmount) > 0 && <Row label="คืนสินค้าแล้ว" value={`-${baht(o.returnedAmount)}`} tone="text-amber-700" />}
              </dl>
            </Card>

            <Card>
              <SectionTitle>การชำระเงิน</SectionTitle>
              <dl className="space-y-1 text-[15px]" data-testid="bill-payments">
                {(o.payments || []).map((p, i) => (
                  <Row key={p.id || i} label={`${PAYMENT_LABELS[p.method] || p.method}${p.referenceNo ? ` (${p.referenceNo})` : ''}`} value={baht(p.amount)} />
                ))}
                {o.debt && n(o.debt.remainingAmount) > 0 && <Row label="หนี้คงค้างของบิลนี้" value={baht(o.debt.remainingAmount)} tone="text-amber-700" />}
              </dl>
            </Card>

            {(o.returns || []).length > 0 && (
              <Card>
                <SectionTitle>การคืนสินค้า</SectionTitle>
                <ul className="space-y-2 text-[14px]">
                  {(o.returns || []).map((r) => (
                    <li key={r.returnNumber} className="rounded-xl bg-amber-50 px-3 py-2">
                      <div className="flex justify-between gap-2 font-semibold text-slate-800">
                        <span>{r.returnNumber}</span>
                        <span className="tabular-nums">{baht(r.refundAmount)}</span>
                      </div>
                      <p className="text-[13px] text-slate-600">
                        {fmtDateTime(r.createdAt)} · {REFUND_LABELS[r.refundMethod] || r.refundMethod}
                        {r.reason ? ` · ${r.reason}` : ''}
                      </p>
                    </li>
                  ))}
                </ul>
              </Card>
            )}
            <p className="pb-2 text-center text-[13px] text-slate-400">ดูอย่างเดียว · ยกเลิก/คืนสินค้าทำได้ที่เครื่องขาย</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value, bold, tone }: { label: string; value: string; bold?: boolean; tone?: string }) {
  return (
    <div className={cn('flex items-baseline justify-between gap-3', bold && 'text-[17px] font-extrabold text-slate-900', tone)}>
      <dt className={cn(!bold && !tone && 'text-slate-600')}>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
