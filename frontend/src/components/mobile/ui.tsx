'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** Baht with satang only when there are satang: ฿1,234 / ฿1,234.50 */
export function baht(n: unknown): string {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  // minus before the sign: -฿12 (refunds bigger than the day's transfers)
  return (v < 0 ? '-฿' : '฿') + a.toLocaleString('th-TH', { minimumFractionDigits: a % 1 !== 0 ? 2 : 0, maximumFractionDigits: 2 });
}

export function Card({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('rounded-2xl border border-slate-200 bg-white p-4 shadow-sm', className)} {...rest}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h2 className="text-[15px] font-bold text-slate-800">{children}</h2>
      {right}
    </div>
  );
}

/** Thumb-sized toggle chip (>= 44 px high). */
export function Chip({ active, onClick, children, testId }: { active: boolean; onClick: () => void; children: ReactNode; testId?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={cn(
        'min-h-11 rounded-full border px-3 text-[15px] font-semibold whitespace-nowrap transition-colors',
        active ? 'border-indigo-600 bg-indigo-600 text-white shadow-sm' : 'border-slate-300 bg-white text-slate-700 active:bg-slate-100',
      )}
    >
      {children}
    </button>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-xl bg-slate-200/80', className)} />;
}

/** A few grey cards while the first response is on its way. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="กำลังโหลด">
      {Array.from({ length: rows }, (_, i) => (
        <Card key={i} className="space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-6 w-1/2" />
        </Card>
      ))}
    </div>
  );
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-4 py-10 text-center text-[15px] text-slate-500">{children}</div>;
}

const timeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' });
const dateTimeFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const dateFmt = new Intl.DateTimeFormat('th-TH', { timeZone: 'Asia/Bangkok', day: 'numeric', month: 'short', year: '2-digit' });

export const fmtTime = (iso: string | number | null | undefined) => (iso ? timeFmt.format(new Date(iso)) : '-');
export const fmtDateTime = (iso: string | number | null | undefined) => (iso ? dateTimeFmt.format(new Date(iso)) : '-');
export const fmtDate = (iso: string | number | null | undefined) => (iso ? dateFmt.format(new Date(iso)) : '-');

export const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  QR_PROMPTPAY: 'QR พร้อมเพย์',
  TRANSFER: 'โอน',
  CREDIT_CARD: 'บัตร',
  CREDIT_DEBT: 'เงินเชื่อ',
  CREDIT_NOTE: 'ใบลดหนี้',
  DEBT_REDUCTION: 'ลดหนี้',
};
