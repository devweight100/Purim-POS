'use client';

import Link from 'next/link';
import { AlertTriangle, CalendarClock, ChevronRight, Truck, Users } from 'lucide-react';
import { formatCurrency, formatListDate } from '@/lib/utils';
import { customerDebtsHref } from './CreditCustomersDialog';

/** GET /dashboard/obligations (backend/src/finance/obligations.service.ts). */
export interface Obligations {
  days: number;
  creditors: {
    supplierCount: number; billCount: number; total: number;
    overdueSupplierCount: number; overdueBillCount: number; overdueAmount: number;
    suppliers: { supplierId: string | null; name: string; billCount: number; owed: number; overdueCount: number; overdueAmount: number; oldestDue: string }[];
  };
  upcoming: {
    days: number; overdueCount: number; overdueAmount: number; dueCount: number; dueAmount: number;
    items: { kind: 'RECURRING' | 'SUPPLIER_BILL'; id: string; label: string; sub: string; amount: number; dueDate: string; overdue: boolean; link: string }[];
  };
}

/** GET /debts/owing-customers?overdue=1 rows */
export interface OverdueDebtor {
  customerId: string; name: string; phone: string; owed: number; bills: number;
  overdueAmount: number; overdueBills: number; oldestOverdueDue: string | null;
}

const panel = 'flex min-w-0 flex-col rounded-2xl border border-slate-200 bg-white shadow-2xs';
const head = 'flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3';
const rowCls = 'flex items-center justify-between gap-3 rounded-lg px-2 py-2 text-sm outline-none hover:bg-slate-50 focus-visible:bg-sky-50 focus-visible:ring-2 focus-visible:ring-sky-300';
const empty = 'px-2 py-6 text-center text-sm text-subtle';

/**
 * Dashboard "ภาระการเงิน" (Round B item 8): overdue debtors, creditors (supplier bills owed), expenses due within
 * N days + overdue. Every number is the server's; rows are links (Tab / Enter).
 */
