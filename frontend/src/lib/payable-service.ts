import {
  loadPurchaseOrders,
  savePurchaseOrders,
  loadSuppliers,
  loadSupplierReturnNotes,
  saveSupplierReturnNotes,
  fetchPurchaseOrders,
  fetchSuppliers,
} from './supplier-return-service';
import { apiFetch, api } from './api';

export interface PayablePaymentEntry {
  id: string;
  voucherId?: string;
  voucherNumber?: string;
  paymentDate: string;
  paymentMethod: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER';
  totalBillAmount: number;
  deductedCreditAmount: number;
  discountAmount?: number;
  netCashOrTransferPaid: number;
  deductedNotes: Array<{
    returnNoteId: string;
    amount: number;
  }>;
  bankAccountId?: string;
  bankAccountLabel?: string;
  referenceNo?: string;
  note?: string;
  cashierName: string;
}

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
  totalAmount: number;
  alreadyDeductedReturns: number;
  alreadyPaidAmount: number;
  alreadyDiscountAmount: number;
  remainingPayable: number;
  itemsCount: number;
  items?: any[];
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

const PAYMENT_VOUCHERS_KEY = 'pos_payment_vouchers';
let lastVoucherSyncAt = 0;
let lastBillsSyncAt = 0;

function normalizeVoucherRow(v: any): PaymentVoucher {
  const bills: PaymentVoucherBillItem[] = Array.isArray(v?.bills)
    ? v.bills
    : Array.isArray(v?.items)
    ? v.items.map((item: any) => ({
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
    ? v.debitNotes.map((dn: any) => ({
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
    paymentMethod: (v?.paymentMethod || 'CASH') as any,
    bankAccountId: v?.bankAccountId || undefined,
    bankAccountLabel: v?.bankAccountLabel || undefined,
    referenceNo: v?.referenceNo || undefined,
    note: v?.note || undefined,
    cashierName: String(v?.cashierName || 'เจ้าหน้าที่การเงิน'),
    createdAt: v?.createdAt || v?.paymentDate || new Date().toISOString(),
  };
}

function readLocalVouchers(): PaymentVoucher[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PAYMENT_VOUCHERS_KEY);
    if (!raw) return [];
    const list = JSON.parse(raw);
    return Array.isArray(list) ? list : [];
  } catch (e) {
    console.error('Error loading payment vouchers:', e);
    return [];
  }
}

export async function fetchPaymentVouchers(): Promise<PaymentVoucher[]> {
  try {
    const res = await apiFetch('/payables/vouchers?limit=200');
    const list = res?.data ?? (Array.isArray(res) ? res : null);
    if (Array.isArray(list)) {
      lastVoucherSyncAt = Date.now();
      const mapped = list.map((v: any) => normalizeVoucherRow(v));
      savePaymentVouchers(mapped);
      return mapped;
    }
  } catch (err) {
    console.warn('[PayableService] Failed to fetch vouchers from backend:', err);
  }
  return readLocalVouchers();
}

export function loadPaymentVouchers(): PaymentVoucher[] {
  const cached = readLocalVouchers();
  if (typeof window !== 'undefined' && Date.now() - lastVoucherSyncAt > 10000) {
    lastVoucherSyncAt = Date.now();
    void fetchPaymentVouchers().catch(() => {});
  }
  return cached;
}

export function savePaymentVouchers(vouchers: PaymentVoucher[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PAYMENT_VOUCHERS_KEY, JSON.stringify(vouchers));
  } catch (e) {
    console.error('Error saving payment vouchers:', e);
  }
}

export function getPaymentVoucherById(id: string): PaymentVoucher | undefined {
  return readLocalVouchers().find((v) => v.id === id || v.voucherNumber === id);
}

export function updateBillInvoiceNo(
  poId: string,
  supplierInvoiceNo: string,
  supplierInvoiceDate?: string,
): { success: boolean; message: string } {
  const allPos = loadPurchaseOrders();
  const po = allPos.find((p) => p.id === poId);
  if (!po) return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลนี้' };

  const cleanNo = supplierInvoiceNo.trim();
  po.supplierInvoiceNo = cleanNo;
  if (supplierInvoiceDate) {
    po.supplierInvoiceDate = supplierInvoiceDate;
  }
  savePurchaseOrders(allPos);

  void api.purchaseOrders
    .update(poId, {
      supplierInvoiceNo: cleanNo,
      ...(supplierInvoiceDate ? { billDate: supplierInvoiceDate } : {}),
    })
    .catch(() => {});

  return { success: true, message: 'บันทึกเลขที่บิลผู้จำหน่ายเรียบร้อยแล้ว' };
}

function mapPosToPayableBills(
  pos: any[],
  suppliers: any[],
  vouchers: PaymentVoucher[],
): SupplierPayableBill[] {
  const activeVouchers = Array.isArray(vouchers)
    ? vouchers.filter((v) => v.status !== 'CANCELLED')
    : [];

  return pos
    .filter((po: any) => po.status !== 'CANCELLED' && po.status !== 'DRAFT')
    .map((po: any) => {
      const totalAmount = Number(po.totalAmount || 0);

      const deductedReturns = Array.isArray(po.deductedReturns) ? po.deductedReturns : [];
      const alreadyDeducted = deductedReturns.reduce(
        (sum: number, r: any) => sum + Number(r.amount || 0),
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
        (sum: number, p: any) => sum + Number(p.netCashOrTransferPaid || 0),
        0,
      );
      const alreadyPaid =
        paymentsPaidSum > 0 ? paymentsPaidSum : Number(po.paidAmount || 0);
      const alreadyDiscount = payments.reduce(
        (sum: number, p: any) => sum + Number(p.discountAmount || 0),
        0,
      );

      const computedRemaining = Math.max(
        0,
        Math.round((totalAmount - alreadyDeducted - alreadyPaid - alreadyDiscount) * 100) / 100,
      );
      const remainingPayable =
        po.remainingPayable !== undefined && payments.length === 0
          ? Math.max(0, Number(po.remainingPayable))
          : computedRemaining;

      let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
      if (remainingPayable <= 0 && totalAmount > 0) {
        paymentStatus = 'PAID';
      } else if (alreadyDeducted > 0 || alreadyPaid > 0 || alreadyDiscount > 0) {
        paymentStatus = 'PARTIALLY_PAID';
      } else if (po.paymentStatus === 'PAID' || po.paymentStatus === 'PARTIALLY_PAID') {
        paymentStatus = po.paymentStatus;
      }

      const supp =
        suppliers.find((s: any) => s.id === (po.supplierId || po.supplier?.id)) ||
        po.supplier ||
        {};

      return {
        poId: po.id,
        poNumber: po.poNumber,
        supplierInvoiceNo: po.supplierInvoiceNo || po.invoiceNo || '',
        supplierInvoiceDate: po.supplierInvoiceDate || po.invoiceDate || '',
        supplierId: po.supplierId || supp.id || '',
        supplierName: po.supplierName || supp.name || 'ไม่ระบุผู้จำหน่าย',
        supplierContact: supp.contactName,
        supplierPhone: supp.phone,
        supplierAddress: supp.address,
        billDate:
          po.billDate || po.createdAt || po.issueDate || po.issuedAt || new Date().toISOString(),
        status: po.status,
        paymentStatus,
        totalAmount,
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
  const pos = loadPurchaseOrders();
  const suppliers = loadSuppliers();
  const vouchers = readLocalVouchers();
  return mapPosToPayableBills(pos, suppliers, vouchers);
}

export interface SettlePayableParams {
  poId: string;
  matchedDebitNotes: Array<{
    returnNoteId: string;
    amountToDeduct: number;
  }>;
  discountAmount?: number;
  cashOrTransferAmount: number;
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

  // Attempt backend settlement via POST /payables/settle-multiple so database is saved
  let backendVoucher: any = null;
  const supplierId = targetPo.supplierId || targetPo.supplier?.id;
  if (supplierId) {
    try {
      const payload = {
        supplierId,
        billsToSettle: [
          { poId: targetPo.id, amountToPay: Number(params.cashOrTransferAmount) || 0 },
        ],
        matchedDebitNotes: params.matchedDebitNotes?.length
          ? params.matchedDebitNotes.map((d) => ({
              returnNoteId: d.returnNoteId,
              amountToDeduct: Number(d.amountToDeduct) || 0,
            }))
          : undefined,
        discountAmount: Number(params.discountAmount) || 0,
        paymentMethod: params.paymentMethod,
        bankAccountLabel: params.bankAccountLabel,
        referenceNo: params.referenceNo,
        note: params.note,
        cashierName: params.cashierName,
      };
      const res = await api.payables.settleMultiple(payload);
      if (res && res.voucher) {
        backendVoucher = res.voucher;
      }
    } catch (apiErr) {
      console.warn('[PayableService] Backend settle failed, continuing local update:', apiErr);
    }
  }

  const nowIso = new Date().toISOString();
  const paymentId = `PAY-${Date.now()}`;
  const allReturnNotes = loadSupplierReturnNotes();

  // 1. Process matched Debit Notes
  let totalDebitDeducted = 0;
  const deductedEntriesForPo: any[] = [];
  const deductedNotesRecord: Array<{ returnNoteId: string; amount: number }> = [];

  for (const match of params.matchedDebitNotes) {
    if (match.amountToDeduct <= 0) continue;
    const note = allReturnNotes.find((n) => n.id === match.returnNoteId);
    if (!note) continue;

    const actualDeduct = Math.min(match.amountToDeduct, note.remainingCreditAmount);
    if (actualDeduct <= 0) continue;

    note.remainingCreditAmount = Math.max(
      0,
      Math.round((note.remainingCreditAmount - actualDeduct) * 100) / 100,
    );
    note.status = note.remainingCreditAmount <= 0 ? 'DEDUCTED' : 'PARTIALLY_DEDUCTED';

    note.deductions = [
      ...(note.deductions || []),
      {
        billNumber: targetPo.poNumber,
        deductedAmount: actualDeduct,
        deductedAt: nowIso,
        netPaid: Math.max(0, Number(targetPo.totalAmount || 0) - actualDeduct),
        note: `ประกบหักยอดบิล ${targetPo.poNumber}`,
      },
    ];

    totalDebitDeducted += actualDeduct;
    deductedNotesRecord.push({ returnNoteId: note.id, amount: actualDeduct });

    deductedEntriesForPo.push({
      returnNoteId: note.id,
      returnNumber: note.id,
      amount: actualDeduct,
      deductedAt: nowIso,
      note: `ประกบใบลดหนี้ ${note.id}`,
    });
  }

  saveSupplierReturnNotes(allReturnNotes);

  // 2. Process Cash / Transfer Payment & Bill Discount
  const netPaidCashOrTransfer = Math.max(0, Number(params.cashOrTransferAmount || 0));
  const billDiscount = Math.max(0, Number(params.discountAmount || 0));

  const allVouchers = readLocalVouchers();
  const dateObj = new Date(nowIso);
  const yy = dateObj.getFullYear().toString().slice(-2);
  const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  const prefix = `PV-${yy}${mm}`;
  const voucherCountThisMonth = allVouchers.filter((v) =>
    (v.voucherNumber || '').startsWith(prefix),
  ).length;
  const voucherNumber =
    backendVoucher?.voucherNumber ||
    `${prefix}${String(voucherCountThisMonth + 1).padStart(5, '0')}`;
  const voucherId = backendVoucher?.id || `voucher_${Date.now()}`;

  const paymentEntry: PayablePaymentEntry = {
    id: paymentId,
    voucherId,
    voucherNumber,
    paymentDate: nowIso,
    paymentMethod: params.paymentMethod,
    totalBillAmount: Number(targetPo.totalAmount || 0),
    deductedCreditAmount: totalDebitDeducted,
    discountAmount: billDiscount > 0 ? billDiscount : undefined,
    netCashOrTransferPaid: netPaidCashOrTransfer,
    deductedNotes: deductedNotesRecord,
    bankAccountId: params.bankAccountId,
    bankAccountLabel: params.bankAccountLabel,
    referenceNo: params.referenceNo,
    note: params.note,
    cashierName: params.cashierName || 'เจ้าหน้าที่การเงิน',
  };

  // 3. Update PO in storage
  if (totalDebitDeducted > 0) {
    targetPo.deductedReturns = [...(targetPo.deductedReturns || []), ...deductedEntriesForPo];
  }
  targetPo.payments = [...(targetPo.payments || []), paymentEntry];

  const totalAmount = Number(targetPo.totalAmount || 0);
  const totalDeducted = (targetPo.deductedReturns || []).reduce(
    (s: number, r: any) => s + Number(r.amount || 0),
    0,
  );
  const totalPaid = targetPo.payments.reduce(
    (s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0),
    0,
  );
  const totalDiscount = targetPo.payments.reduce(
    (s: number, p: any) => s + Number(p.discountAmount || 0),
    0,
  );

  targetPo.netAmountPayable = Math.max(
    0,
    Math.round((totalAmount - totalDeducted - totalPaid - totalDiscount) * 100) / 100,
  );

  if (targetPo.netAmountPayable <= 0) {
    targetPo.paymentStatus = 'PAID';
  } else {
    targetPo.paymentStatus = 'PARTIALLY_PAID';
  }

  savePurchaseOrders(allPos);

  // 4. Also register a PaymentVoucher for unified history
  const voucher: PaymentVoucher = {
    id: voucherId,
    voucherNumber,
    status: 'ACTIVE',
    supplierId: targetPo.supplierId || targetPo.supplier?.id || '',
    supplierName: targetPo.supplierName || targetPo.supplier?.name || 'ไม่ระบุผู้จำหน่าย',
    supplierContact: targetPo.supplier?.contactName,
    supplierPhone: targetPo.supplier?.phone,
    supplierAddress: targetPo.supplier?.address,
    paymentDate: nowIso,
    bills: [
      {
        poId: targetPo.id,
        poNumber: targetPo.poNumber,
        supplierInvoiceNo: targetPo.supplierInvoiceNo || targetPo.invoiceNo || '',
        billDate: targetPo.createdAt || targetPo.issueDate || targetPo.issuedAt || nowIso,
        totalBillAmount: totalAmount,
        remainingBeforePay: totalAmount,
        amountPaid: netPaidCashOrTransfer,
      },
    ],
    totalBillsAmount: totalAmount,
    deductedCreditAmount: totalDebitDeducted,
    deductedNotes: deductedNotesRecord,
    discountAmount: billDiscount > 0 ? billDiscount : undefined,
    netPaidAmount: netPaidCashOrTransfer,
    paymentMethod: params.paymentMethod,
    bankAccountId: params.bankAccountId,
    bankAccountLabel: params.bankAccountLabel,
    referenceNo: params.referenceNo,
    note: params.note,
    cashierName: params.cashierName || 'เจ้าหน้าที่การเงิน',
    createdAt: nowIso,
  };

  allVouchers.unshift(voucher);
  savePaymentVouchers(allVouchers);

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
  let backendVoucher: any = null;
  try {
    const payload = {
      supplierId: params.supplierId,
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
      paymentMethod: params.paymentMethod,
      bankAccountLabel: params.bankAccountLabel,
      referenceNo: params.referenceNo,
      note: params.note,
      cashierName: params.cashierName,
      paymentDate: params.paymentDate,
    };
    const res = await api.payables.settleMultiple(payload);
    if (res && res.voucher) {
      backendVoucher = res.voucher;
    }
  } catch (apiErr) {
    console.warn('[PayableService] Backend settle-multiple failed or offline, fallback to local:', apiErr);
  }

  const allPos = loadPurchaseOrders();
  const allReturnNotes = loadSupplierReturnNotes();
  const allVouchers = readLocalVouchers();
  const suppliers = loadSuppliers();
  const supp = suppliers.find((s) => s.id === params.supplierId);

  const nowIso = params.paymentDate || new Date().toISOString();
  const dateObj = new Date(nowIso);
  const yy = dateObj.getFullYear().toString().slice(-2);
  const mm = (dateObj.getMonth() + 1).toString().padStart(2, '0');
  const prefix = `PV-${yy}${mm}`;
  const voucherCountThisMonth = allVouchers.filter((v) =>
    (v.voucherNumber || '').startsWith(prefix),
  ).length;
  const voucherNumber =
    backendVoucher?.voucherNumber ||
    `${prefix}${String(voucherCountThisMonth + 1).padStart(5, '0')}`;
  const voucherId = backendVoucher?.id || `voucher_${Date.now()}`;

  // 1. Process matched Debit Notes
  let totalDebitDeducted = 0;
  const deductedNotesRecord: Array<{ returnNoteId: string; amount: number }> = [];

  for (const match of params.matchedDebitNotes) {
    if (match.amountToDeduct <= 0) continue;
    const note = allReturnNotes.find((n) => n.id === match.returnNoteId);
    if (!note) continue;

    const actualDeduct = Math.min(match.amountToDeduct, note.remainingCreditAmount);
    if (actualDeduct <= 0) continue;

    note.remainingCreditAmount = Math.max(
      0,
      Math.round((note.remainingCreditAmount - actualDeduct) * 100) / 100,
    );
    note.status = note.remainingCreditAmount <= 0 ? 'DEDUCTED' : 'PARTIALLY_DEDUCTED';

    note.deductions = [
      ...(note.deductions || []),
      {
        billNumber: voucherNumber,
        deductedAmount: actualDeduct,
        deductedAt: nowIso,
        netPaid: params.netCashOrTransferAmount,
        note: `ประกบหักในใบสำคัญจ่าย ${voucherNumber}`,
      },
    ];

    totalDebitDeducted += actualDeduct;
    deductedNotesRecord.push({ returnNoteId: note.id, amount: actualDeduct });
  }

  saveSupplierReturnNotes(allReturnNotes);

  // 2. Process each PO / Bill
  const voucherBillItems: PaymentVoucherBillItem[] = [];
  let totalBillsSettledAmount = 0;

  for (const b of params.billsToSettle) {
    if (b.amountToPay <= 0) continue;
    const targetPo = allPos.find((p) => p.id === b.poId);
    if (!targetPo) continue;

    const poTotal = Number(targetPo.totalAmount || 0);
    const prevDeducted = (targetPo.deductedReturns || []).reduce(
      (s: number, r: any) => s + Number(r.amount || 0),
      0,
    );
    const prevPaid = (targetPo.payments || []).reduce(
      (s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0),
      0,
    );
    const prevDiscount = (targetPo.payments || []).reduce(
      (s: number, p: any) => s + Number(p.discountAmount || 0),
      0,
    );
    const remainingBefore = Math.max(
      0,
      Math.round((poTotal - prevDeducted - prevPaid - prevDiscount) * 100) / 100,
    );

    const actualPayForThisPo = Math.min(b.amountToPay, remainingBefore);

    const paymentEntry: PayablePaymentEntry = {
      id: `PAY-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      voucherId,
      voucherNumber,
      paymentDate: nowIso,
      paymentMethod: params.paymentMethod,
      totalBillAmount: poTotal,
      deductedCreditAmount: 0,
      netCashOrTransferPaid: actualPayForThisPo,
      deductedNotes: [],
      bankAccountId: params.bankAccountId,
      bankAccountLabel: params.bankAccountLabel,
      referenceNo: params.referenceNo || voucherNumber,
      note: `ชำระตามใบสำคัญจ่าย ${voucherNumber}` + (params.note ? ` (${params.note})` : ''),
      cashierName: params.cashierName || 'เจ้าหน้าที่การเงิน',
    };

    targetPo.payments = [...(targetPo.payments || []), paymentEntry];

    const updatedPaid = (targetPo.payments || []).reduce(
      (s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0),
      0,
    );
    targetPo.netAmountPayable = Math.max(
      0,
      Math.round((poTotal - prevDeducted - updatedPaid - prevDiscount) * 100) / 100,
    );

    if (targetPo.netAmountPayable <= 0) {
      targetPo.paymentStatus = 'PAID';
    } else {
      targetPo.paymentStatus = 'PARTIALLY_PAID';
    }

    voucherBillItems.push({
      poId: targetPo.id,
      poNumber: targetPo.poNumber,
      supplierInvoiceNo: targetPo.supplierInvoiceNo || targetPo.invoiceNo || '',
      billDate: targetPo.createdAt || targetPo.issueDate || targetPo.issuedAt || nowIso,
      totalBillAmount: poTotal,
      remainingBeforePay: remainingBefore,
      amountPaid: actualPayForThisPo,
    });

    totalBillsSettledAmount += actualPayForThisPo;
  }

  savePurchaseOrders(allPos);

  // 3. Create Unified Payment Voucher
  const voucher: PaymentVoucher = {
    id: voucherId,
    voucherNumber,
    status: 'ACTIVE',
    supplierId: params.supplierId,
    supplierName: params.supplierName || supp?.name || 'ไม่ระบุผู้จำหน่าย',
    supplierContact: supp?.contactName,
    supplierPhone: supp?.phone,
    supplierAddress: supp?.address,
    paymentDate: nowIso,
    bills: voucherBillItems,
    totalBillsAmount: totalBillsSettledAmount,
    deductedCreditAmount: totalDebitDeducted,
    deductedNotes: deductedNotesRecord,
    discountAmount:
      params.discountAmount && params.discountAmount > 0 ? params.discountAmount : undefined,
    netPaidAmount: params.netCashOrTransferAmount,
    paymentMethod: params.paymentMethod,
    bankAccountId: params.bankAccountId,
    bankAccountLabel: params.bankAccountLabel,
    referenceNo: params.referenceNo,
    note: params.note,
    cashierName: params.cashierName || 'เจ้าหน้าที่การเงิน',
    createdAt: nowIso,
  };

  allVouchers.unshift(voucher);
  savePaymentVouchers(allVouchers);

  return {
    success: true,
    message: `สร้างใบชำระหนี้ ${voucherNumber} สำเร็จ (${voucherBillItems.length} บิล)`,
    voucher,
  };
}

// ─── Rollback / Cancel Payments for a Payable Bill ───
export function rollbackPayableBillPayment(
  poId: string,
  paymentId?: string,
): { success: boolean; message: string } {
  const allPos = loadPurchaseOrders();
  const targetPo = allPos.find((p) => p.id === poId);

  if (!targetPo) {
    return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลเจ้าหนี้นี้' };
  }

  const allReturnNotes = loadSupplierReturnNotes();
  const payments: PayablePaymentEntry[] = Array.isArray(targetPo.payments) ? targetPo.payments : [];

  const paymentsToRollback = paymentId
    ? payments.filter((p) => p.id === paymentId)
    : [...payments];

  if (
    paymentsToRollback.length === 0 &&
    (!targetPo.deductedReturns || targetPo.deductedReturns.length === 0)
  ) {
    return {
      success: false,
      message: 'บิลนี้ยังไม่มีประวัติการชำระเงินหรือการประกบใบลดหนี้',
    };
  }

  for (const pay of paymentsToRollback) {
    if (Array.isArray(pay.deductedNotes)) {
      for (const dn of pay.deductedNotes) {
        const note = allReturnNotes.find((n) => n.id === dn.returnNoteId);
        if (note) {
          note.remainingCreditAmount =
            Math.round((Number(note.remainingCreditAmount || 0) + Number(dn.amount)) * 100) / 100;
          note.status =
            note.remainingCreditAmount >= note.totalCreditAmount
              ? 'PENDING_DEDUCTION'
              : 'PARTIALLY_DEDUCTED';
          if (Array.isArray(note.deductions)) {
            note.deductions = note.deductions.filter((d) => d.billNumber !== targetPo.poNumber);
          }
        }
      }
    }
  }

  if (!paymentId) {
    for (const r of targetPo.deductedReturns || []) {
      const note = allReturnNotes.find((n) => n.id === r.returnNoteId);
      if (note) {
        note.remainingCreditAmount =
          Math.round((Number(note.remainingCreditAmount || 0) + Number(r.amount)) * 100) / 100;
        note.status =
          note.remainingCreditAmount >= note.totalCreditAmount
            ? 'PENDING_DEDUCTION'
            : 'PARTIALLY_DEDUCTED';
        if (Array.isArray(note.deductions)) {
          note.deductions = note.deductions.filter((d) => d.billNumber !== targetPo.poNumber);
        }
      }
    }
    targetPo.deductedReturns = [];
    targetPo.payments = [];
  } else {
    targetPo.payments = payments.filter((p) => p.id !== paymentId);
    const rolledBackNoteIds = new Set(
      paymentsToRollback.flatMap((p) => (p.deductedNotes || []).map((dn) => dn.returnNoteId)),
    );
    if (Array.isArray(targetPo.deductedReturns)) {
      targetPo.deductedReturns = targetPo.deductedReturns.filter(
        (r: any) => !rolledBackNoteIds.has(r.returnNoteId),
      );
    }
  }

  saveSupplierReturnNotes(allReturnNotes);

  const totalAmount = Number(targetPo.totalAmount || 0);
  const totalDeducted = (targetPo.deductedReturns || []).reduce(
    (s: number, r: any) => s + Number(r.amount || 0),
    0,
  );
  const totalPaid = (targetPo.payments || []).reduce(
    (s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0),
    0,
  );
  const totalDiscount = (targetPo.payments || []).reduce(
    (s: number, p: any) => s + Number(p.discountAmount || 0),
    0,
  );

  targetPo.netAmountPayable = Math.max(
    0,
    Math.round((totalAmount - totalDeducted - totalPaid - totalDiscount) * 100) / 100,
  );

  if (targetPo.netAmountPayable <= 0 && totalAmount > 0) {
    targetPo.paymentStatus = 'PAID';
  } else if (totalDeducted > 0 || totalPaid > 0 || totalDiscount > 0) {
    targetPo.paymentStatus = 'PARTIALLY_PAID';
  } else {
    targetPo.paymentStatus = 'UNPAID';
  }

  savePurchaseOrders(allPos);

  return {
    success: true,
    message: `ย้อนสถานะการชำระเงินของบิล ${targetPo.poNumber} สำเร็จ เครดิตใบลดหนี้และยอดหนี้ได้รับการปรับปรุงเรียบร้อย`,
  };
}

// ─── Cancel / Void Payable Bill ───
export function cancelPayableBill(
  poId: string,
  reason?: string,
): { success: boolean; message: string } {
  rollbackPayableBillPayment(poId);

  const allPos = loadPurchaseOrders();
  const targetPo = allPos.find((p) => p.id === poId);
  if (!targetPo) {
    return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลเจ้าหนี้' };
  }

  targetPo.status = 'CANCELLED';
  targetPo.notes =
    (targetPo.notes ? targetPo.notes + ' | ' : '') +
    `ยกเลิกบิลเจ้าหนี้: ${reason || 'ยกเลิกโดยผู้ใช้งาน'}`;
  savePurchaseOrders(allPos);

  return { success: true, message: `ยกเลิกบิล ${targetPo.poNumber} เรียบร้อยแล้ว` };
}

// ─── Cancel / Void Payment Voucher ───
export async function cancelPaymentVoucher(
  voucherId: string,
  cancelReason?: string,
): Promise<{ success: boolean; message: string }> {
  try {
    await api.payables.cancelVoucher(
      voucherId,
      cancelReason || 'ยกเลิกใบสำคัญจ่ายโดยผู้ใช้',
    );
  } catch (apiErr) {
    console.warn('[PayableService] Backend voucher cancellation failed, continuing local rollback:', apiErr);
  }

  const allVouchers = readLocalVouchers();
  const voucherIndex = allVouchers.findIndex(
    (v) => v.id === voucherId || v.voucherNumber === voucherId,
  );

  if (voucherIndex === -1) {
    return { success: false, message: 'ไม่พบใบสำคัญจ่ายนี้' };
  }

  const voucher = allVouchers[voucherIndex];

  if (voucher.status === 'CANCELLED') {
    return { success: false, message: 'ใบสำคัญจ่ายนี้ถูกยกเลิกไปแล้ว' };
  }

  const allPos = loadPurchaseOrders();
  const allReturnNotes = loadSupplierReturnNotes();

  if (Array.isArray(voucher.deductedNotes)) {
    for (const dn of voucher.deductedNotes) {
      const note = allReturnNotes.find((n) => n.id === dn.returnNoteId);
      if (note) {
        note.remainingCreditAmount =
          Math.round((Number(note.remainingCreditAmount || 0) + Number(dn.amount)) * 100) / 100;
        note.status =
          note.remainingCreditAmount >= note.totalCreditAmount
            ? 'PENDING_DEDUCTION'
            : 'PARTIALLY_DEDUCTED';
        if (Array.isArray(note.deductions)) {
          note.deductions = note.deductions.filter(
            (d) =>
              !d.note?.includes(voucher.voucherNumber) &&
              !voucher.bills.some((b) => b.poNumber === d.billNumber),
          );
        }
      }
    }
    saveSupplierReturnNotes(allReturnNotes);
  }

  for (const bill of voucher.bills) {
    const targetPo = allPos.find(
      (p) => p.id === bill.poId || p.poNumber === bill.poNumber,
    );
    if (!targetPo) continue;

    if (Array.isArray(targetPo.payments)) {
      targetPo.payments = targetPo.payments.filter((p: any) => {
        if (
          p.voucherId &&
          (p.voucherId === voucher.id || p.voucherId === voucher.voucherNumber)
        )
          return false;
        if (p.voucherNumber && p.voucherNumber === voucher.voucherNumber) return false;
        if (p.referenceNo && p.referenceNo === voucher.voucherNumber) return false;
        if (p.note && p.note.includes(voucher.voucherNumber)) return false;
        if (p.id === voucher.id || p.id === voucher.voucherNumber) return false;
        return true;
      });
    }

    if (Array.isArray(targetPo.deductedReturns) && Array.isArray(voucher.deductedNotes)) {
      const dnIds = new Set(voucher.deductedNotes.map((dn) => dn.returnNoteId));
      targetPo.deductedReturns = targetPo.deductedReturns.filter(
        (r: any) => !dnIds.has(r.returnNoteId),
      );
    }

    const poTotal = Number(targetPo.totalAmount || 0);
    const prevDeducted = (targetPo.deductedReturns || []).reduce(
      (s: number, r: any) => s + Number(r.amount || 0),
      0,
    );
    const prevPaid = (targetPo.payments || []).reduce(
      (s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0),
      0,
    );
    const prevDiscount = (targetPo.payments || []).reduce(
      (s: number, p: any) => s + Number(p.discountAmount || 0),
      0,
    );

    targetPo.netAmountPayable = Math.max(
      0,
      Math.round((poTotal - prevDeducted - prevPaid - prevDiscount) * 100) / 100,
    );
    if (targetPo.netAmountPayable <= 0) {
      targetPo.paymentStatus = 'PAID';
    } else if (targetPo.netAmountPayable < poTotal) {
      targetPo.paymentStatus = 'PARTIALLY_PAID';
    } else {
      targetPo.paymentStatus = 'UNPAID';
    }
  }

  savePurchaseOrders(allPos);

  voucher.status = 'CANCELLED';
  voucher.cancelledAt = new Date().toISOString();
  voucher.cancelReason = cancelReason?.trim() || 'ยกเลิกใบสำคัญจ่ายโดยผู้ใช้';

  allVouchers[voucherIndex] = voucher;
  savePaymentVouchers(allVouchers);

  return {
    success: true,
    message: `ยกเลิกใบสำคัญจ่าย ${voucher.voucherNumber} สำเร็จ และคืนสถานะหนี้ค้างชำระเรียบร้อยแล้ว`,
  };
}
