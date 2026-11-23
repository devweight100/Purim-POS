import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Product } from '@/lib/types';

// docs/pos-price-level.md: the cart prices every line at the bill's level and re-prices on customer / level change
const settings = vi.hoisted(() => ({ vatEnabled: false, vatRate: 7, posAskCustomerAtStart: false, walkInLevelNeedsDiscount: false }));
vi.mock('@/lib/store-settings-storage', () => ({
  loadStoreSettings: () => ({ ...settings }),
  getLowStockThreshold: () => 5,
}));
const customers = vi.hoisted(() => new Map<string, { id: string; priceLevel: number }>());
vi.mock('@/lib/customer-service', () => ({
  getCustomerById: (id: string) => customers.get(id) ?? null,
}));
vi.mock('@/lib/ask-dialog', () => ({ askConfirm: vi.fn(async () => false), askReason: vi.fn(async () => null) }));

import { useCartStore, sanitizePersistedCart } from '@/lib/store/cart-store';
import { toStoreProduct, useProductStore } from '@/lib/store/product-store';
import { addToCart, finishStart, usePosStart } from '@/lib/pos/pos-add';
import { askConfirm } from '@/lib/ask-dialog';

const cart = () => useCartStore.getState();
const price = (name: string, unit?: string) => {
  const l = cart().items.find((i) => i.name === name && (!unit || i.unitName === unit));
  return l ? (l.customPrice ?? l.originalPrice) : undefined;
};

// realistic catalogue rows (as GET /products sends them: Decimal strings, packs with / without own level prices)
const dish = toStoreProduct({
  id: 'dish', sku: 'D1', name: 'น้ำยาล้างจาน', unit: 'ขวด', basePrice: '20', priceLevel1: '20', priceLevel2: '18', priceLevel3: '16',
  packagingUnits: [
    { id: 'pk', name: 'แพ็ค', qtyPerPrev: 6, priceLevel1: '110', priceLevel2: '100', priceLevel3: null },
    { id: 'cs', name: 'ลัง', qtyPerPrev: 4 },
  ],
} as never);
const glue = toStoreProduct({ id: 'glue', sku: 'G1', name: 'กาว', unit: 'หลอด', basePrice: '50', priceLevel1: '50' } as never);
const tape = toStoreProduct({ id: 'tape', sku: 'T1', name: 'เทป', unit: 'ม้วน', basePrice: '0', priceLevel1: '0', priceLevel3: '30' } as never);
const none = toStoreProduct({ id: 'none', sku: 'N1', name: 'ไม่มีราคา', unit: 'ชิ้น', basePrice: '0', priceLevel1: null } as never);
const packOf = (p: Product, name: string) => p.units.find((u) => u.unitName === name)!;

beforeEach(() => {
  settings.posAskCustomerAtStart = false;
  settings.walkInLevelNeedsDiscount = false;
  customers.clear();
  customers.set('m2', { id: 'm2', priceLevel: 2 });
  customers.set('m3', { id: 'm3', priceLevel: 3 });
  useProductStore.setState({ products: [dish, glue, tape, none] });
  cart().clearCart();
  useCartStore.setState({ heldBills: [] });
  usePosStart.setState({ open: false, pending: [] });
});

describe('catalogue unit prices (ราคา 1, shared rule)', () => {
  it('a pack without its own ราคา 1 = base x size (was the base price); no ราคา 1 = first of 2..5', () => {
    expect(dish.units.map((u) => [u.unitName, u.factor, u.price])).toEqual([['ขวด', 1, 20], ['แพ็ค', 6, 110], ['ลัง', 24, 480]]);
    expect(tape.units[0].price).toBe(30);
    expect(none.units[0].price).toBe(0);
  });
});

