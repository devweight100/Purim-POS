import { apiFetch, api } from './api';
import { errorText } from './api-error';
import {
  PayablePaymentEntry, ApiPaymentVoucher, ApiPurchaseOrderItem, ApiListResponse,
  apiListRows,
} from './types';

export type { PayablePaymentEntry } from './types';

export interface SupplierPayableBill {
  poId: string;
  poNumber: string;
  supplierInvoiceNo?: string; // เลขที่บิล / ใบกำกับภาษี / ใบส่งของ ของผู้จำหน่าย
  supplierInvoiceDate?: string; // วันที่ในบิลผู้จำหน่าย
  supplierId: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  billDate: string;
  status: string; // PO status: 'COMPLETED' | 'PARTIALLY_RECEIVED' | 'ISSUED'
  paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';
  totalAmount: number; // full PO amount
  receivedAmount: number; // value of goods actually received = amount owed to the supplier
  alreadyDeductedReturns: number;
  alreadyPaidAmount: number;
  alreadyDiscountAmount: number;
  remainingPayable: number;
  itemsCount: number;
  items?: ApiPurchaseOrderItem[];
  deductedReturns: Array<{
    returnNoteId: string;
    returnNumber: string;
    amount: number;
    deductedAt: string;
    note?: string;
  }>;
  payments: PayablePaymentEntry[];
}

export interface PaymentVoucherBillItem {
  poId: string;
  poNumber: string;
  supplierInvoiceNo?: string;
  billDate: string;
  totalBillAmount: number;
  remainingBeforePay: number;
  amountPaid: number; // ยอดที่ตัดชำระในบิลนี้
}

export interface PaymentVoucher {
  id: string; // e.g. PV-20260901-0001
  voucherNumber: string;
  status?: 'ACTIVE' | 'CANCELLED';
  cancelledAt?: string;
  cancelReason?: string;
  supplierId: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
  supplierAddress?: string;
  paymentDate: string;
  bills: PaymentVoucherBillItem[]; // ทุกบิล/Invoice ที่ชำระในรอบนี้!
  totalBillsAmount: number; // ผลรวมของยอดตัดจ่ายทุกบิล
  deductedCreditAmount: number;
  deductedNotes: Array<{
    returnNoteId: string;
    amount: number;
  }>;
  discountAmount?: number;
  netPaidAmount: number; // เงินสด/โอน จ่ายจริงสุทธิ
  paymentMethod: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER';
  bankAccountId?: string;
  bankAccountLabel?: string;
  referenceNo?: string;
  note?: string;
  cashierName: string;
  createdAt: string;
}


export function normalizeVoucherRow(v: ApiPaymentVoucher | null | undefined): PaymentVoucher {
  const bills: PaymentVoucherBillItem[] = Array.isArray(v?.bills)
    ? v.bills
    : Array.isArray(v?.items)
    ? v.items.map((item) => ({
        poId: item.purchaseOrderId || item.poId || item.purchaseOrder?.id || '',
        poNumber: item.purchaseOrder?.poNumber || item.poNumber || '',
        supplierInvoiceNo:
          item.purchaseOrder?.supplierInvoiceNo || item.supplierInvoiceNo || '',
        billDate:
          item.purchaseOrder?.billDate ||
          item.purchaseOrder?.createdAt ||
          v.paymentDate ||
          new Date().toISOString(),
        totalBillAmount: Number(
          item.purchaseOrder?.totalAmount ?? item.totalBillAmount ?? item.amountPaid ?? 0,
        ),
        remainingBeforePay: Number(
          item.remainingBeforePay ?? item.purchaseOrder?.totalAmount ?? item.amountPaid ?? 0,
        ),
        amountPaid: Number(item.amountPaid ?? 0),
      }))
    : [];

  const deductedNotes = Array.isArray(v?.deductedNotes)
    ? v.deductedNotes
    : Array.isArray(v?.debitNotes)
    ? v.debitNotes.map((dn) => ({
        returnNoteId: dn.returnNoteId || dn.returnNote?.id || '',
        amount: Number(dn.amountDeducted ?? dn.amount ?? 0),
      }))
    : [];

  return {
    id: String(v?.id || v?.voucherNumber || ''),
    voucherNumber: String(v?.voucherNumber || v?.id || ''),
    status: v?.status === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE',
    cancelledAt: v?.cancelledAt || undefined,
    cancelReason: v?.cancelReason || undefined,
    supplierId: String(v?.supplierId || v?.supplier?.id || ''),
    supplierName: String(v?.supplierName || v?.supplier?.name || 'ไม่ระบุผู้จำหน่าย'),
    supplierContact: v?.supplierContact || v?.supplier?.contactName || undefined,
    supplierPhone: v?.supplierPhone || v?.supplier?.phone || undefined,
    supplierAddress: v?.supplierAddress || v?.supplier?.address || undefined,
    paymentDate: v?.paymentDate || v?.createdAt || new Date().toISOString(),
    bills,
    totalBillsAmount: Number(v?.totalBillsAmount ?? 0),
    deductedCreditAmount: Number(v?.deductedCreditAmount ?? v?.debitDeducted ?? 0),
    deductedNotes,
    discountAmount:
      v?.discountAmount !== undefined && Number(v.discountAmount) > 0
        ? Number(v.discountAmount)
        : undefined,
    netPaidAmount: Number(v?.netPaidAmount ?? 0),
    paymentMethod: (v?.paymentMethod || 'CASH') as PaymentVoucher['paymentMethod'],
    bankAccountId: v?.bankAccountId || undefined,
    bankAccountLabel: v?.bankAccountLabel || undefined,
    referenceNo: v?.referenceNo || undefined,
    note: v?.note || undefined,
    cashierName: String(v?.cashierName || 'เจ้าหน้าที่การเงิน'),
    createdAt: v?.createdAt || v?.paymentDate || new Date().toISOString(),
  };
}

