import { BadRequestException } from '@nestjs/common';
import { canTransition, normalizeFrontendStatus, parseClaimStockCost, parseClaimStockQuantity } from './claims.service';

describe('claim workflow', () => {
  it('accepts only known statuses (legacy aliases mapped)', () => {
    expect(normalizeFrontendStatus('sent_to_supplier')).toBe('SENT_TO_SUPPLIER');
    expect(normalizeFrontendStatus('PENDING')).toBe('PENDING_SUPPLIER');
    expect(normalizeFrontendStatus('<script>')).toBeNull();
    expect(normalizeFrontendStatus(42)).toBeNull();
  });
  it('allows only defined transitions; REJECTED/SCRAPPED are final', () => {
    expect(canTransition('PENDING_CHECKOUT', 'COMPLETED')).toBe(true);
    expect(canTransition('SENT_TO_SUPPLIER', 'PENDING_SUPPLIER')).toBe(true);
    expect(canTransition('COMPLETED', 'PENDING_CHECKOUT')).toBe(false);
    expect(canTransition('REJECTED', 'COMPLETED')).toBe(false);
    expect(canTransition('SCRAPPED', 'PENDING_SUPPLIER')).toBe(false);
    expect(canTransition('COMPLETED', 'COMPLETED')).toBe(true);
  });
});

describe('claim stock input', () => {
  it('rejects negative, fractional and huge quantities', () => {
    expect(() => parseClaimStockQuantity(-1)).toThrow(BadRequestException);
    expect(() => parseClaimStockQuantity(1.5)).toThrow(BadRequestException);
    expect(() => parseClaimStockQuantity(1e30)).toThrow(BadRequestException);
    expect(() => parseClaimStockQuantity('abc')).toThrow(BadRequestException);
    expect(parseClaimStockQuantity('3')).toBe(3);
  });
  it('rejects negative cost', () => {
    expect(() => parseClaimStockCost(-9)).toThrow(BadRequestException);
    expect(parseClaimStockCost(10.555)).toBe(10.56);
  });
});
