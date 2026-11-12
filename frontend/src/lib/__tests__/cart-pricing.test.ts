import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CartItem, Product } from '@/lib/types';

// Store settings come from localStorage in the browser; the tests control them here.
const settings = vi.hoisted(() => ({ vatEnabled: false, vatRate: 7 as number | string }));
vi.mock('@/lib/store-settings-storage', () => ({
  loadStoreSettings: () => ({ ...settings }),
  getLowStockThreshold: () => 5,
}));

import { calculateSmartRollupAndPricing, getProductWholesaleSteps } from '@/lib/cart-pricing';
import { useCartStore, validateDiscount, sanitizePersistedCart } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';

const cart = () => useCartStore.getState();

function product(over: Partial<Product> & { id: string; price: number }): Product {
  const { price, ...rest } = over;
  return {
    name: over.id,
    sku: over.id.toUpperCase(),
    categoryId: 'c1',
    stock: 100,
    hasVat: true,
    image: null,
    units: [{ id: `u-${over.id}-base`, unitName: 'ชิ้น', factor: 1, price, barcode: '' }],
    ...rest,
  } as Product;
}

function line(over: Partial<CartItem>): CartItem {
  return {
    productId: 'p',
    name: 'p',
    sku: 'P',
    originalPrice: 10,
    customPrice: null,
    quantity: 1,
    unitId: 'u-p-base',
    unitName: 'ชิ้น',
    conversionFactor: 1,
    discountType: 'none',
    discountValue: 0,
    hasVat: true,
    ...over,
  };
}

beforeEach(() => {
  settings.vatEnabled = false;
  settings.vatRate = 7;
  useProductStore.setState({ products: [] });
  cart().clearCart();
  useCartStore.setState({ isVatEnabled: false, heldBills: [] });
});

describe('line and bill amounts', () => {
  it('adds the same product up and totals the lines', () => {
    const a = product({ id: 'a', price: 12.5 });
    const b = product({ id: 'b', price: 40 });
    cart().addItem(a);
    cart().addItem(a);
    cart().addItem(b);
    expect(cart().items).toHaveLength(2);
    expect(cart().getItemCount()).toBe(3);
    expect(cart().getSubtotal()).toBe(65);
    expect(cart().getTotal()).toBe(65);
  });

  it('percent and baht line discounts; a baht discount never exceeds the line', () => {
    const a = product({ id: 'a', price: 100 });
    const b = product({ id: 'b', price: 30 });
    cart().addItem(a);
    cart().updateQuantity('a', 2);
    cart().addItem(b);
    cart().setItemDiscount('a', 'percent', 10);
    cart().setItemDiscount('b', 'baht', 50);
    const [la, lb] = cart().items;
    expect(cart().getItemDiscountAmount(la)).toBe(20);
    expect(cart().getItemLineTotal(la)).toBe(180);
    expect(cart().getItemDiscountAmount(lb)).toBe(30);
    expect(cart().getItemLineTotal(lb)).toBe(0);
    expect(cart().getSubtotal()).toBe(180);
  });

  it('stored discounts are clamped (no negatives, percent at most 100)', () => {
    cart().addItem(product({ id: 'a', price: 100 }));
    cart().setItemDiscount('a', 'percent', 150);
    expect(cart().items[0].discountValue).toBe(100);
    cart().setItemDiscount('a', 'baht', -5);
    expect(cart().items[0].discountValue).toBe(0);
    cart().setBillDiscount('percent', 120);
    expect(cart().billDiscountValue).toBe(100);
  });

  it('custom price replaces the unit price', () => {
    cart().addItem(product({ id: 'a', price: 100 }));
    cart().setCustomPrice('a', 80);
    expect(cart().getEffectivePrice(cart().items[0])).toBe(80);
    expect(cart().getSubtotal()).toBe(80);
  });

  it('claimed (replacement) quantity is not charged', () => {
    cart().addItem(product({ id: 'a', price: 50 }));
    cart().updateQuantity('a', 3);
    cart().setItemClaim('a', 1, 'แตก');
    expect(cart().getSubtotal()).toBe(100);
    cart().setItemClaim('a', 99);
    expect(cart().items[0].claimQuantity).toBe(3);
    expect(cart().getSubtotal()).toBe(0);
  });

  it('bill discount: baht capped at the subtotal, percent of the subtotal', () => {
    cart().addItem(product({ id: 'a', price: 200 }));
    cart().setBillDiscount('baht', 500);
    expect(cart().getBillDiscountAmount()).toBe(200);
    expect(cart().getTotal()).toBe(0);
    cart().setBillDiscount('percent', 15);
    expect(cart().getBillDiscountAmount()).toBe(30);
    expect(cart().getTotal()).toBe(170);
  });

  it('points discount is limited to what is left after the bill discount', () => {
    cart().addItem(product({ id: 'a', price: 100 }));
    cart().setBillDiscount('baht', 70);
    cart().setPointsDiscount(50, 500);
    expect(cart().getPointsDiscountAmount()).toBe(30);
    expect(cart().getTotal()).toBe(0);
    cart().clearPointsDiscount();
    expect(cart().getPointsDiscountAmount()).toBe(0);
    expect(cart().pointsUsed).toBe(0);
  });

  it('removing the customer drops the points discount', () => {
    cart().addItem(product({ id: 'a', price: 100 }));
    cart().setCustomer('c1', 'ลูกค้า');
    cart().setPointsDiscount(10, 100);
    cart().setCustomer(null, null);
    expect(cart().pointsDiscountValue).toBe(0);
  });
});

