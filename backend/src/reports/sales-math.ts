import { Prisma } from '@prisma/client';

/**
 * One definition of "sales" for every report (P&L, /reports/sales-summary, /reports/dashboard):
 * - bills: COMPLETED orders whose createdAt is in the period
 * - partial returns (OrderReturn) whose createdAt is in the period reduce sales, VAT and COGS
 *   (same rule as the P&L, so all pages agree)
 * - gross sales = qty x unit price before any discount; discounts = line + bill discounts
 *   (net of the discount share of returned goods), so gross - discounts = net sales
 */
export type DateRange = { gte?: Date; lt?: Date; lte?: Date } | undefined;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** SQL conditions for a timestamp column (stored as UTC `timestamp without time zone`). */
export function sqlRange(column: Prisma.Sql, r: DateRange): Prisma.Sql {
  const parts: Prisma.Sql[] = [];
  if (r?.gte) parts.push(Prisma.sql`AND ${column} >= ${r.gte.toISOString()}::timestamp`);
  if (r?.lt) parts.push(Prisma.sql`AND ${column} < ${r.lt.toISOString()}::timestamp`);
  if (r?.lte) parts.push(Prisma.sql`AND ${column} <= ${r.lte.toISOString()}::timestamp`);
  return parts.length ? Prisma.join(parts, ' ') : Prisma.empty;
}

export interface SalesTotals {
  completedCount: number;
  voidedCount: number;
  voidedAmount: number;
  billsInclVat: number; // sum of completed bills
  billsVat: number;
  billsCogs: number;
  listValue: number; // qty x unit price (before any discount)
  lineDiscounts: number;
  billDiscounts: number;
  unitsSold: number;
  returns: { count: number; amount: number; vat: number; cogs: number; listValue: number; units: number };
  // derived
  grossSales: number;
  discounts: number;
  netSales: number; // incl. VAT, after returns
  outputVat: number;
  revenueExVat: number;
  cogs: number;
  grossProfit: number;
}

export function deriveTotals(t: Omit<SalesTotals, 'grossSales' | 'discounts' | 'netSales' | 'outputVat' | 'revenueExVat' | 'cogs' | 'grossProfit'>): SalesTotals {
  const grossSales = round2(t.listValue - t.returns.listValue);
  const netSales = round2(t.billsInclVat - t.returns.amount);
  // discount share of returned goods = their list value - what was refunded for them
  const discounts = round2(t.lineDiscounts + t.billDiscounts - (t.returns.listValue - t.returns.amount));
  const outputVat = round2(t.billsVat - t.returns.vat);
  const cogs = round2(t.billsCogs - t.returns.cogs);
  const revenueExVat = round2(netSales - outputVat);
  return { ...t, grossSales, discounts, netSales, outputVat, revenueExVat, cogs, grossProfit: round2(revenueExVat - cogs) };
}