describe('cart prices follow the bill level', () => {
  it('(a) member first, then items: level price, fallback to ราคา 1, ราคา 3 when 1 / 2 are empty', () => {
    cart().setCustomer('m2', 'ร้านส่ง', 2);
    cart().addItem(dish);
    cart().addItem(glue);
    cart().addItem(tape);
    expect([price('น้ำยาล้างจาน'), price('กาว'), price('เทป')]).toEqual([18, 50, 30]);
    expect(cart().items.map((i) => i.priceLevel)).toEqual([2, 1, 3]);
    expect(cart().getTotal()).toBe(98);
  });

  it('(b)(c) items first, then member / change / clear: every line re-priced', () => {
    cart().addItem(dish);
    expect(price('น้ำยาล้างจาน')).toBe(20);
    cart().setCustomer('m2', 'ร้านส่ง'); // level looked up in the customer list
    expect(price('น้ำยาล้างจาน')).toBe(18);
    cart().setCustomer('m3', 'ช่าง', 3);
    expect(price('น้ำยาล้างจาน')).toBe(16);
    cart().setCustomer(null, null);
    expect(price('น้ำยาล้างจาน')).toBe(20);
    expect(cart().priceLevel).toBe(1);
  });

  it('walk-in level (no member) and the member level followed from the server', () => {
    cart().addItem(dish);
    cart().setWalkInLevel(3);
    expect(cart()).toMatchObject({ customerId: null, priceLevel: 3, levelChosen: true });
    expect(price('น้ำยาล้างจาน')).toBe(16);
    cart().setCustomer('m2', 'ร้านส่ง', 2);
    cart().setMemberLevel(3);
    expect(price('น้ำยาล้างจาน')).toBe(16);
  });

  it('(d)(e) pack scan and roll-up: own pack level price, else base level x size', () => {
    cart().setCustomer('m2', 'ร้านส่ง', 2);
    cart().addItem(dish, packOf(dish, 'แพ็ค'));
    expect(price('น้ำยาล้างจาน', 'แพ็ค')).toBe(100);
    cart().setCustomer('m3', 'ช่าง', 3);
    expect(price('น้ำยาล้างจาน', 'แพ็ค')).toBe(96);
    cart().clearCart();
    cart().setCustomer('m2', 'ร้านส่ง', 2);
    for (let i = 0; i < 7; i++) cart().addItem(dish);
    expect(cart().items.map((i) => [i.unitName, i.quantity, i.originalPrice])).toEqual([['แพ็ค', 1, 100], ['ขวด', 1, 18]]);
    cart().setItemUnit('dish', packOf(dish, 'ลัง'));
    expect(price('น้ำยาล้างจาน', 'ลัง')).toBe(432); // 18 x 24
  });

  it('(f) held bill keeps the level; (g) persisted cart keeps it', () => {
    cart().setCustomer('m2', 'ร้านส่ง', 2);
    cart().addItem(dish);
    cart().holdBill();
    expect(cart().priceLevel).toBe(1);
    cart().recallBill(cart().heldBills[0].id);
    expect(cart().priceLevel).toBe(2);
    cart().addItem(dish);
    expect(price('น้ำยาล้างจาน')).toBe(18);
    expect(sanitizePersistedCart({ items: [], priceLevel: 3, levelChosen: true })).toMatchObject({ priceLevel: 3, levelChosen: true });
    expect(sanitizePersistedCart({ items: [], priceLevel: 'x' })).toMatchObject({ priceLevel: 1, levelChosen: false });
  });

  it('(g) catalogue not loaded (offline): lines re-price from their own level prices', () => {
    cart().addItem(dish);
    useProductStore.setState({ products: [] });
    cart().setCustomer('m3', 'ช่าง', 3);
    expect(price('น้ำยาล้างจาน')).toBe(16);
  });

  it('(j) manual price stays manual; a line with a discount still follows the level; agreed online price is kept', () => {
    cart().addItem(dish);
    cart().addItem(glue);
    cart().setCustomPrice('glue', 45);
    cart().setItemDiscount('dish', 'baht', 1);
    cart().setCustomer('m2', 'ร้านส่ง', 2);
    expect(price('กาว')).toBe(45);
    expect(price('น้ำยาล้างจาน')).toBe(18);
    expect(cart().getItemLineTotal(cart().items.find((i) => i.productId === 'dish')!)).toBe(17);
    cart().loadOnlineOrder({ id: 'o1', orderNo: 'OL-1', customerId: 'm3', customerName: 'ช่าง', note: '', items: [{ ...cart().items[0], productId: 'dish', name: 'น้ำยาล้างจาน', originalPrice: 19, customPrice: null, discountType: 'none', discountValue: 0 }] });
    expect(cart().priceLevel).toBe(3);
    cart().addItem(glue);
    expect(price('น้ำยาล้างจาน')).toBe(19);
  });

  it('a product without any price is not added; a manual price adds it as a manual line', () => {
    expect(cart().addItem(none)).toBe(false);
    expect(cart().items).toHaveLength(0);
    expect(cart().addItem(none, undefined, 25)).toBe(true);
    expect(cart().items[0]).toMatchObject({ customPrice: 25, originalPrice: 0 });
  });
});

describe('addToCart gate', () => {
  it('no price: popup, nothing added', () => {
    expect(addToCart(none)).toBe('no-price');
    expect(askConfirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'สินค้านี้ยังไม่ได้ตั้งราคา', alertOnly: true }));
    expect(cart().items).toHaveLength(0);
  });

  it('start-of-bill dialog on: the first scan (and scans while it is open) wait, then go in at the chosen level', () => {
    settings.posAskCustomerAtStart = true;
    const added = vi.fn();
    expect(addToCart(dish, undefined, { onAdded: added })).toBe('pending');
    expect(addToCart(glue)).toBe('pending');
    expect(usePosStart.getState()).toMatchObject({ open: true });
    expect(cart().items).toHaveLength(0);
    cart().setWalkInLevel(2);
    finishStart();
    expect(usePosStart.getState().open).toBe(false);
    expect([price('น้ำยาล้างจาน'), price('กาว')]).toEqual([18, 50]);
    expect(added).toHaveBeenCalledTimes(1);
    // the bill has started: no dialog for the next item; a new bill asks again
    expect(addToCart(dish)).toBe('added');
    cart().clearCart();
    expect(addToCart(dish)).toBe('pending');
  });

  it('start-of-bill dialog off: added at once', () => {
    expect(addToCart(dish)).toBe('added');
    expect(price('น้ำยาล้างจาน')).toBe(20);
  });
});
