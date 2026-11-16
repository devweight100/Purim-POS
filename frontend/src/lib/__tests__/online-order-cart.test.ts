import { onlineOrderCartItems } from '../online-order-cart';
import { cartTotals } from '@shared/pricing';

describe('online order -> POS cart', () => {
  const payload = {
    id: 'oo1', orderNo: 'WEB-261116-001', customer: { id: 'c1', name: 'ช่าง' }, contactName: 'ช่าง', note: 'ออเดอร์ออนไลน์ WEB-261116-001 (ส่งของ)',
    lines: [
      { productId: 'p1', sku: 'C1', name: 'ปูน', unitId: null, unitName: 'ถุง', factor: 1, quantity: 4, unitPrice: 85, isBundle: false },
      { productId: 'p1', sku: 'C1', name: 'ปูน', unitId: 'pk', unitName: 'แพค', factor: 10, quantity: 1, unitPrice: 800, isBundle: false },
      { productId: 'b1', sku: 'B1', name: 'ชุด', unitId: null, unitName: 'ชุด', factor: 1, quantity: 2, unitPrice: 50, isBundle: true },
      { productId: 'fee', sku: 'SYS-DELIVERY-FEE', name: 'ค่าส่ง', unitId: null, unitName: 'ครั้ง', factor: 1, quantity: 1, unitPrice: 80, isBundle: false },
    ],
  };
  const products = [
    { id: 'p1', hasVat: true },
    { id: 'b1', isBundle: true, bundleItems: [{ childProductId: 'x', quantity: 3, childProduct: { name: 'ลูก', sku: 'X', basePrice: 10 } }] },
    { id: 'fee', hasVat: false },
  ];
  const items = onlineOrderCartItems(payload, products);

  it('keeps the agreed prices, units (base unit id like the POS catalogue) and the fee line', () => {
    expect(items.map((i) => [i.unitId, i.originalPrice, i.quantity, i.conversionFactor])).toEqual([
      ['u-p1-base', 85, 4, 1],
      ['pk', 800, 1, 10],
      ['u-b1-base', 50, 2, 1],
      ['u-fee-base', 80, 1, 1],
    ]);
    expect(items.every((i) => i.customPrice === null && i.discountType === 'none')).toBe(true);
    expect(items[3].hasVat).toBe(false);
    expect(items[2].bundleData).toEqual([{ productId: 'x', productName: 'ลูก', sku: 'X', quantityPerBundle: 3, totalQuantity: 6, unitPrice: 10 }]);
  });

  it('the POS bill total equals the online order total', () => {
    const t = cartTotals({ lines: items.map((i) => ({ unitPrice: i.originalPrice, quantity: i.quantity, claimQuantity: 0, discountType: 'none', discountValue: 0, hasVat: i.hasVat })), billDiscountType: 'none', billDiscountValue: 0, pointsDiscount: 0, claimDiscount: 0, vatRate: 0 });
    expect(t.totalAmount).toBe(340 + 800 + 100 + 80);
  });
});
