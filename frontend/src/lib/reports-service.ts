import { useProductStore } from './store/product-store';
import { loadAllClaimRecords } from './claim-service';
import { loadPurchaseOrders, loadSuppliers } from './supplier-return-service';
import { loadAllDebtRecords } from './debt-service';
import { loadCustomers } from './customer-service';
import { loadAllShiftSummaries } from './shift-service';
import { bangkokDate, bangkokDayKey, bangkokDayStart, bangkokParts, bangkokStartOfDay, DAY_MS } from '@shared/bangkok-date';
import { addQty } from './qty';

export type ReportTimeRange = 'today' | 'yesterday' | '7days' | '30days' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'all' | 'custom';

// ─── Helper to Load Orders ───
export function loadAllOrders(): any[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('pos_orders');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return [];
}

// ─── Time ranges (Asia/Bangkok calendar, end exclusive) ───
/** [start, end) in epoch ms for a report range, using the Bangkok calendar whatever the device TZ. */
export function reportRangeBounds(
  timeRange: ReportTimeRange,
  customStart?: string,
  customEnd?: string,
  now: number = Date.now()
): { start: number; end: number } {
  const today = bangkokStartOfDay(now);
  const tomorrow = today + DAY_MS;
  const { year, month } = bangkokParts(now);
  switch (timeRange) {
    case 'today':
      return { start: today, end: tomorrow };
    case 'yesterday':
      return { start: today - DAY_MS, end: today };
    case '7days':
      return { start: today - 6 * DAY_MS, end: tomorrow };
    case '30days':
      return { start: today - 29 * DAY_MS, end: tomorrow };
    case 'thisMonth':
      return { start: bangkokDate(year, month, 1), end: tomorrow };
    case 'lastMonth':
      return { start: bangkokDate(year, month - 1, 1), end: bangkokDate(year, month, 1) };
    case 'thisYear':
      return { start: bangkokDate(year, 0, 1), end: tomorrow };
    case 'custom': {
      const s = customStart ? bangkokDayStart(customStart) : NaN;
      const e = customEnd ? bangkokDayStart(customEnd) : NaN;
      // custom end date is inclusive: the whole Bangkok day, up to next day 00:00 (exclusive)
      return { start: isNaN(s) ? -Infinity : s, end: isNaN(e) ? Infinity : e + DAY_MS };
    }
    case 'all':
    default:
      return { start: -Infinity, end: Infinity };
  }
}

/** Keep rows whose createdAt (or orderDate) falls in the range (Bangkok days, end exclusive). */
export function filterOrdersByDateRange(
  orders: any[],
  timeRange: ReportTimeRange,
  customStart?: string,
  customEnd?: string
): any[] {
  const { start, end } = reportRangeBounds(timeRange, customStart, customEnd);
  if (start === -Infinity && end === Infinity) return orders;
  return orders.filter((o) => {
    const d = new Date(o.createdAt || o.orderDate || Date.now()).getTime();
    if (isNaN(d)) return true;
    return d >= start && d < end;
  });
}

const isVoidStatus = (s: any) => s === 'VOIDED' || s === 'CANCELLED' || s === 'REFUNDED';
const round2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** A partial return (OrderReturn) together with its order, for period-based netting. */
export interface FlatReturn {
  order: any;
  createdAt: string;
  refundAmount: number;
  vatAmount: number;
  cogsReturned: number;
  refundMethod: string;
  items: { orderItemId: string; productId: string; quantity: number; baseQuantity: number; refundAmount: number; unitCost: number; restock: boolean }[];
}

/**
 * All partial returns of the given orders. Like the P&L, a return reduces sales in the period
 * it was MADE (filter the result with filterOrdersByDateRange), not in the bill's period.
 */
export function collectReturns(orders: any[]): FlatReturn[] {
  const out: FlatReturn[] = [];
  for (const o of orders || []) {
    if (isVoidStatus(o.status)) continue;
    for (const r of Array.isArray(o.returns) ? o.returns : []) {
      out.push({
        order: o,
        createdAt: r.createdAt || o.createdAt,
        refundAmount: Number(r.refundAmount || 0),
        vatAmount: Number(r.vatAmount || 0),
        cogsReturned: Number(r.cogsReturned || 0),
        refundMethod: String(r.refundMethod || 'CASH'),
        items: Array.isArray(r.items) ? r.items : [],
      });
    }
  }
  return out;
}

/** Returns made in the selected range (from all loaded orders, whatever the bill date). */
export function returnsInRange(allOrders: any[], timeRange: ReportTimeRange, customStart?: string, customEnd?: string): FlatReturn[] {
  return filterOrdersByDateRange(collectReturns(allOrders), timeRange, customStart, customEnd);
}

/** List value of a bill: qty x unit price before any discount. */
function orderListValue(order: any) {
  let list = 0;
  for (const it of order.items || []) list += Number(it.quantity || 0) * Number(it.unitPrice ?? it.price ?? 0);
  return list;
}

/** List value of returned goods (qty x unit price of the original line). */
function returnListValue(ret: FlatReturn) {
  if (!ret.items.length) return ret.refundAmount;
  let list = 0;
  for (const ri of ret.items) {
    const line = (ret.order.items || []).find((i: any) => i.id === ri.orderItemId);
    list += Number(ri.quantity || 0) * Number(line?.unitPrice ?? 0);
  }
  return list;
}

