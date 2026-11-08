import { BadRequestException } from '@nestjs/common';
import { canViewCost, stripCostFields } from './cost-visibility';
import { parsePrice, parseQtyPerPrev } from './products.service';
import { clampInt, rethrowPrismaError } from './prisma-errors';
import { validateCategoryInput } from '../categories/categories.controller';

describe('cost visibility', () => {
  it('only ADMIN, VIEW_COST or ALL can see costs', () => {
    expect(canViewCost({ role: 'ADMIN', permissions: [] })).toBe(true);
    expect(canViewCost({ role: 'CASHIER', permissions: ['VIEW_COST'] })).toBe(true);
    expect(canViewCost({ role: 'MANAGER', permissions: ['ALL'] })).toBe(true);
    expect(canViewCost({ role: 'CASHIER', permissions: ['POS_SELL', 'MANAGE_INVENTORY'] })).toBe(false);
    expect(canViewCost(undefined)).toBe(false);
  });

  it('strips nested cost fields but keeps everything else', () => {
    const when = new Date();
    const out: any = stripCostFields([
      { id: 'p', costPrice: 5, basePrice: 9, createdAt: when, stockBatches: [{ quantityRemaining: 3, unitCost: 4 }], supplierEntries: [{ unitCost: 1, lastCost: 1, supplierId: 's' }] },
    ]);
    expect(out[0]).toEqual({ id: 'p', basePrice: 9, createdAt: when, stockBatches: [{ quantityRemaining: 3 }], supplierEntries: [{ supplierId: 's' }] });
    expect(out[0].createdAt).toBeInstanceOf(Date);
  });
});

describe('product input validation', () => {
  it('prices must be 0..10,000,000', () => {
    expect(parsePrice('1,250.5', 'ราคา')).toBe(1250.5);
    expect(parsePrice(0, 'ราคา')).toBe(0);
    for (const bad of [-5, 1e12, 'abc', NaN]) expect(() => parsePrice(bad, 'ราคา')).toThrow(BadRequestException);
  });

  it('qtyPerPrev is an integer >= 1 (blank = 1)', () => {
    expect(parseQtyPerPrev(undefined, 'box')).toBe(1);
    expect(parseQtyPerPrev(12, 'box')).toBe(12);
    for (const bad of [0, -3, 2.5, 'x']) expect(() => parseQtyPerPrev(bad, 'box')).toThrow(BadRequestException);
  });
});

describe('list params and prisma errors', () => {
  it('clampInt falls back and clamps', () => {
    expect(clampInt('abc', 50, 1, 500)).toBe(50);
    expect(clampInt('-5', 50, 1, 500)).toBe(1);
    expect(clampInt('9999', 50, 1, 500)).toBe(500);
    expect(clampInt(undefined, 100, 1, 1000)).toBe(100);
  });

  it('maps prisma codes to 4xx', () => {
    expect(() => rethrowPrismaError({ code: 'P2002' })).toThrow(expect.objectContaining({ status: 409 }));
    expect(() => rethrowPrismaError({ code: 'P2025' })).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => rethrowPrismaError({ code: 'P2003' })).toThrow(expect.objectContaining({ status: 400 }));
    const other = new Error('boom');
    expect(() => rethrowPrismaError(other)).toThrow(other);
  });
});

describe('category input', () => {
  it('requires a name and rejects unknown fields', () => {
    expect(validateCategoryInput({ name: '  เครื่องดื่ม ' }, false)).toEqual({ name: 'เครื่องดื่ม' });
    expect(() => validateCategoryInput({}, false)).toThrow(BadRequestException);
    expect(() => validateCategoryInput({ name: 'x', foo: 1 }, false)).toThrow(BadRequestException);
    expect(() => validateCategoryInput({}, true)).toThrow(BadRequestException);
    expect(validateCategoryInput({ color: '#123456' }, true)).toEqual({ color: '#123456' });
  });
});
