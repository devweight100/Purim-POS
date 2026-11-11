import { describe, expect, it } from 'vitest';
import {
  isCreditMethod,
  orderToA4Data,
  orderToReceiptData,
  paymentMethodLabel,
  summarizePaymentMethods,
} from '@/lib/receipt-mapper';

const backendOrder = {
  id: 'o1',
  orderNumber: 'ORD-0001',
  createdAt: '2026-11-07T07:05:00Z',
  subtotal: 290,
  discountAmount: 20,
  totalAmount: 270,
  vatAmount: 17.66,
  user: { fullName: 'แคชเชียร์ 1' },
  customer: { name: 'ลูกค้า ก', phone: '0800000000', taxId: '123', companyName: 'บริษัท ก' },
  items: [
    { product: { name: 'ข้าว', sku: 'RICE-JAS-5KG' }, quantity: 2, unitPrice: 100, discountAmount: 10, total: 190, unitName: 'ถุง' },
    { product: { name: 'น้ำ', sku: 'DRK-001' }, quantity: 1, unitPrice: 100, discountAmount: 0, total: 100 },
  ],
  payments: [{ method: 'CASH', amount: 270, cashReceived: 300, changeAmount: 30 }],
};

describe('labels', () => {
  it('payment method labels, case-insensitive, unknown passed through', () => {
    expect(paymentMethodLabel('cash')).toBe('เงินสด');
    expect(paymentMethodLabel('CREDIT_DEBT')).toBe('ค้างชำระ (เงินเชื่อ)');
    expect(paymentMethodLabel('WEIRD')).toBe('WEIRD');
    expect(paymentMethodLabel(null)).toBe('-');
  });
  it('credit methods', () => {
    expect(isCreditMethod('credit_debt')).toBe(true);
    expect(isCreditMethod('DEBT')).toBe(true);
    expect(isCreditMethod('CASH')).toBe(false);
  });
  it('summary of payments', () => {
    expect(summarizePaymentMethods([{ method: 'CASH', amount: 10 }, { method: 'TRANSFER', amount: 5 }])).toBe('แบ่งชำระ (Split Payment)');
    // zero-amount payments are ignored when others are paid
    expect(summarizePaymentMethods([{ method: 'CASH', amount: 0 }, { method: 'TRANSFER', amount: 5 }])).toBe('โอนเงิน');
    expect(summarizePaymentMethods([], 'QR')).toBe('QR พร้อมเพย์');
    expect(summarizePaymentMethods([])).toBe('-');
  });
});

describe('orderToReceiptData', () => {
  it('lines add up to the subtotal and subtotal - discount = total', () => {
    const r = orderToReceiptData(backendOrder);
    const lineSum = r.items.reduce((s, i) => s + i.lineTotal, 0);
    expect(lineSum).toBe(r.subtotal);
    expect(r.subtotal).toBe(290);
    expect(r.billDiscountAmount).toBe(20);
    expect(r.totalAmount).toBe(270);
    expect(r.subtotal - r.billDiscountAmount).toBe(r.totalAmount);
    expect(r).toMatchObject({
      orderNumber: 'ORD-0001',
      userName: 'แคชเชียร์ 1',
      customerName: 'ลูกค้า ก',
      paymentMethod: 'เงินสด',
      cashReceived: 300,
      changeAmount: 30,
      vatAmount: 17.66,
      isReprint: false,
    });
    expect(r.items[1].unitName).toBe('ชิ้น');
    expect(r.outstandingAmount).toBeUndefined();
  });

  it('bill discount is derived from subtotal and total when the stored discount disagrees', () => {
    const r = orderToReceiptData({ ...backendOrder, discountAmount: 0, subtotal: 999 });
    expect(r.subtotal).toBe(290);
    expect(r.billDiscountAmount).toBe(20);
  });

  it('local POS order keeps bill / points / claim discounts separate', () => {
    const r = orderToReceiptData({
      orderNumber: 'L1',
      items: [{ name: 'A', quantity: 3, price: 50, lineTotal: 150 }],
      billDiscountAmount: 10,
      pointsDiscountAmount: 5,
      claimDiscountAmount: 0,
      total: 135,
      paymentMethod: 'CASH',
    });
    expect(r.subtotal).toBe(150);
    expect(r.billDiscountAmount).toBe(10);
    expect(r.pointsDiscountAmount).toBe(5);
    expect(r.claimDiscountAmount).toBeUndefined();
    expect(r.totalAmount).toBe(135);
    expect(r.paymentMethod).toBe('เงินสด');
  });

  it('computes a line total net of the line discount when none is stored', () => {
    const r = orderToReceiptData({ items: [{ name: 'A', quantity: 2, unitPrice: 9.99, discountAmount: 1 }], totalAmount: 18.98 });
    expect(r.items[0].lineTotal).toBe(18.98);
    expect(r.billDiscountAmount).toBe(0);
  });

  it('credit sale: CREDIT_DEBT label and the outstanding amount from the debt', () => {
    const r = orderToReceiptData({
      ...backendOrder,
      discountAmount: 0,
      items: [{ product: { name: 'A' }, quantity: 1, unitPrice: 500, total: 500 }],
      subtotal: 500,
      totalAmount: 500,
      payments: [
        { method: 'CASH', amount: 200 },
        { method: 'CREDIT_DEBT', amount: 300 },
      ],
      debt: { remainingAmount: 250 },
    });
    expect(r.payments?.map((p) => p.method)).toEqual(['CASH', 'CREDIT_DEBT']);
    expect(r.paymentMethod).toBe('แบ่งชำระ (Split Payment)');
    expect(r.outstandingAmount).toBe(250);

    const only = orderToReceiptData({ items: [], totalAmount: 80, payments: [{ method: 'CREDIT_DEBT', amount: 80 }] });
    expect(only.paymentMethod).toBe('ค้างชำระ (เงินเชื่อ)');
    expect(only.outstandingAmount).toBe(80);
  });

  it('reprint flag and options override payments', () => {
    const r = orderToReceiptData(backendOrder, {
      isReprint: true,
      reprintedAt: '2026-11-08T00:00:00Z',
      payments: [{ method: 'TRANSFER', amount: 270 }],
      cashReceived: 0,
    });
    expect(r.isReprint).toBe(true);
    expect(r.reprintedAt).toBe('2026-11-08T00:00:00Z');
    expect(r.paymentMethod).toBe('โอนเงิน');
  });
});

describe('orderToA4Data', () => {
  it('maps customer details and credit / copy flags', () => {
    const a4 = orderToA4Data({ ...backendOrder, payments: [{ method: 'CREDIT', amount: 270 }] }, { isReprint: true });
    expect(a4).toMatchObject({
      customerName: 'ลูกค้า ก',
      customerPhone: '0800000000',
      customerTaxId: '123',
      customerCompany: 'บริษัท ก',
      customerBranch: 'สำนักงานใหญ่',
      isCreditBill: true,
      outstandingAmount: 270,
      isCopy: true,
      subtotal: 290,
      billDiscountAmount: 20,
      totalAmount: 270,
    });
    expect(a4.items[0].sku).toBe('RICE-JAS-5KG');
  });
});
