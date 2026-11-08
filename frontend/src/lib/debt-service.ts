'use client';

import { DebtRecord, DebtPaymentInstallment, DebtStatus, Order, PaymentMethodType } from './types';
import { loadCustomers, Customer } from './customer-service';
import { apiFetch } from './api';
import { isRetryableError } from './api-error';
import { newOperationId } from './order-sync-service';
import { useShiftStore } from './store/shift-store';

const STORAGE_KEY_DEBT_PAYMENTS = 'pos_debt_payments_history';
const STORAGE_KEY_MANUAL_DEBTS = 'pos_manual_debt_records';
const STORAGE_KEY_CONFIRMED_DEBTS = 'pos_confirmed_debts';

let lastDebtSyncAt = 0;

/**
 * Initial sample credit orders for mock customers with initial debt
 */
const INITIAL_SAMPLE_DEBTS: DebtRecord[] = [];

function getStoredInstallments(): Record<string, DebtPaymentInstallment[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DEBT_PAYMENTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * Load all credit orders & customer debts from confirmed backend mirror (or offline fallback)
 */
export function loadAllDebtRecords(): DebtRecord[] {
  if (typeof window === 'undefined') return INITIAL_SAMPLE_DEBTS;

  if (Date.now() - lastDebtSyncAt > 10000) {
    lastDebtSyncAt = Date.now();
    void fetchDebtRecords().catch(() => {});
  }

  try {
    const confirmed = localStorage.getItem(STORAGE_KEY_CONFIRMED_DEBTS);
    if (confirmed !== null) {
      const parsed = JSON.parse(confirmed);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}

  // Debts exist only in the database. Never derive "debts" from bills cached in this browser
  // (they could be voided / unsynced and would show phantom balances).
  return [];
}

function mapDebt(row: any): DebtRecord {
  const totalAmount = Number(row.totalDebt);
  const paidAmount = Number(row.paidAmount);
  let previousPaid = 0;
  // cancelled receipts no longer count as paid
  const installments: DebtPaymentInstallment[] = [...(row.payments || [])].filter((p: any) => !p.cancelledAt)
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
  const custProfile =
    typeof row.customer?.profile === 'object' && row.customer?.profile !== null
      ? row.customer.profile
      : {};
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
    const result = await apiFetch('/debts?limit=100&page=' + page);
    if (!Array.isArray(result?.data)) throw new Error('ข้อมูลหนี้จากฐานข้อมูลไม่ถูกต้อง');
    rows.push(...result.data.map(mapDebt));
    if (page >= (result.meta?.totalPages || 1)) break;
    page++;
  }
  lastDebtSyncAt = Date.now();
  try {
    // Always overwrite localStorage mirror even when rows is empty []
    localStorage.setItem(STORAGE_KEY_CONFIRMED_DEBTS, JSON.stringify(rows));
    localStorage.removeItem(STORAGE_KEY_MANUAL_DEBTS);
  } catch {}
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
  let response: any;
  try {
    response = await apiFetch('/debts/' + orderId + '/pay', {
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
  const installment = debtRecord.installments.find((row) => row.id === response.payment.id);
  try {
    localStorage.removeItem(key);
    const cached: DebtRecord[] = JSON.parse(
      localStorage.getItem(STORAGE_KEY_CONFIRMED_DEBTS) || '[]',
    );
    localStorage.setItem(
      STORAGE_KEY_CONFIRMED_DEBTS,
      JSON.stringify([...cached.filter((row) => row.orderId !== orderId), debtRecord]),
    );
  } catch {}
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
  const list: any[] = [];

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
  const res = await apiFetch(`/debts/payments/${encodeURIComponent(paymentId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
  try { await fetchDebtRecords(); } catch {}
  return res;
}
