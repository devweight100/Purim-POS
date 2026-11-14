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

/** Paging fields of a long list (the server sends one page; totals always cover every row). */
export interface ReportPage {
  total: number; // rows matching the search
  page: number;
  limit: number;
}

export interface BestSellersReport extends ReportPage {
  allProducts: ProductPerformance[]; // one page (sort, q, page, limit)
  sort: string;
  productCount: number; // every product sold in the period
  totals: { quantity: number; revenue: number; cost: number; profit: number };
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
  list: InventoryList;
  listCounts: Record<InventoryList, number>;
  items: InventoryValuationItem[]; // one page of `list` (q, page, limit)
  total: number;
  page: number;
  limit: number;
}

export type InventoryList = 'all' | 'deadstock' | 'lowstock';

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

export interface CustomerDebtsReport extends ReportPage {
  totalOutstandingDebt: number;
  unpaidBillsCount: number;
  agingBuckets: DebtAgingBucket[];
  allCustomers: CustomerSpendingSummary[]; // one page (sort, q, page, limit)
  sort: string;
  customerCount: number; // every customer of the period
  totalSpentAll: number;
  topCustomers: CustomerSpendingSummary[];
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

export interface ReportTabsParams {
  range: ReportTimeRange;
  start?: string;
  end?: string;
  tab?: ReportTab;
  // long lists (bestsellers, inventory, customers): one page at a time
  page?: number;
  limit?: number;
  q?: string;
  sort?: string;
  list?: InventoryList;
}

/** Most rows the server sends per page. */
export const REPORT_PAGE_MAX = 500;

export function reportTabsQuery(params: ReportTabsParams): string {
  const q = new URLSearchParams({ range: params.range });
  if (params.range === 'custom') {
    if (params.start) q.set('start', params.start);
    if (params.end) q.set('end', params.end);
  }
  if (params.tab) q.set('tab', params.tab);
  if (params.page) q.set('page', String(params.page));
  if (params.limit) q.set('limit', String(params.limit));
  if (params.q?.trim()) q.set('q', params.q.trim());
  if (params.sort) q.set('sort', params.sort);
  if (params.list && params.list !== 'all') q.set('list', params.list);
  return q.toString();
}

/** Report figures of one tab for a period (custom: YYYY-MM-DD Bangkok days, end inclusive). */
export function fetchReportTabs(params: ReportTabsParams): Promise<ReportTabsResponse> {
  return apiFetch(`/reports/tabs?${reportTabsQuery(params)}`);
}

/** Every row of a paged list: asks page 1, 2, ... (REPORT_PAGE_MAX rows each) until `total` rows are in. */
export async function collectAllPages<T>(fetchPage: (page: number, limit: number) => Promise<{ rows: T[]; total: number }>, limit = REPORT_PAGE_MAX): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; ; page++) {
    const { rows, total } = await fetchPage(page, limit);
    out.push(...rows);
    if (rows.length < limit || out.length >= total) return out;
  }
}

type ListTab = 'bestsellers' | 'inventory' | 'customers';
const LIST_ROWS = { bestsellers: 'allProducts', inventory: 'items', customers: 'allCustomers' } as const;
type ListRow<K extends ListTab> = K extends 'bestsellers' ? ProductPerformance : K extends 'inventory' ? InventoryValuationItem : CustomerSpendingSummary;

/** The whole list of a tab for export (every page; same period, search, sort and list as asked). */
export function fetchAllReportRows<K extends ListTab>(tab: K, params: Omit<ReportTabsParams, 'tab' | 'page' | 'limit'>): Promise<ListRow<K>[]> {
  return collectAllPages(async (page, limit) => {
    const data = (await fetchReportTabs({ ...params, tab, page, limit }))[tab] as unknown as Record<string, unknown> & { total: number };
    return { rows: data[LIST_ROWS[tab]] as ListRow<K>[], total: data.total };
  });
}

// Shown while a tab has not been loaded yet
export const EMPTY_SALES: SalesProfitReport = { totalOrders: 0, totalGrossSales: 0, totalDiscounts: 0, totalNetSales: 0, totalReturns: 0, totalCogs: 0, totalGrossProfit: 0, overallMargin: 0, dailyBreakdown: [] };
export const EMPTY_CLAIMS_AND_VAT: ClaimsAndVat = { replacementCost: 0, refundsPaid: 0, supplierRecovery: 0, claimNetCost: 0, vatAmount: 0, vatSales: 0, vatBase: 0 };
export const EMPTY_BESTSELLERS: BestSellersReport = { allProducts: [], total: 0, page: 1, limit: 15, sort: 'quantity', productCount: 0, totals: { quantity: 0, revenue: 0, cost: 0, profit: 0 }, topByQuantity: [], topByProfit: [], topByRevenue: [] };
export const EMPTY_INVENTORY: InventoryReport = { totalProducts: 0, totalStockPieces: 0, totalCostVal: 0, totalRetailVal: 0, totalPotentialProfit: 0, deadstockPieces: 0, deadstockCostVal: 0, lowStockCount: 0, lowStockThreshold: 5, list: 'all', listCounts: { all: 0, deadstock: 0, lowstock: 0 }, items: [], total: 0, page: 1, limit: 15 };
export const EMPTY_PAYMENTS: PaymentsShiftsReport = { totalCollected: 0, salesCollected: 0, debtReceived: 0, creditSales: 0, refunds: 0, channels: [], shifts: { totalShiftsCount: 0, totalExpectedCash: 0, totalActualCash: 0, totalCashDiscrepancy: 0, balancedShifts: 0, shortShifts: 0, overShifts: 0 } };
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
  total: 0,
  page: 1,
  limit: 15,
  sort: 'spent',
  customerCount: 0,
  totalSpentAll: 0,
  topCustomers: [],
};
export const EMPTY_PURCHASES: PurchasesClaimsReport = { totalPurchasesOverall: 0, totalOrderedNotReceived: 0, totalRemainingPayable: 0, totalClaimsCostOverall: 0, supplierBreakdown: [] };
