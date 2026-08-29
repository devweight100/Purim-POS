'use client';

import { DebtRecord, DebtPaymentInstallment, DebtStatus, Order, PaymentMethodType } from './types';
import { loadCustomers, saveCustomers, Customer } from './customer-service';

const STORAGE_KEY_DEBT_PAYMENTS = 'pos_debt_payments_history';
const STORAGE_KEY_MANUAL_DEBTS = 'pos_manual_debt_records';

/**
 * Initial sample credit orders for mock customers with initial debt
 */
const INITIAL_SAMPLE_DEBTS: DebtRecord[] = [
  {
    orderId: 'debt_init_1',
    orderNumber: 'INV-20260815-0042',
    orderDate: '2026-08-15T14:20:00.000Z',
    dueDate: '2026-09-14T23:59:59.000Z',
    customerId: 'cust_1',
    customerCode: 'CUST-0001',
    customerName: 'คุณสมชาย ใจดี',
    customerPhone: '081-234-5678',
    customerType: 'INDIVIDUAL',
    companyName: '',
    taxId: '',
    taxAddress: '123/45 ถ.สุขุมวิท ต.ในเมือง อ.เมือง จ.เชียงใหม่ 50000',
    totalAmount: 15000,
    paidAmount: 10500,
    remainingDebt: 4500,
    progressPercent: 70,
    status: 'PARTIAL',
    lastPaymentDate: '2026-08-20T10:30:00.000Z',
    installments: [
      {
        id: 'inst_1_1',
        installmentNo: 1,
        paymentDate: '2026-08-15T14:20:00.000Z',
        amountPaid: 5000,
        paymentMethod: 'CASH',
        cashierName: 'Mock Admin',
        previousPaid: 0,
        remainingAfter: 10000,
        note: 'เงินมัดจำวันส่งของ',
      },
      {
        id: 'inst_1_2',
        installmentNo: 2,
        paymentDate: '2026-08-20T10:30:00.000Z',
        amountPaid: 5500,
        paymentMethod: 'QR_PROMPTPAY',
        cashierName: 'Mock Admin',
        previousPaid: 5000,
        remainingAfter: 4500,
        note: 'โอนงวดที่ 2 ผ่าน QR',
      }
    ]
  },
  {
    orderId: 'debt_init_2',
    orderNumber: 'INV-20260810-0019',
    orderDate: '2026-08-10T11:00:00.000Z',
    dueDate: '2026-09-24T23:59:59.000Z',
    customerId: 'cust_2',
    customerCode: 'CUST-0002',
    customerName: 'บริษัท ปุริมพัฒนา คอนสตรัคชั่น จำกัด',
    customerPhone: '02-789-4561',
    customerType: 'COMPANY',
    companyName: 'บริษัท ปุริมพัฒนา คอนสตรัคชั่น จำกัด',
    taxId: '0105565012345',
    taxAddress: '99/1 อาคารปุริมทาวเวอร์ ชั้น 12 ถ.รัชดาภิเษก แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพฯ 10310',
    totalAmount: 50000,
    paidAmount: 17200,
    remainingDebt: 32800,
    progressPercent: 34,
    status: 'PARTIAL',
    lastPaymentDate: '2026-08-18T16:45:00.000Z',
    installments: [
      {
        id: 'inst_2_1',
        installmentNo: 1,
        paymentDate: '2026-08-18T16:45:00.000Z',
        amountPaid: 17200,
        paymentMethod: 'TRANSFER',
        accountLabel: 'ธ.กสิกรไทย (123-4-56789-0)',
        cashierName: 'Mock Admin',
        previousPaid: 0,
        remainingAfter: 32800,
        referenceNo: 'KBANK-TX-998811',
        note: 'ชำระงวดแรก 30%',
      }
    ]
  }
];

function getStoredInstallments(): Record<string, DebtPaymentInstallment[]> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY_DEBT_PAYMENTS);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveStoredInstallments(map: Record<string, DebtPaymentInstallment[]>) {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY_DEBT_PAYMENTS, JSON.stringify(map));
  } catch {}
}

/**
 * Load all credit orders & customer debts from Order History + Initial Samples
 */
