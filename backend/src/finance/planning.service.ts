import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { grossPerUnit } from '../../../shared/src/po-calc';
import { PrismaService } from '../prisma/prisma.service';
import { businessTransaction } from '../prisma/business-transaction';
import * as ledger from './ledger';
import { bangkokDayKey, bangkokStartOfMonth, dateRangeFilter, parseDateParam } from '../common/bangkok-date';
import { salesTotals } from '../reports/sales-math';

type Actor = { id?: string } | undefined;
const DAY = 86400000;
const round2 = (n: number) => Math.round(n * 100) / 100;
const CLIENT_ID = /^[a-zA-Z0-9-]{16,80}$/;
const FREQUENCIES = ['MONTHLY', 'WEEKLY', 'YEARLY'];
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Next occurrence strictly after `from` for a recurring rule. */
export function nextOccurrence(rule: { frequency: string; dayOfMonth?: number | null; monthOfYear?: number | null; dayOfWeek?: number | null }, from: Date): Date {
  const base = startOfDay(from);
  if (rule.frequency === 'WEEKLY') {
    const dow = rule.dayOfWeek ?? base.getDay();
    const d = new Date(base);
    d.setDate(d.getDate() + 1);
    while (d.getDay() !== dow) d.setDate(d.getDate() + 1);
    return d;
  }
  const clampDay = (y: number, m: number, day: number) => new Date(y, m, Math.min(day, new Date(y, m + 1, 0).getDate()));
  if (rule.frequency === 'YEARLY') {
    const m = (rule.monthOfYear ?? base.getMonth() + 1) - 1;
    const day = rule.dayOfMonth ?? base.getDate();
    let d = clampDay(base.getFullYear(), m, day);
    if (d <= base) d = clampDay(base.getFullYear() + 1, m, day);
    return d;
  }
  const day = rule.dayOfMonth ?? base.getDate();
  let d = clampDay(base.getFullYear(), base.getMonth(), day);
  if (d <= base) d = clampDay(base.getFullYear(), base.getMonth() + 1, day);
  return d;
}

@Injectable()
export class PlanningService {
  constructor(private prisma: PrismaService) {}

  // ─── recurring expenses ───
  private validateRule(body: any) {
    const frequency = String(body.frequency || 'MONTHLY').toUpperCase();
    if (!FREQUENCIES.includes(frequency)) throw new BadRequestException('ความถี่ต้องเป็น รายเดือน / รายสัปดาห์ / รายปี');
    const dayOfMonth = body.dayOfMonth != null && body.dayOfMonth !== '' ? Number(body.dayOfMonth) : null;
    const dayOfWeek = body.dayOfWeek != null && body.dayOfWeek !== '' ? Number(body.dayOfWeek) : null;
    const monthOfYear = body.monthOfYear != null && body.monthOfYear !== '' ? Number(body.monthOfYear) : null;
    if (frequency !== 'WEEKLY' && (!Number.isInteger(dayOfMonth) || dayOfMonth! < 1 || dayOfMonth! > 31)) throw new BadRequestException('กรุณาระบุวันที่ของเดือน (1-31)');
    if (frequency === 'WEEKLY' && (!Number.isInteger(dayOfWeek) || dayOfWeek! < 0 || dayOfWeek! > 6)) throw new BadRequestException('กรุณาเลือกวันในสัปดาห์');
    if (frequency === 'YEARLY' && (!Number.isInteger(monthOfYear) || monthOfYear! < 1 || monthOfYear! > 12)) throw new BadRequestException('กรุณาเลือกเดือน');
    return { frequency, dayOfMonth: frequency === 'WEEKLY' ? null : dayOfMonth, dayOfWeek: frequency === 'WEEKLY' ? dayOfWeek : null, monthOfYear: frequency === 'YEARLY' ? monthOfYear : null };
  }

  async listRecurring() {
    const rows = await this.prisma.recurringExpense.findMany({
      orderBy: [{ isActive: 'desc' }, { nextDueDate: 'asc' }],
      include: { category: { select: { id: true, name: true } }, account: { select: { id: true, name: true, type: true } } },
    });
    const today = startOfDay(new Date()).getTime();
    return rows.map((r) => {
      const daysToDue = Math.floor((startOfDay(r.nextDueDate).getTime() - today) / DAY);
      return {
        ...r,
        amount: Number(r.amount),
        daysToDue,
        status: !r.isActive ? 'INACTIVE' : daysToDue < 0 ? 'OVERDUE' : daysToDue <= r.remindDays ? 'DUE_SOON' : 'SCHEDULED',
      };
    });
  }

