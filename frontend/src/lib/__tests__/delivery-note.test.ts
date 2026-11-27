import { describe, expect, it } from 'vitest';
import { billToDeliveryNote, onlineToDeliveryNote } from '../delivery-note';
import { cartTotals } from '@shared/pricing';
import type { CartItem } from '../types';

const item = (o: Partial<CartItem>): CartItem => ({
  productId: 'p', name: 'สินค้า', sku: 'S', originalPrice: 100, customPrice: null, quantity: 1, unitId: 'u', unitName: 'ชิ้น',
  conversionFactor: 1, discountType: 'none', discountValue: 0, hasVat: true, ...o,
});

describe('billToDeliveryNote (held bill / cart)', () => {
  const items = [
    item({ name: 'ปูนซีเมนต์ 50 กก.', originalPrice: 165.5, quantity: 3, unitName: 'ถุง' }),
    item({ name: 'สว่าน', originalPrice: 2890, customPrice: 2700, quantity: 1, discountType: 'percent', discountValue: 10 }),
    item({ name: 'เทป', originalPrice: 25, quantity: 4, discountType: 'baht', discountValue: 5 }),
    item({ name: 'ค่าส่ง', sku: 'SYS-DELIVERY-FEE', originalPrice: 80, quantity: 1, unitName: 'ครั้ง' }),
  ];
  const bill = { items, customerName: 'คุณเอ', billDiscountType: 'baht' as const, billDiscountValue: 50, pointsDiscountValue: 10, note: 'ส่งหลังร้าน' };

  it('lines, discounts and the total are the cart\'s own numbers (shared pricing)', () => {
    const n = billToDeliveryNote(bill, { source: 'held', reference: 'บิลพัก #1', cashierName: 'แคชเชียร์', customer: { name: 'คุณเอ', phone: '081', address: '99 ถนนสุขุมวิท' } });
    expect(n.lines.map((l) => [l.name, l.unitPrice, l.discount, l.lineTotal])).toEqual([
      ['ปูนซีเมนต์ 50 กก.', 165.5, 0, 496.5],
      ['สว่าน', 2700, 270, 2430],
      ['เทป', 25, 5, 95],
    ]);
    expect(n.goodsTotal).toBe(3021.5);
    expect(n.deliveryFee).toBe(80);
    expect(n.billDiscount).toBe(50);
    expect(n.pointsDiscount).toBe(10);
    const expected = cartTotals({
      lines: items.map((i) => ({ unitPrice: i.customPrice ?? i.originalPrice, quantity: i.quantity, discountType: i.discountType, discountValue: i.discountValue })),
      billDiscountType: 'baht', billDiscountValue: 50, pointsDiscount: 10,
    }).totalAmount;
    expect(n.total).toBe(expected);
    expect(n.total).toBe(round(n.goodsTotal + 80 - 50 - 10));
    expect(n).toMatchObject({ customerName: 'คุณเอ', phone: '081', address: '99 ถนนสุขุมวิท', note: 'ส่งหลังร้าน', reference: 'บิลพัก #1', cashierName: 'แคชเชียร์' });
  });

  it('claimed units are not charged; no fee line -> deliveryFee null; tax address as fallback', () => {
    const n = billToDeliveryNote({ items: [item({ quantity: 2, claimQuantity: 1 })] }, { source: 'cart', customer: { name: 'บริษัท', taxAddress: 'ที่อยู่ใบกำกับ' } });
    expect(n.lines[0]).toMatchObject({ lineTotal: 100, discount: 100 });
    expect(n.deliveryFee).toBeNull();
    expect(n.total).toBe(100);
    expect(n.address).toBe('ที่อยู่ใบกำกับ');
  });
});

describe('onlineToDeliveryNote', () => {
  const p = {
    orderNo: 'WB2611-0001', createdAt: '2026-11-27T02:00:00Z', fulfillment: 'DELIVERY' as const, customerName: 'คุณบี', phone: '089', address: 'บ้าน', note: null,
    lines: [{ name: 'ปูน', unitName: 'ถุง', quantity: 2, unitPrice: 120, lineTotal: 240 }], subtotal: 240, deliveryFee: 60, totalAmount: 300, printCount: 1,
  };
  it('agreed prices and fee, the order total', () => {
    expect(onlineToDeliveryNote(p)).toMatchObject({ source: 'online', reference: 'WB2611-0001', goodsTotal: 240, deliveryFee: 60, total: 300, address: 'บ้าน', printCount: 1, feePending: false });
  });
  it('pickup: no fee line, no address; delivery without a fee yet: pending', () => {
    expect(onlineToDeliveryNote({ ...p, fulfillment: 'PICKUP', deliveryFee: 0, totalAmount: 240 })).toMatchObject({ deliveryFee: null, address: null, total: 240 });
    expect(onlineToDeliveryNote({ ...p, deliveryFee: null, totalAmount: 240 }).feePending).toBe(true);
  });
});

const round = (n: number) => Math.round(n * 100) / 100;
