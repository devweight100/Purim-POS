/**
 * FROZEN COPY of the bill mapping the payables page ran in the browser (frontend/src/lib/payable-service.ts
 * as of commit b67c198: normalizeVoucherRow, receivedValueOf, mapPosToPayableBills) and of the page's
 * cards / filter. Test oracle only: the payables parity e2e test feeds it what the old page downloaded
 * (/purchase-orders?limit=1000, /suppliers, /payables/vouchers?limit=200, /supplier-returns?limit=200)
 * and checks GET /api/payables/bills gives the same figures. Types loosened to `any`; do not "fix" it.
 */
/* eslint-disable */
type ApiPaymentVoucher = any;
type ApiPurchaseOrder = any;
type ApiSupplier = any;
type PayablePaymentEntry = any;
type PaymentVoucher = any;
type PaymentVoucherBillItem = any;
type SupplierPayableBill = any;

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

const PAYABLE_PO_STATUSES = ['PARTIALLY_RECEIVED', 'RECEIVED', 'COMPLETED'];

function receivedValueOf(po: ApiPurchaseOrder): number {
  const items = Array.isArray(po.items) ? po.items : [];
  if (!items.length) return Number(po.totalAmount || 0);
  return items.reduce(
    (sum: number, i) => sum + (Number(i.receivedQty ?? i.receivedQuantity) || 0) * (Number(i.unitCost) || 0),
    0,
  );
}

export function mapPosToPayableBills(
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


/** The payables page's cards (over every bill) and its bill filter. */
export function pageCards(bills: any[], returnNotes: any[]) {
  const totalOutstandingDebt = bills.reduce((sum, b) => sum + b.remainingPayable, 0);
  const unpaidBillsCount = bills.filter((b) => b.paymentStatus !== 'PAID').length;
  const availableDebitNotes = returnNotes.filter((n) => n.status !== 'CANCELLED' && n.remainingCreditAmount > 0);
  const totalAvailableDebitCredit = availableDebitNotes.reduce((sum, n) => sum + Number(n.remainingCreditAmount || 0), 0);
  const totalPaidAmount = bills.reduce((sum, b) => sum + b.alreadyPaidAmount + b.alreadyDeductedReturns, 0);
  return { totalOutstandingDebt, unpaidBillsCount, totalAvailableDebitCredit, availableCreditCount: availableDebitNotes.length, totalPaidAmount };
}

export function pageFilter(bills: any[], search: string, supplierFilter: string, statusFilter: string) {
  return bills.filter((b) => {
    const matchesSearch =
      b.poNumber.toLowerCase().includes(search.toLowerCase()) ||
      b.supplierName.toLowerCase().includes(search.toLowerCase());
    const matchesSupplier = supplierFilter === 'ALL' || b.supplierId === supplierFilter;
    const matchesStatus =
      statusFilter === 'ALL' ||
      (statusFilter === 'UNPAID' && b.paymentStatus === 'UNPAID') ||
      (statusFilter === 'PARTIALLY_PAID' && b.paymentStatus === 'PARTIALLY_PAID') ||
      (statusFilter === 'PAID' && b.paymentStatus === 'PAID');
    return matchesSearch && matchesSupplier && matchesStatus;
  });
}
