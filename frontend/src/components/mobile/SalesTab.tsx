'use client';

import { useState } from 'react';
import { TrendingDown, TrendingUp, Minus } from 'lucide-react';
import { LoadErrorState } from '@/components/common/LoadErrorState';
import { MOBILE_RANGES, pctChange, type MobileRange } from '@/lib/mobile';
import { formatQty } from '@/lib/qty';
import { cn } from '@/lib/utils';
import type { MobileDashboard } from './types';
import { baht, Card, Chip, SectionTitle, Skeleton } from './ui';
import { reloadMobileData, useMobileData } from './use-mobile-data';

const n = (v: unknown) => Number(v) || 0;

/** "ยอดขาย": figures of GET /reports/dashboard for the chosen period (same as the back-office dashboard). */
export function SalesTab({ range, onRange, url }: { range: MobileRange; onRange: (r: MobileRange) => void; url: string }) {
  const { data, error, loading } = useMobileData<MobileDashboard>(url);
  const meta = MOBILE_RANGES.find((r) => r.key === range)!;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-2" role="group" aria-label="ช่วงเวลา">
        {MOBILE_RANGES.map((r) => (
          <Chip key={r.key} active={range === r.key} onClick={() => onRange(r.key)} testId={`range-${r.key}`}>
            {r.label}
          </Chip>
        ))}
      </div>

      {error && !data ? (
        <LoadErrorState message={error} onRetry={() => reloadMobileData(url)} retrying={loading} />
      ) : !data ? (
        <SalesSkeleton />
      ) : (
        <SalesBody d={data} compareLabel={meta.compareLabel} range={range} />
      )}
      {error && data && <p className="text-center text-sm text-red-600">อัปเดตไม่สำเร็จ แสดงข้อมูลล่าสุดที่โหลดได้</p>}
    </div>
  );
}

function SalesSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="กำลังโหลด">
      <Card className="space-y-3">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-4 w-40" />
      </Card>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <Card key={i} className="space-y-2">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-6 w-20" />
          </Card>
        ))}
      </div>
      <Card>
        <Skeleton className="h-32 w-full" />
      </Card>
    </div>
  );
}

function Change({ current, previous, label, onDark }: { current: number; previous: number | undefined; label: string; onDark?: boolean }) {
  if (previous === undefined) return null;
  const pct = pctChange(current, previous);
  const up = pct !== null && pct > 0;
  const down = pct !== null && pct < 0;
  const Icon = up ? TrendingUp : down ? TrendingDown : Minus;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
      <span
        data-testid="sales-change"
        className={cn(
          'inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold',
          up ? 'bg-emerald-100 text-emerald-800' : down ? 'bg-rose-100 text-rose-800' : 'bg-slate-100 text-slate-700',
        )}
      >
        {pct !== null && <Icon className="h-4 w-4" aria-hidden />}
        {pct === null ? (current > 0 ? 'ใหม่' : '0%') : `${pct > 0 ? '+' : ''}${pct.toLocaleString('th-TH')}%`}
      </span>
      <span className={onDark ? 'text-indigo-100' : 'text-slate-500'}>
        {label} ({baht(previous)})
      </span>
    </div>
  );
}

