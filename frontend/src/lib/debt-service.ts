'use client';

import { DebtRecord, DebtPaymentInstallment, PaymentMethodType, ApiDebt, ApiDebtPayment, ApiPage, DebtPayResponse } from './types';
import { apiFetch } from './api';
import { isRetryableError } from './api-error';
import { newOperationId } from './order-sync-service';
import { useShiftStore } from './store/shift-store';

let lastDebtSyncAt = 0;
/** Last debt list the server returned in this session (memory only, never localStorage). */
let lastServerDebts: DebtRecord[] = [];

/**
 * Debts the server returned most recently in this session (empty until the first fetch) and a
 * background refresh. Pages that show debts call fetchDebtRecords() and handle its errors.
 */
export function loadAllDebtRecords(): DebtRecord[] {
  if (typeof window === 'undefined') return [];

  if (Date.now() - lastDebtSyncAt > 10000) {
    lastDebtSyncAt = Date.now();
    void fetchDebtRecords().catch(() => {});
  }
  return lastServerDebts;
}

type DebtCustomerProfile = NonNullable<NonNullable<ApiDebt['customer']>['profile']>;

function mapDebt(row: ApiDebt): DebtRecord {
  const totalAmount = Number(row.totalDebt);
  const paidAmount = Number(row.paidAmount);
  let previousPaid = 0;
  // cancelled receipts no longer count as paid
  const installments: DebtPaymentInstallment[] = [...(row.payments || [])].filter((p) => !p.cancelledAt)
    .sort((a, b) => new Date(a.paymentDate).getTime() - new Date(b.paymentDate).getTime())
    .map((payment, index) => {
      const amountPaid = Number(payment.amount);
      const result = {
        id: payment.id,
        receiptNo: payment.receiptNo,
        installmentNo: index + 1,
        paymentDate: payment.paymentDate,
        amountPaid,
        paymentMethod: payment.paymentMethod,
        referenceNo: payment.referenceNo,
        cashierName: payment.cashierName,
        note: payment.note,
        previousPaid,
        remainingAfter: Math.max(0, totalAmount - previousPaid - amountPaid),
      };
      previousPaid += amountPaid;
      return result;
    });
  const profile = row.customer?.profile;
  const custProfile: DebtCustomerProfile = typeof profile === 'object' && profile !== null ? profile : {};
  return {
    orderId: row.orderId,
    orderNumber: row.order?.orderNumber || row.orderId,
    orderDate: row.order?.createdAt || row.createdAt,
    dueDate: row.dueDate,
    customerId: row.customerId,
    customerCode: custProfile.code || row.customer?.code || '',
    customerName: row.customer?.name || '',
    customerPhone: row.customer?.phone || '',
    customerType: custProfile.type || 'INDIVIDUAL',
    companyName: custProfile.companyName || '',
    taxId: custProfile.taxId || '',
    taxAddress: custProfile.taxAddress || row.customer?.address || '',
    totalAmount,
    paidAmount,
    remainingDebt: Number(row.remainingAmount),
    // rounded to 2 decimals for display (e.g. 37.63%)
    progressPercent: totalAmount ? Math.min(100, Math.round((paidAmount / totalAmount) * 10000) / 100) : 100,
    status: Number(row.remainingAmount) <= 0 ? 'PAID' : paidAmount > 0 ? 'PARTIAL' : 'UNPAID',
    installments,
    lastPaymentDate: installments.at(-1)?.paymentDate,
  };
}

export async function fetchDebtRecords(): Promise<DebtRecord[]> {
  const rows: DebtRecord[] = [];
  let page = 1;
  while (true) {
    const result = await apiFetch<ApiPage<ApiDebt> | null>('/debts?limit=100&page=' + page);
    if (!Array.isArray(result?.data)) throw new Error('ข้อมูลหนี้จากฐานข้อมูลไม่ถูกต้อง');
    rows.push(...result.data.map(mapDebt));
    if (page >= (result.meta?.totalPages || 1)) break;
    page++;
  }
  lastDebtSyncAt = Date.now();
  lastServerDebts = rows;
  return rows;
}

