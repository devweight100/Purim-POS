/**
 * Shapes of the API responses read by the mobile summary page (only the fields it shows).
 * Local types (candidates for lib/types.ts). Money Decimals arrive as strings, hence `Num`.
 */
export type Num = number | string | null | undefined;

/** GET /reports/dashboard (with top=10&compare=1) */
export interface MobileDashboard {
  period?: { range: string; from: string | null; to: string; bucket?: 'day' | 'month' };
  sales?: {
    netSales?: Num; completedCount?: Num; averageBasket?: Num; returnsAmount?: Num; returnCount?: Num;
    voidedCount?: Num; voidedAmount?: Num; unitsSoldNet?: Num; discounts?: Num;
  };
  payments?: { cash?: Num; qrTransfer?: Num; credit?: Num; card?: Num; other?: Num };
  timeline?: { date: string; netSales?: Num; orders?: Num }[];
  hourly?: { hour: number; netSales: number; orders: number }[] | null;
  previous?: { from: string; to: string; netSales: number; completedCount: number; averageBasket: number; returnsAmount: number } | null;
  topProducts?: { productId?: string; name: string; sku?: string; quantity?: Num; revenue?: Num }[];
  receivables?: { totalPending?: Num; billCount?: Num };
  inventory?: { lowStockCount?: Num; outOfStockCount?: Num; lowStockThreshold?: Num };
}

export interface LookupPack {
  name: string;
  qtyPerPrev: number;
  factor: number;
  barcode: string | null;
  prices: (number | null)[];
}

/** GET /products/lookup */
export interface LookupProduct {
  id: string;
  name: string;
  sku: string;
  unit: string;
  category: string | null;
  isBundle: boolean;
  barcodes: string[];
  stock: number;
  stockLevel: 'out' | 'low' | 'ok' | null;
  prices: (number | null)[];
  packs: LookupPack[];
  wholesalePrices: { minQuantity: number; unitPrice: number }[];
  /** only for users who may see cost (ADMIN / VIEW_COST) */
  costPrice?: number;
}

export interface LookupResponse {
  data: LookupProduct[];
  meta: { total: number; page: number; limit: number; totalPages: number; lowStockThreshold: number; counts: { all: number; low: number; out: number } };
  canViewCost: boolean;
}

export interface MobileOrderListRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  status: string;
  totalAmount: Num;
  returnedAmount?: Num;
  customer?: { name?: string | null } | null;
  payments?: { method: string; amount: Num }[];
  items?: unknown[];
  returns?: unknown[];
}

/** GET /orders */
export interface MobileOrderList {
  data: MobileOrderListRow[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

/** GET /orders/:id */
export interface MobileOrderDetail extends MobileOrderListRow {
  subtotal?: Num;
  discountAmount?: Num;
  vatRate?: Num;
  vatAmount?: Num;
  note?: string | null;
  voidReason?: string | null;
  pointsUsed?: number;
  user?: { fullName?: string | null; username?: string | null } | null;
  customer?: { name?: string | null; phone?: string | null } | null;
  items?: {
    id: string;
    quantity: Num;
    unitName?: string | null;
    unitPrice: Num;
    discountAmount?: Num;
    total: Num;
    product?: { name?: string | null; sku?: string | null; unit?: string | null } | null;
  }[];
  payments?: { id?: string; method: string; amount: Num; referenceNo?: string | null }[];
  returns?: { id?: string; returnNumber: string; createdAt: string; refundAmount: Num; refundMethod: string; reason?: string | null }[];
  debt?: { remainingAmount?: Num; status?: string } | null;
}

/** GET /shifts/history row */
export interface MobileShift {
  id: string;
  shiftNumber?: string | null;
  userName?: string;
  openedAt: string;
  closedAt: string | null;
  isOpen: boolean;
  openingCash?: number;
  expectedCash?: number;
  actualCash?: number | null;
  difference?: number | null;
  totalSales?: number;
  netSales?: number;
  cashSales?: number;
  orderCount?: number;
  ordersCount?: number;
  terminalId?: string | null;
}
