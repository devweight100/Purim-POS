/**
 * One mapping from an order (backend response or a locally kept POS order) to the data the
 * printed documents need. Every reprint entry point (orders page, POS order history, document
 * search, payment edit) uses it, so they all print the same receipt.
 *
 * Backend order fields: subtotal (= sum of items[].total, line discounts already taken off),
 * discountAmount (bill + points + claim discount), items[].total, items[].product.name,
 * user.fullName, customer.name, payments[], debt.remainingAmount, pointsUsed/pointsEarned.
 */
import type { ReceiptData } from '@/components/pos/ThermalReceiptView';
import type { ReceiptA4Data } from '@/components/pos/ReceiptA4PdfModal';

/** Thai labels for every payment method the system knows (backend enum + POS aliases). */
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'เงินสด',
  QR_PROMPTPAY: 'QR พร้อมเพย์',
  QR: 'QR พร้อมเพย์',
  PROMPTPAY: 'QR พร้อมเพย์',
  TRANSFER: 'โอนเงิน',
  BANK_TRANSFER: 'โอนเงิน',
  CREDIT_CARD: 'บัตรเครดิต',
  CARD: 'บัตรเครดิต',
  CREDIT_DEBT: 'ค้างชำระ (เงินเชื่อ)',
  DEBT: 'ค้างชำระ (เงินเชื่อ)',
  CREDIT: 'ค้างชำระ (เงินเชื่อ)',
  CREDIT_NOTE: 'ใบลดหนี้ (Credit Note)',
  SPLIT: 'แบ่งชำระหลายช่องทาง',
  STORE_CREDIT: 'เครดิตร้านค้า',
};

const CREDIT_METHODS = new Set(['CREDIT_DEBT', 'DEBT', 'CREDIT']);

export function paymentMethodLabel(method: string | null | undefined): string {
  if (!method) return '-';
  return PAYMENT_METHOD_LABELS[String(method).toUpperCase()] || String(method);
}

export function isCreditMethod(method: string | null | undefined): boolean {
  return !!method && CREDIT_METHODS.has(String(method).toUpperCase());
}

export interface MappedPayment {
  method: string;
  amount: number;
  referenceNo?: string;
}

