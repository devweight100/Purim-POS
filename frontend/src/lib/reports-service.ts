import { useProductStore } from './store/product-store';
import { loadAllClaimRecords } from './claim-service';
import { loadPurchaseOrders, loadSuppliers } from './supplier-return-service';
import { loadAllDebtRecords } from './debt-service';
import { loadCustomers } from './customer-service';
import { loadAllShiftSummaries } from './shift-service';
import { orders as mockOrders } from './mock-data';

export type ReportTimeRange = 'today' | 'yesterday' | '7days' | '30days' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'all' | 'custom';

// ─── Helper to Load Orders ───
export function loadAllOrders(): any[] {
  if (typeof window === 'undefined') return mockOrders || [];
  try {
    const raw = localStorage.getItem('pos_orders');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    }
  } catch {}
  return mockOrders || [];
}

// ─── Filter Orders by Time Range ───
export function filterOrdersByDateRange(
  orders: any[],
  timeRange: ReportTimeRange,
  customStart?: string,
  customEnd?: string
): any[] {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const endOfToday = startOfToday + 86400000 - 1;

  return orders.filter((o) => {
    const d = new Date(o.createdAt || o.orderDate || Date.now()).getTime();
    if (isNaN(d)) return true;

    switch (timeRange) {
      case 'today':
        return d >= startOfToday && d <= endOfToday;
      case 'yesterday': {
        const startYesterday = startOfToday - 86400000;
        const endYesterday = startOfToday - 1;
        return d >= startYesterday && d <= endYesterday;
      }
      case '7days':
        return d >= startOfToday - 6 * 86400000 && d <= endOfToday;
      case '30days':
        return d >= startOfToday - 29 * 86400000 && d <= endOfToday;
      case 'thisMonth': {
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
        return d >= startOfMonth && d <= endOfToday;
      }
      case 'lastMonth': {
        const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1).getTime();
        const endOfLastMonth = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).getTime();
        return d >= startOfLastMonth && d <= endOfLastMonth;
      }
      case 'thisYear': {
        const startOfYear = new Date(now.getFullYear(), 0, 1).getTime();
        return d >= startOfYear && d <= endOfToday;
      }
      case 'custom': {
        if (!customStart && !customEnd) return true;
        const start = customStart ? new Date(`${customStart}T00:00:00`).getTime() : 0;
        const end = customEnd ? new Date(`${customEnd}T23:59:59`).getTime() : Infinity;
        return d >= start && d <= end;
      }
      case 'all':
      default:
        return true;
    }
  });
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