export function ObligationPanels({ ob, debtors, onOpenDebtors }: { ob: Obligations | null; debtors: OverdueDebtor[] | null; onOpenDebtors: () => void }) {
  const c = ob?.creditors;
  const u = ob?.upcoming;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3" data-testid="obligation-panels">
      {/* 1. debtors: customers with overdue credit bills */}
      <section className={panel} data-testid="panel-debtors">
        <div className={head}>
          <h2 className="section-title flex items-center gap-2"><Users className="h-4 w-4 text-muted-foreground" /> ลูกหนี้เกินกำหนด</h2>
          <button type="button" onClick={onOpenDebtors} className="inline-flex shrink-0 items-center gap-0.5 text-sub font-medium text-info hover:underline">ดูทั้งหมด <ChevronRight className="h-3.5 w-3.5" /></button>
        </div>
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto p-2">
          {debtors === null ? <p className={empty}>กำลังโหลด...</p> : debtors.length === 0 ? <p className={empty}>ไม่มีลูกหนี้เกินกำหนด</p> : debtors.map((d) => (
            <Link key={d.customerId} href={customerDebtsHref(d)} className={rowCls} data-testid="debtor-row">
              <span className="min-w-0">
                <span className="block truncate font-medium text-fg" title={d.name}>{d.name}</span>
                <span className="block truncate text-sub text-muted-foreground">{d.overdueBills} บิลเกินกำหนด · ครบ {formatListDate(d.oldestOverdueDue)}</span>
              </span>
              <span className="shrink-0 text-right tabular-nums font-medium text-danger">{formatCurrency(d.overdueAmount)}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 2. creditors: supplier bills the shop owes */}
      <section className={panel} data-testid="panel-creditors">
        <div className={head}>
          <h2 className="section-title flex items-center gap-2"><Truck className="h-4 w-4 text-muted-foreground" /> เจ้าหนี้ (ค้างจ่ายผู้จำหน่าย)</h2>
          <Link href="/payables" className="inline-flex shrink-0 items-center gap-0.5 text-sub font-medium text-info hover:underline">ไปหน้าเจ้าหนี้ <ChevronRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="px-4 pt-3 text-sub text-muted-foreground" data-testid="creditors-summary">
          {c ? (
            <>
              ค้างจ่าย <b className="tabular-nums text-fg">{formatCurrency(c.total)}</b> · {c.supplierCount.toLocaleString()} ราย {c.billCount.toLocaleString()} บิล
              {c.overdueBillCount > 0
                ? <> · <span className="font-medium text-danger">เกินกำหนด {c.overdueBillCount.toLocaleString()} บิล {formatCurrency(c.overdueAmount)}</span></>
                : <> · ไม่มีเกินกำหนด</>}
            </>
          ) : 'กำลังโหลด...'}
        </div>
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto p-2">
          {c && c.suppliers.length === 0 && <p className={empty}>ไม่มีบิลค้างจ่าย</p>}
          {c?.suppliers.slice(0, 20).map((s) => (
            <Link key={s.supplierId || s.name} href={s.supplierId ? `/payables?supplierId=${encodeURIComponent(s.supplierId)}` : '/payables'} className={rowCls} data-testid="creditor-row">
              <span className="min-w-0">
                <span className="block truncate font-medium text-fg" title={s.name}>{s.name}</span>
                <span className="block truncate text-sub text-muted-foreground">
                  {s.billCount} บิล{s.overdueCount > 0 ? <span className="text-danger"> · เกินกำหนด {formatCurrency(s.overdueAmount)}</span> : ` · ครบ ${formatListDate(s.oldestDue)}`}
                </span>
              </span>
              <span className="shrink-0 text-right tabular-nums font-medium text-fg">{formatCurrency(s.owed)}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* 3. expenses / bills due within N days + overdue */}
      <section className={panel} data-testid="panel-upcoming">
        <div className={head}>
          <h2 className="section-title flex items-center gap-2"><CalendarClock className="h-4 w-4 text-muted-foreground" /> ค่าใช้จ่ายใกล้ถึงกำหนด</h2>
          <Link href="/finance?view=recurring" className="inline-flex shrink-0 items-center gap-0.5 text-sub font-medium text-info hover:underline">ค่าใช้จ่ายประจำ <ChevronRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="px-4 pt-3 text-sub text-muted-foreground" data-testid="upcoming-summary">
          {u ? (
            <>
              ใน {u.days} วัน <b className="tabular-nums text-fg">{formatCurrency(u.dueAmount)}</b> ({u.dueCount} รายการ)
              {u.overdueCount > 0 && <> · <span className="font-medium text-danger">เกินกำหนด {u.overdueCount} รายการ {formatCurrency(u.overdueAmount)}</span></>}
            </>
          ) : 'กำลังโหลด...'}
        </div>
        <div className="flex max-h-64 flex-col gap-2 overflow-y-auto p-2">
          {u && u.items.length === 0 && <p className={empty}>ไม่มีค่าใช้จ่ายถึงกำหนดใน {u.days} วัน</p>}
          {u?.items.map((i) => (
            <Link key={`${i.kind}-${i.id}`} href={i.link} className={rowCls} data-testid="upcoming-row">
              <span className="min-w-0">
                <span className="block truncate font-medium text-fg" title={i.label}>{i.label}</span>
                <span className="block truncate text-sub text-muted-foreground">
                  {i.sub} · {i.overdue ? <span className="font-medium text-danger"><AlertTriangle className="mr-0.5 inline h-3 w-3" />เกินกำหนด {formatListDate(i.dueDate)}</span> : `ครบ ${formatListDate(i.dueDate)}`}
                </span>
              </span>
              <span className={`shrink-0 text-right tabular-nums font-medium ${i.overdue ? 'text-danger' : 'text-fg'}`}>{formatCurrency(i.amount)}</span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