/** Share of the bill-level discount that applies to each line: total / subtotal. */
function billFactor(order: any) {
  const sub = Number(order.subtotal || 0);
  const total = Number(order.totalAmount ?? order.total ?? 0);
  return sub > 0 ? total / sub : 1;
}

// ─── 1. Sales & Gross Profit Summary ───
export interface DailySalesProfit {
  date: string;
  orderCount: number;
  grossSales: number;
  discounts: number;
  netSales: number;
  cogs: number; // Cost of Goods Sold
  grossProfit: number;
  profitMarginPercent: number;
}

/** Recorded COGS of a bill (0 is a valid recorded value); only a missing figure falls back to catalog cost. */
function orderCost(order: any, productCostMap: Map<string, number>) {
  if (order.totalCogs !== null && order.totalCogs !== undefined && order.totalCogs !== '') return Number(order.totalCogs) || 0;
  let cost = 0;
  (order.items || []).forEach((item: any) => {
    const qty = Number(item.baseQuantity ?? item.quantity ?? 1);
    let itemCost = item.unitCost !== null && item.unitCost !== undefined ? Number(item.unitCost) : NaN;
    if (!Number.isFinite(itemCost)) {
      itemCost =
        Number(item.product?.costPrice ?? 0) ||
        productCostMap.get(item.productId) ||
        productCostMap.get(item.sku) ||
        productCostMap.get(item.productName) ||
        0;
    }
    cost += itemCost * qty;
  });
  return cost;
}

/**
 * Sales tab. Net sales = bills in the range - returns made in the range (same rule as the P&L).
 * Gross = qty x unit price before any discount; discounts = line + bill discounts (net of the
 * discount share of returned goods); gross - discounts = net.
 * `returns`: returns made in the range (returnsInRange); if omitted, each bill's own returns are used.
 */
export function calculateSalesAndProfitReport(orders: any[], productsCatalog: any[], returns?: FlatReturn[]) {
  const productCostMap = new Map<string, number>();
  productsCatalog.forEach((p) => {
    // IMPORTANT: Never fall back to p.basePrice (selling price) as cost!
    const cost = Number(p.costPrice ?? p.cost ?? 0);
    if (p.id) productCostMap.set(p.id, cost);
    if (p.sku) productCostMap.set(p.sku, cost);
    if (p.name) productCostMap.set(p.name, cost);
  });

  const dailyMap = new Map<string, DailySalesProfit>();
  const day = (key: string) => {
    let row = dailyMap.get(key);
    if (!row) {
      row = { date: key, orderCount: 0, grossSales: 0, discounts: 0, netSales: 0, cogs: 0, grossProfit: 0, profitMarginPercent: 0 };
      dailyMap.set(key, row);
    }
    return row;
  };

  const completed = orders.filter((o) => !isVoidStatus(o.status));
  completed.forEach((order) => {
    const total = Number(order.totalAmount ?? order.total ?? 0);
    const list = orderListValue(order);
    const gross = list > 0 ? list : total + Number(order.discountAmount ?? order.discount ?? 0);
    const row = day(bangkokDayKey(order.createdAt || order.orderDate || Date.now()));
    row.orderCount += 1;
    row.grossSales += gross;
    row.discounts += gross - total; // line + bill discounts
    row.netSales += total;
    row.cogs += orderCost(order, productCostMap);
  });

  const rets = returns ?? collectReturns(completed);
  rets.forEach((r) => {
    const listBack = returnListValue(r);
    const row = day(bangkokDayKey(r.createdAt));
    row.grossSales -= listBack;
    row.discounts -= listBack - r.refundAmount;
    row.netSales -= r.refundAmount;
    row.cogs -= r.cogsReturned;
  });

  let totalGrossSales = 0;
  let totalDiscounts = 0;
  let totalNetSales = 0;
  let totalCogs = 0;
  for (const row of dailyMap.values()) {
    row.grossSales = round2(row.grossSales);
    row.discounts = round2(row.discounts);
    row.netSales = round2(row.netSales);
    row.cogs = round2(row.cogs);
    row.grossProfit = round2(row.netSales - row.cogs);
    row.profitMarginPercent = row.netSales > 0 ? Math.round((row.grossProfit / row.netSales) * 1000) / 10 : 0;
    totalGrossSales += row.grossSales;
    totalDiscounts += row.discounts;
    totalNetSales += row.netSales;
    totalCogs += row.cogs;
  }

  const dailyList = Array.from(dailyMap.values()).sort((a, b) => b.date.localeCompare(a.date));
  totalNetSales = round2(totalNetSales);
  totalCogs = round2(totalCogs);
  const totalGrossProfit = round2(totalNetSales - totalCogs);
  const overallMargin = totalNetSales > 0 ? Math.round((totalGrossProfit / totalNetSales) * 1000) / 10 : 0;

  return {
    totalOrders: completed.length,
    totalGrossSales: round2(totalGrossSales),
    totalDiscounts: round2(totalDiscounts),
    totalNetSales,
    totalReturns: round2(rets.reduce((s, r) => s + r.refundAmount, 0)),
    totalCogs,
    totalGrossProfit,
    overallMargin,
    dailyBreakdown: dailyList,
  };
}