export function loadAllDebtRecords(): DebtRecord[] {
  if (typeof window === 'undefined') return INITIAL_SAMPLE_DEBTS;

  const customers = loadCustomers();
  const customerMap = new Map<string, Customer>();
  customers.forEach(c => customerMap.set(c.id, c));

  const storedInstallmentsMap = getStoredInstallments();

  // 1. Gather all credit orders from pos_completed_orders
  let completedOrders: Order[] = [];
  try {
    const rawOrders = localStorage.getItem('pos_completed_orders');
    if (rawOrders) completedOrders = JSON.parse(rawOrders);
  } catch {}

  const creditOrdersFromPOS: DebtRecord[] = [];

  completedOrders.forEach(order => {
    if (order.status === 'VOIDED' || order.status === 'REFUNDED') return;

    // Check if order has credit payment
    let creditAmount = 0;
    let nonCreditPaid = 0;

    if (Array.isArray(order.payments) && order.payments.length > 0) {
      order.payments.forEach(p => {
        if (p.method === ('CREDIT_NOTE' as any) || p.method === ('CREDIT' as any)) {
          creditAmount += p.amount;
        } else {
          nonCreditPaid += p.amount;
        }
      });
    } else {
      const pm = (order as any).paymentMethod || '';
      if (pm.includes('เชื่อ') || pm.includes('เครดิต') || pm === 'CREDIT') {
        creditAmount = order.totalAmount;
      }
    }

    if (creditAmount > 0) {
      const cust = order.customerId ? customerMap.get(order.customerId) : null;
      const initialPaid = nonCreditPaid;
      const totalAmount = order.totalAmount;

      // Calculate due date from customer's creditTerms
      const termsDays = cust?.creditTerms || 30;
      const createdTime = new Date(order.createdAt).getTime();
      const dueTime = new Date(createdTime + termsDays * 24 * 60 * 60 * 1000).toISOString();

      // Look up installment history
      const installments = storedInstallmentsMap[order.id] || storedInstallmentsMap[order.orderNumber] || [];
      const installmentPaidTotal = installments.reduce((sum, inst) => sum + inst.amountPaid, 0);

      const totalPaid = Math.min(totalAmount, initialPaid + installmentPaidTotal);
      const remaining = Math.max(0, totalAmount - totalPaid);
      const progressPercent = totalAmount > 0 ? Math.min(100, Math.round((totalPaid / totalAmount) * 100)) : 100;

      const status: DebtStatus = remaining <= 0 ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';
      const lastPayment = installments.length > 0 ? installments[installments.length - 1].paymentDate : order.createdAt;

      creditOrdersFromPOS.push({
        orderId: order.id,
        orderNumber: order.orderNumber,
        orderDate: order.createdAt,
        dueDate: dueTime,
        customerId: cust?.id || order.customerId || 'unknown',
        customerCode: cust?.code || 'CUST-TEMP',
        customerName: cust?.name || order.customerName || 'ลูกค้าทั่วไป',
        customerPhone: cust?.phone || '',
        customerType: cust?.type || 'INDIVIDUAL',
        companyName: cust?.companyName || (cust?.type === 'COMPANY' ? cust.name : ''),
        taxId: cust?.taxId || '',
        taxAddress: cust?.taxAddress || cust?.address || '',
        totalAmount,
        paidAmount: totalPaid,
        remainingDebt: remaining,
        progressPercent,
        status,
        installments,
        lastPaymentDate: lastPayment,
      });
    }
  });

  // 2. Load manual / initial sample debts
  let sampleDebts = INITIAL_SAMPLE_DEBTS;
  try {
    const rawManual = localStorage.getItem(STORAGE_KEY_MANUAL_DEBTS);
    if (rawManual) {
      sampleDebts = JSON.parse(rawManual);
    }
  } catch {}

  // Recalculate samples with stored installments
  const updatedSampleDebts = sampleDebts.map(sample => {
    const cust = customerMap.get(sample.customerId);
    const installments = storedInstallmentsMap[sample.orderId] || sample.installments || [];
    const installmentPaidTotal = installments.reduce((sum, inst) => sum + inst.amountPaid, 0);

    const totalAmount = sample.totalAmount;
    const totalPaid = Math.min(totalAmount, installmentPaidTotal);
    const remaining = Math.max(0, totalAmount - totalPaid);
    const progressPercent = totalAmount > 0 ? Math.min(100, Math.round((totalPaid / totalAmount) * 100)) : 100;
    const status: DebtStatus = remaining <= 0 ? 'PAID' : totalPaid > 0 ? 'PARTIAL' : 'UNPAID';
    const lastPayment = installments.length > 0 ? installments[installments.length - 1].paymentDate : sample.orderDate;

    return {
      ...sample,
      customerName: cust?.name || sample.customerName,
      customerPhone: cust?.phone || sample.customerPhone,
      customerType: cust?.type || sample.customerType,
      companyName: cust?.companyName || sample.companyName,
      taxId: cust?.taxId || sample.taxId,
      paidAmount: totalPaid,
      remainingDebt: remaining,
      progressPercent,
      status,
      installments,
      lastPaymentDate: lastPayment,
    };
  });

  // Combine POS credit orders + Sample debts (deduplicating by orderId/orderNumber)
  const existingIds = new Set(creditOrdersFromPOS.map(o => o.orderId));
  const combined: DebtRecord[] = [...creditOrdersFromPOS];

  updatedSampleDebts.forEach(d => {
    if (!existingIds.has(d.orderId)) {
      combined.push(d);
      existingIds.add(d.orderId);
    }
  });

  // Sort by orderDate descending (newest first)
  combined.sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());

  return combined;
}

/**
 * Record a debt payment installment for an order and deduct customer's currentDebt balance
 */
