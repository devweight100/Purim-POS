/** Online shop rules. Runs under backend jest and frontend vitest. */
import {
  deliveryFeeFor,
  levelNames,
  nextStatuses,
  normalizeLevel,
  normalizeThaiPhone,
  onlineOrderTotals,
  parseDeliveryFee,
  shopUnits,
} from '../src/online-shop';

const product = { basePrice: 100, priceLevel1: 100, priceLevel2: 90, priceLevel3: 85, priceLevel4: null, priceLevel5: 0, unit: 'ชิ้น' };
const packs = [
  { id: 'pk', name: 'แพค', qtyPerPrev: 6, priceLevel1: 570, priceLevel2: null, priceLevel3: 480 },
  { id: 'cs', name: 'ลัง', qtyPerPrev: 4, priceLevel1: null, priceLevel2: 2000, priceLevel3: null },
];

describe('shopUnits', () => {
  it('retail (level 1): base, pack price, case = retail x factor when unset', () => {
    expect(shopUnits(product, packs, 1)).toEqual([
      { id: null, name: 'ชิ้น', factor: 1, price: 100 },
      { id: 'pk', name: 'แพค', factor: 6, price: 570 },
      { id: 'cs', name: 'ลัง', factor: 24, price: 2400 },
    ]);
  });
  it('level 2: pack falls back to base level x factor, capped by the pack retail price', () => {
    // pack: 90 x 6 = 540 (< 570); case: own level-2 price 2000
    expect(shopUnits(product, packs, 2).map((u) => u.price)).toEqual([90, 540, 2000]);
  });
  it('level 3: own pack price; case from base level 3 x 24', () => {
    expect(shopUnits(product, packs, 3).map((u) => u.price)).toEqual([85, 480, 2040]);
  });
  it('a level without prices = retail; a level above retail is capped', () => {
    expect(shopUnits(product, packs, 4).map((u) => u.price)).toEqual([100, 570, 2400]);
    expect(shopUnits({ basePrice: 50, priceLevel1: 50, priceLevel2: 60 }, [], 2)).toEqual([{ id: null, name: 'ชิ้น', factor: 1, price: 50 }]);
  });
  it('basePrice when level 1 is empty; no price -> no unit; broken chain stops', () => {
    expect(shopUnits({ basePrice: '12.50', priceLevel1: null }, [], 1)[0].price).toBe(12.5);
    expect(shopUnits({ basePrice: 0 }, [], 1)).toEqual([]);
    expect(shopUnits(product, [{ id: 'x', name: 'x', qtyPerPrev: 0 }, packs[0]], 1)).toHaveLength(1);
  });
});

describe('delivery fee', () => {
  it('pickup 0, delivery = member fee or pending', () => {
    expect(deliveryFeeFor('PICKUP', 80)).toBe(0);
    expect(deliveryFeeFor('DELIVERY', 80)).toBe(80);
    expect(deliveryFeeFor('DELIVERY', '120')).toBe(120);
    expect(deliveryFeeFor('DELIVERY', undefined)).toBeNull();
    expect(deliveryFeeFor('DELIVERY', 'abc')).toBeNull();
  });
  it('validates', () => {
    expect(parseDeliveryFee('')).toEqual({ ok: true, value: null });
    expect(parseDeliveryFee(50)).toEqual({ ok: true, value: 50 });
    expect(parseDeliveryFee(-1).ok).toBe(false);
    expect(parseDeliveryFee(10001).ok).toBe(false);
    expect(parseDeliveryFee(1.005).ok).toBe(false);
    expect(parseDeliveryFee(true).ok).toBe(false);
  });
  it('totals', () => {
    expect(onlineOrderTotals([{ quantity: 3, unitPrice: 33.33 }, { quantity: 1, unitPrice: 0.01 }], 70)).toEqual({ subtotal: 100, deliveryFee: 70, feePending: false, total: 170 });
    expect(onlineOrderTotals([{ quantity: 2, unitPrice: 10 }], null)).toEqual({ subtotal: 20, deliveryFee: null, feePending: true, total: 20 });
  });
});

describe('misc', () => {
  it('levels and names', () => {
    expect(normalizeLevel('3')).toBe(3);
    expect(normalizeLevel(9)).toBe(1);
    expect(normalizeLevel(undefined)).toBe(1);
    expect(levelNames({ 2: ' ส่งช่าง ', 3: '' })[2]).toBe('ส่งช่าง');
    expect(levelNames(null)[3]).toBe('ราคาส่งพิเศษ');
  });
  it('status flow', () => {
    expect(nextStatuses('ACCEPTED', 'PICKUP')).toEqual(['PREPARING', 'DONE', 'CANCELLED']);
    expect(nextStatuses('PREPARING', 'DELIVERY')).toContain('DELIVERING');
    expect(nextStatuses('DONE', 'DELIVERY')).toEqual([]);
    expect(nextStatuses('NEW', 'DELIVERY')).toEqual([]);
    // READY ("จัดของเสร็จ") is set by its own action, never by a status button; from READY: deliver / done
    expect(nextStatuses('ACCEPTED', 'DELIVERY')).not.toContain('READY');
    expect(nextStatuses('READY', 'DELIVERY')).toEqual(['DELIVERING', 'DONE', 'CANCELLED']);
    expect(nextStatuses('READY', 'PICKUP')).toEqual(['DONE', 'CANCELLED']);
  });
  it('phones', () => {
    expect(normalizeThaiPhone('081-234-5678')).toBe('0812345678');
    expect(normalizeThaiPhone('+66 81 234 5678')).toBe('0812345678');
    expect(normalizeThaiPhone('02 123 4567')).toBe('021234567');
    expect(normalizeThaiPhone('12345')).toBeNull();
  });
});