describe('VAT (prices include VAT)', () => {
  it('no VAT when the store setting is off', () => {
    cart().addItem(product({ id: 'a', price: 107 }));
    expect(cart().getVatAmount()).toBe(0);
  });

  it('vat = amount x 7 / 107, only on VAT lines, after bill discounts; total unchanged', () => {
    settings.vatEnabled = true;
    useCartStore.setState({ isVatEnabled: true });
    cart().addItem(product({ id: 'a', price: 107 }));
    cart().addItem(product({ id: 'n', price: 50, hasVat: false }));
    expect(cart().getVatAmount()).toBeCloseTo(7, 10);
    expect(cart().getTotal()).toBe(157);

    // 10% off the bill reduces the VAT base the same way
    cart().setBillDiscount('percent', 10);
    expect(cart().getVatAmount()).toBeCloseTo(6.3, 10);
  });

  it('uses the store VAT rate, falling back to 7 on a bad value', () => {
    settings.vatEnabled = true;
    useCartStore.setState({ isVatEnabled: true });
    cart().addItem(product({ id: 'a', price: 110 }));
    settings.vatRate = 10;
    expect(cart().getVatAmount()).toBeCloseTo(10, 10);
    settings.vatRate = 'x';
    // rounded to the satang, as the server stores it (orders.vat_amount)
    expect(cart().getVatAmount()).toBe(Math.round(((110 * 7) / 107) * 100) / 100);
  });

  it('rounds to the satang when printed: 3 x 33.33 with VAT', () => {
    settings.vatEnabled = true;
    useCartStore.setState({ isVatEnabled: true });
    cart().addItem(product({ id: 'a', price: 33.33 }));
    cart().updateQuantity('a', 3);
    expect(cart().getSubtotal()).toBeCloseTo(99.99, 10);
    expect(Math.round(cart().getVatAmount() * 100) / 100).toBe(6.54);
  });
});

