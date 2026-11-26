import { describe, expect, it, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) });
import { calculateEarnedPoints, calculateRedemptionDiscount, normalizeCustomerRow } from '@/lib/customer-service';
import { setShopLoyaltyConfig, shopRates } from '@/lib/loyalty-rates';

// docs/round-shift-today-bundle-replace.md 5a: the POS preview follows the shop rate unless the member has their own
describe('POS points preview', () => {
  beforeEach(() => setShopLoyaltyConfig({ defaultPointEarnRateBaht: 100, defaultPointEarnUnits: 5, defaultPointRedeemRatePoints: 50, defaultPointRedeemDiscountBaht: 2 }));

  it('a member row no longer gets 500 / 10 / 100 / 1 filled in', () => {
    const c = normalizeCustomerRow({ id: 'c1', name: 'ก', profile: { priceLevel: 2 } } as never);
    expect(c.pointEarnRateBaht).toBeUndefined();
    expect(c.pointRedeemDiscountBaht).toBeUndefined();
  });

  it('uses the shop rate for a member without one and the member rate otherwise', () => {
    const plain = normalizeCustomerRow({ id: 'c1', name: 'ก' } as never);
    const own = normalizeCustomerRow({ id: 'c2', name: 'ข', profile: { pointEarnRateBaht: 200, pointEarnUnits: 1 } } as never);
    expect(calculateEarnedPoints(plain, 450)).toBe(20);
    expect(calculateEarnedPoints(own, 450)).toBe(2);
    expect(calculateRedemptionDiscount(plain, 120)).toBe(4);
  });

  it('remembers the shop rate for an offline start', () => {
    expect(JSON.parse(localStorage.getItem('purim-cache:loyalty-config') || '{}').defaultPointEarnUnits).toBe(5);
    expect(shopRates().earnBaht).toBe(100);
  });
});
