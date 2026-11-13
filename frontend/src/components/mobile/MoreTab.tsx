'use client';

import Link from 'next/link';
import { ExternalLink, LogOut, RefreshCw } from 'lucide-react';
import { bangkokDayKey } from '@shared/bangkok-date';
import { LoadErrorState } from '@/components/common/LoadErrorState';
import { webBuildInfo } from '@/components/common/VersionInfo';
import { cn } from '@/lib/utils';
import type { MobileDashboard, MobileShift } from './types';
import { baht, Card, fmtTime, SectionTitle, Skeleton } from './ui';
import { reloadMobileData, useMobileData } from './use-mobile-data';

export const SHIFTS_URL = '/shifts/history?limit=20';
const n = (v: unknown) => Number(v) || 0;

/** "เพิ่มเติม": today's shifts, receivables, back office link, logout, version. */
export function MoreTab({
  now,
  dashboardUrl,
  userName,
  updatedAt,
  refreshing,
  onRefresh,
  onLogout,
}: {
  now: number;
  dashboardUrl: string;
  userName: string;
  updatedAt: number | null;
  refreshing: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  const shifts = useMobileData<{ data: MobileShift[] }>(SHIFTS_URL);
  const dash = useMobileData<MobileDashboard>(dashboardUrl);
  const today = bangkokDayKey(now);
  const rows = shifts.data?.data || [];
  const open = rows.filter((s) => s.isOpen);
  const closedToday = rows.filter((s) => !s.isOpen && s.closedAt && bangkokDayKey(s.closedAt) === today);
  const build = webBuildInfo();

  return (
    <div className="space-y-4">
      <Card>
        <SectionTitle right={<span className="text-[13px] text-slate-500">วันนี้</span>}>กะการขาย</SectionTitle>
        {shifts.error && !shifts.data ? (
          <LoadErrorState message={shifts.error} onRetry={() => reloadMobileData(SHIFTS_URL)} retrying={shifts.loading} />
        ) : !shifts.data ? (
          <div className="space-y-2">
            <Skeleton className="h-14 w-full" />
            <Skeleton className="h-14 w-full" />
          </div>
        ) : (
          <div className="space-y-2" data-testid="shift-list">
            {open.length === 0 && <p className="rounded-xl bg-slate-50 px-3 py-3 text-[15px] text-slate-600">ไม่มีกะที่เปิดอยู่</p>}
            {open.map((s) => (
              <div key={s.id} className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5" data-testid="open-shift">
                <div className="flex items-center justify-between gap-2">
                  <p className="min-w-0 truncate text-[15px] font-bold text-slate-900">{s.userName || 'พนักงาน'}</p>
                  <span className="shrink-0 rounded-full bg-emerald-600 px-2 py-0.5 text-[12px] font-bold text-white">เปิดอยู่</span>
                </div>
                <p className="text-[13px] text-slate-600">
                  {s.shiftNumber || ''} · เปิด {fmtTime(s.openedAt)}
                  {bangkokDayKey(s.openedAt) !== today ? ' (ค้างจากวันก่อน)' : ''}
                </p>
                <div className="mt-1.5 grid grid-cols-2 gap-2 text-[14px]">
                  <div>
                    <p className="text-[12px] text-slate-500">ยอดขายในกะ</p>
                    <p className="font-bold tabular-nums text-slate-900">{baht(s.netSales ?? s.totalSales)}</p>
                  </div>
                  <div>
                    <p className="text-[12px] text-slate-500">เงินสดที่ควรมีในลิ้นชัก</p>
                    <p className="font-bold tabular-nums text-slate-900" data-testid="expected-cash">
                      {baht(s.expectedCash)}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {closedToday.map((s) => {
              const diff = s.difference;
              return (
                <div key={s.id} className="rounded-xl border border-slate-200 px-3 py-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="min-w-0 truncate text-[15px] font-semibold text-slate-800">{s.userName || 'พนักงาน'}</p>
                    <span className="shrink-0 rounded-full bg-slate-200 px-2 py-0.5 text-[12px] font-bold text-slate-700">ปิดแล้ว {fmtTime(s.closedAt)}</span>
                  </div>
                  <p className="text-[13px] text-slate-600">
                    ขาย {baht(s.netSales ?? s.totalSales)} · นับได้ {baht(s.actualCash)}
                    {diff !== null && diff !== undefined && (
                      <span className={cn('font-bold', diff === 0 ? 'text-emerald-700' : diff < 0 ? 'text-rose-700' : 'text-amber-700')}>
                        {' '}
                        · {diff === 0 ? 'ตรง' : diff < 0 ? `ขาด ${baht(-diff)}` : `เกิน ${baht(diff)}`}
                      </span>
                    )}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle>ลูกหนี้ค้างชำระ</SectionTitle>
        {dash.error && !dash.data ? (
          <LoadErrorState message={dash.error} onRetry={() => reloadMobileData(dashboardUrl)} retrying={dash.loading} />
        ) : !dash.data ? (
          <Skeleton className="h-9 w-40" />
        ) : (
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-[26px] font-black tabular-nums text-amber-700" data-testid="receivables">
              {baht(dash.data.receivables?.totalPending)}
            </p>
            <p className="text-[14px] text-slate-500">{n(dash.data.receivables?.billCount).toLocaleString('th-TH')} บิล</p>
          </div>
        )}
      </Card>

      <div className="space-y-2">
        <Link
          href="/dashboard"
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 px-4 text-[15px] font-bold text-white shadow-sm active:bg-indigo-700"
        >
          <ExternalLink className="h-5 w-5" /> เปิดหน้าจัดการเต็ม
        </Link>
        <button
          type="button"
          onClick={onRefresh}
          disabled={refreshing}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-[15px] font-semibold text-slate-800 active:bg-slate-100 disabled:opacity-60"
        >
          <RefreshCw className={cn('h-5 w-5', refreshing && 'animate-spin')} /> รีเฟรชข้อมูล
        </button>
        <button
          type="button"
          onClick={onLogout}
          className="flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border border-rose-200 bg-white px-4 text-[15px] font-semibold text-rose-700 active:bg-rose-50"
        >
          <LogOut className="h-5 w-5" /> ออกจากระบบ
        </button>
      </div>

      <div className="space-y-0.5 pb-2 text-center text-[13px] text-slate-500">
        <p>ผู้ใช้: {userName}</p>
        <p data-testid="last-updated">อัปเดตล่าสุด {updatedAt ? new Date(updatedAt).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok' }) : '-'}</p>
        <p>เวอร์ชัน {build.label}</p>
      </div>
    </div>
  );
}