function SalesBody({ d, compareLabel, range }: { d: MobileDashboard; compareLabel: string; range: MobileRange }) {
  const s = d.sales || {};
  const net = n(s.netSales);
  const pay = d.payments || {};
  const payRows = [
    { key: 'cash', label: 'เงินสด', value: n(pay.cash), color: 'bg-emerald-500' },
    { key: 'qr', label: 'โอน / QR', value: n(pay.qrTransfer), color: 'bg-sky-500' },
    { key: 'credit', label: 'เงินเชื่อ', value: n(pay.credit), color: 'bg-amber-500' },
    { key: 'card', label: 'บัตร', value: n(pay.card), color: 'bg-violet-500', optional: true },
    { key: 'other', label: 'อื่น ๆ / ใบลดหนี้', value: n(pay.other), color: 'bg-slate-400', optional: true },
  ].filter((r) => !r.optional || r.value !== 0);
  const payTotal = payRows.reduce((sum, r) => sum + Math.max(0, r.value), 0);

  return (
    <>
      <Card className="bg-gradient-to-br from-indigo-600 to-indigo-700 text-white border-indigo-700">
        <p className="text-sm font-medium text-indigo-100">ยอดขายสุทธิ</p>
        <p className="mt-1 text-[34px] leading-tight font-black tracking-tight" data-testid="net-sales">
          {baht(net)}
        </p>
        <Change current={net} previous={d.previous?.netSales} label={compareLabel} onDark />
      </Card>

      <div className="grid grid-cols-2 gap-3">
        <Stat label="จำนวนบิล" value={n(s.completedCount).toLocaleString('th-TH')} sub={d.previous ? `ก่อนหน้า ${d.previous.completedCount.toLocaleString('th-TH')}` : undefined} testId="bill-count" />
        <Stat label="เฉลี่ยต่อบิล" value={baht(s.averageBasket)} sub={d.previous ? `ก่อนหน้า ${baht(d.previous.averageBasket)}` : undefined} />
        <Stat label="คืนสินค้า" value={baht(s.returnsAmount)} sub={`${n(s.returnCount).toLocaleString('th-TH')} ครั้ง`} tone={n(s.returnsAmount) > 0 ? 'warn' : undefined} />
        <Stat label="บิลยกเลิก" value={`${n(s.voidedCount).toLocaleString('th-TH')} บิล`} sub={baht(s.voidedAmount)} tone={n(s.voidedCount) > 0 ? 'warn' : undefined} />
      </div>

      <Card>
        <SectionTitle>ช่องทางชำระเงิน</SectionTitle>
        <ul className="space-y-3">
          {payRows.map((r) => (
            <li key={r.key}>
              <div className="flex items-baseline justify-between text-[15px]">
                <span className="text-slate-700">{r.label}</span>
                <span className="font-bold text-slate-900 tabular-nums" data-testid={`pay-${r.key}`}>
                  {baht(r.value)}
                </span>
              </div>
              <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100">
                <div className={cn('h-full rounded-full', r.color)} style={{ width: `${payTotal > 0 ? Math.max(0, (r.value / payTotal) * 100) : 0}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <SalesChart d={d} range={range} />

      <Card>
        <SectionTitle>สินค้าขายดี 10 อันดับ</SectionTitle>
        {(d.topProducts || []).length === 0 ? (
          <p className="py-4 text-center text-[15px] text-slate-500">ยังไม่มียอดขายในช่วงนี้</p>
        ) : (
          <ol className="divide-y divide-slate-100" data-testid="top-products">
            {(d.topProducts || []).map((p, i) => (
              <li key={p.productId || p.sku || i} className="flex items-center gap-3 py-2.5">
                <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-sm font-bold', i < 3 ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600')}>
                  {i + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px] font-semibold text-slate-800">{p.name}</p>
                  <p className="text-[13px] text-slate-500">จำนวน {formatQty(p.quantity, { grouping: true })}</p>
                </div>
                <span className="shrink-0 text-[15px] font-bold tabular-nums text-slate-900">{baht(p.revenue)}</span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </>
  );
}

function Stat({ label, value, sub, tone, testId }: { label: string; value: string; sub?: string; tone?: 'warn'; testId?: string }) {
  return (
    <Card className="p-3.5">
      <p className="text-[13px] font-medium text-slate-500">{label}</p>
      <p className={cn('mt-0.5 text-xl font-extrabold tabular-nums', tone === 'warn' ? 'text-amber-700' : 'text-slate-900')} data-testid={testId}>
        {value}
      </p>
      {sub && <p className="text-[13px] text-slate-500">{sub}</p>}
    </Card>
  );
}

const shortDay = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', day: 'numeric', month: 'short' });
const shortMonth = new Intl.DateTimeFormat('th-TH', { timeZone: 'UTC', month: 'short' });

/** Plain CSS bars: per hour for one-day periods, per day otherwise. Tap a bar to see its figure. */
function SalesChart({ d, range }: { d: MobileDashboard; range: MobileRange }) {
  const [picked, setPicked] = useState<number | null>(null);
  let bars: { label: string; full: string; value: number; orders: number }[];
  let title: string;
  if (d.hourly && (range === 'today' || range === 'yesterday')) {
    title = 'ยอดขายรายชั่วโมง';
    const active = d.hourly.filter((h) => h.netSales !== 0 || h.orders > 0).map((h) => h.hour);
    const from = Math.min(8, ...active);
    const to = Math.max(20, ...active);
    bars = d.hourly
      .filter((h) => h.hour >= from && h.hour <= to)
      .map((h) => ({ label: String(h.hour), full: `${String(h.hour).padStart(2, '0')}:00-${String(h.hour).padStart(2, '0')}:59`, value: h.netSales, orders: h.orders }));
  } else {
    title = 'ยอดขายรายวัน';
    bars = (d.timeline || []).map((t) => {
      const date = new Date(t.date.length === 7 ? `${t.date}-01T00:00:00Z` : `${t.date}T00:00:00Z`);
      return {
        label: t.date.length === 7 ? shortMonth.format(date) : String(date.getUTCDate()),
        full: t.date.length === 7 ? shortMonth.format(date) : shortDay.format(date),
        value: n(t.netSales),
        orders: n(t.orders),
      };
    });
  }
  const max = Math.max(1, ...bars.map((b) => b.value));
  const every = bars.length > 16 ? Math.ceil(bars.length / 8) : bars.length > 10 ? 2 : 1;
  const sel = picked !== null && picked < bars.length ? bars[picked] : null;

  return (
    <Card>
      <SectionTitle right={<span className="text-[13px] text-slate-500">แตะแท่งเพื่อดูยอด</span>}>{title}</SectionTitle>
      <p className="mb-2 min-h-5 text-sm text-slate-700" aria-live="polite">
        {sel ? (
          <>
            <b>{sel.full}</b> · {baht(sel.value)} · {sel.orders.toLocaleString('th-TH')} บิล
          </>
        ) : (
          <span className="text-slate-400">สูงสุด {baht(Math.max(0, ...bars.map((b) => b.value)))}</span>
        )}
      </p>
      <div className="flex h-36 items-end gap-[3px]" data-testid="sales-chart">
        {bars.map((b, i) => (
          <button
            key={i}
            type="button"
            aria-label={`${b.full} ${baht(b.value)}`}
            onClick={() => setPicked(i === picked ? null : i)}
            className="flex h-full min-w-0 flex-1 items-end"
          >
            <span
              className={cn('block w-full rounded-t-[3px]', i === picked ? 'bg-amber-500' : b.value > 0 ? 'bg-indigo-500' : 'bg-slate-200')}
              style={{ height: `${b.value > 0 ? Math.max(3, (b.value / max) * 100) : 2}%` }}
            />
          </button>
        ))}
      </div>
      <div className="mt-1 flex gap-[3px] text-[11px] text-slate-500">
        {bars.map((b, i) => (
          <span key={i} className="min-w-0 flex-1 text-center">
            {i % every === 0 ? b.label : ''}
          </span>
        ))}
      </div>
    </Card>
  );
}
