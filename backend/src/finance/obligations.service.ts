import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PAYABLE_PO_STATUSES } from '../payables/payables.service';
import { PlanningService } from './planning.service';
import { round2 } from '../../../shared/src/money';

const DAY = 86400000;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }; // process TZ = Asia/Bangkok (tz.ts)

export interface ObligationItem {
  kind: 'RECURRING' | 'SUPPLIER_BILL';
  id: string;
  label: string;
  sub: string;
  amount: number;
  dueDate: string;
  overdue: boolean;
  /** back-office page that handles it */
  link: string;
}

/**
 * Dashboard money the shop OWES (Round B item 8), one source for every figure:
 *  - creditors (เจ้าหนี้): supplier bills payable now = the payables page rule (received value - paid, capped at the
 *    PO's remaining; PARTIALLY_RECEIVED / RECEIVED / COMPLETED POs), due = PO due date, else bill date + supplier
 *    credit terms (30 days) - the cash forecast rule; overdue = due day before today (Bangkok).
 *  - upcoming expenses: recurring expenses due up to today + N days (overdue ones included) and supplier bills due in
 *    that window or overdue. N = store setting dashboardDueDays (default 7) unless ?days= is given.
 */
@Injectable()
export class ObligationsService {
  constructor(private prisma: PrismaService, private planning: PlanningService) {}

  private async supplierBills() {
    const statuses = PAYABLE_PO_STATUSES as string[];
    const rows = await this.prisma.$queryRaw<{ id: string; po_number: string; supplier_id: string | null; supplier_name: string; due: Date; remaining: string }[]>`
      WITH b AS (
        SELECT po.id, po.po_number, po.supplier_id, COALESCE(NULLIF(s.name, ''), 'ไม่ระบุผู้จำหน่าย') AS supplier_name,
               COALESCE(po.due_date, COALESCE(po.bill_date, po.created_at) + make_interval(days => COALESCE(s.credit_terms, 30))) AS due,
               GREATEST(0, LEAST(GREATEST(0, po.remaining_payable),
                 ROUND((CASE WHEN COALESCE(it.item_count, 0) = 0 THEN po.total_amount ELSE it.received_value END) - po.paid_amount, 2))) AS remaining
          FROM purchase_orders po
          LEFT JOIN suppliers s ON s.id = po.supplier_id
          LEFT JOIN purchase_order_item_totals it ON it.purchase_order_id = po.id
         WHERE po.status = ANY(${statuses}::"POStatus"[]))
      SELECT id, po_number, supplier_id, supplier_name, due, remaining::text FROM b WHERE remaining > 0 ORDER BY due ASC, po_number ASC`;
    return rows.map((r) => ({ ...r, remaining: Number(r.remaining) }));
  }

  async dueDays(raw?: unknown): Promise<number> {
    const n = Number(raw);
    if (Number.isInteger(n) && n >= 1 && n <= 90) return n;
    const s = await this.prisma.storeSettings.findFirst({ select: { dashboardDueDays: true } });
    return s?.dashboardDueDays && s.dashboardDueDays >= 1 ? s.dashboardDueDays : 7;
  }

  async summary(q: { days?: unknown } = {}) {
    const days = await this.dueDays(q.days);
    const today = startOfDay(new Date());
    const until = new Date(today.getTime() + days * DAY);
    const bills = await this.supplierBills();

    // ── creditors ──
    const bySupplier = new Map<string, { supplierId: string | null; name: string; billCount: number; owed: number; overdueCount: number; overdueAmount: number; oldestDue: Date }>();
    let total = 0;
    let overdueAmount = 0;
    let overdueBillCount = 0;
    for (const b of bills) {
      const overdue = startOfDay(b.due) < today;
      total += b.remaining;
      if (overdue) { overdueAmount += b.remaining; overdueBillCount++; }
      const key = b.supplier_id || '-';
      const row = bySupplier.get(key) || { supplierId: b.supplier_id, name: b.supplier_name, billCount: 0, owed: 0, overdueCount: 0, overdueAmount: 0, oldestDue: b.due };
      row.billCount++;
      row.owed += b.remaining;
      if (overdue) { row.overdueCount++; row.overdueAmount += b.remaining; }
      if (b.due < row.oldestDue) row.oldestDue = b.due;
      bySupplier.set(key, row);
    }
    const suppliers = [...bySupplier.values()]
      .map((r) => ({ ...r, owed: round2(r.owed), overdueAmount: round2(r.overdueAmount), oldestDue: r.oldestDue.toISOString() }))
      .sort((a, b) => b.overdueAmount - a.overdueAmount || b.owed - a.owed || a.name.localeCompare(b.name, 'th'));
    const creditors = {
      supplierCount: suppliers.length,
      billCount: bills.length,
      total: round2(total),
      overdueSupplierCount: suppliers.filter((s) => s.overdueCount > 0).length,
      overdueBillCount,
      overdueAmount: round2(overdueAmount),
      suppliers: suppliers.slice(0, 50),
    };

    // ── upcoming expenses ──
    const items: ObligationItem[] = [];
    for (const o of await this.planning.recurringOccurrences(until)) {
      items.push({
        kind: 'RECURRING', id: `${o.id}:${o.dueDate.toISOString()}`, label: o.name, sub: `ค่าใช้จ่ายประจำ · ${o.category}`,
        amount: round2(o.amount), dueDate: o.dueDate.toISOString(), overdue: o.dueDate < today, link: '/finance?view=recurring',
      });
    }
    for (const b of bills) {
      const due = startOfDay(b.due);
      if (due > until) continue;
      items.push({
        kind: 'SUPPLIER_BILL', id: b.id, label: b.supplier_name, sub: `บิลผู้จำหน่าย · ${b.po_number}`,
        amount: round2(b.remaining), dueDate: b.due.toISOString(), overdue: due < today, link: `/payables?search=${encodeURIComponent(b.po_number)}`,
      });
    }
    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.label.localeCompare(b.label, 'th'));
    const over = items.filter((i) => i.overdue);
    const soon = items.filter((i) => !i.overdue);
    const upcoming = {
      days,
      overdueCount: over.length,
      overdueAmount: round2(over.reduce((s, i) => s + i.amount, 0)),
      dueCount: soon.length,
      dueAmount: round2(soon.reduce((s, i) => s + i.amount, 0)),
      items: items.slice(0, 100),
    };
    return { days, today: today.toISOString(), creditors, upcoming };
  }
}

export type ObligationsSummary = Awaited<ReturnType<ObligationsService['summary']>>;