export function recordDebtPayment(
  orderId: string,
  amount: number,
  paymentMethod: PaymentMethodType,
  options?: {
    accountLabel?: string;
    referenceNo?: string;
    note?: string;
    cashierName?: string;
  }
): { success: boolean; debtRecord?: DebtRecord; installment?: DebtPaymentInstallment; error?: string } {
  if (amount <= 0) {
    return { success: false, error: 'จำนวนเงินที่ชำระต้องมากกว่า 0 บาท' };
  }

  const allDebts = loadAllDebtRecords();
  const targetDebt = allDebts.find(d => d.orderId === orderId || d.orderNumber === orderId);

  if (!targetDebt) {
    return { success: false, error: 'ไม่พบบิลหนี้ที่ระบุ' };
  }

  if (amount > targetDebt.remainingDebt) {
    return { 
      success: false, 
      error: `จำนวนเงินที่ชำระ (${amount.toLocaleString()} ฿) เกินยอดคงค้าง (${targetDebt.remainingDebt.toLocaleString()} ฿)` 
    };
  }

  const previousPaid = targetDebt.paidAmount;
  const newPaidAmount = previousPaid + amount;
  const newRemaining = Math.max(0, targetDebt.totalAmount - newPaidAmount);

  const installmentNo = (targetDebt.installments?.length || 0) + 1;
  const now = new Date().toISOString();

  const newInstallment: DebtPaymentInstallment = {
    id: `inst_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
    installmentNo,
    paymentDate: now,
    amountPaid: amount,
    paymentMethod,
    accountLabel: options?.accountLabel,
    referenceNo: options?.referenceNo,
    note: options?.note,
    cashierName: options?.cashierName || 'พนักงานขาย',
    previousPaid,
    remainingAfter: newRemaining,
  };

  // 1. Update Installments in LocalStorage
  const storedInstallmentsMap = getStoredInstallments();
  const currentList = storedInstallmentsMap[targetDebt.orderId] || targetDebt.installments || [];
  const updatedInstallments = [...currentList, newInstallment];
  storedInstallmentsMap[targetDebt.orderId] = updatedInstallments;
  saveStoredInstallments(storedInstallmentsMap);

  // 2. Deduct Customer's currentDebt in customer-service
  if (targetDebt.customerId) {
    const customers = loadCustomers();
    const updatedCustomers = customers.map(c => {
      if (c.id === targetDebt.customerId) {
        const newDebt = Math.max(0, (c.currentDebt || 0) - amount);
        return {
          ...c,
          currentDebt: newDebt,
          updatedAt: now,
        };
      }
      return c;
    });
    saveCustomers(updatedCustomers);
  }

  // 3. Update Manual Debts storage if it was a sample debt
  try {
    const rawManual = localStorage.getItem(STORAGE_KEY_MANUAL_DEBTS);
    let sampleDebts: DebtRecord[] = rawManual ? JSON.parse(rawManual) : INITIAL_SAMPLE_DEBTS;
    const foundSampleIdx = sampleDebts.findIndex(s => s.orderId === targetDebt.orderId);
    if (foundSampleIdx >= 0) {
      sampleDebts[foundSampleIdx] = {
        ...sampleDebts[foundSampleIdx],
        paidAmount: newPaidAmount,
        remainingDebt: newRemaining,
        progressPercent: Math.min(100, Math.round((newPaidAmount / sampleDebts[foundSampleIdx].totalAmount) * 100)),
        status: newRemaining <= 0 ? 'PAID' : 'PARTIAL',
        installments: updatedInstallments,
        lastPaymentDate: now,
      };
      localStorage.setItem(STORAGE_KEY_MANUAL_DEBTS, JSON.stringify(sampleDebts));
    }
  } catch {}

  const updatedRecord: DebtRecord = {
    ...targetDebt,
    paidAmount: newPaidAmount,
    remainingDebt: newRemaining,
    progressPercent: Math.min(100, Math.round((newPaidAmount / targetDebt.totalAmount) * 100)),
    status: newRemaining <= 0 ? 'PAID' : 'PARTIAL',
    installments: updatedInstallments,
    lastPaymentDate: now,
  };

  return {
    success: true,
    debtRecord: updatedRecord,
    installment: newInstallment,
  };
}

/**
 * Get all debt payment collections made during a shift timeframe
 */
export function getShiftDebtCollections(shiftStartTime: number, shiftEndTime: number): {
  count: number;
  total: number;
  cashTotal: number;
  qrTransferTotal: number;
  installments: Array<{ orderNumber?: string; customerName?: string; amount: number; method: string; time: string }>;
} {
  const allDebts = loadAllDebtRecords();
  let count = 0;
  let total = 0;
  let cashTotal = 0;
  let qrTransferTotal = 0;
  const list: any[] = [];

  allDebts.forEach(debt => {
    (debt.installments || []).forEach(inst => {
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
  return all.find(d => d.orderId === orderId || d.orderNumber === orderId) || null;
}

