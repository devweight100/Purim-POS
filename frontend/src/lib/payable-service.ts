import { loadPurchaseOrders, savePurchaseOrders, loadSuppliers, loadSupplierReturnNotes, saveSupplierReturnNotes } from './supplier-return-service';
import { SupplierReturnNote } from './types';

export interface PayablePaymentEntry {
  id: string;
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
  supplierId: string;
  supplierName: string;
  supplierContact?: string;
  supplierPhone?: string;
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
        supplierId: po.supplierId || supp.id || 'supp_1',
        supplierName: po.supplierName || supp.name || 'ไม่ระบุผู้จำหน่าย',
        supplierContact: supp.contactName,
        supplierPhone: supp.phone,
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

  const paymentEntry: PayablePaymentEntry = {
    id: paymentId,
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
  targetPo.deductedReturns = [...(targetPo.deductedReturns || []), ...deductedEntriesForPo];
  targetPo.payments = [...(targetPo.payments || []), paymentEntry];

  const totalAmount = Number(targetPo.totalAmount || 0);
  const totalDeducted = targetPo.deductedReturns.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
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

  return {
    success: true,
    message: `บันทึกการชำระเงินบิล ${targetPo.poNumber} สำเร็จ`,
    paymentEntry,
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
