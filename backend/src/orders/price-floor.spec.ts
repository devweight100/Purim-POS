import { OrdersService } from './orders.service';

// lowestAllowedUnitPrice is private; exercised directly because it decides whether a sale needs discount rights
const svc = new OrdersService({} as any, {} as any) as any;
const product = {
  basePrice: 12, priceLevel1: 12, priceLevel2: 11, priceLevel3: null, priceLevel4: 0, priceLevel5: null,
  packagingUnits: [{ id: 'pack', name: 'แพ็ค', qtyPerPrev: 6, priceLevel1: 60, priceLevel2: 58 }],
  wholesalePrices: [{ minQuantity: 24, unitPrice: 9.5 }],
};

describe('price floor (lowest price the system itself would charge)', () => {
  it('base unit: lowest configured price level', () => {
    expect(svc.lowestAllowedUnitPrice(product, 1, undefined, undefined, 1)).toBe(11);
  });
  it('pack unit: lowest of pack prices and base levels x factor', () => {
    expect(svc.lowestAllowedUnitPrice(product, 6, 'pack', 'แพ็ค', 6)).toBe(58);
  });
  it('wholesale step applies once the bill reaches its quantity', () => {
    expect(svc.lowestAllowedUnitPrice(product, 1, undefined, undefined, 24)).toBe(9.5);
    expect(svc.lowestAllowedUnitPrice(product, 1, undefined, undefined, 23)).toBe(11);
  });
  it('no configured price means no floor', () => {
    expect(svc.lowestAllowedUnitPrice({ basePrice: 0, packagingUnits: [], wholesalePrices: [] }, 1, undefined, undefined, 1)).toBeNull();
  });
});