  async createRecurring(body: any) {
    const name = String(body.name || '').trim();
    if (!name) throw new BadRequestException('กรุณาตั้งชื่อรายการ เช่น ค่าเช่าร้าน');
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
    const cat = await this.prisma.expenseCategory.findUnique({ where: { id: String(body.categoryId) } });
    if (!cat) throw new BadRequestException('กรุณาเลือกหมวดค่าใช้จ่าย');
    const rule = this.validateRule(body);
    const first = body.firstDueDate ? startOfDay(new Date(body.firstDueDate)) : nextOccurrence(rule, new Date(Date.now() - DAY));
    return this.prisma.recurringExpense.create({
      data: {
        name, categoryId: cat.id, accountId: body.accountId || null, amount: round2(amount), ...rule,
        nextDueDate: first, remindDays: Number.isInteger(Number(body.remindDays)) ? Number(body.remindDays) : 3, note: body.note?.trim() || null,
      },
    });
  }

  async updateRecurring(id: string, body: any) {
    const cur = await this.prisma.recurringExpense.findUnique({ where: { id } });
    if (!cur) throw new NotFoundException('ไม่พบรายการค่าใช้จ่ายประจำ');
    const data: any = {};
    if (body.name !== undefined) data.name = String(body.name).trim();
    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
      data.amount = round2(amount);
    }
    if (body.categoryId !== undefined) data.categoryId = body.categoryId;
    if (body.accountId !== undefined) data.accountId = body.accountId || null;
    if (body.remindDays !== undefined) data.remindDays = Number(body.remindDays) || 0;
    if (body.isActive !== undefined) data.isActive = Boolean(body.isActive);
    if (body.note !== undefined) data.note = body.note?.trim() || null;
    if (body.frequency !== undefined) Object.assign(data, this.validateRule({ ...cur, ...body }));
    if (body.nextDueDate) data.nextDueDate = startOfDay(new Date(body.nextDueDate));
    return this.prisma.recurringExpense.update({ where: { id }, data });
  }

  /** Pay this occurrence: records a normal expense and moves the due date to the next occurrence. */
  async payRecurring(id: string, body: { clientId?: string; amount?: number; accountId?: string; paidAt?: string; note?: string }, actor: Actor) {
    if (!body.clientId || !CLIENT_ID.test(body.clientId)) throw new BadRequestException('ต้องระบุรหัสรายการ (clientId)');
    return businessTransaction(this.prisma, async (tx) => {
      const key = 'recurring-pay-' + body.clientId;
      const prev = await tx.auditLog.findUnique({ where: { id: key } });
      if (prev) return (prev.details as any).result;
      const rec = await tx.recurringExpense.findUnique({ where: { id }, include: { category: true } });
      if (!rec || !rec.isActive) throw new NotFoundException('ไม่พบรายการค่าใช้จ่ายประจำที่ใช้งานอยู่');
      const amount = round2(Number(body.amount ?? rec.amount));
      if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('จำนวนเงินต้องมากกว่า 0');
      const accountId = body.accountId || rec.accountId;
      if (!accountId) throw new BadRequestException('กรุณาเลือกบัญชีที่จ่าย');
      const acc = await tx.moneyAccount.findUnique({ where: { id: accountId } });
      if (!acc || !acc.isActive) throw new BadRequestException('ไม่พบบัญชีที่จ่าย');
      if (acc.type === 'CASH_DRAWER') throw new BadRequestException('ค่าใช้จ่ายประจำจ่ายจากลิ้นชักไม่ได้ ให้จ่ายจากเซฟหรือบัญชีธนาคาร (หรือบันทึกที่หน้า POS)');
      const bal = await ledger.balanceOf(tx, acc.id);
      if (bal + 0.001 < amount) throw new BadRequestException(`ยอดเงินใน ${acc.name} ไม่พอ (คงเหลือ ฿${bal.toFixed(2)})`);
      const dueLabel = rec.nextDueDate.toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: 'numeric' });
      const { expense } = await ledger.recordExpense(tx, {
        categoryId: rec.categoryId, accountId: acc.id, amount,
        description: `${rec.name} (งวด ${dueLabel})${body.note?.trim() ? ' ' + body.note.trim() : ''}`,
        paidAt: body.paidAt ? new Date(body.paidAt) : undefined, userId: actor?.id,
      });
      const next = nextOccurrence(rec, rec.nextDueDate);
      await tx.recurringExpense.update({ where: { id }, data: { nextDueDate: next, lastPaidAt: new Date() } });
      const result = { success: true, expenseNumber: expense.expenseNumber, nextDueDate: next.toISOString() };
      await tx.auditLog.create({ data: { id: key, action: 'RECURRING_PAY', entity: 'RecurringExpense', entityId: id, details: { result } } });
      return result;
    });
  }

  /** Skip this occurrence without paying (e.g. landlord waived a month). */
  async skipRecurring(id: string, body: { reason?: string }) {
    const rec = await this.prisma.recurringExpense.findUnique({ where: { id } });
    if (!rec) throw new NotFoundException('ไม่พบรายการค่าใช้จ่ายประจำ');
    if (!String(body.reason || '').trim()) throw new BadRequestException('กรุณาระบุเหตุผลที่ข้ามงวดนี้');
    const next = nextOccurrence(rec, rec.nextDueDate);
    await this.prisma.auditLog.create({ data: { action: 'RECURRING_SKIP', entity: 'RecurringExpense', entityId: id, details: { skippedDue: rec.nextDueDate.toISOString(), reason: body.reason } } });
    return this.prisma.recurringExpense.update({ where: { id }, data: { nextDueDate: next } });
  }

  /** Occurrences of active recurring expenses due up to `until` (overdue ones included). */
  private async recurringOccurrences(until: Date) {
    const rows = await this.prisma.recurringExpense.findMany({ where: { isActive: true }, include: { category: { select: { name: true } } } });
    const out: { id: string; name: string; category: string; amount: number; dueDate: Date }[] = [];
    for (const r of rows) {
      let d = startOfDay(r.nextDueDate);
      let guard = 0;
      while (d <= until && guard++ < 400) {
        out.push({ id: r.id, name: r.name, category: r.category.name, amount: Number(r.amount), dueDate: d });
        d = nextOccurrence(r, d);
      }
    }
    return out;
  }

  async recurringDueSummary(withinDays = 30) {
    const today = startOfDay(new Date());
    const occ = await this.recurringOccurrences(new Date(today.getTime() + withinDays * DAY));
    const overdue = occ.filter((o) => o.dueDate < today);
    const upcoming = occ.filter((o) => o.dueDate >= today);
    return {
      overdue: round2(overdue.reduce((s, o) => s + o.amount, 0)),
      due7: round2(upcoming.filter((o) => o.dueDate.getTime() <= today.getTime() + 7 * DAY).reduce((s, o) => s + o.amount, 0)),
      dueWithin: round2(upcoming.reduce((s, o) => s + o.amount, 0)),
      items: occ.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime()).slice(0, 30).map((o) => ({ ...o, dueDate: o.dueDate.toISOString() })),
    };
  }

  // ─── cash forecast ───
  /**
   * Day-by-day projection: money now + customer debts as they fall due − supplier bills and
   * recurring expenses as they fall due. Already-overdue bills/expenses are assumed paid today;
   * overdue customer debts are NOT assumed collected (shown separately).
   */
  async forecast(daysInput?: number) {
    const days = Math.min(180, Math.max(7, Number(daysInput) || 30));
    const today = startOfDay(new Date());
    const until = new Date(today.getTime() + days * DAY);
    const accounts = await this.prisma.moneyAccount.findMany({ where: { isActive: true } });
    const bal = await ledger.balances(this.prisma);
    const startCash = round2(accounts.reduce((s, a) => s + (bal.get(a.id) || 0), 0));

    const events: { date: string; kind: 'IN' | 'OUT'; source: string; label: string; amount: number }[] = [];
    const at = (d: Date) => (d < today ? today : startOfDay(d));

    const debts = await this.prisma.customerDebt.findMany({
      where: { remainingAmount: { gt: 0 } },
      select: { remainingAmount: true, dueDate: true, createdAt: true, customer: { select: { name: true } }, order: { select: { orderNumber: true } } },
    });
    let overdueReceivables = 0;
    for (const d of debts) {
      const due = startOfDay(d.dueDate ?? new Date(d.createdAt.getTime() + 30 * DAY));
      if (due < today) { overdueReceivables += Number(d.remainingAmount); continue; }
      if (due > until) continue;
      events.push({ date: dayKey(due), kind: 'IN', source: 'RECEIVABLE', label: `ลูกหนี้ ${d.customer.name} (${d.order.orderNumber})`, amount: Number(d.remainingAmount) });
    }

    const pos = await this.prisma.purchaseOrder.findMany({
      where: { status: { in: ['PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED'] }, remainingPayable: { gt: 0 } },
      select: { poNumber: true, billDate: true, dueDate: true, paidAmount: true, remainingPayable: true, supplier: { select: { name: true, creditTerms: true } }, items: { select: { receivedQty: true, unitCost: true, quantity: true, total: true } } },
    });
    for (const po of pos) {
      const received = po.items.reduce((s, i) => s + Number(i.receivedQty) * grossPerUnit(i), 0);
      const amount = round2(Math.max(0, Math.min(Number(po.remainingPayable), received - Number(po.paidAmount))));
      if (amount <= 0) continue;
      const due = po.dueDate ?? new Date(po.billDate.getTime() + (po.supplier.creditTerms ?? 30) * DAY);
      if (startOfDay(due) > until) continue;
      events.push({ date: dayKey(at(due)), kind: 'OUT', source: 'PAYABLE', label: `เจ้าหนี้ ${po.supplier.name} (${po.poNumber})`, amount });
    }

    for (const o of await this.recurringOccurrences(until)) {
      events.push({ date: dayKey(at(o.dueDate)), kind: 'OUT', source: 'RECURRING', label: `${o.name} (${o.category})`, amount: o.amount });
    }

    const series: { date: string; in: number; out: number; balance: number }[] = [];
    let running = startCash;
    let lowest = { date: dayKey(today), balance: startCash };
    let firstNegative: string | null = null;
    for (let i = 0; i <= days; i++) {
      const d = new Date(today.getTime() + i * DAY);
      const k = dayKey(d);
      const todays = events.filter((e) => e.date === k);
      const inn = round2(todays.filter((e) => e.kind === 'IN').reduce((s, e) => s + e.amount, 0));
      const out = round2(todays.filter((e) => e.kind === 'OUT').reduce((s, e) => s + e.amount, 0));
      running = round2(running + inn - out);
      series.push({ date: k, in: inn, out, balance: running });
      if (running < lowest.balance) lowest = { date: k, balance: running };
      if (running < 0 && !firstNegative) firstNegative = k;
    }
    return {
      days, startCash, endCash: running, lowest, firstNegative,
      overdueReceivables: round2(overdueReceivables),
      totals: {
        in: round2(events.filter((e) => e.kind === 'IN').reduce((s, e) => s + e.amount, 0)),
        out: round2(events.filter((e) => e.kind === 'OUT').reduce((s, e) => s + e.amount, 0)),
      },
      series,
      events: events.sort((a, b) => a.date.localeCompare(b.date)),
    };
  }

  // ─── profit & loss ───
  async profitAndLoss(q: { from?: string; to?: string }) {
    // YYYY-MM-DD = whole Bangkok day (from=to=same day works); ISO timestamps used as given
    const range = dateRangeFilter(q.from, q.to) || {};
    const period: { gte: Date; lt?: Date; lte?: Date } = {
      gte: range.gte ?? bangkokStartOfMonth(range.lt ? new Date(range.lt.getTime() - 1) : range.lte ?? new Date()),
      ...(range.lt ? { lt: range.lt } : { lte: range.lte ?? new Date() }),
    };
    const from = period.gte;
    const to = period.lt ? new Date(period.lt.getTime() - 1) : period.lte!;

    // shared definition with /reports/*: bills in the period, partial returns made in the period
    // reduce sales, VAT and (for restocked goods) COGS; discounts = line + bill discounts
    const t = await salesTotals(this.prisma, period);
    const returnsInclVat = t.returns.amount;
    const salesInclVat = t.netSales;
    const outputVat = t.outputVat;
    const revenue = t.revenueExVat;
    const cogs = t.cogs;
    const grossProfit = t.grossProfit;

    const claims = await this.prisma.customerClaim.findMany({ where: { createdAt: period }, select: { metadata: true } });
    let replacementCost = 0;
    let refundsPaid = 0;
    for (const c of claims) {
      const acc = ((c.metadata as any) || {}).accounting || {};
      replacementCost += Number(acc.replacementCost) || 0;
      refundsPaid += Number(acc.refundPaid) || 0;
    }
    const recovered = await this.prisma.supplierReturnNoteItem.aggregate({
      where: { itemType: 'DEFECTIVE', note: { status: { not: 'CANCELLED' }, createdAt: period } },
      _sum: { total: true },
    });
    const supplierRecovery = Number(recovered._sum.total || 0);
    const claimCost = round2(replacementCost + refundsPaid - supplierRecovery);

    // stock written off (damage / shrinkage) = negative cost value of stock-reducing adjustments
    const adj = await this.prisma.auditLog.findMany({ where: { action: 'STOCK_ADJUST_SUB', createdAt: period }, select: { details: true } });
    const stockWriteOff = round2(adj.reduce((s, a) => s + Math.max(0, -Number((a.details as any)?.costValue || 0)), 0));

    // expenses / other income / over-short / bank adjustments from the ledger (reversals netted)
    const rows = await this.prisma.moneyTransaction.findMany({
      where: { occurredAt: period, type: { in: ['EXPENSE', 'OTHER_INCOME', 'SHIFT_OVER_SHORT', 'ADJUSTMENT', 'REVERSAL'] } },
      select: { id: true, type: true, direction: true, amount: true, reversalOfId: true, category: { select: { name: true } }, account: { select: { type: true } } },
    });
    const originals = new Map(
      (await this.prisma.moneyTransaction.findMany({ where: { id: { in: rows.filter((r) => r.reversalOfId).map((r) => r.reversalOfId as string) } }, select: { id: true, type: true } })).map((o) => [o.id, o.type]),
    );
    const expenses: Record<string, number> = {};
    let otherIncome = 0;
    let overShort = 0;
    let adjustments = 0;
    for (const r of rows) {
      const kind = r.type === 'REVERSAL' ? originals.get(r.reversalOfId || '') : r.type;
      const signed = (r.direction === 'IN' ? 1 : -1) * Number(r.amount); // +money in, -money out
      if (kind === 'EXPENSE') { const k = r.category?.name || 'อื่นๆ'; expenses[k] = round2((expenses[k] || 0) - signed); }
      else if (kind === 'OTHER_INCOME') otherIncome += signed;
      else if (kind === 'SHIFT_OVER_SHORT') overShort += signed;
      else if (kind === 'ADJUSTMENT' && r.account.type !== 'CASH_DRAWER') adjustments += signed;
    }
    for (const k of Object.keys(expenses)) if (Math.abs(expenses[k]) < 0.005) delete expenses[k];
    const totalExpenses = round2(Object.values(expenses).reduce((s, v) => s + v, 0));
    const operatingProfit = round2(grossProfit - claimCost - stockWriteOff - totalExpenses);
    const netProfit = round2(operatingProfit + otherIncome + overShort + adjustments);
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      orderCount: t.completedCount,
      salesInclVat: round2(salesInclVat), outputVat: round2(outputVat), revenue, returnsInclVat, discounts: t.discounts, grossSales: t.grossSales,
      cogs, grossProfit, grossMargin: revenue > 0 ? round2((grossProfit / revenue) * 100) : 0,
      claims: { replacementCost: round2(replacementCost), refundsPaid: round2(refundsPaid), supplierRecovery: round2(supplierRecovery), net: claimCost },
      stockWriteOff,
      expenses, totalExpenses,
      operatingProfit,
      otherIncome: round2(otherIncome), cashOverShort: round2(overShort), accountAdjustments: round2(adjustments),
      netProfit, netMargin: revenue > 0 ? round2((netProfit / revenue) * 100) : 0,
    };
  }

  // ─── bank reconciliation ───
  async reconcileState(accountId: string, q: { to?: string }) {
    const acc = await this.prisma.moneyAccount.findUnique({ where: { id: accountId } });
    if (!acc) throw new NotFoundException('ไม่พบบัญชี');
    // end of the Bangkok day of `to` (default today)
    const end = dateRangeFilter(undefined, bangkokDayKey(q.to ? parseDateParam(q.to) : new Date()))!;
    const to = new Date(end.lt!.getTime() - 1);
    const [unreconciled, clearedAgg, ledgerAgg, history] = await Promise.all([
      this.prisma.moneyTransaction.findMany({ where: { accountId, reconciledAt: null, occurredAt: { lte: to } }, orderBy: { occurredAt: 'asc' } }),
      this.prisma.moneyTransaction.groupBy({ by: ['direction'], where: { accountId, reconciledAt: { not: null } }, _sum: { amount: true } }),
      this.prisma.moneyTransaction.groupBy({ by: ['direction'], where: { accountId, occurredAt: { lte: to } }, _sum: { amount: true } }),
      this.prisma.bankReconciliation.findMany({ where: { accountId }, orderBy: { statementDate: 'desc' }, take: 10 }),
    ]);
    const net = (rows: any[]) => round2(rows.reduce((s, r) => s + (r.direction === 'IN' ? 1 : -1) * Number(r._sum.amount || 0), 0));
    return {
      account: { id: acc.id, name: acc.name, type: acc.type },
      asOf: to.toISOString(),
      ledgerBalance: net(ledgerAgg),
      clearedBalance: net(clearedAgg),
      unreconciled: unreconciled.map((r) => ({ id: r.id, occurredAt: r.occurredAt, direction: r.direction, amount: Number(r.amount), type: r.type, note: r.note })),
      history: history.map((h) => ({ ...h, statementBalance: Number(h.statementBalance), ledgerBalance: Number(h.ledgerBalance), difference: Number(h.difference) })),
    };
  }

  /**
   * Tick off ledger rows that appear on the statement. cleared balance (all ticked rows ever)
   * must equal the statement balance; a remaining difference can be booked as an adjustment
   * (bank fee / interest), which is ticked too.
   */
  async reconcile(accountId: string, body: { statementDate?: string; statementBalance?: number; transactionIds?: string[]; note?: string; adjustDifference?: boolean; adjustReason?: string }, actor: Actor) {
    const statementBalance = Number(body.statementBalance);
    if (!Number.isFinite(statementBalance)) throw new BadRequestException('กรุณาระบุยอดคงเหลือตาม statement');
    const statementDate = body.statementDate ? new Date(body.statementDate) : new Date();
    const ids = Array.isArray(body.transactionIds) ? body.transactionIds : [];
    return businessTransaction(this.prisma, async (tx) => {
      const acc = await tx.moneyAccount.findUnique({ where: { id: accountId } });
      if (!acc) throw new NotFoundException('ไม่พบบัญชี');
      if (ids.length) {
        const rows = await tx.moneyTransaction.findMany({ where: { id: { in: ids } }, select: { id: true, accountId: true, reconciledAt: true } });
        if (rows.length !== ids.length || rows.some((r) => r.accountId !== accountId || r.reconciledAt)) throw new BadRequestException('มีรายการที่ไม่ใช่ของบัญชีนี้หรือกระทบยอดไปแล้ว กรุณาโหลดใหม่');
      }
      const rec = await tx.bankReconciliation.create({
        data: { accountId, statementDate, statementBalance: round2(statementBalance), ledgerBalance: 0, difference: 0, note: body.note?.trim() || null, userId: actor?.id ?? null },
      });
      if (ids.length) await tx.moneyTransaction.updateMany({ where: { id: { in: ids } }, data: { reconciledAt: new Date(), reconciliationId: rec.id } });
      const clearedRows = await tx.moneyTransaction.groupBy({ by: ['direction'], where: { accountId, reconciledAt: { not: null } }, _sum: { amount: true } });
      let cleared = round2(clearedRows.reduce((s, r) => s + (r.direction === 'IN' ? 1 : -1) * Number(r._sum.amount || 0), 0));
      let difference = round2(statementBalance - cleared);
      if (body.adjustDifference && Math.abs(difference) >= 0.01) {
        const reason = String(body.adjustReason || '').trim();
        if (!reason) throw new BadRequestException('กรุณาระบุเหตุผลของส่วนต่าง เช่น ค่าธรรมเนียม ดอกเบี้ย');
        const row = await ledger.post(tx, { accountId, direction: difference > 0 ? 'IN' : 'OUT', amount: Math.abs(difference), type: 'ADJUSTMENT', note: `กระทบยอด statement: ${reason}`, userId: actor?.id, occurredAt: statementDate });
        await tx.moneyTransaction.update({ where: { id: row!.id }, data: { reconciledAt: new Date(), reconciliationId: rec.id } });
        cleared = round2(cleared + difference);
        difference = 0;
      }
      const ledgerBalance = await ledger.balanceOf(tx, accountId);
      return tx.bankReconciliation.update({ where: { id: rec.id }, data: { ledgerBalance, difference } }).then((r) => ({
        ...r, statementBalance: Number(r.statementBalance), ledgerBalance: Number(r.ledgerBalance), difference: Number(r.difference), clearedBalance: cleared, matched: ids.length,
      }));
    });
  }
}