/** One page of payment vouchers from the server (newest first). Throws when the server cannot be reached. */
export async function fetchPaymentVouchersPage(params: { page?: number; limit?: number; search?: string } = {}): Promise<{ rows: PaymentVoucher[]; total: number }> {
  const q = new URLSearchParams({ page: String(params.page || 1), limit: String(params.limit || 50) });
  if (params.search?.trim()) q.set('search', params.search.trim());
  const res = await apiFetch<ApiListResponse<ApiPaymentVoucher> | null>(`/payables/vouchers?${q.toString()}`);
  const list = apiListRows(res);
  if (!Array.isArray(list)) throw new Error('ข้อมูลใบสำคัญจ่ายจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  const total = res && !Array.isArray(res) && typeof res.meta?.total === 'number' ? res.meta.total : list.length;
  return { rows: list.map((v) => normalizeVoucherRow(v)), total };
}

/** Save the supplier's invoice number on the bill (server first; nothing is kept locally). */
export async function updateBillInvoiceNo(
  poId: string,
  supplierInvoiceNo: string,
  supplierInvoiceDate?: string,
): Promise<{ success: boolean; message: string }> {
  const cleanNo = supplierInvoiceNo.trim();
  try {
    await api.purchaseOrders.update(poId, {
      supplierInvoiceNo: cleanNo,
      ...(supplierInvoiceDate ? { billDate: supplierInvoiceDate } : {}),
    });
  } catch (err) {
    return { success: false, message: errorText(err) || 'บันทึกเลขที่บิลผู้จำหน่ายไม่สำเร็จ' };
  }
  return { success: true, message: 'บันทึกเลขที่บิลผู้จำหน่ายเรียบร้อยแล้ว' };
}

function newClientVoucherId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `pv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Backend only knows CASH / TRANSFER etc.; cheques and others are recorded as TRANSFER with a tag. */
function toBackendPaymentMethod(method: string, note?: string): { paymentMethod: string; note?: string } {
  if (method === 'CASH' || method === 'TRANSFER') return { paymentMethod: method, note };
  const tag = method === 'CHEQUE' ? '[เช็ค]' : '[อื่นๆ]';
  return { paymentMethod: 'TRANSFER', note: [tag, note].filter(Boolean).join(' ') };
}

export type PayableBillStatusFilter = 'ALL' | 'UNPAID' | 'PARTIALLY_PAID' | 'PAID';

export interface PayableSupplierSummary {
  supplierId: string;
  /** bills with something payable now */
  openCount: number;
  debt: number;
  /** credit notes with credit left */
  creditCount: number;
  creditTotal: number;
}

/** Cards of the payables page, over every bill (the filters do not change them). */
export interface PayablesSummary {
  billCount: number;
  unpaidCount: number;
  totalOutstanding: number;
  totalPaid: number;
  availableCredit: number;
  availableCreditCount: number;
  suppliers: PayableSupplierSummary[];
}

export interface PayableBillsPage {
  data: SupplierPayableBill[];
  meta: { total: number; page: number; limit: number; totalPages: number };
  summary: PayablesSummary;
}

export interface PayableBillsQuery {
  page?: number;
  limit?: number;
  search?: string;
  supplierId?: string;
  paymentStatus?: PayableBillStatusFilter;
  /** only bills with something payable now */
  open?: boolean;
  /** rows without the PO lines */
  slim?: boolean;
}

export function payableBillsUrl(query: PayableBillsQuery = {}): string {
  const q = new URLSearchParams({ page: String(query.page || 1), limit: String(query.limit || 50) });
  if (query.search?.trim()) q.set('search', query.search.trim());
  if (query.supplierId && query.supplierId !== 'ALL') q.set('supplierId', query.supplierId);
  if (query.paymentStatus && query.paymentStatus !== 'ALL') q.set('paymentStatus', query.paymentStatus);
  if (query.open) q.set('open', '1');
  if (query.slim) q.set('slim', '1');
  return `/payables/bills?${q.toString()}`;
}

/**
 * One page of supplier bills, computed on the server over every PO and payment voucher
 * (the page used to build them here from the newest 500 POs and 200 vouchers).
 */
export async function fetchPayableBillsPage(query: PayableBillsQuery = {}): Promise<PayableBillsPage> {
  const res = await apiFetch<PayableBillsPage | null>(payableBillsUrl(query));
  if (!res || !Array.isArray(res.data) || !res.meta || !res.summary) throw new Error('ข้อมูลบิลเจ้าหนี้จากเซิร์ฟเวอร์ไม่ถูกต้อง');
  return res;
}

/** Every bill with something payable now (all pages, without PO lines): the settle-several-bills dialog. */
export async function fetchOpenPayableBills(supplierId?: string): Promise<SupplierPayableBill[]> {
  const out: SupplierPayableBill[] = [];
  for (let page = 1; page <= 1000; page++) {
    const res = await fetchPayableBillsPage({ page, limit: 500, open: true, slim: true, supplierId });
    out.push(...res.data);
    if (page >= res.meta.totalPages || res.data.length === 0) break;
  }
  return out;
}

export interface SettlePayableParams {
  /** the bill being paid (as the page shows it) */
  bill: Pick<SupplierPayableBill, 'poId' | 'poNumber' | 'supplierId' | 'totalAmount'>;
  matchedDebitNotes: Array<{
    returnNoteId: string;
    amountToDeduct: number;
  }>;
  discountAmount?: number;
  cashOrTransferAmount: number;
  /** Idempotency key: reuse the same value when retrying the same payment. */
  clientVoucherId?: string;
  paymentMethod: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER';
  bankAccountId?: string;
  bankAccountLabel?: string;
  referenceNo?: string;
  note?: string;
  cashierName?: string;
}

export async function settlePayableBill(params: SettlePayableParams): Promise<{
  success: boolean;
  message: string;
  paymentEntry?: PayablePaymentEntry;
  updatedBill?: SupplierPayableBill;
  voucher?: PaymentVoucher;
}> {
  const targetPo = params.bill;
  if (!targetPo?.poId) {
    return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลเจ้าหนี้นี้' };
  }

  // Settlement is recorded in the database first; nothing is saved locally if the backend refuses it.
  let backendVoucher: ApiPaymentVoucher | null = null;
  const supplierId = targetPo.supplierId;
  if (!supplierId) return { success: false, message: 'บิลนี้ไม่มีข้อมูลผู้จำหน่าย' };
  {
    const debitTotal = (params.matchedDebitNotes || []).reduce((sum, d) => sum + (Number(d.amountToDeduct) || 0), 0);
    // The bill is cleared by cash/transfer + credit notes + discount together.
    const grossToClear =
      Math.round(((Number(params.cashOrTransferAmount) || 0) + debitTotal + (Number(params.discountAmount) || 0)) * 100) / 100;
    const method = toBackendPaymentMethod(params.paymentMethod, params.note);
    try {
      const payload = {
        clientVoucherId: params.clientVoucherId || newClientVoucherId(),
        supplierId,
        billsToSettle: [
          { poId: targetPo.poId, amountToPay: grossToClear },
        ],
        matchedDebitNotes: params.matchedDebitNotes?.length
          ? params.matchedDebitNotes.map((d) => ({
              returnNoteId: d.returnNoteId,
              amountToDeduct: Number(d.amountToDeduct) || 0,
            }))
          : undefined,
        discountAmount: Number(params.discountAmount) || 0,
        paymentMethod: method.paymentMethod,
        bankAccountLabel: params.bankAccountLabel,
        referenceNo: params.referenceNo,
        note: method.note,
        cashierName: params.cashierName,
      };
      const res = await api.payables.settleMultiple(payload);
      if (res && res.voucher) {
        backendVoucher = res.voucher;
      }
    } catch (apiErr) {
      return { success: false, message: errorText(apiErr) || 'บันทึกการชำระเงินลงฐานข้อมูลไม่สำเร็จ' };
    }
  }
  if (!backendVoucher) return { success: false, message: 'เซิร์ฟเวอร์ไม่ได้ออกใบสำคัญจ่าย กรุณาลองใหม่' };
  const savedVoucher: ApiPaymentVoucher = backendVoucher;

  // The database committed the payment (and the credit-note deductions); show its record.
  const voucher = normalizeVoucherRow(savedVoucher);
  const billItem = voucher.bills.find((b) => b.poId === targetPo.poId || b.poNumber === targetPo.poNumber);
  const paymentEntry: PayablePaymentEntry = {
    id: `PAY-${voucher.id}-${targetPo.poId}`,
    voucherId: voucher.id,
    voucherNumber: voucher.voucherNumber,
    paymentDate: voucher.paymentDate,
    paymentMethod: params.paymentMethod,
    totalBillAmount: Number(targetPo.totalAmount || 0),
    deductedCreditAmount: voucher.deductedCreditAmount || 0,
    discountAmount: voucher.discountAmount,
    netCashOrTransferPaid: Number(billItem?.amountPaid ?? voucher.netPaidAmount ?? 0),
    deductedNotes: voucher.deductedNotes || [],
    bankAccountId: params.bankAccountId,
    bankAccountLabel: params.bankAccountLabel,
    referenceNo: voucher.referenceNo || voucher.voucherNumber,
    note: voucher.note,
    cashierName: voucher.cashierName || params.cashierName || 'เจ้าหน้าที่การเงิน',
  };

  return {
    success: true,
    message: `บันทึกการชำระเงินบิล ${targetPo.poNumber} สำเร็จ`,
    paymentEntry,
    voucher,
  };
}

export interface SettleMultipleBillsParams {
  supplierId: string;
  supplierName?: string;
  billsToSettle: Array<{
    poId: string;
    amountToPay: number;
  }>;
  matchedDebitNotes: Array<{
    returnNoteId: string;
    amountToDeduct: number;
  }>;
  discountAmount?: number;
  netCashOrTransferAmount: number;
  /** Idempotency key: reuse the same value when retrying the same payment. */
  clientVoucherId?: string;
  /** Finance money account the payment leaves (optional). */
  moneyAccountId?: string;
  paymentMethod: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER';
  bankAccountId?: string;
  bankAccountLabel?: string;
  referenceNo?: string;
  note?: string;
  cashierName?: string;
  paymentDate?: string;
}

export async function settleMultipleBills(params: SettleMultipleBillsParams): Promise<{
  success: boolean;
  message: string;
  voucher?: PaymentVoucher;
}> {
  let backendVoucher: ApiPaymentVoucher | null = null;
  const method = toBackendPaymentMethod(params.paymentMethod, params.note);
  try {
    const payload = {
      clientVoucherId: params.clientVoucherId || newClientVoucherId(),
      supplierId: params.supplierId,
      moneyAccountId: params.moneyAccountId,
      billsToSettle: params.billsToSettle.map((b) => ({
        poId: b.poId,
        amountToPay: Number(b.amountToPay) || 0,
      })),
      matchedDebitNotes: params.matchedDebitNotes?.length
        ? params.matchedDebitNotes.map((d) => ({
            returnNoteId: d.returnNoteId,
            amountToDeduct: Number(d.amountToDeduct) || 0,
          }))
        : undefined,
      discountAmount: Number(params.discountAmount) || 0,
      paymentMethod: method.paymentMethod,
      bankAccountLabel: params.bankAccountLabel,
      referenceNo: params.referenceNo,
      note: method.note,
      cashierName: params.cashierName,
      paymentDate: params.paymentDate,
    };
    const res = await api.payables.settleMultiple(payload);
    if (res && res.voucher) {
      backendVoucher = res.voucher;
    }
  } catch (apiErr) {
    // No local fallback: a voucher that exists only in this browser would desync payables.
    return { success: false, message: errorText(apiErr) || 'บันทึกใบสำคัญจ่ายลงฐานข้อมูลไม่สำเร็จ' };
  }
  if (!backendVoucher) return { success: false, message: 'เซิร์ฟเวอร์ไม่ได้ออกใบสำคัญจ่าย กรุณาลองใหม่' };
  const savedVoucher: ApiPaymentVoucher = backendVoucher;

  // The database committed the voucher; show its record (nothing is bookkept locally).
  const voucher = normalizeVoucherRow(savedVoucher);
  return {
    success: true,
    message: `สร้างใบชำระหนี้ ${voucher.voucherNumber} สำเร็จ (${voucher.bills.length || params.billsToSettle.length} บิล)`,
    voucher,
  };
}

// ─── Rollback / Cancel Payments for a Payable Bill ───
// A payment can only be undone on the server, by cancelling the payment voucher that holds it
// (the server restores the bill balance and the credit notes in the same transaction).
export async function rollbackPayableBillPayment(
  bill: Pick<SupplierPayableBill, 'poNumber' | 'payments'> | null | undefined,
  paymentId?: string,
): Promise<{ success: boolean; message: string }> {
  if (!bill) return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลเจ้าหนี้นี้' };
  const payments = (bill.payments || []).filter((p) => !paymentId || p.id === paymentId);
  const voucherIds = Array.from(new Set(payments.map((p) => p.voucherId).filter(Boolean))) as string[];
  if (voucherIds.length === 0) {
    return { success: false, message: 'บิลนี้ยังไม่มีประวัติการชำระเงินหรือการประกบใบลดหนี้' };
  }
  for (const voucherId of voucherIds) {
    const res = await cancelPaymentVoucher(voucherId, `ย้อนการชำระบิล ${bill.poNumber}`);
    if (!res.success) return res;
  }
  return {
    success: true,
    message: `ย้อนสถานะการชำระเงินของบิล ${bill.poNumber} สำเร็จ เครดิตใบลดหนี้และยอดหนี้ได้รับการปรับปรุงเรียบร้อย`,
  };
}

// ─── Cancel / Void Payable Bill ───
export async function cancelPayableBill(
  poId: string,
  reason?: string,
  poNumber?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    await apiFetch(`/purchase-orders/${encodeURIComponent(poId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'ยกเลิกบิลเจ้าหนี้โดยผู้ใช้งาน' }),
    });
  } catch (err) {
    return { success: false, message: errorText(err) || 'ยกเลิกบิลไม่สำเร็จ' };
  }
  return { success: true, message: `ยกเลิกบิล ${poNumber || ''} เรียบร้อยแล้ว` };
}

// ─── Cancel / Void Payment Voucher ───
export async function cancelPaymentVoucher(
  voucherId: string,
  cancelReason?: string,
  voucher?: Pick<PaymentVoucher, 'id' | 'voucherNumber' | 'status'>,
): Promise<{ success: boolean; message: string }> {
  if (voucher?.status === 'CANCELLED') {
    return { success: false, message: 'ใบสำคัญจ่ายนี้ถูกยกเลิกไปแล้ว' };
  }
  try {
    await api.payables.cancelVoucher(voucher?.id || voucherId, cancelReason?.trim() || 'ยกเลิกใบสำคัญจ่ายโดยผู้ใช้');
  } catch (apiErr) {
    return { success: false, message: errorText(apiErr) || 'ยกเลิกใบสำคัญจ่ายในฐานข้อมูลไม่สำเร็จ' };
  }
  return {
    success: true,
    message: `ยกเลิกใบสำคัญจ่าย ${voucher?.voucherNumber || voucherId} สำเร็จ และคืนสถานะหนี้ค้างชำระเรียบร้อยแล้ว`,
  };
}