/** Output VAT card: VAT bills in the range minus VAT of returns made in the range. */
export function calculateVatSummary(orders: any[], returns: FlatReturn[]) {
  const completed = orders.filter((o) => !isVoidStatus(o.status));
  let vatAmount = completed.reduce((s, o) => s + (Number(o.vatAmount) || 0), 0);
  let vatSales = completed.filter((o) => Number(o.vatAmount) > 0).reduce((s, o) => s + (Number(o.totalAmount) || 0), 0);
  for (const r of returns) {
    if (Number(r.order?.vatAmount) > 0 || r.vatAmount > 0) {
      vatAmount -= r.vatAmount;
      vatSales -= r.refundAmount;
    }
  }
  vatAmount = round2(vatAmount);
  vatSales = round2(vatSales);
  return { vatAmount, vatSales, vatBase: round2(vatSales - vatAmount) };
}

// ─── 2. Best Selling & Top Profit Products ───
export interface ProductPerformance {
  id: string;
  name: string;
  sku: string;
  category: string;
  unitName: string;
  quantitySold: number;
  totalRevenue: number;
  totalCost: number;
  totalProfit: number;
  profitMarginPercent: number;
}

function extractCategoryName(category: any): string {
  if (!category) return 'ทั่วไป';
  if (typeof category === 'string') return category;
  if (typeof category === 'object' && category.name) return String(category.name);
  return 'ทั่วไป';
}

/**
 * Best sellers. Revenue per line = line total x bill-discount share (total / subtotal), so the
 * sum over products equals net sales; returned goods (returns made in the range) are taken off
 * quantity, revenue and (when restocked) cost.
 */
export function calculateBestSellingProducts(orders: any[], productsCatalog: any[], returns?: FlatReturn[]) {
  const productCostMap = new Map<string, number>();
  const productCategoryMap = new Map<string, string>();
  const productNameMap = new Map<string, string>();
  const productSkuMap = new Map<string, string>();
  const productUnitMap = new Map<string, string>();

  productsCatalog.forEach((p) => {
    // IMPORTANT: Never fall back to p.basePrice (selling price) as cost!
    const cost = Number(p.costPrice ?? p.cost ?? 0);
    const cat = extractCategoryName(p.category);
    const name = p.name || '';
    const sku = p.sku || '-';
    const unit = p.unit || p.unitName || p.units?.[0]?.unitName || p.units?.[0]?.name || 'ชิ้น';

    if (p.id) {
      productCostMap.set(p.id, cost);
      productCategoryMap.set(p.id, cat);
      if (name) productNameMap.set(p.id, name);
      if (sku !== '-') productSkuMap.set(p.id, sku);
      productUnitMap.set(p.id, unit);
    }
    if (p.sku) {
      productCostMap.set(p.sku, cost);
      productCategoryMap.set(p.sku, cat);
      if (name) productNameMap.set(p.sku, name);
      productSkuMap.set(p.sku, p.sku);
      productUnitMap.set(p.sku, unit);
    }
    if (name) {
      productCostMap.set(name, cost);
    }
  });

  const map = new Map<string, ProductPerformance>();

  orders.forEach((order) => {
    if (order.status === 'VOIDED' || order.status === 'CANCELLED' || order.status === 'REFUNDED') return;
    const factor = billFactor(order);

    (order.items || []).forEach((item: any) => {
      // Prioritize item.name, item.productName, item.product.name, or lookup from productsCatalog
      const resolvedName =
        item.name ||
        item.productName ||
        item.product?.name ||
        (item.productId ? productNameMap.get(item.productId) : undefined) ||
        (item.sku ? productNameMap.get(item.sku) : undefined) ||
        'สินค้าทั่วไป';

      const resolvedSku =
        item.sku ||
        item.barcode ||
        item.product?.sku ||
        (item.productId ? productSkuMap.get(item.productId) : undefined) ||
        '-';

      const key = item.productId || (resolvedSku !== '-' ? resolvedSku : resolvedName);

      const qty = Number(item.quantity || 1);
      const baseQty = Number(item.baseQuantity ?? item.quantity ?? 1);
      const price = Number(item.unitPrice ?? item.price ?? 0);
      const lineDiscount = Number(item.discountAmount ?? 0);
      const revenue = Number(item.total ?? item.subtotal ?? (price * qty - lineDiscount)) * factor;

      // recorded cost of the sale (0 is valid); catalog cost only when nothing was recorded
      const recorded = item.unitCost ?? item.costPrice;
      let cost = recorded !== null && recorded !== undefined ? Number(recorded) || 0 : NaN;
      if (!Number.isFinite(cost)) {
        cost =
          Number(item.product?.costPrice ?? 0) ||
          productCostMap.get(item.productId) ||
          productCostMap.get(resolvedSku) ||
          productCostMap.get(resolvedName) ||
          0;
      }

      const totalItemCost = cost * baseQty;
      const profit = revenue - totalItemCost;
      const category = extractCategoryName(
        item.category ||
        item.product?.category ||
        productCategoryMap.get(item.productId) ||
        productCategoryMap.get(resolvedSku)
      );

      const unitName =
        item.unitName ||
        item.unit ||
        item.product?.unit ||
        (item.productId ? productUnitMap.get(item.productId) : undefined) ||
        'ชิ้น';

      const existing = map.get(key);
      if (!existing) {
        map.set(key, {
          id: item.productId || key,
          name: resolvedName,
          sku: resolvedSku,
          category,
          unitName,
          quantitySold: baseQty,
          totalRevenue: revenue,
          totalCost: totalItemCost,
          totalProfit: profit,
          profitMarginPercent: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
        });
      } else {
        if (existing.name === 'สินค้า' || existing.name === 'สินค้าทั่วไป') {
          if (resolvedName !== 'สินค้า' && resolvedName !== 'สินค้าทั่วไป') {
            existing.name = resolvedName;
          }
        }
        if (existing.sku === '-' && resolvedSku !== '-') {
          existing.sku = resolvedSku;
        }
        existing.quantitySold += baseQty;
        existing.totalRevenue += revenue;
        existing.totalCost += totalItemCost;
        existing.totalProfit = existing.totalRevenue - existing.totalCost;
        existing.profitMarginPercent =
          existing.totalRevenue > 0 ? Math.round((existing.totalProfit / existing.totalRevenue) * 1000) / 10 : 0;
      }
    });
  });

  // returned goods
  const rets = returns ?? collectReturns(orders);
  for (const r of rets) {
    for (const ri of r.items) {
      const line = (r.order.items || []).find((i: any) => i.id === ri.orderItemId);
      const key = ri.productId || line?.productId;
      if (!key) continue;
      let entry = map.get(key);
      if (!entry) {
        entry = {
          id: key, name: line?.product?.name || productNameMap.get(key) || 'สินค้า', sku: line?.product?.sku || productSkuMap.get(key) || '-',
          category: extractCategoryName(line?.product?.category || productCategoryMap.get(key)), unitName: productUnitMap.get(key) || 'ชิ้น',
          quantitySold: 0, totalRevenue: 0, totalCost: 0, totalProfit: 0, profitMarginPercent: 0,
        };
        map.set(key, entry);
      }
      entry.quantitySold -= Number(ri.baseQuantity ?? ri.quantity ?? 0);
      entry.totalRevenue -= Number(ri.refundAmount || 0);
      if (ri.restock !== false) entry.totalCost -= Number(ri.unitCost || 0) * Number(ri.baseQuantity ?? ri.quantity ?? 0);
    }
  }
  for (const e of map.values()) {
    e.totalRevenue = round2(e.totalRevenue);
    e.totalCost = round2(e.totalCost);
    e.totalProfit = round2(e.totalRevenue - e.totalCost);
    e.profitMarginPercent = e.totalRevenue > 0 ? Math.round((e.totalProfit / e.totalRevenue) * 1000) / 10 : 0;
  }

  const list = Array.from(map.values());
  const byQuantity = [...list].sort((a, b) => b.quantitySold - a.quantitySold);
  const byProfit = [...list].sort((a, b) => b.totalProfit - a.totalProfit);
  const byRevenue = [...list].sort((a, b) => b.totalRevenue - a.totalRevenue);

  return {
    allProducts: byQuantity,
    topByQuantity: byQuantity.slice(0, 15),
    topByProfit: byProfit.slice(0, 15),
    topByRevenue: byRevenue.slice(0, 15),
  };
}

