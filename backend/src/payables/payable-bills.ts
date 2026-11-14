/**
 * Supplier bills ("payable bills") as the payables page shows them, computed on the server.
 *
 * This is the server port of the mapping the payables page used to run in the browser
 * (frontend payable-service mapPosToPayableBills) over /purchase-orders?limit=1000 (server cap 500)
 * and /payables/vouchers?limit=200: with more POs or vouchers the bills and paid amounts were
 * incomplete. Here every payable PO and every active voucher is used.
 *
 * Kept from the browser logic (same figures, see the e2e parity test):
 *  - a bill = a PO in a payable status (goods received), newest first (createdAt desc, id desc);
 *  - payments = one entry per ACTIVE voucher that pays the bill, newest voucher first; the entry's
 *    discount / credit figures are the voucher's (a multi-bill voucher repeats them on each bill);
 *  - alreadyPaid = sum of what the vouchers paid on this bill, or po.paidAmount when there is none;
 *  - alreadyDiscount = sum of the vouchers' discounts; alreadyDeductedReturns = 0 (credit notes are
 *    applied through vouchers only);
 *  - payment status rules (PAID only when the whole PO is settled).
 * One correction: the received value (bill amount and payable cap) uses each line's gross per unit
 * (discounts and VAT included) like payableNow, the PO detail dialog and settlement validation do;
 * the browser used quantity x unitCost, which capped VAT / discounted bills below what settlement
 * accepts. Lines without discount or VAT give the same number.
 */
import { grossPerUnit } from '../../../shared/src/po-calc';

export type BillPaymentStatus = 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

const r2 = (n: number) => Math.round(n * 100) / 100;

export interface BillFigureInput {
  totalAmount: unknown;
  paidAmount: unknown;
  remainingPayable: unknown;
  paymentStatus: string;
  items: { receivedQty: unknown; unitCost: unknown; quantity?: unknown; total?: unknown }[];
}

/** Value of the goods received so far (gross per unit), as payableNow counts it. */
export function receivedValueOf(po: BillFigureInput): number {
  if (!po.items.length) return Number(po.totalAmount || 0);
  return po.items.reduce(
    (sum, i) => sum + Number(i.receivedQty) * (Number(i.quantity) && i.total !== undefined ? grossPerUnit({ quantity: i.quantity, total: i.total, unitCost: i.unitCost }) : Number(i.unitCost)),
    0,
  );
}

export interface BillFigures {
  totalAmount: number;
  receivedAmount: number;
  alreadyPaidAmount: number;
  alreadyDiscountAmount: number;
  remainingPayable: number;
  paymentStatus: BillPaymentStatus;
}

/**
 * Figures of one bill. `payments` = what each ACTIVE voucher paid on this bill and the voucher's
 * discount, newest voucher first (the order only matters for float summing, as in the browser).
 */
export function billFigures(po: BillFigureInput, payments: { amountPaid: unknown; discountAmount: unknown }[]): BillFigures {
  const totalAmount = Number(po.totalAmount || 0);
  const alreadyDeducted = 0;
  const paymentsPaidSum = payments.reduce((sum, p) => sum + Number(p.amountPaid || 0), 0);
  const alreadyPaid = paymentsPaidSum > 0 ? paymentsPaidSum : Number(po.paidAmount || 0);
  const alreadyDiscount = payments.reduce((sum, p) => sum + (Number(p.discountAmount) > 0 ? Number(p.discountAmount) : 0), 0);
  const dbRemaining = po.remainingPayable !== undefined && po.remainingPayable !== null ? Math.max(0, Number(po.remainingPayable)) : Math.max(0, r2(totalAmount - alreadyDeducted - alreadyPaid - alreadyDiscount));
  const receivedValue = receivedValueOf(po);
  // = payableNow(po) (what settlement accepts) for a PO with lines
  const remainingPayable = Math.max(0, Math.min(dbRemaining, r2(receivedValue - Number(po.paidAmount || 0))));

  let paymentStatus: BillPaymentStatus = 'UNPAID';
  if (dbRemaining <= 0 && totalAmount > 0) paymentStatus = 'PAID';
  else if (remainingPayable <= 0 && totalAmount > 0) paymentStatus = 'PARTIALLY_PAID';
  else if (alreadyDeducted > 0 || alreadyPaid > 0 || alreadyDiscount > 0) paymentStatus = 'PARTIALLY_PAID';
  else if (po.paymentStatus === 'PAID' || po.paymentStatus === 'PARTIALLY_PAID') paymentStatus = po.paymentStatus;

  return { totalAmount, receivedAmount: r2(receivedValue), alreadyPaidAmount: alreadyPaid, alreadyDiscountAmount: alreadyDiscount, remainingPayable, paymentStatus };
}

/** Voucher of a payment entry (ACTIVE vouchers only). */
export interface BillVoucher {
  id: string;
  voucherNumber: string;
  paymentDate: Date | string;
  paymentMethod: string;
  debitDeducted: unknown;
  discountAmount: unknown;
  bankAccountLabel: string | null;
  referenceNo: string | null;
  note: string | null;
  cashierName: string | null;
  debitNotes: { returnNoteId: string; amountDeducted: unknown }[];
}

const iso = (d: Date | string | null | undefined) => (d instanceof Date ? d.toISOString() : d || undefined);

/** One payment entry of a bill (the shape the page's PayablePaymentEntry had). */
export function paymentEntry(poId: string, totalAmount: number, v: BillVoucher, amountPaid: unknown) {
  const discount = Number(v.discountAmount);
  return {
    id: `PAY-${v.id}-${poId}`,
    voucherId: v.id,
    voucherNumber: v.voucherNumber,
    paymentDate: iso(v.paymentDate),
    paymentMethod: v.paymentMethod || 'CASH',
    totalBillAmount: totalAmount,
    deductedCreditAmount: Number(v.debitDeducted ?? 0) || 0,
    discountAmount: discount > 0 ? discount : undefined,
    netCashOrTransferPaid: Number(amountPaid ?? 0),
    deductedNotes: v.debitNotes.map((dn) => ({ returnNoteId: dn.returnNoteId, amount: Number(dn.amountDeducted ?? 0) })),
    bankAccountId: undefined,
    bankAccountLabel: v.bankAccountLabel || undefined,
    referenceNo: v.referenceNo || v.voucherNumber,
    note: v.note || undefined,
    cashierName: v.cashierName || 'เจ้าหน้าที่การเงิน',
  };
}

/** Search as the page did (PO number / supplier name, case-insensitive substring) plus the supplier's invoice number. */
export function billMatchesSearch(bill: { poNumber: string; supplierName: string; supplierInvoiceNo?: string | null }, search: string): boolean {
  const q = search.toLowerCase();
  if (!q) return true;
  return bill.poNumber.toLowerCase().includes(q) || bill.supplierName.toLowerCase().includes(q) || (bill.supplierInvoiceNo || '').toLowerCase().includes(q);
}
