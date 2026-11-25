import { describe, expect, it } from 'vitest';
import { displayUnitCost, stockOnHandCost } from './product-cost';

describe('product cost shown in tables', () => {
  it('shows the cost typed in the product form, even when the stock on hand cost differs', () => {
    expect(displayUnitCost({ costPrice: '65', stockUnitCost: 59.5 })).toBe(65);
    expect(stockOnHandCost({ costPrice: '65', stockUnitCost: 59.5 })).toBe(59.5);
  });
  it('no second line when both costs are the same', () => {
    expect(stockOnHandCost({ costPrice: 12, stockUnitCost: 12.001 })).toBeUndefined();
  });
  it('falls back to the stock cost when no typed cost is known', () => {
    expect(displayUnitCost({ stockUnitCost: 40 })).toBe(40);
    expect(stockOnHandCost({ stockUnitCost: 40 })).toBeUndefined();
  });
  it('a typed cost of 0 (never entered) falls back to the stock cost, no second line', () => {
    expect(displayUnitCost({ costPrice: 0, stockUnitCost: 59.5 })).toBe(59.5);
    expect(stockOnHandCost({ costPrice: 0, stockUnitCost: 59.5 })).toBeUndefined();
    expect(displayUnitCost({ costPrice: 0 })).toBe(0);
  });
  it('unknown cost (no permission) stays undefined', () => {
    expect(displayUnitCost({})).toBeUndefined();
  });
});
