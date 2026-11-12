/**
 * Reports page data. Every figure is computed by the server (GET /api/reports/tabs, see
 * backend/src/reports/report-tabs.ts); this file only describes the response and fetches it.
 * The browser no longer downloads orders / claims / debts / shifts to add them up itself.
 */
import { apiFetch } from './api';
import type { ReportTimeRange } from '@shared/bangkok-date';

export type { ReportTimeRange };

export type ReportTab = 'sales' | 'bestsellers' | 'inventory' | 'payments' | 'customers' | 'purchases';

// ─── 1. Sales & Gross Profit ───
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

export interface SalesProfitReport {
  totalOrders: number;
  totalGrossSales: number;
  totalDiscounts: number;
  totalNetSales: number;
  totalReturns: number;
  totalCogs: number;
  totalGrossProfit: number;
  overallMargin: number;
  dailyBreakdown: DailySalesProfit[];
}

/** Net profit after claims + output VAT (Sales tab). */
export interface ClaimsAndVat {
  replacementCost: number;
  refundsPaid: number;
  supplierRecovery: number;
  claimNetCost: number;
  vatAmount: number;
  vatSales: number;
  vatBase: number;
}

// ─── 2. Best sellers ───
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

export interface BestSellersReport {
  allProducts: ProductPerformance[];
  topByQuantity: ProductPerformance[];
  topByProfit: ProductPerformance[];
  topByRevenue: ProductPerformance[];
}

// ─── 3. Inventory valuation & deadstock ───
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

export interface InventoryReport {
  totalProducts: number;
  totalStockPieces: number;
  totalCostVal: number;
  totalRetailVal: number;
  totalPotentialProfit: number;
  deadstockPieces: number;
  deadstockCostVal: number;
  lowStockCount: number;
  lowStockThreshold: number;
  items: InventoryValuationItem[];
  deadstockList: InventoryValuationItem[];
  lowStockList: InventoryValuationItem[];
}

// ─── 4. Payment channels & shifts ───
export interface PaymentChannelBreakdown {
  method: string;
  label: string;
  orderCount: number;
  totalAmount: number;
  percentage: number;
}

export interface PaymentsShiftsReport {
  totalCollected: number;
  salesCollected: number;
  debtReceived: number;
  creditSales: number;
  refunds: number;
  channels: PaymentChannelBreakdown[];
  shifts: {
    totalShiftsCount: number;
    totalExpectedCash: number;
    totalActualCash: number;
    totalCashDiscrepancy: number;
    balancedShifts: number;
    shortShifts: number;
    overShifts: number;
    list: unknown[]; // the shifts' history rows (not read by the frontend)
  };
}

// ─── 5. Customers & debt aging ───
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

export interface CustomerDebtsReport {
  totalOutstandingDebt: number;
  unpaidBillsCount: number;
  agingBuckets: DebtAgingBucket[];
  allCustomers: CustomerSpendingSummary[];
  topCustomers: CustomerSpendingSummary[];
  unpaidDebtsList: unknown[]; // the unpaid debt rows (not read by the frontend)
}

// ─── 6. Purchases & supplier claims ───
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

export interface PurchasesClaimsReport {
  totalPurchasesOverall: number;
  totalOrderedNotReceived: number;
  totalRemainingPayable: number;
  totalClaimsCostOverall: number;
  supplierBreakdown: SupplierPurchaseSummary[];
}

/** GET /reports/tabs: only the requested tab is present (all tabs when no tab is given). */
export interface ReportTabsResponse {
  period: { range: ReportTimeRange; start: string | null; end: string | null; endExclusive: boolean; timezone: string };
  sales?: SalesProfitReport;
  claimsAndVat?: ClaimsAndVat;
  bestsellers?: BestSellersReport;
  inventory?: InventoryReport;
  payments?: PaymentsShiftsReport;
  customers?: CustomerDebtsReport;
  purchases?: PurchasesClaimsReport;
}

/** Report figures of one tab for a period (custom: YYYY-MM-DD Bangkok days, end inclusive). */
export function fetchReportTabs(params: { range: ReportTimeRange; start?: string; end?: string; tab?: ReportTab }): Promise<ReportTabsResponse> {
  const q = new URLSearchParams({ range: params.range });
  if (params.range === 'custom') {
    if (params.start) q.set('start', params.start);
    if (params.end) q.set('end', params.end);
  }
  if (params.tab) q.set('tab', params.tab);
  return apiFetch(`/reports/tabs?${q.toString()}`);
}

// Shown while a tab has not been loaded yet
export const EMPTY_SALES: SalesProfitReport = { totalOrders: 0, totalGrossSales: 0, totalDiscounts: 0, totalNetSales: 0, totalReturns: 0, totalCogs: 0, totalGrossProfit: 0, overallMargin: 0, dailyBreakdown: [] };
export const EMPTY_CLAIMS_AND_VAT: ClaimsAndVat = { replacementCost: 0, refundsPaid: 0, supplierRecovery: 0, claimNetCost: 0, vatAmount: 0, vatSales: 0, vatBase: 0 };
export const EMPTY_BESTSELLERS: BestSellersReport = { allProducts: [], topByQuantity: [], topByProfit: [], topByRevenue: [] };
export const EMPTY_INVENTORY: InventoryReport = { totalProducts: 0, totalStockPieces: 0, totalCostVal: 0, totalRetailVal: 0, totalPotentialProfit: 0, deadstockPieces: 0, deadstockCostVal: 0, lowStockCount: 0, lowStockThreshold: 5, items: [], deadstockList: [], lowStockList: [] };
export const EMPTY_PAYMENTS: PaymentsShiftsReport = { totalCollected: 0, salesCollected: 0, debtReceived: 0, creditSales: 0, refunds: 0, channels: [], shifts: { totalShiftsCount: 0, totalExpectedCash: 0, totalActualCash: 0, totalCashDiscrepancy: 0, balancedShifts: 0, shortShifts: 0, overShifts: 0, list: [] } };
export const EMPTY_CUSTOMERS: CustomerDebtsReport = {
  totalOutstandingDebt: 0,
  unpaidBillsCount: 0,
  agingBuckets: [
    { bucketName: '', rangeDays: '', billCount: 0, totalAmount: 0 },
    { bucketName: '', rangeDays: '', billCount: 0, totalAmount: 0 },
    { bucketName: '', rangeDays: '', billCount: 0, totalAmount: 0 },
    { bucketName: '', rangeDays: '', billCount: 0, totalAmount: 0 },
  ],
  allCustomers: [],
  topCustomers: [],
  unpaidDebtsList: [],
};
export const EMPTY_PURCHASES: PurchasesClaimsReport = { totalPurchasesOverall: 0, totalOrderedNotReceived: 0, totalRemainingPayable: 0, totalClaimsCostOverall: 0, supplierBreakdown: [] };
