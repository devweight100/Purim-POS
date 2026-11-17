import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/types';

vi.mock('@/lib/store-settings-storage', () => ({
  loadStoreSettings: () => ({ vatEnabled: false, vatRate: 7 }),
  getLowStockThreshold: () => 5,
}));

import { useCartStore } from '@/lib/store/cart-store';
import { useProductStore } from '@/lib/store/product-store';
import { cartLineKey, findTouchedLine } from '@/lib/store/cart-last-touched';

const cart = () => useCartStore.getState();
const last = () => cart().lastTouched;
const lastKey = () => (last() ? cartLineKey(last()!) : null);

function product(id: string, price = 10, extraUnits: Product['units'] = []): Product {
  return {
    id,
    name: `สินค้า ${id}`,
    sku: id.toUpperCase(),
    categoryId: 'c1',
    stock: 1000,
    hasVat: true,
    image: null,
    units: [{ id: `u-${id}-base`, unitName: 'ชิ้น', factor: 1, price, barcode: '' }, ...extraUnits],
  } as Product;
}

beforeEach(() => {
  useProductStore.setState({ products: [] });
  cart().clearCart();
  useCartStore.setState({ heldBills: [] });
});

describe('last touched cart line', () => {
  it('is the line just added, with +1', () => {
    cart().addItem(product('a'));
    expect(lastKey()).toBe('a-u-a-base');
    expect(last()!.delta).toBe(1);
    cart().addItem(product('b'));
    expect(lastKey()).toBe('b-u-b-base');
  });

  it('moves back to line 1 when its item is scanned again among 20+ lines, with a new seq every time', () => {
    const ps = Array.from({ length: 22 }, (_, i) => product(`p${i}`));
    for (const p of ps) cart().addItem(p);
    expect(lastKey()).toBe('p21-u-p21-base');
    const before = last()!.seq;
    cart().addItem(ps[0]);
    expect(lastKey()).toBe('p0-u-p0-base');
    expect(cart().items.findIndex((i) => i.productId === 'p0')).toBe(0);
    expect(cart().items[0].quantity).toBe(2);
    expect(last()!.delta).toBe(1);
    const second = last()!.seq;
    expect(second).toBeGreaterThan(before);
    // the same line scanned again still gets a new seq (so the row flashes again)
    cart().addItem(ps[0]);
    expect(lastKey()).toBe('p0-u-p0-base');
    expect(last()!.seq).toBeGreaterThan(second);
    expect(cart().items).toHaveLength(22);
  });

  it('is set by +/- and quantity edits on a line, with the change', () => {
    cart().addItem(product('a'));
    cart().addItem(product('b'));
    cart().updateQuantity('a', 5, 'u-a-base');
    expect(lastKey()).toBe('a-u-a-base');
    expect(last()!.delta).toBe(4);
    cart().updateQuantity('b', 0.5, 'u-b-base');
    expect(lastKey()).toBe('b-u-b-base');
    expect(last()!.delta).toBe(-0.5);
  });

  it('is set by a unit change (delta 0)', () => {
    const pack = { id: 'u-a-pack', unitName: 'แพ็ค', factor: 6, price: 55, barcode: '' };
    const a = product('a', 10, [pack]);
    useProductStore.setState({ products: [a] });
    cart().addItem(a);
    cart().addItem(product('b'));
    cart().setItemUnit('a', pack);
    const line = cart().items.find((i) => i.productId === 'a')!;
    expect(line.unitName).toBe('แพ็ค');
    expect(lastKey()).toBe(cartLineKey(line));
    expect(last()!.delta).toBe(0);
  });

  it('follows the line when the rollup turns pieces into a pack', () => {
    const pack = { id: 'u-a-pack', unitName: 'แพ็ค', factor: 3, price: 28, barcode: '' };
    const a = product('a', 10, [pack]);
    useProductStore.setState({ products: [a] });
    cart().addItem(a);
    cart().addItem(product('b'));
    cart().addItem(a);
    cart().addItem(a); // 3 pieces -> 1 pack
    const line = cart().items.find((i) => i.productId === 'a')!;
    expect(line.unitName).toBe('แพ็ค');
    expect(lastKey()).toBe(cartLineKey(line));
  });

  it('follows the line when lines are reordered (a discounted line moves to the top)', () => {
    cart().addItem(product('a'));
    cart().addItem(product('b'));
    cart().setItemDiscount('b', 'baht', 1, 'u-b-base');
    cart().addItem(product('a')); // rollup puts the discounted b first
    expect(cart().items[0].productId).toBe('b');
    expect(lastKey()).toBe('a-u-a-base');
    cart().removeItem('b', 'u-b-base');
    expect(lastKey()).toBe('a-u-a-base');
  });

  it('is cleared when that line is removed (also by quantity 0), kept when another line is removed', () => {
    cart().addItem(product('a'));
    cart().addItem(product('b'));
    cart().removeItem('a', 'u-a-base');
    expect(lastKey()).toBe('b-u-b-base');
    cart().removeItem('b', 'u-b-base');
    expect(last()).toBeNull();
    cart().addItem(product('c'));
    cart().updateQuantity('c', 0, 'u-c-base');
    expect(last()).toBeNull();
  });

  it('is cleared when the cart is cleared, paid (clearCart), held or a bill is recalled', () => {
    cart().addItem(product('a'));
    cart().clearCart();
    expect(last()).toBeNull();
    cart().addItem(product('a'));
    cart().holdBill();
    expect(last()).toBeNull();
    cart().addItem(product('b'));
    cart().recallBill(cart().heldBills[0].id);
    expect(last()).toBeNull();
  });

  it('findTouchedLine returns null for a product that is not in the cart', () => {
    expect(findTouchedLine([], 'x', 'u')).toBeNull();
  });

  it('stays fast: 500 scans over 100 lines', () => {
    const ps = Array.from({ length: 100 }, (_, i) => product(`q${i}`));
    const t0 = performance.now();
    for (let n = 0; n < 500; n++) cart().addItem(ps[n % 100]);
    const ms = performance.now() - t0;
    expect(cart().items).toHaveLength(100);
    expect(cart().items[0].quantity).toBe(5);
    expect(lastKey()).toBe('q99-u-q99-base');
    expect(ms).toBeLessThan(2000);
  });
});