// ─── 3. Inventory Valuation & Deadstock Report ───
export interface InventoryValuationItem {
  id: string;
  name: string;
  sku: string;
  category: string;
  supplierName: string;
  stock: number;
  unitName: string;
  costPrice: number;
  retailPrice: number;
  totalCostValue: number;
  totalRetailValue: number;
  potentialProfit: number;
  daysSinceLastSale?: number;
  daysSinceLastReceipt?: number;
  isDeadstock: boolean; // stock on hand, no sale in 30+ days and nothing received in 30+ days
  isLowStock: boolean;
}

export const DEFAULT_LOW_STOCK_THRESHOLD = 5;
export const DEADSTOCK_DAYS = 30;

/**
 * Inventory tab. Stock value at cost (FIFO batches); retail value shown separately.
 * Low stock = stock <= StoreSettings.lowStockThreshold (one threshold everywhere, default 5).
 * Deadstock = stock on hand, no sale for DEADSTOCK_DAYS AND nothing received within DEADSTOCK_DAYS
 * (goods that just arrived are not "dead").
 */
export function calculateInventoryValuationReport(
  products: any[],
  orders: any[],
  batchValuationByProduct?: Record<string, { quantityRemaining: number; totalCostValue: number; averageUnitCost: number }>,
  options: { lowStockThreshold?: number; lastReceivedAtByProduct?: Record<string, string | null>; deadstockDays?: number } = {}
) {
  const threshold = Number.isFinite(Number(options.lowStockThreshold)) ? Number(options.lowStockThreshold) : DEFAULT_LOW_STOCK_THRESHOLD;
  const deadDays = options.deadstockDays ?? DEADSTOCK_DAYS;
  const lastSoldDateMap = new Map<string, number>();

  orders.forEach((o) => {
    if (o.status === 'VOIDED' || o.status === 'CANCELLED' || o.status === 'REFUNDED') return;
    const oDate = new Date(o.createdAt || o.orderDate || Date.now()).getTime();
    (o.items || []).forEach((item: any) => {
      const key = item.productId || item.sku || item.productName;
      const prev = lastSoldDateMap.get(key) || 0;
      if (oDate > prev) {
        lastSoldDateMap.set(key, oDate);
        if (item.productId) lastSoldDateMap.set(item.productId, oDate);
        if (item.sku) lastSoldDateMap.set(item.sku, oDate);
      }
    });
  });

  const nowTime = Date.now();

  let totalProducts = 0;
  let totalStockPieces = 0;
  let totalCostVal = 0;
  let totalRetailVal = 0;
  let deadstockPieces = 0;
  let deadstockCostVal = 0;
  let lowStockCount = 0;

  const items: InventoryValuationItem[] = products.filter((p) => !p.isBundle).map((p) => {
    const batchInfo = p.id ? batchValuationByProduct?.[p.id] : undefined;
    const stock = Math.max(0, Number(batchInfo?.quantityRemaining ?? p.stock ?? p.quantity ?? 0));
    // IMPORTANT: Use explicit costPrice for cost and priceLevel1/basePrice for retail price!
    const fallbackCost = Number(p.costPrice ?? p.cost ?? 0);
    const retail = Number(p.priceLevel1 || p.basePrice || p.price || 0);

    let costVal = 0;
    let cost = fallbackCost;

    if (batchInfo && batchInfo.quantityRemaining > 0) {
      costVal = batchInfo.totalCostValue > 0 ? batchInfo.totalCostValue : stock * fallbackCost;
      cost = stock > 0 ? costVal / stock : fallbackCost;
    } else if (Array.isArray(p.stockBatches) && p.stockBatches.length > 0 && stock > 0) {
      const activeBatches = p.stockBatches.filter((b: any) => Number(b.quantityRemaining) > 0);
      const batchQty = addQty(...activeBatches.map((b: any) => Number(b.quantityRemaining || 0)));
      const batchCost = activeBatches.reduce(
        (sum: number, b: any) => sum + Number(b.quantityRemaining || 0) * Number(b.unitCost ?? fallbackCost),
        0
      );
      if (batchQty > 0 && batchCost > 0) {
        costVal = batchCost;
        cost = batchCost / batchQty;
      } else {
        costVal = stock * fallbackCost;
      }
    } else {
      costVal = stock * fallbackCost;
    }

    const retailVal = stock * retail;
    const potentialProfit = retailVal - costVal;

    const lastSaleTime = lastSoldDateMap.get(p.id) || lastSoldDateMap.get(p.sku) || 0;
    const daysSinceLastSale = lastSaleTime > 0 ? Math.floor((nowTime - lastSaleTime) / 86400000) : 999;
    const lastReceived = options.lastReceivedAtByProduct?.[p.id] ? new Date(options.lastReceivedAtByProduct[p.id] as string).getTime() : 0;
    const daysSinceLastReceipt = lastReceived > 0 ? Math.floor((nowTime - lastReceived) / 86400000) : 999;
    const isDeadstock = stock > 0 && daysSinceLastSale >= deadDays && daysSinceLastReceipt >= deadDays;
    const isLowStock = stock <= threshold;

    totalProducts += 1;
    totalStockPieces += stock;
    totalCostVal += costVal;
    totalRetailVal += retailVal;

    if (isDeadstock) {
      deadstockPieces += stock;
      deadstockCostVal += costVal;
    }
    if (isLowStock) {
      lowStockCount += 1;
    }

    return {
      id: p.id,
      name: p.name,
      sku: p.sku || '-',
      category: extractCategoryName(p.category),
      supplierName: p.supplierName || (typeof p.supplier === 'object' ? p.supplier?.name : p.supplier) || 'ทั่วไป',
      stock,
      unitName: p.unit || p.unitName || p.units?.[0]?.unitName || p.units?.[0]?.name || 'ชิ้น',
      costPrice: cost,
      retailPrice: retail,
      totalCostValue: costVal,
      totalRetailValue: retailVal,
      potentialProfit,
      daysSinceLastSale,
      daysSinceLastReceipt,
      isDeadstock,
      isLowStock,
    };
  });

  const deadstockList = items.filter((i) => i.isDeadstock).sort((a, b) => b.totalCostValue - a.totalCostValue);
  const lowStockList = items.filter((i) => i.isLowStock).sort((a, b) => a.stock - b.stock);

  return {
    totalProducts,
    totalStockPieces,
    totalCostVal,
    totalRetailVal,
    totalPotentialProfit: totalRetailVal - totalCostVal,
    deadstockPieces,
    deadstockCostVal,
    lowStockCount,
    lowStockThreshold: threshold,
    items: items.sort((a, b) => b.totalCostValue - a.totalCostValue),
    deadstockList,
    lowStockList,
  };
}