describe('smart roll-up and wholesale tiers', () => {
  const water = product({
    id: 'w',
    price: 7,
    units: [
      { id: 'u-w-base', unitName: 'ขวด', factor: 1, price: 7, barcode: '' },
      { id: 'u-w-pack', unitName: 'แพ็ค', factor: 6, price: 39, barcode: '' },
    ],
  });

  it('rolls loose units up into the pack unit with its own price', () => {
    useProductStore.setState({ products: [water] });
    for (let i = 0; i < 8; i++) cart().addItem(water);
    const lines = cart().items.map((i) => [i.unitName, i.quantity, i.originalPrice]);
    expect(lines).toEqual([
      ['แพ็ค', 1, 39],
      ['ขวด', 2, 7],
    ]);
    expect(cart().getSubtotal()).toBe(53);
  });

  it('a pack without a price is sold at base price x units', () => {
    const items = calculateSmartRollupAndPricing([line({ productId: 'q', quantity: 12, originalPrice: 5 })]);
    expect(items).toHaveLength(1);
    useProductStore.setState({
      products: [product({ id: 'q', price: 5, units: [{ id: 'b', unitName: 'ชิ้น', factor: 1, price: 5, barcode: '' }, { id: 'l', unitName: 'ลัง', factor: 12, price: 0, barcode: '' }] })],
    });
    const rolled = calculateSmartRollupAndPricing([line({ productId: 'q', quantity: 12, originalPrice: 5 })]);
    expect(rolled.map((i) => [i.unitName, i.quantity, i.originalPrice])).toEqual([['ลัง', 1, 60]]);
  });

  it('lines with a custom price or discount are not rolled up', () => {
    useProductStore.setState({ products: [water] });
    const items = calculateSmartRollupAndPricing([line({ productId: 'w', quantity: 6, originalPrice: 7, customPrice: 6 })]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ unitName: 'ชิ้น', quantity: 6, customPrice: 6 });
  });

  it('wholesale tiers: highest reached tier applies, only when cheaper', () => {
    useProductStore.setState({
      products: [
        product({
          id: 'r',
          price: 10,
          wholesalePrices: [
            { minQuantity: 10, unitPrice: 9 },
            { minQuantity: 50, unitPrice: 8 },
            { minQuantity: 5, unitPrice: 11 },
          ] as unknown as Product['wholesalePrices'],
        }),
      ],
    });
    expect(getProductWholesaleSteps('r').map((s) => s.minQuantity)).toEqual([50, 10, 5]);

    const at = (qty: number) => calculateSmartRollupAndPricing([line({ productId: 'r', quantity: qty, originalPrice: 10 })])[0];
    expect(at(4)).toMatchObject({ originalPrice: 10, isWholesaleApplied: false });
    expect(at(7)).toMatchObject({ originalPrice: 10, isWholesaleApplied: false }); // 11 is dearer
    expect(at(10)).toMatchObject({ originalPrice: 9, isWholesaleApplied: true });
    expect(at(60)).toMatchObject({ originalPrice: 8, isWholesaleApplied: true });
    expect(at(60).pricingNote).toContain('ราคาส่ง');
  });

  it('empty input', () => {
    expect(calculateSmartRollupAndPricing([])).toEqual([]);
  });
});

describe('held bills', () => {
  it('hold and recall keep items and discounts', () => {
    cart().addItem(product({ id: 'a', price: 20 }));
    cart().setBillDiscount('baht', 5);
    cart().holdBill('โต๊ะ 1');
    expect(cart().items).toHaveLength(0);
    expect(cart().heldBills).toHaveLength(1);
    cart().recallBill(cart().heldBills[0].id);
    expect(cart().getTotal()).toBe(15);
    expect(cart().heldBills).toHaveLength(0);
  });
});

describe('validateDiscount / sanitizePersistedCart', () => {
  it('validateDiscount', () => {
    expect(validateDiscount('none', 999, 0)).toBeNull();
    expect(validateDiscount('percent', 100, 0)).toBeNull();
    expect(validateDiscount('percent', 101, 0)).toMatch(/0 - 100/);
    expect(validateDiscount('baht', 50.01, 50)).toMatch(/ไม่เกินยอด/);
    expect(validateDiscount('baht', -1, 50)).toMatch(/ตั้งแต่ 0/);
  });

  it('drops malformed cart data instead of crashing', () => {
    const out = sanitizePersistedCart({
      items: [line({}), { productId: 1 }, line({ quantity: 0 }), null],
      billDiscountType: 'weird',
      billDiscountValue: 'x',
      heldBills: [{ id: 'h', items: [] }, { id: 'h2', items: [line({})] }],
    });
    expect(out.items).toHaveLength(1);
    expect(out.billDiscountType).toBe('none');
    expect(out.billDiscountValue).toBe(0);
    expect(out.heldBills?.map((b) => b.id)).toEqual(['h2']);
    expect(sanitizePersistedCart(null)).toEqual({});
  });
});
