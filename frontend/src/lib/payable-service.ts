import { loadPurchaseOrders, savePurchaseOrders, loadSuppliers, loadSupplierReturnNotes, saveSupplierReturnNotes } from './supplier-return-service';
import { SupplierReturnNote } from './types';

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

export function loadPaymentVouchers(): PaymentVoucher[] {
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

export function savePaymentVouchers(vouchers: PaymentVoucher[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(PAYMENT_VOUCHERS_KEY, JSON.stringify(vouchers));
  } catch (e) {
    console.error('Error saving payment vouchers:', e);
  }
}

export function getPaymentVoucherById(id: string): PaymentVoucher | undefined {
  return loadPaymentVouchers().find((v) => v.id === id || v.voucherNumber === id);
}

export function updateBillInvoiceNo(
  poId: string,
  supplierInvoiceNo: string,
  supplierInvoiceDate?: string
): { success: boolean; message: string } {
  const allPos = loadPurchaseOrders();
  const po = allPos.find((p) => p.id === poId);
  if (!po) return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลนี้' };

  po.supplierInvoiceNo = supplierInvoiceNo.trim();
  if (supplierInvoiceDate) {
    po.supplierInvoiceDate = supplierInvoiceDate;
  }
  savePurchaseOrders(allPos);
  return { success: true, message: 'บันทึกเลขที่บิลผู้จำหน่ายเรียบร้อยแล้ว' };
}

export function loadPayableBills(): SupplierPayableBill[] {
  const pos = loadPurchaseOrders();
  const suppliers = loadSuppliers();

  return pos
    .filter((po) => po.status !== 'CANCELLED' && po.status !== 'DRAFT')
    .map((po) => {
      const totalAmount = Number(po.totalAmount || 0);

      const deductedReturns = Array.isArray(po.deductedReturns) ? po.deductedReturns : [];
      const alreadyDeducted = deductedReturns.reduce(
        (sum: number, r: any) => sum + Number(r.amount || 0),
        0
      );

      const payments: PayablePaymentEntry[] = Array.isArray(po.payments) ? po.payments : [];
      const alreadyPaid = payments.reduce(
        (sum: number, p: any) => sum + Number(p.netCashOrTransferPaid || 0),
        0
      );
      const alreadyDiscount = payments.reduce(
        (sum: number, p: any) => sum + Number(p.discountAmount || 0),
        0
      );

      const remainingPayable = Math.max(
        0,
        Math.round((totalAmount - alreadyDeducted - alreadyPaid - alreadyDiscount) * 100) / 100
      );

      let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
      if (remainingPayable <= 0 && totalAmount > 0) {
        paymentStatus = 'PAID';
      } else if (alreadyDeducted > 0 || alreadyPaid > 0 || alreadyDiscount > 0) {
        paymentStatus = 'PARTIALLY_PAID';
      }

      const supp = suppliers.find((s) => s.id === (po.supplierId || po.supplier?.id)) || po.supplier || {};

      return {
        poId: po.id,
        poNumber: po.poNumber,
        supplierInvoiceNo: po.supplierInvoiceNo || po.invoiceNo || '',
        supplierInvoiceDate: po.supplierInvoiceDate || po.invoiceDate || '',
        supplierId: po.supplierId || supp.id || 'supp_1',
        supplierName: po.supplierName || supp.name || 'ไม่ระบุผู้จำหน่าย',
        supplierContact: supp.contactName,
        supplierPhone: supp.phone,
        supplierAddress: supp.address,
        billDate: po.createdAt || po.issueDate || po.issuedAt || new Date().toISOString(),
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

export function settlePayableBill(params: SettlePayableParams): {
  success: boolean;
  message: string;
  paymentEntry?: PayablePaymentEntry;
  updatedBill?: SupplierPayableBill;
  voucher?: PaymentVoucher;
} {
  const allPos = loadPurchaseOrders();
  const targetPo = allPos.find((p) => p.id === params.poId);

  if (!targetPo) {
    return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลเจ้าหนี้นี้' };
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

    note.remainingCreditAmount = Math.max(0, Math.round((note.remainingCreditAmount - actualDeduct) * 100) / 100);
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

  const allVouchers = loadPaymentVouchers();
  const dateStr = new Date(nowIso).toISOString().slice(0, 10).replace(/-/g, '');
  const voucherCountToday = allVouchers.filter((v) => v.createdAt?.slice(0, 10).replace(/-/g, '') === dateStr).length;
  const voucherNumber = `PV-${dateStr}-${String(voucherCountToday + 1).padStart(4, '0')}`;
  const voucherId = `voucher_${Date.now()}`;

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
  const totalDeducted = (targetPo.deductedReturns || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const totalPaid = targetPo.payments.reduce((s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0), 0);
  const totalDiscount = targetPo.payments.reduce((s: number, p: any) => s + Number(p.discountAmount || 0), 0);
  
  targetPo.netAmountPayable = Math.max(
    0,
    Math.round((totalAmount - totalDeducted - totalPaid - totalDiscount) * 100) / 100
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
    supplierId: targetPo.supplierId || targetPo.supplier?.id || 'supp_1',
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

export function settleMultipleBills(params: SettleMultipleBillsParams): {
  success: boolean;
  message: string;
  voucher?: PaymentVoucher;
} {
  const allPos = loadPurchaseOrders();
  const allReturnNotes = loadSupplierReturnNotes();
  const allVouchers = loadPaymentVouchers();
  const suppliers = loadSuppliers();
  const supp = suppliers.find((s) => s.id === params.supplierId);

  const nowIso = params.paymentDate || new Date().toISOString();
  const dateStr = new Date(nowIso).toISOString().slice(0, 10).replace(/-/g, '');
  const voucherCountToday = allVouchers.filter((v) => v.createdAt?.slice(0, 10).replace(/-/g, '') === dateStr).length;
  const voucherNumber = `PV-${dateStr}-${String(voucherCountToday + 1).padStart(4, '0')}`;
  const voucherId = `voucher_${Date.now()}`;

  // 1. Process matched Debit Notes
  let totalDebitDeducted = 0;
  const deductedNotesRecord: Array<{ returnNoteId: string; amount: number }> = [];

  for (const match of params.matchedDebitNotes) {
    if (match.amountToDeduct <= 0) continue;
    const note = allReturnNotes.find((n) => n.id === match.returnNoteId);
    if (!note) continue;

    const actualDeduct = Math.min(match.amountToDeduct, note.remainingCreditAmount);
    if (actualDeduct <= 0) continue;

    note.remainingCreditAmount = Math.max(0, Math.round((note.remainingCreditAmount - actualDeduct) * 100) / 100);
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
    const prevDeducted = (targetPo.deductedReturns || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const prevPaid = (targetPo.payments || []).reduce((s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0), 0);
    const prevDiscount = (targetPo.payments || []).reduce((s: number, p: any) => s + Number(p.discountAmount || 0), 0);
    const remainingBefore = Math.max(0, Math.round((poTotal - prevDeducted - prevPaid - prevDiscount) * 100) / 100);

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

    const updatedPaid = (targetPo.payments || []).reduce((s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0), 0);
    targetPo.netAmountPayable = Math.max(0, Math.round((poTotal - prevDeducted - updatedPaid - prevDiscount) * 100) / 100);

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
    discountAmount: params.discountAmount && params.discountAmount > 0 ? params.discountAmount : undefined,
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
  paymentId?: string
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

  if (paymentsToRollback.length === 0 && (!targetPo.deductedReturns || targetPo.deductedReturns.length === 0)) {
    return { success: false, message: 'บิลนี้ยังไม่มีประวัติการชำระเงินหรือการประกบใบลดหนี้' };
  }

  // 1. Rollback matched debit notes
  for (const pay of paymentsToRollback) {
    if (Array.isArray(pay.deductedNotes)) {
      for (const dn of pay.deductedNotes) {
        const note = allReturnNotes.find((n) => n.id === dn.returnNoteId);
        if (note) {
          note.remainingCreditAmount = Math.round((Number(note.remainingCreditAmount || 0) + Number(dn.amount)) * 100) / 100;
          note.status = note.remainingCreditAmount >= note.totalCreditAmount ? 'PENDING_DEDUCTION' : 'PARTIALLY_DEDUCTED';
          if (Array.isArray(note.deductions)) {
            note.deductions = note.deductions.filter((d) => d.billNumber !== targetPo.poNumber);
          }
        }
      }
    }
  }

  // 2. Rollback po.deductedReturns
  if (!paymentId) {
    // Entire bill rollback
    for (const r of (targetPo.deductedReturns || [])) {
      const note = allReturnNotes.find((n) => n.id === r.returnNoteId);
      if (note) {
        note.remainingCreditAmount = Math.round((Number(note.remainingCreditAmount || 0) + Number(r.amount)) * 100) / 100;
        note.status = note.remainingCreditAmount >= note.totalCreditAmount ? 'PENDING_DEDUCTION' : 'PARTIALLY_DEDUCTED';
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
      paymentsToRollback.flatMap((p) => (p.deductedNotes || []).map((dn) => dn.returnNoteId))
    );
    if (Array.isArray(targetPo.deductedReturns)) {
      targetPo.deductedReturns = targetPo.deductedReturns.filter(
        (r: any) => !rolledBackNoteIds.has(r.returnNoteId)
      );
    }
  }

  saveSupplierReturnNotes(allReturnNotes);

  // 3. Recalculate PO debt and paymentStatus
  const totalAmount = Number(targetPo.totalAmount || 0);
  const totalDeducted = (targetPo.deductedReturns || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
  const totalPaid = (targetPo.payments || []).reduce((s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0), 0);
  const totalDiscount = (targetPo.payments || []).reduce((s: number, p: any) => s + Number(p.discountAmount || 0), 0);

  targetPo.netAmountPayable = Math.max(0, Math.round((totalAmount - totalDeducted - totalPaid - totalDiscount) * 100) / 100);

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
export function cancelPayableBill(poId: string, reason?: string): { success: boolean; message: string } {
  // First rollback any payments if present
  rollbackPayableBillPayment(poId);

  const allPos = loadPurchaseOrders();
  const targetPo = allPos.find((p) => p.id === poId);
  if (!targetPo) {
    return { success: false, message: 'ไม่พบใบสั่งซื้อ / บิลเจ้าหนี้' };
  }

  targetPo.status = 'CANCELLED';
  targetPo.notes = (targetPo.notes ? targetPo.notes + ' | ' : '') + `ยกเลิกบิลเจ้าหนี้: ${reason || 'ยกเลิกโดยผู้ใช้งาน'}`;
  savePurchaseOrders(allPos);

  return { success: true, message: `ยกเลิกบิล ${targetPo.poNumber} เรียบร้อยแล้ว` };
}

// ─── Cancel / Void Payment Voucher ───
export function cancelPaymentVoucher(
  voucherId: string,
  cancelReason?: string
): { success: boolean; message: string } {
  const allVouchers = loadPaymentVouchers();
  const voucherIndex = allVouchers.findIndex((v) => v.id === voucherId || v.voucherNumber === voucherId);

  if (voucherIndex === -1) {
    return { success: false, message: 'ไม่พบใบสำคัญจ่ายนี้' };
  }

  const voucher = allVouchers[voucherIndex];

  if (voucher.status === 'CANCELLED') {
    return { success: false, message: 'ใบสำคัญจ่ายนี้ถูกยกเลิกไปแล้ว' };
  }

  const allPos = loadPurchaseOrders();
  const allReturnNotes = loadSupplierReturnNotes();

  // 1. Roll back debit notes deducted in this voucher
  if (Array.isArray(voucher.deductedNotes)) {
    for (const dn of voucher.deductedNotes) {
      const note = allReturnNotes.find((n) => n.id === dn.returnNoteId);
      if (note) {
        note.remainingCreditAmount = Math.round((Number(note.remainingCreditAmount || 0) + Number(dn.amount)) * 100) / 100;
        note.status = note.remainingCreditAmount >= note.totalCreditAmount ? 'PENDING_DEDUCTION' : 'PARTIALLY_DEDUCTED';
        if (Array.isArray(note.deductions)) {
          note.deductions = note.deductions.filter((d) => 
            !d.note?.includes(voucher.voucherNumber) && 
            !voucher.bills.some(b => b.poNumber === d.billNumber)
          );
        }
      }
    }
    saveSupplierReturnNotes(allReturnNotes);
  }

  // 2. Roll back payments on all POs/bills covered by this voucher
  for (const bill of voucher.bills) {
    const targetPo = allPos.find((p) => p.id === bill.poId || p.poNumber === bill.poNumber);
    if (!targetPo) continue;

    // Remove payment entries tied to this voucher
    if (Array.isArray(targetPo.payments)) {
      targetPo.payments = targetPo.payments.filter((p: any) => {
        if (p.voucherId && (p.voucherId === voucher.id || p.voucherId === voucher.voucherNumber)) return false;
        if (p.voucherNumber && p.voucherNumber === voucher.voucherNumber) return false;
        if (p.referenceNo && p.referenceNo === voucher.voucherNumber) return false;
        if (p.note && p.note.includes(voucher.voucherNumber)) return false;
        if (p.id === voucher.id || p.id === voucher.voucherNumber) return false;
        return true;
      });
    }

    // Also if targetPo had deductedReturns from this voucher
    if (Array.isArray(targetPo.deductedReturns) && Array.isArray(voucher.deductedNotes)) {
      const dnIds = new Set(voucher.deductedNotes.map(dn => dn.returnNoteId));
      targetPo.deductedReturns = targetPo.deductedReturns.filter((r: any) => !dnIds.has(r.returnNoteId));
    }

    // Recalculate debt & status
    const poTotal = Number(targetPo.totalAmount || 0);
    const prevDeducted = (targetPo.deductedReturns || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
    const prevPaid = (targetPo.payments || []).reduce((s: number, p: any) => s + Number(p.netCashOrTransferPaid || 0), 0);
    const prevDiscount = (targetPo.payments || []).reduce((s: number, p: any) => s + Number(p.discountAmount || 0), 0);
    
    targetPo.netAmountPayable = Math.max(0, Math.round((poTotal - prevDeducted - prevPaid - prevDiscount) * 100) / 100);
    if (targetPo.netAmountPayable <= 0) {
      targetPo.paymentStatus = 'PAID';
    } else if (targetPo.netAmountPayable < poTotal) {
      targetPo.paymentStatus = 'PARTIALLY_PAID';
    } else {
      targetPo.paymentStatus = 'UNPAID';
    }
  }

  savePurchaseOrders(allPos);

  // 3. Mark voucher as CANCELLED
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