// ─── 4. Payment Channels & Shift Reconciliation Report ───
export interface PaymentChannelBreakdown {
  method: string;
  label: string;
  orderCount: number;
  totalAmount: number;
  percentage: number;
}

/**
 * Payments tab.
 * - channels: money per channel for bills in the range, net of refunds of returns made in the range
 *   (CASH / TRANSFER refunds; DEBT_REDUCTION reduces the credit channel). CREDIT_DEBT = credit sale.
 * - totalCollected = money actually received: cash + QR/transfer + card - refunds + debt receipts
 *   in the range. Unpaid credit sales are NOT collected money (shown separately).
 * - shift statistics: only shifts closed (or opened, if still open) within the range.
 */
export function calculatePaymentsAndShiftsReport(
  orders: any[],
  shiftsHistory: any[],
  options: { returns?: FlatReturn[]; debtReceipts?: { amount: number; method?: string; createdAt: string }[]; inRange?: (iso: string) => boolean } = {}
) {
  const methodMap = new Map<string, { label: string; count: number; amount: number }>();

  methodMap.set('CASH', { label: 'เงินสด (Cash)', count: 0, amount: 0 });
  methodMap.set('QR_PROMPTPAY', { label: 'สแกน QR PromptPay / โอนเงิน', count: 0, amount: 0 });
  methodMap.set('CREDIT_CARD', { label: 'บัตรเครดิต / เดบิต', count: 0, amount: 0 });
  methodMap.set('CREDIT', { label: 'ขายเชื่อ (ยังไม่ได้รับเงิน)', count: 0, amount: 0 });
  methodMap.set('STORE_CREDIT', { label: 'ใบลดหนี้ / เครดิตร้าน', count: 0, amount: 0 });
  methodMap.set('OTHER', { label: 'ช่องทางอื่นๆ', count: 0, amount: 0 });

  const channelKey = (m: string) => {
    if (m === 'CREDIT_DEBT' || m === 'CREDIT' || m === 'DEBT_REDUCTION') return 'CREDIT';
    if (m === 'CREDIT_NOTE') return 'STORE_CREDIT';
    if (m === 'TRANSFER' || m === 'QR_PROMPTPAY') return 'QR_PROMPTPAY';
    if (m === 'CASH' || m === 'CREDIT_CARD') return m;
    return 'OTHER';
  };
  const add = (m: string, amt: number, count = 1) => {
    const entry = methodMap.get(channelKey(m)) || methodMap.get('OTHER')!;
    entry.count += count;
    entry.amount += amt;
  };

  orders.forEach((o) => {
    if (isVoidStatus(o.status)) return;
    if (Array.isArray(o.payments) && o.payments.length > 0) {
      o.payments.forEach((p: any) => add(p.method || 'OTHER', Number(p.amount || 0)));
    } else {
      add(o.paymentMethod || 'CASH', Number(o.totalAmount ?? o.total ?? 0));
    }
  });

  let refunds = 0;
  for (const r of options.returns ?? collectReturns(orders)) {
    add(r.refundMethod, -r.refundAmount, 0);
    if (r.refundMethod !== 'DEBT_REDUCTION') refunds += r.refundAmount;
  }

  const debtReceipts = (options.debtReceipts || []).filter((d) => !options.inRange || options.inRange(d.createdAt));
  const debtReceived = round2(debtReceipts.reduce((s, d) => s + Number(d.amount || 0), 0));

  const amountOf = (k: string) => round2(methodMap.get(k)?.amount || 0);
  const salesCollected = round2(amountOf('CASH') + amountOf('QR_PROMPTPAY') + amountOf('CREDIT_CARD') + amountOf('OTHER'));
  const totalCollected = round2(salesCollected + debtReceived);
  const totalSales = round2(Array.from(methodMap.values()).reduce((s, e) => s + e.amount, 0));

  const channels: PaymentChannelBreakdown[] = Array.from(methodMap.entries())
    .map(([method, data]) => ({
      method,
      label: data.label,
      orderCount: data.count,
      totalAmount: round2(data.amount),
      percentage: totalSales > 0 ? Math.round((data.amount / totalSales) * 1000) / 10 : 0,
    }))
    .filter((c) => Math.abs(c.totalAmount) >= 0.005);
  if (debtReceived > 0) {
    channels.push({ method: 'DEBT_RECEIPT', label: 'รับชำระหนี้ลูกค้า (เงินเข้า ไม่ใช่ยอดขาย)', orderCount: debtReceipts.length, totalAmount: debtReceived, percentage: 0 });
  }

  // Shift discrepancy summary (shifts of the selected range only)
  const shifts = (Array.isArray(shiftsHistory) ? shiftsHistory : []).filter((s) => {
    if (!options.inRange) return true;
    const when = s.closedAt || s.openedAt || s.createdAt;
    return !when || options.inRange(when);
  });
  const totalShiftsCount = shifts.length;
  let totalExpectedCash = 0;
  let totalActualCash = 0;
  let totalCashDiscrepancy = 0;
  let balancedShifts = 0;
  let shortShifts = 0;
  let overShifts = 0;

  shifts.forEach((s) => {
    const exp = Number(s.expectedCash || 0);
    const hasActual = s.actualCash !== null && s.actualCash !== undefined;
    const act = hasActual ? Number(s.actualCash) : exp;
    const diff = s.cashDifference !== null && s.cashDifference !== undefined
      ? Number(s.cashDifference)
      : act - exp;

    totalExpectedCash += exp;
    totalActualCash += act;
    totalCashDiscrepancy += diff;

    if (Math.abs(diff) < 0.005) balancedShifts += 1;
    else if (diff < 0) shortShifts += 1;
    else overShifts += 1;
  });

  return {
    totalCollected,
    salesCollected,
    debtReceived,
    creditSales: amountOf('CREDIT'),
    refunds: round2(refunds),
    channels,
    shifts: {
      totalShiftsCount,
      totalExpectedCash: round2(totalExpectedCash),
      totalActualCash: round2(totalActualCash),
      totalCashDiscrepancy: round2(totalCashDiscrepancy),
      balancedShifts,
      shortShifts,
      overShifts,
      list: shifts,
    },
  };
}

