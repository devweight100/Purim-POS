import { getDebtRecordByOrderId } from '@/lib/debt-service';

// Local shape of an order row as the server returns it on /orders (plus fields this page adds).
// (Candidate for lib/types.ts: the server order differs from the POS `Order` type there.)

export interface OrderRowItem {
  productId?: string;
  name?: string;
  productName?: string;
  sku?: string;
  product?: { name?: string; sku?: string } | null;
  quantity: number;
  unitName?: string;
  unitId?: string;
  unitPrice?: number;
  price?: number;
  lineTotal?: number;
  customPrice?: number | null;
  discountType?: 'none' | 'baht' | 'percent';
  discountValue?: number;
}

export interface OrderRowPayment {
  method: string;
  amount?: number;
  referenceNo?: string;
}

export interface OrderRow {
  id: string;
  orderNumber: string;
  createdAt: string;
  status?: string;
  customerId?: string | null;
  customerName?: string | null;
  customer?: string | { name?: string } | null;
  items?: OrderRowItem[];
  itemCount?: number;
  totalAmount?: number;
  total?: number;
  subtotal?: number;
  billDiscountAmount?: number;
  pointsDiscountAmount?: number;
  payments?: OrderRowPayment[];
  paymentMethod?: string;
  note?: string;
  remarks?: string;
  voidReason?: string;
  hasClaims?: boolean;
  claims?: unknown[];
  isSynced?: boolean;
}

/** Order action opened from a button / menu item (the event only stops the row click). */
export type OrderAction = (order: OrderRow, e?: React.MouseEvent) => void;

// Helper to detect if order is a Credit Sale
export const isOrderCredit = (order: OrderRow | null | undefined): boolean => {
  if (!order) return false;
  if (Array.isArray(order.payments) && order.payments.some((p) => p.method === "CREDIT_DEBT" || p.method === "DEBT" || p.method === "CREDIT_NOTE" || p.method === "CREDIT")) {
    return true;
  }
  const pm = (order.paymentMethod || "").toLowerCase();
  return pm.includes("เชื่อ") || pm.includes("credit") || pm.includes("debt");
};

// Helper to check if a credit order is fully paid
export const isCreditOrderFullyPaid = (order: OrderRow | null): boolean => {
  if (!order || !isOrderCredit(order)) return true;
  const debt = getDebtRecordByOrderId(order.id || order.orderNumber);
  if (!debt) return false;
  return debt.remainingDebt <= 0 && debt.paidAmount > 0;
};
