import { OrdersService } from './orders.service';

// expectedUnitPrice is private; exercised directly because it decides whether a sale needs discount rights
// (shared price-level rule, docs/pos-price-level.md)
const svc = new OrdersService({} as any, {} as any) as any;
const product = {
  basePrice: 12, priceLevel1: 12, priceLevel2: 11, priceLevel3: null, priceLevel4: 0, priceLevel5: null,
  packagingUnits: [{ id: 'pack', name: 'แพ็ค', qtyPerPrev: 6, priceLevel1: 60, priceLevel2: 58 }],
  wholesalePrices: [{ minQuantity: 24, unitPrice: 9.5 }],
};

describe('expected unit price at the bill level', () => {
  it('base unit: the level price; a level without a price falls back to ราคา 1', () => {
    expect(svc.expectedUnitPrice(product, 1, undefined, undefined, 1, 1)).toBe(12);
    expect(svc.expectedUnitPrice(product, 1, undefined, undefined, 2, 1)).toBe(11);
    expect(svc.expectedUnitPrice(product, 1, undefined, undefined, 3, 1)).toBe(12);
  });
  it('pack unit: own pack price per level, else base level x factor (never above the pack ราคา 1)', () => {
    expect(svc.expectedUnitPrice(product, 6, 'pack', 'แพ็ค', 1, 6)).toBe(60);
    expect(svc.expectedUnitPrice(product, 6, 'pack', 'แพ็ค', 2, 6)).toBe(58);
    expect(svc.expectedUnitPrice(product, 6, 'pack', 'แพ็ค', 3, 6)).toBe(60);
  });
  it('wholesale step lowers it once the bill reaches its quantity', () => {
    expect(svc.expectedUnitPrice(product, 1, undefined, undefined, 1, 24)).toBe(9.5);
    expect(svc.expectedUnitPrice(product, 1, undefined, undefined, 1, 23)).toBe(12);
  });
  it('agreed online-order price lowers it', () => {
    expect(svc.expectedUnitPrice(product, 1, undefined, undefined, 1, 1, 10)).toBe(10);
  });
  it('no price at any level = null (not sellable without a manual price + right / approval)', () => {
    expect(svc.expectedUnitPrice({ basePrice: 0, packagingUnits: [], wholesalePrices: [] }, 1, undefined, undefined, 1, 1)).toBeNull();
    // ราคา 3 only: everyone pays it
    expect(svc.expectedUnitPrice({ basePrice: 0, priceLevel3: 30, packagingUnits: [], wholesalePrices: [] }, 1, undefined, undefined, 1, 1)).toBe(30);
  });
});
