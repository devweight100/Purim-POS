'use client';

import { DebtRecord, DebtPaymentInstallment, PaymentMethodType, ApiDebt, ApiDebtPayment, ApiPage, DebtPayResponse } from './types';
import { apiFetch } from './api';
import { isRetryableError } from './api-error';
import { newOperationId } from './order-sync-service';
import { useShiftStore } from './store/shift-store';

/**
 * Debts the server returned in this session, by order id (memory only, never localStorage). Pages ask the
 * server for the debts they show (a filtered page, or the debts of given bills) instead of downloading
 * every debt.
 */
const debtsByOrder = new Map<string, DebtRecord>();

function remember(rows: DebtRecord[]) {
  for (const row of rows) debtsByOrder.set(row.orderId, row);
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

/** The debts of these bills (credit bills of the orders page), from the server; also kept for getDebtRecordByOrderId. */
export async function fetchDebtsForOrders(orderIds: string[]): Promise<DebtRecord[]> {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const out: DebtRecord[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const result = await apiFetch<ApiPage<ApiDebt> | null>(`/debts?limit=500&orderIds=${chunk.map(encodeURIComponent).join(',')}`);
    if (!Array.isArray(result?.data)) throw new Error('ข้อมูลหนี้จากฐานข้อมูลไม่ถูกต้อง');
    for (const id of chunk) debtsByOrder.delete(id);
    const rows = result.data.map(mapDebt);
    remember(rows);
    out.push(...rows);
  }
  return out;
}

export interface DebtPageStats {
  totalBills: number;
  totalDebtValue: number;
  totalCollected: number;
  totalOutstanding: number;
  paidCount: number;
  unpaidCount: number;
  overdueCount: number;
}

export interface DebtPageQuery {
  page: number;
  limit: number;
  search?: string;
  /** owing = something left to pay (remaining > 0): the POS debt picker */
  statusGroup?: 'all' | 'unpaid' | 'overdue' | 'paid' | 'owing';
  customerId?: string | null;
  customerType?: 'all' | 'INDIVIDUAL' | 'COMPANY';
  /** cards over every debt (default true) */
  stats?: boolean;
}

/** One page of the receivables list, filtered / searched by the server, plus the cards over every debt. */
export async function fetchDebtPage(q: DebtPageQuery): Promise<{ rows: DebtRecord[]; total: number; stats: DebtPageStats | null }> {
  const params = new URLSearchParams({ page: String(q.page), limit: String(q.limit) });
  if (q.stats !== false) params.set('stats', '1');
  if (q.search?.trim()) params.set('search', q.search.trim());
  if (q.statusGroup && q.statusGroup !== 'all') params.set('statusGroup', q.statusGroup);
  if (q.customerId) params.set('customerId', q.customerId);
  if (q.customerType && q.customerType !== 'all') params.set('customerType', q.customerType);
  const result = await apiFetch<(ApiPage<ApiDebt> & { stats?: DebtPageStats }) | null>('/debts?' + params.toString());
  if (!Array.isArray(result?.data)) throw new Error('ข้อมูลหนี้จากฐานข้อมูลไม่ถูกต้อง');
  const rows = result.data.map(mapDebt);
  remember(rows);
  return { rows, total: Number(result.meta?.total) || 0, stats: result.stats || null };
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
  debtsByOrder.set(debtRecord.orderId, debtRecord);
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
  // offline fallback only (the server's shift summary wins): the debts seen in this session
  const allDebts = [...debtsByOrder.values()];
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
  const byId = debtsByOrder.get(orderId);
  if (byId) return byId;
  for (const d of debtsByOrder.values()) if (d.orderNumber === orderId) return d;
  return null;
}

/** Cancel a debt receipt recorded by mistake (ADMIN / MANAGER). The debt goes back up. */
export async function cancelDebtPayment(paymentId: string, reason: string) {
  const res = await apiFetch<ApiDebtPayment>(`/debts/payments/${encodeURIComponent(paymentId)}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) });
  return res;
}