// ─── 5. Customer & Debts Aging Report ───
export interface CustomerSpendingSummary {
  id: string;
  code: string;
  name: string;
  phone: string;
  points: number;
  orderCount: number;
  totalSpent: number;
  averageTicket: number;
  outstandingDebt: number;
  lastOrderDate: string;
}

export interface DebtAgingBucket {
  bucketName: string;
  rangeDays: string;
  billCount: number;
  totalAmount: number;
}

/**
 * Customers tab. totalSpent = bills in the range net of their partial returns (incl. DEBT_REDUCTION).
 * Debt aging here is by BILL AGE (days since the bill date); Finance overview buckets by days OVERDUE.
 */
export function calculateCustomerAndDebtsReport(orders: any[], debts: any[], customers: any[]) {
  // 1. Build lookup maps from customers catalog
  const customerProfileMap = new Map<string, any>();
  (customers || []).forEach((c) => {
    if (c.id) customerProfileMap.set(c.id, c);
    if (c.name) customerProfileMap.set(c.name, c);
    if (c.code) customerProfileMap.set(c.code, c);
  });

  // 2. Build debt map by customer (supports both remainingDebt and PostgreSQL remainingAmount)
  const debtByCustomerMap = new Map<string, number>();
  (debts || []).forEach((d) => {
    const remaining = Number(d.remainingDebt ?? d.remainingAmount ?? 0);
    if (remaining > 0 && d.status !== 'PAID') {
      const custName = d.customerName || d.customer?.name;
      const key = d.customerId || custName || 'UNKNOWN';
      debtByCustomerMap.set(key, (debtByCustomerMap.get(key) || 0) + remaining);
      if (custName && custName !== key) {
        debtByCustomerMap.set(custName, (debtByCustomerMap.get(custName) || 0) + remaining);
      }
    }
  });

  // 3. Aggregate spending from orders
  const customerSpendingMap = new Map<string, CustomerSpendingSummary>();

  orders.forEach((o) => {
    if (o.status === 'VOIDED' || o.status === 'CANCELLED' || o.status === 'REFUNDED') return;
    const rawName = o.customerName || o.customer?.name || 'ลูกค้าทั่วไป';
    const cId = o.customerId || o.customer?.id || (rawName !== 'ลูกค้าทั่วไป' ? `NAME_${rawName}` : 'GENERAL');
    const profile = (o.customerId ? customerProfileMap.get(o.customerId) : undefined) || customerProfileMap.get(rawName);

    const cCode = profile?.code || profile?.customerCode || (o.customerId ? o.customerId.slice(-6).toUpperCase() : '-');
    const cName = profile?.name || rawName;
    const cPhone = profile?.phone || o.customerPhone || o.customer?.phone || '-';
    const cPoints = Number(profile?.points || 0);
    const returned = Array.isArray(o.returns) && o.returns.length
      ? o.returns.reduce((s: number, r: any) => s + Number(r.refundAmount || 0), 0)
      : Number(o.returnedAmount || 0);
    const amt = round2(Number(o.totalAmount ?? o.total ?? 0) - returned);
    const orderDate = o.createdAt || o.orderDate || '';

    const existing = customerSpendingMap.get(cId);
    if (!existing) {
      customerSpendingMap.set(cId, {
        id: cId,
        code: cCode,
        name: cName,
        phone: cPhone,
        points: cPoints,
        orderCount: 1,
        totalSpent: amt,
        averageTicket: amt,
        outstandingDebt: debtByCustomerMap.get(o.customerId) || debtByCustomerMap.get(cName) || 0,
        lastOrderDate: orderDate,
      });
    } else {
      existing.orderCount += 1;
      existing.totalSpent += amt;
      existing.totalSpent = round2(existing.totalSpent);
      existing.averageTicket = Math.round(existing.totalSpent / existing.orderCount);
      if (orderDate && (!existing.lastOrderDate || new Date(orderDate) > new Date(existing.lastOrderDate))) {
        existing.lastOrderDate = orderDate;
      }
    }
  });

  // Also include customers in catalog who haven't ordered in this period if debt exists
  (customers || []).forEach((c) => {
    if (c.id && !customerSpendingMap.has(c.id)) {
      const debt = debtByCustomerMap.get(c.id) || debtByCustomerMap.get(c.name) || 0;
      if (debt > 0 || (c.totalSpent && c.totalSpent > 0)) {
        customerSpendingMap.set(c.id, {
          id: c.id,
          code: c.code || c.customerCode || c.id.slice(-6).toUpperCase(),
          name: c.name || 'สมาชิก',
          phone: c.phone || '-',
          points: Number(c.points || 0),
          orderCount: Number(c.totalOrders || 0),
          totalSpent: Number(c.totalSpent || 0),
          averageTicket: (c.totalOrders && c.totalSpent) ? Math.round(c.totalSpent / c.totalOrders) : 0,
          outstandingDebt: debt,
          lastOrderDate: c.lastPurchaseDate || '',
        });
      }
    }
  });

  const allCustomers = Array.from(customerSpendingMap.values()).sort((a, b) => b.totalSpent - a.totalSpent);
  const topCustomers = allCustomers.slice(0, 15);

  // Debts Aging Breakdown
  const now = Date.now();
  let totalOutstandingDebt = 0;

  const buckets: DebtAgingBucket[] = [
    { bucketName: 'อายุบิล 0 - 15 วัน', rangeDays: '0-15', billCount: 0, totalAmount: 0 },
    { bucketName: 'อายุบิล 16 - 30 วัน', rangeDays: '16-30', billCount: 0, totalAmount: 0 },
    { bucketName: 'อายุบิล 31 - 60 วัน', rangeDays: '31-60', billCount: 0, totalAmount: 0 },
    { bucketName: 'อายุบิลเกิน 60 วัน', rangeDays: '60+', billCount: 0, totalAmount: 0 },
  ];

  const unpaidDebts = (debts || []).filter((d) => {
    const rem = Number(d.remainingDebt ?? d.remainingAmount ?? 0);
    return rem > 0 && d.status !== 'PAID';
  });

  unpaidDebts.forEach((debt) => {
    const remaining = Number(debt.remainingDebt ?? debt.remainingAmount ?? 0);
    totalOutstandingDebt += remaining;

    const orderTime = new Date(debt.orderDate || debt.order?.createdAt || debt.createdAt || Date.now()).getTime();
    const daysOld = Math.max(0, Math.floor((now - orderTime) / 86400000));

    if (daysOld <= 15) {
      buckets[0].billCount += 1;
      buckets[0].totalAmount += remaining;
    } else if (daysOld <= 30) {
      buckets[1].billCount += 1;
      buckets[1].totalAmount += remaining;
    } else if (daysOld <= 60) {
      buckets[2].billCount += 1;
      buckets[2].totalAmount += remaining;
    } else {
      buckets[3].billCount += 1;
      buckets[3].totalAmount += remaining;
    }
  });

  return {
    totalOutstandingDebt,
    unpaidBillsCount: unpaidDebts.length,
    agingBuckets: buckets,
    allCustomers,
    topCustomers,
    unpaidDebtsList: unpaidDebts.sort(
      (a, b) => Number(b.remainingDebt ?? b.remainingAmount ?? 0) - Number(a.remainingDebt ?? a.remainingAmount ?? 0)
    ),
  };
}

