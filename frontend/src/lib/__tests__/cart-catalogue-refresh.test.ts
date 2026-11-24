import { beforeEach, describe, expect, it, vi } from 'vitest';

// docs/pos-keys-refresh.md: lines already in the cart follow a catalogue price change made in the back office
const settings = vi.hoisted(() => ({ vatEnabled: false, vatRate: 7, posAskCustomerAtStart: false, walkInLevelNeedsDiscount: false }));
vi.mock('@/lib/store-settings-storage', () => ({
  loadStoreSettings: () => ({ ...settings }),
  getLowStockThreshold: () => 5,
}));
vi.mock('@/lib/customer-service', () => ({ getCustomerById: () => null }));

import { useCartStore } from '@/lib/store/cart-store';
import { toStoreProduct, useProductStore } from '@/lib/store/product-store';
import { priceChangeToast } from '@/lib/pos/cart-catalogue-refresh';

const cart = () => useCartStore.getState();
const row = (over: Record<string, unknown> = {}) => toStoreProduct({
  id: 'dish', sku: 'D1', name: 'น้ำยาล้างจานสูตรมะนาว 800 มล.', unit: 'ขวด', basePrice: '20', priceLevel1: '20', priceLevel2: '18',
  packagingUnits: [{ id: 'pk', name: 'แพ็ค', qtyPerPrev: 6, priceLevel1: '110', priceLevel2: '100' }],
  ...over,
} as never);
const glue = toStoreProduct({ id: 'glue', sku: 'G1', name: 'กาวร้อน', unit: 'หลอด', basePrice: '50', priceLevel1: '50' } as never);
const setCatalogue = (...p: ReturnType<typeof row>[]) => useProductStore.setState({ products: p });
const line = (name: string, unit?: string) => cart().items.find((i) => i.name.startsWith(name) && (!unit || i.unitName === unit))!;

beforeEach(() => {
  setCatalogue(row(), glue);
  cart().clearCart();
  useCartStore.setState({ heldBills: [] });
});

describe('applyCatalogPrices', () => {
  it('nothing changed: no change, no notice, same items array', () => {
    cart().addItem(row());
    const before = cart().items;
    expect(cart().applyCatalogPrices()).toEqual([]);
    expect(cart().items).toBe(before);
  });

  it('ราคา 1 and pack price changed: lines re-priced with a notice (money with 2 decimals)', () => {
    const p = row();
    cart().addItem(p);
    cart().addItem(p, p.units[1]);
    cart().addItem(glue);
    setCatalogue(row({ basePrice: '25', priceLevel1: '25', packagingUnits: [{ id: 'pk', name: 'แพ็ค', qtyPerPrev: 6, priceLevel1: '120', priceLevel2: '100' }] }), glue);
    const changes = cart().applyCatalogPrices();
    expect(changes.map((c) => [c.unitName, c.from, c.to]).sort()).toEqual([['ขวด', 20, 25], ['แพ็ค', 110, 120]]);
    expect(line('น้ำยา', 'ขวด')).toMatchObject({ originalPrice: 25, priceNotice: 'ราคาอัปเดต ฿20.00 → ฿25.00' });
    expect(line('น้ำยา', 'แพ็ค')).toMatchObject({ originalPrice: 120, priceNotice: 'ราคาอัปเดต ฿110.00 → ฿120.00' });
    expect(line('กาว').priceNotice).toBeUndefined();
    expect(cart().getTotal()).toBe(195);
    expect(priceChangeToast(changes)).toContain('น้ำยาล้างจานสูตรมะนาว 800 มล. (ขวด) ฿20.00 → ฿25.00');
    expect(priceChangeToast([...changes, ...changes])).toMatch(/^ราคาอัปเดต: .+ \(\+2 รายการ\)$/);
    // a second call with the same catalogue changes nothing and keeps the notice
    expect(cart().applyCatalogPrices()).toEqual([]);
    expect(line('น้ำยา', 'ขวด').priceNotice).toBe('ราคาอัปเดต ฿20.00 → ฿25.00');
  });

  it('member level 2 bill: follows ราคา 2', () => {
    cart().setCustomer('m', 'ร้านส่ง', 2);
    cart().addItem(row());
    expect(line('น้ำยา').originalPrice).toBe(18);
    setCatalogue(row({ priceLevel2: '17' }), glue);
    expect(cart().applyCatalogPrices().map((c) => c.to)).toEqual([17]);
  });

  it('manual price (F4), online-order price and an edited old bill are never touched', () => {
    cart().addItem(row());
    cart().setCustomPrice('dish', 19, cart().items[0].unitId);
    cart().addItem(glue);
    useCartStore.setState({ items: cart().items.map((i) => (i.productId === 'glue' ? { ...i, fixedPrice: true } : i)) });
    setCatalogue(row({ basePrice: '30', priceLevel1: '30' }), toStoreProduct({ id: 'glue', sku: 'G1', name: 'กาวร้อน', unit: 'หลอด', basePrice: '60', priceLevel1: '60' } as never));
    expect(cart().applyCatalogPrices()).toEqual([]);
    expect([line('น้ำยา').customPrice, line('กาว').originalPrice]).toEqual([19, 50]);

    cart().clearCart();
    setCatalogue(row(), glue);
    cart().addItem(row());
    cart().setEditingOrderId('old-bill');
    setCatalogue(row({ basePrice: '30', priceLevel1: '30' }), glue);
    expect(cart().applyCatalogPrices()).toEqual([]);
    expect(line('น้ำยา').originalPrice).toBe(20);
  });

  it('a product no longer in the catalogue keeps its line; the order of the lines is kept', () => {
    cart().addItem(glue);
    cart().addItem(row());
    setCatalogue(row({ basePrice: '22', priceLevel1: '22' }));
    expect(cart().applyCatalogPrices().map((c) => c.to)).toEqual([22]);
    expect(cart().items.map((i) => [i.productId, i.originalPrice])).toEqual([['glue', 50], ['dish', 22]]);
  });

  it('held bills are not changed', () => {
    cart().addItem(row());
    cart().holdBill();
    setCatalogue(row({ basePrice: '30', priceLevel1: '30' }), glue);
    expect(cart().applyCatalogPrices()).toEqual([]);
    expect(cart().heldBills[0].items[0].originalPrice).toBe(20);
  });
});
