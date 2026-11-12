/**
 * Runs under both test runners: backend jest (`cd backend && npx jest`) and frontend vitest
 * (`cd frontend && npm run test`), using their global describe / it / expect.
 */
import { billTotals, cartLineTotal, cartTotals, checkoutLineDiscount, earnedPoints, lineAmounts, vatIncluded, type CartLineInput } from '../src/pricing';

/** What the server stores for a cart: the checkout payload replayed through the checkout arithmetic. */
function serverCharge(lines: CartLineInput[], requestedDiscount: number, vatRate: number) {
  const stored = lines.map((l) => lineAmounts(l.quantity, l.unitPrice, checkoutLineDiscount(l)));
  return { stored, ...billTotals(stored.map((s) => s.total), requestedDiscount, vatRate) };
}

describe('POS pricing shared by the cart preview and the checkout', () => {
  const lines: CartLineInput[] = [
    // 2.35 m of rope at 15.50 with 10% off the line
    { unitPrice: 15.5, quantity: 2.35, discountType: 'percent', discountValue: 10 },
    // 3 bags at 129, 20 baht off the line
    { unitPrice: 129, quantity: 3, discountType: 'baht', discountValue: 20 },
    // 1.25 kg at 33.33, no discount
    { unitPrice: 33.33, quantity: 1.25 },
  ];

  it('item + bill discount + VAT + decimal quantity: preview equals what the server charges', () => {
    const preview = cartTotals({ lines, billDiscountType: 'percent', billDiscountValue: 5, vatRate: 7 });
    expect(preview.lineTotals).toEqual([32.78, 367, 41.66]);
    expect(preview.subtotal).toBe(441.44);
    expect(preview.billDiscountAmount).toBeCloseTo(22.072, 10);
    expect(preview.discountAmount).toBe(22.07);
    expect(preview.totalAmount).toBe(419.37);
    expect(preview.vatAmount).toBe(27.44); // 419.37 x 7 / 107

    const server = serverCharge(lines, preview.requestedDiscount, 7);
    expect(server.stored.map((s) => s.total)).toEqual(preview.lineTotals);
    expect(server.subtotal).toBe(preview.subtotal);
    expect(server.discountAmount).toBe(preview.discountAmount);
    expect(server.totalAmount).toBe(preview.totalAmount);
    expect(server.vatAmount).toBe(preview.vatAmount);
    // stored rows are self-consistent: qty x stored unit price - stored discount = line total
    for (const [i, s] of server.stored.entries()) {
      expect(Math.round((lines[i].quantity * s.storedUnitPrice - s.storedDiscount) * 100) / 100).toBe(s.total);
    }
  });

  it('points and claim credit stack after the bill discount and never exceed the subtotal', () => {
    const t = cartTotals({ lines, billDiscountType: 'baht', billDiscountValue: 400, pointsDiscount: 30, claimDiscount: 50, vatRate: 0 });
    expect(t.billDiscountAmount).toBe(400);
    expect(t.pointsDiscountAmount).toBeCloseTo(30, 10);
    expect(t.claimDiscountAmount).toBeCloseTo(11.44, 10);
    expect(t.totalAmount).toBe(0);
    expect(t.vatAmount).toBe(0);
  });

  it('claim replacement units are not charged and travel as line discount', () => {
    const line: CartLineInput = { unitPrice: 50, quantity: 3, claimQuantity: 1 };
    expect(cartLineTotal(line)).toBe(100);
    expect(checkoutLineDiscount(line)).toBe(50);
    expect(lineAmounts(3, 50, checkoutLineDiscount(line)).total).toBe(100);
  });

  it('VAT inside a VAT-inclusive amount; loyalty points per full block', () => {
    expect(vatIncluded(107, 7)).toBe(7);
    expect(vatIncluded(100, 0)).toBe(0);
    expect(earnedPoints(1499.99, 500, 10)).toBe(20);
    expect(earnedPoints(0, 500, 10)).toBe(0);
  });
});