export async function recordDebtPayment(
  orderId: string,
  amount: number,
  paymentMethod: PaymentMethodType,
  options?: { accountLabel?: string; bankAccountId?: string; referenceNo?: string; note?: string; cashierName?: string },
): Promise<{
  success: boolean;
  debtRecord?: DebtRecord;
  installment?: DebtPaymentInstallment;
  error?: string;
}> {
  const ownerId = JSON.parse(localStorage.getItem('auth-storage') || '{}').state?.user?.id;
  if (!ownerId) throw new Error('กรุณาเข้าสู่ระบบก่อนรับชำระ');
  const shiftId =
    paymentMethod === 'CASH' ? useShiftStore.getState().currentShift?.id : undefined;
  if (paymentMethod === 'CASH' && !shiftId) throw new Error('กรุณาเปิดกะก่อนรับเงินสด');
  const body = {
    amount,
    paymentMethod,
    referenceNo: options?.referenceNo,
    note: options?.note,
    shiftId,
  };
  const fingerprint = JSON.stringify(body);
  const bankAccountId = paymentMethod === 'CASH' ? undefined : options?.bankAccountId;
  const key = 'purim-debt-payment-attempt:' + ownerId + ':' + orderId;
  const existing = localStorage.getItem(key);
  const attempt = existing
    ? JSON.parse(existing)
    : { fingerprint, clientPaymentId: newOperationId() };
  if (attempt.fingerprint !== fingerprint)
    throw new Error(
      'มีการรับชำระเดิมที่ยังไม่ทราบผล กรุณาตรวจประวัติหรือส่งยอดและวิธีชำระเดิมซ้ำก่อน',
    );
  // Persist only retry identity; receipt and balances are always supplied by the DB.
  localStorage.setItem(key, JSON.stringify(attempt));
  let response: DebtPayResponse | null;
  try {
    response = await apiFetch<DebtPayResponse | null>('/debts/' + orderId + '/pay', {
      method: 'POST',
      body: JSON.stringify({ ...body, bankAccountId, clientPaymentId: attempt.clientPaymentId }),
    });
  } catch (error) {
    if (!isRetryableError(error)) localStorage.removeItem(key);
    throw error;
  }
  if (!response?.success || !response.payment?.id || !response.debt)
    throw new Error('ยังไม่ได้รับการยืนยันจากฐานข้อมูล กรุณาตรวจสอบหรือส่งซ้ำด้วยข้อมูลเดิม');
  const debtRecord = mapDebt(response.debt);
  const paymentId = response.payment.id;
  const installment = debtRecord.installments.find((row) => row.id === paymentId);
  try {
    localStorage.removeItem(key);
  } catch {}
  lastServerDebts = [...lastServerDebts.filter((row) => row.orderId !== orderId), debtRecord];
  void useShiftStore.getState().fetchCurrentShift();
  return { success: true, debtRecord, installment };
}

/**
 * Get all debt payment collections made during a shift timeframe
 */
export function getShiftDebtCollections(
  shiftStartTime: number,
  shiftEndTime: number,
): {
  count: number;
  total: number;
  cashTotal: number;
  qrTransferTotal: number;
  installments: Array<{
    orderNumber?: string;
    customerName?: string;
    amount: number;
    method: string;
    time: string;
  }>;
} {
  const allDebts = loadAllDebtRecords();
  let count = 0;
  let total = 0;
  let cashTotal = 0;
  let qrTransferTotal = 0;
  const list: Array<{ orderNumber?: string; customerName?: string; amount: number; method: string; time: string }> = [];

  allDebts.forEach((debt) => {
    (debt.installments || []).forEach((inst) => {
      const pTime = new Date(inst.paymentDate).getTime();
      if (pTime >= shiftStartTime && pTime <= shiftEndTime) {
        count++;
        total += inst.amountPaid;
        if (inst.paymentMethod === 'CASH') {
          cashTotal += inst.amountPaid;
        } else {
          qrTransferTotal += inst.amountPaid;
        }
        list.push({
          orderNumber: debt.orderNumber,
          customerName: debt.customerName,
          amount: inst.amountPaid,
          method: inst.paymentMethod,
          time: inst.paymentDate,
        });
      }
    });
  });

  return {
    count,
    total,
    cashTotal,
    qrTransferTotal,
    installments: list,
  };
}

/**
 * Get DebtRecord for a specific order ID or orderNumber
 */
export function getDebtRecordByOrderId(orderId: string): DebtRecord | null {
  if (!orderId) return null;
  const all = loadAllDebtRecords();
  return all.find((d) => d.orderId === orderId || d.orderNumber === orderId) || null;
}

/** Cancel a debt receipt recorded by mistake (ADMIN / MANAGER). The debt goes back up. */
export async function cancelDebtPayment(paymentId: string, reason: string) {
  const res = await apiFetch<ApiDebtPayment>(`/debts/payments/${encodeURIComponent(paymentId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
  try { await fetchDebtRecords(); } catch {}
  return res;
}
