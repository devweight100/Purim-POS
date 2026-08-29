import { loadPurchaseOrders, savePurchaseOrders, loadSuppliers, loadSupplierReturnNotes, saveSupplierReturnNotes } from './supplier-return-service';
import { useShiftStore } from './store/shift-store';
import { SupplierReturnNote } from './types';

export interface PayablePaymentEntry {
  id: string;
  paymentDate: string;
  paymentMethod: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER';
  totalBillAmount: number;
  deductedCreditAmount: number;
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
  remainingPayable: number;
  itemsCount: number;
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

      const remainingPayable = Math.max(0, Math.round((totalAmount - alreadyDeducted - alreadyPaid) * 100) / 100);

      let paymentStatus: 'UNPAID' | 'PARTIALLY_PAID' | 'PAID' = 'UNPAID';
      if (remainingPayable <= 0 && totalAmount > 0) {
        paymentStatus = 'PAID';
      } else if (alreadyDeducted > 0 || alreadyPaid > 0) {
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
        remainingPayable,
        itemsCount: (po.items || []).length,
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
  cashOrTransferAmount: number;
  paymentMethod: 'CASH' | 'TRANSFER' | 'CHEQUE' | 'OTHER';
  bankAccountId?: string;
  bankAccountLabel?: string;
  referenceNo?: string;
  note?: string;
  cashierName?: string;
  deductFromCashDrawer?: boolean;
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

  // 2. Process Cash / Transfer Payment
  const netPaidCashOrTransfer = Math.max(0, Number(params.cashOrTransferAmount || 0));

  // If paid via cash and drawer deduction requested, record in shift store
  if (params.paymentMethod === 'CASH' && params.deductFromCashDrawer && netPaidCashOrTransfer > 0) {
    try {
      const shiftState = useShiftStore.getState();
      shiftState.addCashTransaction(
        'out',
        netPaidCashOrTransfer,
        `ชำระหนี้เจ้าหนี้ บิล ${targetPo.poNumber} (${targetPo.supplierName || 'บริษัท'}) [${paymentId}]`
      );
    } catch (e) {
      console.error('Failed to deduct from cash drawer:', e);
    }
  }

  const paymentEntry: PayablePaymentEntry = {
    id: paymentId,
    paymentDate: nowIso,
    paymentMethod: params.paymentMethod,
    totalBillAmount: Number(targetPo.totalAmount || 0),
    deductedCreditAmount: totalDebitDeducted,
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
  targetPo.netAmountPayable = Math.max(0, Math.round((totalAmount - totalDeducted - totalPaid) * 100) / 100);

  if (targetPo.netAmountPayable <= 0) {
    targetPo.paymentStatus = 'PAID';
  } else {
    targetPo.paymentStatus = 'PARTIALLY_PAID';
  }

  savePurchaseOrders(allPos);

  return {
    success: true,
    message: `บันทึกการชำระเงินและประกบใบลดหนี้บิล ${targetPo.poNumber} สำเร็จ`,
    paymentEntry,
  };
}