/** Totals for a period in a handful of aggregate queries (no row limit). */
export async function salesTotals(prisma: any, range: DateRange): Promise<SalesTotals> {
  const created = range ? { createdAt: range } : {};
  const [byStatus, items, returns] = await Promise.all([
    prisma.order.groupBy({
      by: ['status'],
      where: created,
      _sum: { totalAmount: true, vatAmount: true, totalCogs: true, discountAmount: true },
      _count: { _all: true },
    }),
    prisma.$queryRaw(Prisma.sql`
      SELECT COALESCE(SUM(oi.quantity * oi.unit_price), 0)::float8 AS list,
             COALESCE(SUM(oi.discount_amount), 0)::float8 AS disc,
             COALESCE(SUM(oi.quantity), 0)::float8 AS units
      FROM order_items oi JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'COMPLETED' ${sqlRange(Prisma.sql`o.created_at`, range)}`),
    prisma.$queryRaw(Prisma.sql`
      SELECT COUNT(DISTINCT r.id)::int AS count,
             COALESCE((SELECT SUM(r2.refund_amount) FROM order_returns r2 WHERE true ${sqlRange(Prisma.sql`r2.created_at`, range)}), 0)::float8 AS amount,
             COALESCE((SELECT SUM(r2.vat_amount) FROM order_returns r2 WHERE true ${sqlRange(Prisma.sql`r2.created_at`, range)}), 0)::float8 AS vat,
             COALESCE((SELECT SUM(r2.cogs_returned) FROM order_returns r2 WHERE true ${sqlRange(Prisma.sql`r2.created_at`, range)}), 0)::float8 AS cogs,
             COALESCE(SUM(ri.quantity * oi.unit_price), 0)::float8 AS list,
             COALESCE(SUM(ri.quantity), 0)::float8 AS units
      FROM order_returns r
      LEFT JOIN order_return_items ri ON ri.return_id = r.id
      LEFT JOIN order_items oi ON oi.id = ri.order_item_id
      WHERE true ${sqlRange(Prisma.sql`r.created_at`, range)}`),
  ]);
  const completed = byStatus.find((s: any) => s.status === 'COMPLETED');
  const voided = byStatus.filter((s: any) => s.status !== 'COMPLETED');
  const i = (items as any[])[0] || {};
  const r = (returns as any[])[0] || {};
  return deriveTotals({
    completedCount: completed?._count?._all || 0,
    voidedCount: voided.reduce((s: number, v: any) => s + (v._count?._all || 0), 0),
    voidedAmount: round2(voided.reduce((s: number, v: any) => s + Number(v._sum.totalAmount || 0), 0)),
    billsInclVat: round2(Number(completed?._sum.totalAmount || 0)),
    billsVat: round2(Number(completed?._sum.vatAmount || 0)),
    billsCogs: round2(Number(completed?._sum.totalCogs || 0)),
    billDiscounts: round2(Number(completed?._sum.discountAmount || 0)),
    listValue: round2(Number(i.list || 0)),
    lineDiscounts: round2(Number(i.disc || 0)),
    unitsSold: Number(i.units || 0),
    returns: {
      count: Number(r.count || 0),
      amount: round2(Number(r.amount || 0)),
      vat: round2(Number(r.vat || 0)),
      cogs: round2(Number(r.cogs || 0)),
      listValue: round2(Number(r.list || 0)),
      units: Number(r.units || 0),
    },
  });
}

/** Money per payment channel for the period, net of refunds of partial returns in the period. */
export function channelOf(method: string): 'CASH' | 'QR_TRANSFER' | 'CARD' | 'CREDIT' | 'OTHER' {
  if (method === 'CASH') return 'CASH';
  if (method === 'QR_PROMPTPAY' || method === 'TRANSFER') return 'QR_TRANSFER';
  if (method === 'CREDIT_CARD') return 'CARD';
  if (method === 'CREDIT_DEBT' || method === 'DEBT_REDUCTION') return 'CREDIT';
  return 'OTHER'; // CREDIT_NOTE (store credit) etc.
}

export async function paymentChannels(prisma: any, range: DateRange) {
  const created = range ? { createdAt: range } : {};
  const [pays, rets] = await Promise.all([
    prisma.payment.groupBy({ by: ['method'], where: { order: { status: 'COMPLETED', ...created } }, _sum: { amount: true }, _count: { _all: true } }),
    prisma.orderReturn.groupBy({ by: ['refundMethod'], where: created, _sum: { refundAmount: true }, _count: { _all: true } }),
  ]);
  const out: Record<string, { amount: number; count: number; returned: number }> = {};
  const bucket = (k: string) => (out[k] ||= { amount: 0, count: 0, returned: 0 });
  for (const p of pays) {
    const b = bucket(channelOf(p.method));
    b.amount = round2(b.amount + Number(p._sum.amount || 0));
    b.count += p._count?._all || 0;
  }
  for (const r of rets) {
    const b = bucket(channelOf(r.refundMethod));
    const amt = Number(r._sum.refundAmount || 0);
    b.amount = round2(b.amount - amt);
    b.returned = round2(b.returned + amt);
  }
  return out;
}
