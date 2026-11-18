import { describe, expect, it } from 'vitest';
import { DOC_PREFIX, docPeriod, formatDocNumber, parseDocNumber } from '@shared/doc-number';

describe('document numbers (round 4: <PP><YYMM>-<NNNN>, CE year)', () => {
  it('formats prefix + Christian-era YYMM + 4-digit running number', () => {
    expect(formatDocNumber('SALE', '2611', 1)).toBe('IN2611-0001');
    expect(formatDocNumber('PURCHASE_ORDER', '2612', 37)).toBe('PO2612-0037');
    expect(formatDocNumber('SHIFT', '2701', 9999)).toBe('SH2701-9999');
    // a busy month goes past 4 digits instead of wrapping
    expect(formatDocNumber('SALE', '2611', 10000)).toBe('IN2611-10000');
    expect(() => formatDocNumber('SALE', '261', 1)).toThrow();
    expect(() => formatDocNumber('SALE', '2611', 0)).toThrow();
  });

  it('period = Bangkok calendar month, CE 2-digit year (Nov 2026 -> 2611)', () => {
    expect(docPeriod('2026-11-18T07:00:00Z')).toBe('2611');
    expect(docPeriod('2026-11-30T17:00:00Z')).toBe('2612'); // 00:00 1 Dec in Bangkok
    expect(docPeriod('2026-12-31T16:59:59Z')).toBe('2612');
    expect(docPeriod('2026-12-31T17:00:00Z')).toBe('2701');
  });

  it('prefixes are 2 letters and distinct', () => {
    const all = Object.values(DOC_PREFIX);
    expect(new Set(all).size).toBe(all.length);
    for (const p of all) expect(p).toMatch(/^[A-Z]{2}$/);
  });

  it('parses new numbers back; old formats are not mistaken for new ones', () => {
    expect(parseDocNumber('IN2611-0001')).toEqual({ type: 'SALE', period: '2611', seq: 1 });
    expect(parseDocNumber('wb2611-0012')).toEqual({ type: 'ONLINE_ORDER', period: '2611', seq: 12 });
    for (const old of ['ORD-261100001', 'PO-261100001', 'WEB-261118-001', 'SHF-261100003', 'ORD-OFFLINE-abc', 'XX2611-0001']) {
      expect(parseDocNumber(old)).toBeNull();
    }
  });
});