export function calculateSalesAndProfitReport(orders: any[], productsCatalog: any[]) {
  const productCostMap = new Map<string, number>();
  productsCatalog.forEach((p) => {
    const cost = Number(p.costPrice || p.basePrice || 0);
    if (p.id) productCostMap.set(p.id, cost);
    if (p.sku) productCostMap.set(p.sku, cost);
    if (p.name) productCostMap.set(p.name, cost);
  });

  const dailyMap = new Map<string, DailySalesProfit>();

  let totalGrossSales = 0;
  let totalDiscounts = 0;
  let totalNetSales = 0;
  let totalCogs = 0;

  orders.forEach((order) => {
    if (order.status === 'VOIDED' || order.status === 'CANCELLED') return;

    const orderDateStr = (order.createdAt || order.orderDate || new Date().toISOString()).slice(0, 10);
    const net = Number(order.totalAmount || order.total || 0);
    const disc = Number(order.discountAmount || order.discount || 0);
    const gross = net + disc;

    let orderCost = 0;
    (order.items || []).forEach((item: any) => {
      const qty = Number(item.quantity || 1);
      let itemCost = Number(item.costPrice || 0);
      if (itemCost <= 0) {
        itemCost = productCostMap.get(item.productId) || productCostMap.get(item.sku) || productCostMap.get(item.productName) || 0;
      }
      if (itemCost <= 0) {
        // Estimate 70% if cost is zero
        itemCost = Number(item.unitPrice || item.price || 0) * 0.7;
      }
      orderCost += itemCost * qty;
    });

    totalGrossSales += gross;
    totalDiscounts += disc;
    totalNetSales += net;
    totalCogs += orderCost;

    const existing = dailyMap.get(orderDateStr);
    if (!existing) {
      dailyMap.set(orderDateStr, {
        date: orderDateStr,
        orderCount: 1,
        grossSales: gross,
        discounts: disc,
        netSales: net,
        cogs: orderCost,
        grossProfit: net - orderCost,
        profitMarginPercent: net > 0 ? Math.round(((net - orderCost) / net) * 1000) / 10 : 0,
      });
    } else {
      existing.orderCount += 1;
      existing.grossSales += gross;
      existing.discounts += disc;
      existing.netSales += net;
      existing.cogs += orderCost;
      existing.grossProfit = existing.netSales - existing.cogs;
      existing.profitMarginPercent = existing.netSales > 0 ? Math.round((existing.grossProfit / existing.netSales) * 1000) / 10 : 0;
    }
  });

  const dailyList = Array.from(dailyMap.values()).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  const totalGrossProfit = totalNetSales - totalCogs;
  const overallMargin = totalNetSales > 0 ? Math.round((totalGrossProfit / totalNetSales) * 1000) / 10 : 0;

  return {
    totalOrders: orders.filter((o) => o.status !== 'VOIDED' && o.status !== 'CANCELLED').length,
    totalGrossSales,
    totalDiscounts,
    totalNetSales,
    totalCogs,
    totalGrossProfit,
    overallMargin,
    dailyBreakdown: dailyList,
  };
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

export function calculateBestSellingProducts(orders: any[], productsCatalog: any[]) {
  const productCostMap = new Map<string, number>();
  const productCategoryMap = new Map<string, string>();
  const productNameMap = new Map<string, string>();
  const productSkuMap = new Map<string, string>();
  const productUnitMap = new Map<string, string>();

  productsCatalog.forEach((p) => {
    const cost = Number(p.costPrice || p.basePrice || 0);
    const cat = p.category || 'ทั่วไป';
    const name = p.name || '';
    const sku = p.sku || '-';
    const unit = p.unitName || p.units?.[0]?.name || 'ชิ้น';

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
  });

  const map = new Map<string, ProductPerformance>();

  orders.forEach((order) => {
    if (order.status === 'VOIDED' || order.status === 'CANCELLED') return;

    (order.items || []).forEach((item: any) => {
      // Prioritize item.name (used in POS and mock data), item.productName, or lookup from productsCatalog
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
      const price = Number(item.unitPrice || item.price || 0);
      const revenue = Number(item.subtotal || price * qty);

      let cost = Number(item.costPrice || 0);
      if (cost <= 0) {
        cost =
          productCostMap.get(item.productId) ||
          productCostMap.get(resolvedSku) ||
          productCostMap.get(resolvedName) ||
          0;
      }
      if (cost <= 0) cost = price * 0.7;

      const totalItemCost = cost * qty;
      const profit = revenue - totalItemCost;
      const category =
        item.category ||
        productCategoryMap.get(item.productId) ||
        productCategoryMap.get(resolvedSku) ||
        'ทั่วไป';

      const unitName =
        item.unitName ||
        item.unit ||
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
          quantitySold: qty,
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
        existing.quantitySold += qty;
        existing.totalRevenue += revenue;
        existing.totalCost += totalItemCost;
        existing.totalProfit = existing.totalRevenue - existing.totalCost;
        existing.profitMarginPercent =
          existing.totalRevenue > 0 ? Math.round((existing.totalProfit / existing.totalRevenue) * 1000) / 10 : 0;
      }
    });
  });

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
  isDeadstock: boolean; // No sale in 30+ days or never sold
  isLowStock: boolean;
}