// ─── 6. Purchases & Supplier Claims Report ───
export interface SupplierPurchaseSummary {
  supplierId: string;
  supplierName: string;
  poCount: number; // POs with goods received in the range
  totalPurchaseAmount: number; // value RECEIVED in the range
  orderedNotReceived: number; // still to be delivered (now)
  remainingPayable: number; // owed now for received goods (same as Finance overview)
  claimsCount: number;
  claimPieces: number;
  claimCostTotal: number;
}

export interface PurchasesData {
  receipts: { createdAt: string; supplierId: string; supplierName: string; poNumber: string; value: number }[];
  open: { supplierId: string; supplierName: string; poNumber: string; value: number }[];
  payable: { supplierId: string; supplierName: string; poNumber: string; amount: number }[];
}

/**
 * Purchases tab (from /reports/analytics `purchases`):
 * - purchases = value of goods RECEIVED in the selected range (by receipt date)
 * - ordered but not yet received = separate column (current, not range-bound)
 * - remaining payable = owed for received goods, same formula as /finance/overview
 * Claims are filtered by the caller to the same range.
 */
export function calculatePurchasesAndClaimsReport(purchases: PurchasesData, claims: any[], suppliers: any[], inRange?: (iso: string) => boolean) {
  const map = new Map<string, SupplierPurchaseSummary>();
  const entry = (id: string, name: string) => {
    let e = map.get(id);
    if (!e) {
      e = { supplierId: id, supplierName: name, poCount: 0, totalPurchaseAmount: 0, orderedNotReceived: 0, remainingPayable: 0, claimsCount: 0, claimPieces: 0, claimCostTotal: 0 };
      map.set(id, e);
    }
    return e;
  };
  (suppliers || []).forEach((s) => entry(s.id, s.name));

  const poSeen = new Map<string, Set<string>>();
  for (const r of purchases?.receipts || []) {
    if (inRange && !inRange(r.createdAt)) continue;
    const e = entry(r.supplierId, r.supplierName);
    e.totalPurchaseAmount += Number(r.value || 0);
    const seen = poSeen.get(r.supplierId) || new Set<string>();
    seen.add(r.poNumber);
    poSeen.set(r.supplierId, seen);
  }
  for (const [id, seen] of poSeen) entry(id, '').poCount = seen.size;
  for (const o of purchases?.open || []) entry(o.supplierId, o.supplierName).orderedNotReceived += Number(o.value || 0);
  for (const p of purchases?.payable || []) entry(p.supplierId, p.supplierName).remainingPayable += Number(p.amount || 0);

  (claims || []).forEach((c) => {
    const e = entry(c.supplierId || 'UNKNOWN', c.supplierName || 'ไม่ระบุผู้จำหน่าย');
    const qty = Number(c.baseQuantity !== undefined ? c.baseQuantity : (c.quantity || 1));
    const cost = Number(c.totalCostValue ?? (c.costPrice ? Number(c.costPrice) * qty : c.totalClaimValue ?? 0));
    e.claimsCount += 1;
    e.claimPieces += qty;
    e.claimCostTotal += cost;
  });

  const list = Array.from(map.values())
    .map((e) => ({
      ...e,
      totalPurchaseAmount: round2(e.totalPurchaseAmount),
      orderedNotReceived: round2(e.orderedNotReceived),
      remainingPayable: round2(e.remainingPayable),
      claimCostTotal: round2(e.claimCostTotal),
    }))
    .filter((s) => s.totalPurchaseAmount > 0 || s.orderedNotReceived > 0 || s.remainingPayable > 0 || s.claimsCount > 0)
    .sort((a, b) => b.totalPurchaseAmount - a.totalPurchaseAmount);

  return {
    totalPurchasesOverall: round2(list.reduce((s, i) => s + i.totalPurchaseAmount, 0)),
    totalOrderedNotReceived: round2(list.reduce((s, i) => s + i.orderedNotReceived, 0)),
    totalRemainingPayable: round2(list.reduce((s, i) => s + i.remainingPayable, 0)),
    totalClaimsCostOverall: round2(list.reduce((s, i) => s + i.claimCostTotal, 0)),
    supplierBreakdown: list,
  };
}
