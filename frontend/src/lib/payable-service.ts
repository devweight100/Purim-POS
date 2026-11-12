import {
  loadPurchaseOrders,
  loadSuppliers,
  fetchPurchaseOrders,
  fetchSuppliers,
  fetchSupplierReturnNotes,
} from './supplier-return-service';
import { apiFetch, api } from './api';
import { errorText } from './api-error';
import {
  PayablePaymentEntry, ApiPaymentVoucher, ApiPurchaseOrder, ApiPurchaseOrderItem, ApiSupplier, ApiListResponse,
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

/** Last payment vouchers the server returned in this session (memory only, never localStorage). */
let vouchersMem: PaymentVoucher[] = [];
let lastVoucherSyncAt = 0;
let lastBillsSyncAt = 0;

function normalizeVoucherRow(v: ApiPaymentVoucher | null | undefined): PaymentVoucher {
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

/** Payment vouchers from the server. Throws when the server cannot be reached. */
export async function fetchPaymentVouchers(): Promise<PaymentVoucher[]> {
  const res = await apiFetch<ApiListResponse<ApiPaymentVoucher> | null>('/payables/vouchers?limit=200');
  const list = apiListRows(res);
  if (!Array.isArray(list)) throw new Error('ข้อมูลใบสำคัญจ่ายจากเซิร์ฟเวอร์ไม่ถูกต้อง');
  lastVoucherSyncAt = Date.now();
  vouchersMem = list.map((v) => normalizeVoucherRow(v));
  return vouchersMem;
}

/** Last vouchers the server returned in this session, plus a background refresh. */
export function loadPaymentVouchers(): PaymentVoucher[] {
  if (typeof window !== 'undefined' && Date.now() - lastVoucherSyncAt > 10000) {
    lastVoucherSyncAt = Date.now();
    void fetchPaymentVouchers().catch(() => {});
  }
  return vouchersMem;
}

export function getPaymentVoucherById(id: string): PaymentVoucher | undefined {
  return vouchersMem.find((v) => v.id === id || v.voucherNumber === id);
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
  await fetchPurchaseOrders().catch(() => undefined);
  return { success: true, message: 'บันทึกเลขที่บิลผู้จำหน่ายเรียบร้อยแล้ว' };
}

/** After the server accepted a payables change: reload POs, vouchers and credit notes. */
async function refreshAfterPayableWrite(): Promise<void> {
  await Promise.allSettled([fetchPurchaseOrders(), fetchPaymentVouchers(), fetchSupplierReturnNotes()]);
}

const PAYABLE_PO_STATUSES = ['PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED'];

function receivedValueOf(po: ApiPurchaseOrder): number {
  const items = Array.isArray(po.items) ? po.items : [];
  if (!items.length) return Number(po.totalAmount || 0);
  return items.reduce(
    (sum: number, i) => sum + (Number(i.receivedQty ?? i.receivedQuantity) || 0) * (Number(i.unitCost) || 0),
    0,
  );
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

function mapPosToPayableBills(
  pos: ApiPurchaseOrder[],
  suppliers: ApiSupplier[],
  vouchers: PaymentVoucher[],
): SupplierPayableBill[] {
  const activeVouchers = Array.isArray(vouchers)
    ? vouchers.filter((v) => v.status !== 'CANCELLED')
    : [];

  return pos
    // A supplier bill becomes payable only once goods were actually received.
    .filter((po) => PAYABLE_PO_STATUSES.includes(po.status))
    .map((po) => {
      const totalAmount = Number(po.totalAmount || 0);

      const deductedReturns = Array.isArray(po.deductedReturns) ? po.deductedReturns : [];
      const alreadyDeducted = deductedReturns.reduce(
        (sum: number, r) => sum + Number(r.amount || 0),
        0,
      );

      let payments: PayablePaymentEntry[] = Array.isArray(po.payments) ? po.payments : [];
      if (payments.length === 0 && activeVouchers.length > 0) {
        const matchedVouchers = activeVouchers.filter(
          (v) =>
            Array.isArray(v.bills) &&
            v.bills.some((b) => b.poId === po.id || b.poNumber === po.poNumber),
        );
        payments = matchedVouchers.map((v) => {
          const billItem = v.bills.find(
            (b) => b.poId === po.id || b.poNumber === po.poNumber,
          );
          return {
            id: `PAY-${v.id}-${po.id}`,
            voucherId: v.id,
            voucherNumber: v.voucherNumber,
            paymentDate: v.paymentDate,
            paymentMethod: v.paymentMethod,
            totalBillAmount: totalAmount,
            deductedCreditAmount: v.deductedCreditAmount || 0,
            discountAmount: v.discountAmount,
            netCashOrTransferPaid: Number(billItem?.amountPaid ?? v.netPaidAmount ?? 0),
            deductedNotes: v.deductedNotes || [],
            bankAccountId: v.bankAccountId,
            bankAccountLabel: v.bankAccountLabel,
            referenceNo: v.referenceNo || v.voucherNumber,
            note: v.note,
            cashierName: v.cashierName || 'เจ้าหน้าที่การเงิน',
          };
        });
      }

      const paymentsPaidSum = payments.reduce(
        (sum: number, p) => sum + Number(p.netCashOrTransferPaid || 0),
        0,
      );
      const alreadyPaid =
        paymentsPaidSum > 0 ? paymentsPaidSum : Number(po.paidAmount || 0);
      const alreadyDiscount = payments.reduce(
        (sum: number, p) => sum + Number(p.discountAmount || 0),
        0,
      );

      const computedRemaining = Math.max(
        0,
        Math.round((totalAmount - alreadyDeducted - alreadyPaid - alreadyDiscount) * 100) / 100,
      );
      // The database is the source of truth: remainingPayable already reflects every
      // voucher (cash + credit notes + discount). Cap it at the value of goods received.
      const dbRemaining =
        po.remainingPayable !== undefined && po.remainingPayable !== null
          ? Math.max(0, Number(po.remainingPayable))
          : computedRemaining;
      const remainingPayable = Math.max(
        0,
        Math.min(dbRemaining, Math.round((receivedValueOf(po) - Number(po.paidAmount || 0)) * 100) / 100),
      );

      let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
      // PAID only when the whole PO is settled. Paying everything received so far while goods are
      // still outstanding is PARTIALLY_PAID (more will become payable when the rest arrives).
      if (dbRemaining <= 0 && totalAmount > 0) {
        paymentStatus = 'PAID';
      } else if (remainingPayable <= 0 && totalAmount > 0) {
        paymentStatus = 'PARTIALLY_PAID';
      } else if (alreadyDeducted > 0 || alreadyPaid > 0 || alreadyDiscount > 0) {
        paymentStatus = 'PARTIALLY_PAID';
      } else if (po.paymentStatus === 'PAID' || po.paymentStatus === 'PARTIALLY_PAID') {
        paymentStatus = po.paymentStatus;
      }

      const supp: Partial<ApiSupplier> =
        suppliers.find((s) => s.id === (po.supplierId || po.supplier?.id)) ||
        po.supplier ||
        {};

      return {
        poId: po.id,
        poNumber: po.poNumber,
        supplierInvoiceNo: po.supplierInvoiceNo || po.invoiceNo || '',
        supplierInvoiceDate: po.supplierInvoiceDate || po.invoiceDate || '',
        supplierId: po.supplierId || supp.id || '',
        supplierName: po.supplierName || supp.name || 'ไม่ระบุผู้จำหน่าย',
        supplierContact: supp.contactName ?? undefined,
        supplierPhone: supp.phone ?? undefined,
        supplierAddress: supp.address ?? undefined,
        billDate:
          po.billDate || po.createdAt || po.issueDate || po.issuedAt || new Date().toISOString(),
        status: po.status,
        paymentStatus,
        totalAmount,
        receivedAmount: Math.round(receivedValueOf(po) * 100) / 100,
        alreadyDeductedReturns: alreadyDeducted,
        alreadyPaidAmount: alreadyPaid,
        alreadyDiscountAmount: alreadyDiscount,
        remainingPayable,
        itemsCount: (po.items || []).length,
        items: po.items || [],
        deductedReturns,
        payments,
      };
    });
}

export async function fetchPayableBills(): Promise<SupplierPayableBill[]> {
  lastBillsSyncAt = Date.now();
  const [pos, suppliers, vouchers] = await Promise.all([
    fetchPurchaseOrders(),
    fetchSuppliers(),
    fetchPaymentVouchers(),
  ]);

  return mapPosToPayableBills(pos, suppliers, vouchers);
}

export function loadPayableBills(): SupplierPayableBill[] {
  if (typeof window !== 'undefined' && Date.now() - lastBillsSyncAt > 10000) {
    lastBillsSyncAt = Date.now();
    void fetchPayableBills().catch(() => {});
  }
  return mapPosToPayableBills(loadPurchaseOrders(), loadSuppliers(), vouchersMem);
}

export interface SettlePayableParams {
  poId: string;
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
  const allPos = loadPurchaseOrders();
  const targetPo = allPos.find((p) => p.id === params.poId);

  if (!targetPo) {
    return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลเจ้าหนี้นี้' };
  }

  // Settlement is recorded in the database first; nothing is saved locally if the backend refuses it.
  let backendVoucher: ApiPaymentVoucher | null = null;
  const supplierId = targetPo.supplierId || targetPo.supplier?.id;
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
          { poId: targetPo.id, amountToPay: grossToClear },
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
  await refreshAfterPayableWrite();
  const voucher =
    vouchersMem.find((v) => v.id === savedVoucher.id || v.voucherNumber === savedVoucher.voucherNumber) ||
    normalizeVoucherRow(savedVoucher);
  const billItem = voucher.bills.find((b) => b.poId === targetPo.id || b.poNumber === targetPo.poNumber);
  const paymentEntry: PayablePaymentEntry = {
    id: `PAY-${voucher.id}-${targetPo.id}`,
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
  await refreshAfterPayableWrite();
  const voucher =
    vouchersMem.find((v) => v.id === savedVoucher.id || v.voucherNumber === savedVoucher.voucherNumber) ||
    normalizeVoucherRow(savedVoucher);
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
  poId: string,
  paymentId?: string,
): Promise<{ success: boolean; message: string }> {
  const bill = loadPayableBills().find((b) => b.poId === poId);
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
): Promise<{ success: boolean; message: string }> {
  const po = loadPurchaseOrders().find((p) => p.id === poId);
  try {
    await apiFetch(`/purchase-orders/${encodeURIComponent(poId)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason || 'ยกเลิกบิลเจ้าหนี้โดยผู้ใช้งาน' }),
    });
  } catch (err) {
    return { success: false, message: errorText(err) || 'ยกเลิกบิลไม่สำเร็จ' };
  }
  await refreshAfterPayableWrite();
  return { success: true, message: `ยกเลิกบิล ${po?.poNumber || ''} เรียบร้อยแล้ว` };
}

// ─── Cancel / Void Payment Voucher ───
export async function cancelPaymentVoucher(
  voucherId: string,
  cancelReason?: string,
): Promise<{ success: boolean; message: string }> {
  const voucher = vouchersMem.find((v) => v.id === voucherId || v.voucherNumber === voucherId);
  if (voucher?.status === 'CANCELLED') {
    return { success: false, message: 'ใบสำคัญจ่ายนี้ถูกยกเลิกไปแล้ว' };
  }
  try {
    await api.payables.cancelVoucher(voucher?.id || voucherId, cancelReason?.trim() || 'ยกเลิกใบสำคัญจ่ายโดยผู้ใช้');
  } catch (apiErr) {
    return { success: false, message: errorText(apiErr) || 'ยกเลิกใบสำคัญจ่ายในฐานข้อมูลไม่สำเร็จ' };
  }
  await refreshAfterPayableWrite();
  return {
    success: true,
    message: `ยกเลิกใบสำคัญจ่าย ${voucher?.voucherNumber || voucherId} สำเร็จ และคืนสถานะหนี้ค้างชำระเรียบร้อยแล้ว`,
  };
}