export function calculateInventoryValuationReport(products: any[], orders: any[]) {
  const lastSoldDateMap = new Map<string, number>();

  orders.forEach((o) => {
    if (o.status === 'VOIDED' || o.status === 'CANCELLED') return;
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

  const items: InventoryValuationItem[] = products.map((p) => {
    const stock = Math.max(0, Number(p.stock || p.quantity || 0));
    const cost = Number(p.costPrice || p.basePrice || (p.price ? p.price * 0.7 : 0));
    const retail = Number(p.price || p.basePrice || 0);

    const costVal = stock * cost;
    const retailVal = stock * retail;
    const potentialProfit = retailVal - costVal;

    const lastSaleTime = lastSoldDateMap.get(p.id) || lastSoldDateMap.get(p.sku) || 0;
    const daysSinceLastSale = lastSaleTime > 0 ? Math.floor((nowTime - lastSaleTime) / 86400000) : 999;
    const isDeadstock = stock > 0 && daysSinceLastSale >= 30;
    const isLowStock = stock <= (p.minStock || 5);

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
      category: p.category || 'ทั่วไป',
      supplierName: p.supplierName || (typeof p.supplier === 'object' ? p.supplier?.name : p.supplier) || 'ทั่วไป',
      stock,
      unitName: p.unitName || p.units?.[0]?.name || 'ชิ้น',
      costPrice: cost,
      retailPrice: retail,
      totalCostValue: costVal,
      totalRetailValue: retailVal,
      potentialProfit,
      daysSinceLastSale,
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

export function calculatePaymentsAndShiftsReport(orders: any[], shiftsHistory: any[]) {
  const methodMap = new Map<string, { label: string; count: number; amount: number }>();

  methodMap.set('CASH', { label: 'เงินสด (Cash)', count: 0, amount: 0 });
  methodMap.set('QR_PROMPTPAY', { label: 'สแกน QR PromptPay (โอน)', count: 0, amount: 0 });
  methodMap.set('CREDIT_CARD', { label: 'บัตรเครดิต / เดบิต', count: 0, amount: 0 });
  methodMap.set('CREDIT', { label: 'เงินเชื่อ / ค้างชำระ (ลูกหนี้)', count: 0, amount: 0 });
  methodMap.set('OTHER', { label: 'ช่องทางอื่นๆ', count: 0, amount: 0 });

  let totalCollected = 0;

  orders.forEach((o) => {
    if (o.status === 'VOIDED' || o.status === 'CANCELLED') return;

    if (Array.isArray(o.payments) && o.payments.length > 0) {
      o.payments.forEach((p: any) => {
        const amt = Number(p.amount || 0);
        totalCollected += amt;
        const m = p.method === 'CREDIT_NOTE' ? 'CREDIT' : (p.method || 'OTHER');
        const entry = methodMap.get(m) || methodMap.get('OTHER')!;
        entry.count += 1;
        entry.amount += amt;
      });
    } else {
      const amt = Number(o.totalAmount || o.total || 0);
      totalCollected += amt;
      const m = o.paymentMethod || 'CASH';
      const entry = methodMap.get(m) || methodMap.get('OTHER')!;
      entry.count += 1;
      entry.amount += amt;
    }
  });

  const channels: PaymentChannelBreakdown[] = Array.from(methodMap.entries())
    .map(([method, data]) => ({
      method,
      label: data.label,
      orderCount: data.count,
      totalAmount: data.amount,
      percentage: totalCollected > 0 ? Math.round((data.amount / totalCollected) * 1000) / 10 : 0,
    }))
    .filter((c) => c.totalAmount > 0);

  // Shift discrepancy summary
  const shifts = Array.isArray(shiftsHistory) ? shiftsHistory : [];
  const totalShiftsCount = shifts.length;
  let totalExpectedCash = 0;
  let totalActualCash = 0;
  let totalCashDiscrepancy = 0;
  let balancedShifts = 0;
  let shortShifts = 0;
  let overShifts = 0;

  shifts.forEach((s) => {
    const exp = Number(s.expectedCash || 0);
    const act = Number(s.actualCash || 0);
    const diff = act - exp;

    totalExpectedCash += exp;
    totalActualCash += act;
    totalCashDiscrepancy += diff;

    if (diff === 0) balancedShifts += 1;
    else if (diff < 0) shortShifts += 1;
    else overShifts += 1;
  });

  return {
    totalCollected,
    channels,
    shifts: {
      totalShiftsCount,
      totalExpectedCash,
      totalActualCash,
      totalCashDiscrepancy,
      balancedShifts,
      shortShifts,
      overShifts,
      list: shifts,
    },
  };
}

// ─── 5. Customer & Debts Aging Report ───
export interface DebtAgingBucket {
  bucketName: string;
  rangeDays: string;
  billCount: number;
  totalAmount: number;
}

export function calculateCustomerAndDebtsReport(orders: any[], debts: any[], customers: any[]) {
  const customerSpendingMap = new Map<string, { id: string; name: string; phone: string; orderCount: number; totalSpent: number }>();

  orders.forEach((o) => {
    if (o.status === 'VOIDED' || o.status === 'CANCELLED') return;
    const cId = o.customerId || o.customerName || 'GENERAL';
    const cName = o.customerName || 'ลูกค้าทั่วไป';
    const cPhone = o.customerPhone || '-';
    const amt = Number(o.totalAmount || o.total || 0);

    const existing = customerSpendingMap.get(cId);
    if (!existing) {
      customerSpendingMap.set(cId, {
        id: cId,
        name: cName,
        phone: cPhone,
        orderCount: 1,
        totalSpent: amt,
      });
    } else {
      existing.orderCount += 1;
      existing.totalSpent += amt;
    }
  });

  const topCustomers = Array.from(customerSpendingMap.values()).sort((a, b) => b.totalSpent - a.totalSpent);

  // Debts Aging Breakdown
  const now = Date.now();
  let totalOutstandingDebt = 0;

  const buckets: DebtAgingBucket[] = [
    { bucketName: 'หนี้ใหม่ (0 - 15 วัน)', rangeDays: '0-15', billCount: 0, totalAmount: 0 },
    { bucketName: 'หนี้ปกติ (16 - 30 วัน)', rangeDays: '16-30', billCount: 0, totalAmount: 0 },
    { bucketName: 'หนี้เริ่มค้าง (31 - 60 วัน)', rangeDays: '31-60', billCount: 0, totalAmount: 0 },
    { bucketName: 'หนี้ค้างนาน / เกินกำหนด (> 60 วัน)', rangeDays: '60+', billCount: 0, totalAmount: 0 },
  ];

  const unpaidDebts = debts.filter((d) => d.remainingDebt > 0 && d.status !== 'PAID');

  unpaidDebts.forEach((debt) => {
    const remaining = Number(debt.remainingDebt || 0);
    totalOutstandingDebt += remaining;

    const orderTime = new Date(debt.orderDate || Date.now()).getTime();
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
    topCustomers: topCustomers.slice(0, 15),
    unpaidDebtsList: unpaidDebts.sort((a, b) => b.remainingDebt - a.remainingDebt),
  };
}

// ─── 6. Purchases & Supplier Claims Report ───
export interface SupplierPurchaseSummary {
  supplierId: string;
  supplierName: string;
  poCount: number;
  totalPurchaseAmount: number;
  totalPaidAmount: number;
  remainingPayable: number;
  claimsCount: number;
  claimPieces: number;
  claimCostTotal: number;
}

export function calculatePurchasesAndClaimsReport(purchaseOrders: any[], claims: any[], suppliers: any[]) {
  const map = new Map<string, SupplierPurchaseSummary>();

  // Populate from suppliers catalog
  suppliers.forEach((s) => {
    map.set(s.id, {
      supplierId: s.id,
      supplierName: s.name,
      poCount: 0,
      totalPurchaseAmount: 0,
      totalPaidAmount: 0,
      remainingPayable: 0,
      claimsCount: 0,
      claimPieces: 0,
      claimCostTotal: 0,
    });
  });

  // Aggregate Purchase Orders
  purchaseOrders.forEach((po) => {
    if (po.status === 'CANCELLED' || po.status === 'DRAFT') return;
    const suppId = po.supplierId || po.supplier?.id || 'UNKNOWN';
    const suppName = po.supplierName || po.supplier?.name || 'ไม่ระบุผู้จำหน่าย';
    const total = Number(po.totalAmount || 0);

    let entry = map.get(suppId);
    if (!entry) {
      entry = {
        supplierId: suppId,
        supplierName: suppName,
        poCount: 0,
        totalPurchaseAmount: 0,
        totalPaidAmount: 0,
        remainingPayable: 0,
        claimsCount: 0,
        claimPieces: 0,
        claimCostTotal: 0,
      };
      map.set(suppId, entry);
    }

    entry.poCount += 1;
    entry.totalPurchaseAmount += total;
    entry.remainingPayable += Number(po.remainingPayable || (total - Number(po.paidAmount || 0)));
    entry.totalPaidAmount += Number(po.paidAmount || (total - Number(po.remainingPayable || 0)));
  });

  // Aggregate Claims
  claims.forEach((c) => {
    const suppId = c.supplierId || 'UNKNOWN';
    let entry = map.get(suppId);
    if (!entry) {
      entry = {
        supplierId: suppId,
        supplierName: c.supplierName || 'ไม่ระบุผู้จำหน่าย',
        poCount: 0,
        totalPurchaseAmount: 0,
        totalPaidAmount: 0,
        remainingPayable: 0,
        claimsCount: 0,
        claimPieces: 0,
        claimCostTotal: 0,
      };
      map.set(suppId, entry);
    }

    const qty = Number(c.baseQuantity !== undefined ? c.baseQuantity : (c.quantity || 1));
    const cost = Number(c.totalCostValue || (c.costPrice ? c.costPrice * qty : c.totalClaimValue || 0));

    entry.claimsCount += 1;
    entry.claimPieces += qty;
    entry.claimCostTotal += cost;
  });

  const list = Array.from(map.values())
    .filter((s) => s.poCount > 0 || s.claimsCount > 0)
    .sort((a, b) => b.totalPurchaseAmount - a.totalPurchaseAmount);

  const totalPurchasesOverall = list.reduce((s, i) => s + i.totalPurchaseAmount, 0);
  const totalClaimsCostOverall = list.reduce((s, i) => s + i.claimCostTotal, 0);

  return {
    totalPurchasesOverall,
    totalClaimsCostOverall,
    supplierBreakdown: list,
  };
}
