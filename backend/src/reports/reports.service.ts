import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { OrderStatus } from '@prisma/client';
import { grossPerUnit } from '../../../shared/src/po-calc';
import { addDays, bangkokDayKey, bangkokStartOfDay, bangkokStartOfMonth, dateRangeFilter, DAY_MS } from '../common/bangkok-date';
import { DateRange, paymentChannels, salesTotals, sqlRange } from './sales-math';

const round2 = (n: number) => Math.round(n * 100) / 100;
export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
const DASHBOARD_RANGES = ['today', '7days', '30days', 'month', 'all'] as const;
type DashboardRange = (typeof DASHBOARD_RANGES)[number];

/** Net on-hand qty and cost value per product from stock batches (oversold batches net against positive stock). */
export function valueStock(batches: { productId: string; quantityRemaining: unknown; unitCost: unknown }[]) {
  const net: Record<string, { qty: number; positiveQty: number; positiveValue: number }> = {};
  for (const b of batches) {
    const qty = Number(b.quantityRemaining || 0);
    if (!qty) continue;
    const row = (net[b.productId] ||= { qty: 0, positiveQty: 0, positiveValue: 0 });
    row.qty = Math.round((row.qty + qty) * 100) / 100;
    if (qty > 0) {
      row.positiveQty += qty;
      row.positiveValue += qty * Number(b.unitCost ?? 0);
    }
  }
  const out: Record<string, { quantityRemaining: number; totalCostValue: number; averageUnitCost: number }> = {};
  for (const [productId, row] of Object.entries(net)) {
    const quantityRemaining = Math.max(0, row.qty);
    const averageUnitCost = row.positiveQty > 0 ? row.positiveValue / row.positiveQty : 0;
    out[productId] = { quantityRemaining, totalCostValue: quantityRemaining > 0 ? quantityRemaining * averageUnitCost : 0, averageUnitCost };
  }
  return out;
}

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  async lowStockThreshold(): Promise<number> {
    const s = await this.prisma.storeSettings.findFirst({ select: { lowStockThreshold: true } });
    const n = Number(s?.lowStockThreshold);
    return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LOW_STOCK_THRESHOLD;
  }

  /** Stock position (at cost, plus retail value as a separate figure) and low-stock counts with the store threshold. */
  async inventorySnapshot() {
    const [threshold, products, batches] = await Promise.all([
      this.lowStockThreshold(),
      this.prisma.product.findMany({ where: { isActive: true }, select: { id: true, isBundle: true, costPrice: true, basePrice: true, priceLevel1: true } }),
      this.prisma.stockBatch.findMany({ where: { quantityRemaining: { not: 0 } }, select: { productId: true, quantityRemaining: true, unitCost: true } }),
    ]);
    const val = valueStock(batches);
    let stockCostValue = 0;
    let stockRetailValue = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    for (const p of products) {
      if (p.isBundle) continue; // bundles have no stock of their own
      const v = val[p.id];
      const qty = v?.quantityRemaining || 0;
      stockCostValue += qty > 0 ? (v!.totalCostValue > 0 ? v!.totalCostValue : qty * Number(p.costPrice || 0)) : 0;
      stockRetailValue += qty * Number(p.priceLevel1 || p.basePrice || 0);
      if (qty <= 0) outOfStockCount++;
      else if (qty <= threshold) lowStockCount++;
    }
    return {
      lowStockThreshold: threshold,
      totalProducts: products.length,
      lowStockCount, // 0 < stock <= threshold
      outOfStockCount, // stock <= 0
      stockCostValue: round2(stockCostValue),
      stockRetailValue: round2(stockRetailValue),
    };
  }

  private dashboardPeriod(q: { range?: string; startDate?: string; endDate?: string }): { range: string; filter: DateRange; from: Date | null; to: Date } {
    const now = new Date();
    if (q.startDate || q.endDate) {
      const filter = dateRangeFilter(q.startDate, q.endDate);
      return { range: 'custom', filter, from: filter?.gte ?? null, to: filter?.lt ?? filter?.lte ?? now };
    }
    const range = (q.range || 'today') as DashboardRange;
    if (!DASHBOARD_RANGES.includes(range)) throw new BadRequestException('ช่วงเวลาไม่ถูกต้อง (today, 7days, 30days, month, all)');
    const today = bangkokStartOfDay(now);
    const from =
      range === 'today' ? today : range === '7days' ? addDays(today, -6) : range === '30days' ? addDays(today, -29) : range === 'month' ? bangkokStartOfMonth(now) : null;
    return { range, filter: from ? { gte: from } : undefined, from, to: now };
  }

  /**
   * Server-side aggregate for the dashboard page: no row limits, returns netted, Bangkok days,
   * one low-stock threshold. Legacy fields (todaySales, monthSales, salesChart ...) kept.
   */
  async getDashboard(q: { range?: string; startDate?: string; endDate?: string } = {}) {
    const period = this.dashboardPeriod(q);
    const today = bangkokStartOfDay();
    const [sales, channels, todayTotals, monthTotals, inventory, debt, customers, recent] = await Promise.all([
      salesTotals(this.prisma, period.filter),
      paymentChannels(this.prisma, period.filter),
      salesTotals(this.prisma, { gte: today }),
      salesTotals(this.prisma, { gte: bangkokStartOfMonth() }),
      this.inventorySnapshot(),
      this.prisma.customerDebt.aggregate({ where: { remainingAmount: { gt: 0 } }, _sum: { remainingAmount: true }, _count: { _all: true } }),
      this.prisma.customer.count(),
      this.prisma.order.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, orderNumber: true, createdAt: true, status: true, totalAmount: true, returnedAmount: true,
          customer: { select: { name: true } }, payments: { select: { method: true, amount: true } }, _count: { select: { items: true } },
        },
      }),
    ]);

    // ── timeline: one bucket per Bangkok day (per month when the range is longer than 92 days)
    const day = Prisma.sql`((o.created_at + interval '7 hours')::date)`;
    const [orderDays, returnDays] = await Promise.all([
      this.prisma.$queryRaw<{ d: string; status: string; amount: number; n: number }[]>(Prisma.sql`
        SELECT to_char(${day}, 'YYYY-MM-DD') AS d, o.status::text AS status, COALESCE(SUM(o.total_amount),0)::float8 AS amount, COUNT(*)::int AS n
        FROM orders o WHERE true ${sqlRange(Prisma.sql`o.created_at`, period.filter)} GROUP BY 1, 2`),
      this.prisma.$queryRaw<{ d: string; amount: number }[]>(Prisma.sql`
        SELECT to_char(((r.created_at + interval '7 hours')::date), 'YYYY-MM-DD') AS d, COALESCE(SUM(r.refund_amount),0)::float8 AS amount
        FROM order_returns r WHERE true ${sqlRange(Prisma.sql`r.created_at`, period.filter)} GROUP BY 1`),
    ]);
    const firstDay = period.from
      ? bangkokDayKey(period.from)
      : [...orderDays.map((r) => r.d), ...returnDays.map((r) => r.d)].sort()[0] || bangkokDayKey(today);
    const lastDay = bangkokDayKey(period.to.getTime() - (period.filter?.lt ? 1 : 0));
    const spanDays = Math.round((Date.parse(lastDay) - Date.parse(firstDay)) / DAY_MS) + 1;
    const monthly = spanDays > 92;
    const keyOf = (d: string) => (monthly ? d.slice(0, 7) : d);
    const buckets = new Map<string, { date: string; sales: number; returns: number; voided: number; netSales: number; orders: number; voidedOrders: number }>();
    const ensure = (k: string) => {
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { date: k, sales: 0, returns: 0, voided: 0, netSales: 0, orders: 0, voidedOrders: 0 }));
      return b;
    };
    for (let t = Date.parse(firstDay); t <= Date.parse(lastDay) && buckets.size < 400; t += DAY_MS) ensure(keyOf(new Date(t).toISOString().slice(0, 10)));
    for (const r of orderDays) {
      const b = ensure(keyOf(r.d));
      if (r.status === 'COMPLETED') { b.sales = round2(b.sales + Number(r.amount)); b.orders += Number(r.n); }
      else { b.voided = round2(b.voided + Number(r.amount)); b.voidedOrders += Number(r.n); }
    }
    for (const r of returnDays) { const b = ensure(keyOf(r.d)); b.returns = round2(b.returns + Number(r.amount)); }
    const timeline = [...buckets.values()].sort((a, b) => a.date.localeCompare(b.date)).map((b) => ({ ...b, netSales: round2(b.sales - b.returns) }));

    // ── top products: net of returned items, revenue after the bill-discount share
    const topRows = await this.prisma.$queryRaw<{ product_id: string; name: string; sku: string; qty: number; revenue: number; cost: number }[]>(Prisma.sql`
      WITH sold AS (
        SELECT oi.product_id, SUM(oi.quantity)::float8 AS qty,
               SUM(oi.total * CASE WHEN o.subtotal > 0 THEN o.total_amount / o.subtotal ELSE 1 END)::float8 AS revenue,
               SUM(oi.unit_cost * COALESCE(oi.base_quantity, oi.quantity))::float8 AS cost
        FROM order_items oi JOIN orders o ON o.id = oi.order_id
        WHERE o.status = 'COMPLETED' ${sqlRange(Prisma.sql`o.created_at`, period.filter)}
        GROUP BY oi.product_id),
      back AS (
        SELECT ri.product_id, SUM(ri.quantity)::float8 AS qty, SUM(ri.refund_amount)::float8 AS revenue,
               SUM(CASE WHEN ri.restock THEN ri.unit_cost * ri.base_quantity ELSE 0 END)::float8 AS cost
        FROM order_return_items ri JOIN order_returns r ON r.id = ri.return_id
        WHERE true ${sqlRange(Prisma.sql`r.created_at`, period.filter)}
        GROUP BY ri.product_id)
      SELECT p.id AS product_id, p.name, p.sku,
             (COALESCE(s.qty,0) - COALESCE(b.qty,0))::float8 AS qty,
             (COALESCE(s.revenue,0) - COALESCE(b.revenue,0))::float8 AS revenue,
             (COALESCE(s.cost,0) - COALESCE(b.cost,0))::float8 AS cost
      FROM products p
      JOIN (SELECT product_id FROM sold UNION SELECT product_id FROM back) ids ON ids.product_id = p.id
      LEFT JOIN sold s ON s.product_id = p.id LEFT JOIN back b ON b.product_id = p.id
      ORDER BY revenue DESC LIMIT 10`);
    const topProducts = topRows
      .filter((r) => Number(r.qty) > 0 || Number(r.revenue) > 0)
      .slice(0, 5)
      .map((r) => ({ productId: r.product_id, name: r.name, sku: r.sku, quantity: Number(r.qty), revenue: round2(Number(r.revenue)), cost: round2(Number(r.cost)) }));

    const ch = (k: string) => round2(channels[k]?.amount || 0);
    return {
      period: { range: period.range, from: period.from ? period.from.toISOString() : null, to: period.to.toISOString(), timezone: 'Asia/Bangkok', bucket: monthly ? 'month' : 'day' },
      sales: {
        ...sales,
        returnsAmount: sales.returns.amount,
        returnCount: sales.returns.count,
        unitsSoldNet: sales.unitsSold - sales.returns.units,
        averageBasket: sales.completedCount > 0 ? round2(sales.netSales / sales.completedCount) : 0,
      },
      payments: { cash: ch('CASH'), qrTransfer: ch('QR_TRANSFER'), card: ch('CARD'), credit: ch('CREDIT'), other: ch('OTHER'), detail: channels },
      timeline,
      topProducts,
      inventory,
      receivables: { totalPending: round2(Number(debt._sum.remainingAmount || 0)), billCount: debt._count._all },
      totalCustomers: customers,
      recentOrders: recent.map((o) => ({ ...o, totalAmount: Number(o.totalAmount), returnedAmount: Number(o.returnedAmount), itemCount: o._count.items })),
      // legacy fields (net of returns, Bangkok day / month)
      todaySales: todayTotals.netSales,
      todayOrders: todayTotals.completedCount,
      monthSales: monthTotals.netSales,
      totalProducts: inventory.totalProducts,
      lowStockCount: inventory.lowStockCount + inventory.outOfStockCount,
      salesChart: timeline.slice(-7).map((t) => ({ date: t.date, sales: t.netSales })),
    };
  }

  async getSalesSummary(startDate?: string, endDate?: string) {
    const range = dateRangeFilter(startDate, endDate);
    const [t, channels] = await Promise.all([salesTotals(this.prisma, range), this.paymentBreakdown(range)]);
    return {
      // net of partial returns in the period; same figures as /finance/profit-loss
      totalRevenue: t.netSales,
      totalOrders: t.completedCount,
      totalCogs: t.cogs,
      grossProfit: round2(t.netSales - t.cogs),
      grossSales: t.grossSales,
      discounts: t.discounts,
      returnsAmount: t.returns.amount,
      returnCount: t.returns.count,
      outputVat: t.outputVat,
      revenueExVat: t.revenueExVat,
      grossProfitExVat: t.grossProfit,
      paymentBreakdown: channels,
      voidedOrders: t.voidedCount,
      period: { from: range?.gte?.toISOString() ?? null, to: (range?.lt ?? range?.lte)?.toISOString() ?? null, toExclusive: !!range?.lt, timezone: 'Asia/Bangkok' },
    };
  }

  /** Per payment method (raw enum), net of refunds: CASH / TRANSFER refunds and DEBT_REDUCTION (-> CREDIT_DEBT). */
  private async paymentBreakdown(range: DateRange) {
    const created = range ? { createdAt: range } : {};
    const [pays, rets] = await Promise.all([
      this.prisma.payment.groupBy({ by: ['method'], where: { order: { status: OrderStatus.COMPLETED, ...created } }, _sum: { amount: true } }),
      this.prisma.orderReturn.groupBy({ by: ['refundMethod'], where: created, _sum: { refundAmount: true } }),
    ]);
    const map = new Map<string, number>();
    for (const p of pays) map.set(p.method, round2((map.get(p.method) || 0) + Number(p._sum.amount || 0)));
    for (const r of rets) {
      const m = r.refundMethod === 'DEBT_REDUCTION' ? 'CREDIT_DEBT' : r.refundMethod;
      map.set(m, round2((map.get(m) || 0) - Number(r._sum.refundAmount || 0)));
    }
    return [...map.entries()].map(([method, total]) => ({ method, total }));
  }

  async getFullAnalytics(startDate?: string, endDate?: string) {
    const range = dateRangeFilter(startDate, endDate);
    const whereClause: any = range ? { createdAt: range } : {};
    const hasDateFilter = !!range;

    const [orders, activeBatches, products, threshold, lastReceipts, debtPayments] = await Promise.all([
      this.prisma.order.findMany({
        where: whereClause,
        ...(hasDateFilter ? {} : { take: 50000 }),
        orderBy: { createdAt: 'desc' },
        include: {
          items: { include: { product: true } },
          payments: true,
          customer: { select: { id: true, name: true, phone: true } },
          user: { select: { id: true, fullName: true } },
          returns: {
            select: {
              refundAmount: true, vatAmount: true, cogsReturned: true, refundMethod: true, createdAt: true,
              items: { select: { orderItemId: true, productId: true, quantity: true, baseQuantity: true, refundAmount: true, unitCost: true, restock: true } },
            },
          },
        },
      }),
      // Include negative (oversold) batches so they net against positive stock.
      this.prisma.stockBatch.findMany({ where: { quantityRemaining: { not: 0 } }, select: { productId: true, quantityRemaining: true, unitCost: true } }),
      this.prisma.product.findMany({ where: { isActive: true }, select: { id: true, sku: true, name: true, costPrice: true, basePrice: true, priceLevel1: true, isBundle: true } }),
      this.lowStockThreshold(),
      // last time each product was received (PO receipt, return, adjustment): new stock is not "dead"
      this.prisma.stockBatch.groupBy({ by: ['productId'], where: { quantityReceived: { gt: 0 } }, _max: { receivedAt: true } }),
      this.prisma.debtPayment.findMany({
        where: { cancelledAt: null, ...(range ? { paymentDate: range } : {}) },
        select: { amount: true, paymentMethod: true, paymentDate: true },
      }),
    ]);

    const batchValuationByProduct = valueStock(activeBatches);
    let totalInventoryCostValue = 0;
    for (const p of products) {
      const batchInfo = batchValuationByProduct[p.id];
      if (batchInfo && batchInfo.quantityRemaining > 0) {
        totalInventoryCostValue += batchInfo.totalCostValue > 0 ? batchInfo.totalCostValue : batchInfo.quantityRemaining * Number(p.costPrice ?? 0);
      }
    }

    // Claim accounting: cost of replacement goods handed out, cash/transfer refunds paid to
    // customers, and value recovered from suppliers via credit notes for defective goods.
    const claimDateWhere = range ? { createdAt: range } : {};
    const [claimRows, defectiveReturnItems] = await Promise.all([
      this.prisma.customerClaim.findMany({ where: claimDateWhere, select: { claimNumber: true, createdAt: true, metadata: true } }),
      this.prisma.supplierReturnNoteItem.findMany({
        where: { itemType: 'DEFECTIVE', note: { status: { not: 'CANCELLED' }, ...claimDateWhere } },
        select: { total: true, note: { select: { returnNumber: true, createdAt: true } } },
      }),
    ]);
    const claimEvents = claimRows
      .map((c) => {
        const acc = ((c.metadata as any) || {}).accounting || {};
        return { createdAt: c.createdAt.toISOString(), claimNumber: c.claimNumber, replacementCost: Number(acc.replacementCost) || 0, refundPaid: Number(acc.refundPaid) || 0 };
      })
      .filter((e) => e.replacementCost > 0 || e.refundPaid > 0);
    const supplierRecoveries = defectiveReturnItems.map((i) => ({ createdAt: i.note.createdAt.toISOString(), returnNumber: i.note.returnNumber, amount: Number(i.total) || 0 }));

    return {
      orders,
      lowStockThreshold: threshold,
      lastReceivedAtByProduct: Object.fromEntries(lastReceipts.map((r) => [r.productId, r._max.receivedAt?.toISOString() ?? null])),
      debtReceipts: debtPayments.map((d) => ({ amount: Number(d.amount), method: d.paymentMethod, createdAt: d.paymentDate.toISOString() })),
      purchases: await this.purchasesData(range),
      claimAccounting: { events: claimEvents, supplierRecoveries },
      stockBatchValuation: { byProductId: batchValuationByProduct, totalInventoryCostValue },
    };
  }

  /**
   * Purchases for the Reports tab:
   * - receipts: value of goods received (each PO receipt = a stock batch), dated by receipt date
   * - open: value ordered but not yet received (PENDING / ISSUED / ORDERED / PARTIALLY_RECEIVED)
   * - payable: owed per supplier for received goods, same formula as /finance/overview
   */
  private async purchasesData(range: DateRange) {
    const [batches, pos] = await Promise.all([
      this.prisma.stockBatch.findMany({
        where: { purchaseOrderId: { not: null }, ...(range ? { receivedAt: range } : {}) },
        select: { productId: true, quantityReceived: true, receivedAt: true, purchaseOrderId: true },
      }),
      this.prisma.purchaseOrder.findMany({
        where: { status: { notIn: ['DRAFT', 'CANCELLED'] } },
        select: {
          id: true, poNumber: true, status: true, supplierId: true, paidAmount: true, remainingPayable: true, totalAmount: true,
          supplier: { select: { name: true } },
          items: { select: { productId: true, quantity: true, receivedQty: true, unitCost: true, total: true } },
        },
      }),
    ]);
    const poById = new Map(pos.map((p) => [p.id, p]));
    const receipts = batches
      .map((b) => {
        const po = poById.get(b.purchaseOrderId!);
        const item = po?.items.find((i) => i.productId === b.productId);
        return {
          createdAt: b.receivedAt.toISOString(),
          supplierId: po?.supplierId ?? 'UNKNOWN',
          supplierName: po?.supplier.name ?? 'ไม่ระบุผู้จำหน่าย',
          poNumber: po?.poNumber ?? '-',
          value: round2(Number(b.quantityReceived) * (item ? grossPerUnit(item) : 0)),
        };
      })
      .filter((r) => r.value > 0);
    const open = pos
      .filter((p) => ['PENDING', 'ISSUED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(p.status))
      .map((p) => ({
        supplierId: p.supplierId, supplierName: p.supplier.name, poNumber: p.poNumber,
        value: round2(p.items.reduce((s, i) => s + Math.max(0, Number(i.quantity) - Number(i.receivedQty)) * grossPerUnit(i), 0)),
      }))
      .filter((p) => p.value > 0);
    const payable = pos
      .filter((p) => ['PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED'].includes(p.status) && Number(p.remainingPayable) > 0)
      .map((p) => {
        const received = p.items.reduce((s, i) => s + Number(i.receivedQty) * grossPerUnit(i), 0);
        return { supplierId: p.supplierId, supplierName: p.supplier.name, poNumber: p.poNumber, amount: round2(Math.max(0, Math.min(Number(p.remainingPayable), received - Number(p.paidAmount)))) };
      })
      .filter((p) => p.amount > 0);
    return { receipts, open, payable };
  }
}