/** Single headline for "ชำระโดย" from the list of payments. */
export function summarizePaymentMethods(payments: MappedPayment[], fallback?: string): string {
  const paid = payments.filter((p) => p.amount > 0);
  const list = paid.length ? paid : payments;
  if (list.length > 1) return 'แบ่งชำระ (Split Payment)';
  if (list.length === 1) return paymentMethodLabel(list[0].method);
  return fallback ? paymentMethodLabel(fallback) : '-';
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const round2 = (n: number) => Math.round(n * 100) / 100;

function mapPayments(order: any): MappedPayment[] {
  if (Array.isArray(order?.payments)) {
    return order.payments
      .filter((p: any) => p && typeof p === 'object')
      .map((p: any) => ({
        method: String(p.method || 'CASH'),
        amount: num(p.amount),
        referenceNo: p.referenceNo || undefined,
      }));
  }
  return [];
}

interface MappedLine {
  sku?: string;
  name: string;
  quantity: number;
  unitName: string;
  unitPrice: number;
  discountAmount: number;
  lineTotal: number;
  itemNote?: string;
  bundleData?: any;
}

function mapItems(order: any): MappedLine[] {
  return (order?.items || []).map((it: any) => {
    const quantity = num(it.quantity) || 1;
    const unitPrice = num(it.unitPrice ?? it.price);
    const discountAmount = num(it.discountAmount);
    // backend: items[].total ; local POS order: lineTotal ; else compute net of line discount
    const rawTotal = it.total ?? it.lineTotal;
    const lineTotal = rawTotal !== undefined && rawTotal !== null && rawTotal !== ''
      ? num(rawTotal)
      : round2(quantity * unitPrice - discountAmount);
    return {
      sku: it.product?.sku || it.sku || it.code || undefined,
      name: it.product?.name || it.name || it.productName || 'สินค้า',
      quantity,
      unitName: it.unitName || it.product?.unit || 'ชิ้น',
      unitPrice,
      discountAmount,
      lineTotal,
      itemNote: it.itemNote || it.note || undefined,
      bundleData: it.bundleData && typeof it.bundleData === 'object' ? it.bundleData : undefined,
    };
  });
}

export interface ReceiptMapOptions {
  /** reprint of an existing bill: thermal shows "พิมพ์ซ้ำ", A4 shows "สำเนา (COPY)" */
  isReprint?: boolean;
  /** when the reprint is made (defaults to now) */
  reprintedAt?: string;
  /** customer record with address / tax id (A4) */
  customer?: any;
  /** override what the payments were (payment edit) */
  payments?: MappedPayment[];
  cashReceived?: number;
  changeAmount?: number;
}

/** Common fields of thermal + A4 receipts. */
function mapCommon(order: any, opts: ReceiptMapOptions) {
  const items = mapItems(order);
  const payments = opts.payments ?? mapPayments(order);
  const totalAmount = round2(num(order?.totalAmount ?? order?.total));
  const lineSum = round2(items.reduce((s, i) => s + i.lineTotal, 0));

  // Local POS orders keep the discounts separately; backend orders have one discountAmount.
  const isLocalShape = order && typeof order.billDiscountAmount === 'number';
  let billDiscountAmount = isLocalShape ? num(order.billDiscountAmount) : num(order?.discountAmount);
  const pointsDiscountAmount = isLocalShape ? num(order.pointsDiscountAmount) : 0;
  const claimDiscountAmount = isLocalShape ? num(order.claimDiscountAmount) : 0;

  // Lines must add up to the subtotal; the discount is whatever lies between subtotal and total.
  const subtotal = items.length > 0 ? lineSum : round2(num(order?.subtotal ?? totalAmount));
  const expectedDiscount = round2(subtotal - totalAmount);
  if (Math.abs(subtotal - billDiscountAmount - pointsDiscountAmount - claimDiscountAmount - totalAmount) > 0.01 && expectedDiscount >= 0) {
    billDiscountAmount = round2(expectedDiscount - pointsDiscountAmount - claimDiscountAmount);
    if (billDiscountAmount < 0) billDiscountAmount = 0;
  }

  const creditPaid = round2(payments.filter((p) => isCreditMethod(p.method)).reduce((s, p) => s + p.amount, 0));
  const debtRemaining = order?.debt && order.debt.remainingAmount !== undefined ? num(order.debt.remainingAmount) : undefined;
  const outstandingAmount = creditPaid > 0 ? (debtRemaining ?? creditPaid) : undefined;

  const cashReceived = opts.cashReceived ?? (num(order?.cashReceived ?? order?.payments?.[0]?.cashReceived) || undefined);
  const changeAmount = opts.changeAmount ?? (num(order?.changeAmount ?? order?.payments?.[0]?.changeAmount) || undefined);

  const pointsUsed = num(order?.pointsUsed) || undefined;
  const pointsEarnedRaw = order?.customerPointsEarned ?? order?.pointsEarned;
  const customerPointsEarned = pointsEarnedRaw !== undefined && pointsEarnedRaw !== null ? num(pointsEarnedRaw) : undefined;
  const balanceRaw = order?.customerPointsBalance;
  const customerPointsBalance = balanceRaw !== undefined && balanceRaw !== null ? num(balanceRaw) : undefined;

  const customerName: string | null =
    order?.customer && typeof order.customer === 'object'
      ? order.customer.name || order.customerName || null
      : order?.customerName || (typeof order?.customer === 'string' ? order.customer : null);

  return {
    orderNumber: String(order?.orderNumber || order?.id || '-'),
    createdAt: String(order?.createdAt || new Date().toISOString()),
    customerName,
    userName: order?.user?.fullName || order?.userName || order?.user?.username || undefined,
    items,
    subtotal,
    billDiscountAmount,
    pointsDiscountAmount: pointsDiscountAmount || undefined,
    claimDiscountAmount: claimDiscountAmount || undefined,
    pointsUsed,
    customerPointsEarned,
    customerPointsBalance,
    vatAmount: round2(num(order?.vatAmount)),
    totalAmount,
    payments,
    paymentMethod: summarizePaymentMethods(payments, typeof order?.paymentMethod === 'string' ? order.paymentMethod : undefined),
    cashReceived,
    changeAmount,
    outstandingAmount,
    note: order?.note || order?.remarks || undefined,
    isReprint: opts.isReprint === true,
    reprintedAt: opts.isReprint ? opts.reprintedAt || new Date().toISOString() : undefined,
  };
}

/** Order -> 80mm thermal receipt */
export function orderToReceiptData(order: any, opts: ReceiptMapOptions = {}): ReceiptData {
  const c = mapCommon(order, opts);
  return {
    ...c,
    items: c.items.map((i) => ({
      name: i.name,
      quantity: i.quantity,
      unitName: i.unitName,
      unitPrice: i.unitPrice,
      lineTotal: i.lineTotal,
      discountAmount: i.discountAmount,
      itemNote: i.itemNote,
      bundleData: i.bundleData,
    })),
  };
}

/** Order -> A4 receipt / tax invoice */
export function orderToA4Data(order: any, opts: ReceiptMapOptions = {}): ReceiptA4Data {
  const c = mapCommon(order, opts);
  const customer = opts.customer || (order?.customer && typeof order.customer === 'object' ? order.customer : null);
  return {
    orderNumber: c.orderNumber,
    createdAt: c.createdAt,
    customerName: c.customerName || undefined,
    customerPhone: customer?.phone || order?.customerPhone || undefined,
    customerAddress: customer?.address || order?.customerAddress || undefined,
    customerTaxId: customer?.taxId || order?.customerTaxId || undefined,
    customerBranch: customer?.companyName ? customer?.branchName || 'สำนักงานใหญ่' : undefined,
    customerCompany: customer?.companyName || undefined,
    userName: c.userName,
    items: c.items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitName: i.unitName,
      unitPrice: i.unitPrice,
      discountAmount: i.discountAmount,
      lineTotal: i.lineTotal,
    })),
    subtotal: c.subtotal,
    billDiscountAmount: c.billDiscountAmount,
    pointsDiscountAmount: c.pointsDiscountAmount,
    claimDiscountAmount: c.claimDiscountAmount,
    pointsUsed: c.pointsUsed,
    customerPointsEarned: c.customerPointsEarned,
    customerPointsBalance: c.customerPointsBalance,
    vatAmount: c.vatAmount,
    totalAmount: c.totalAmount,
    paymentMethod: c.paymentMethod,
    payments: c.payments,
    cashReceived: c.cashReceived,
    changeAmount: c.changeAmount,
    outstandingAmount: c.outstandingAmount,
    isCreditBill: c.outstandingAmount !== undefined,
    isCopy: c.isReprint,
  };
}
