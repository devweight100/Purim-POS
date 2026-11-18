import { describe, expect, it } from 'vitest';
import { listDate, listDateTime, listTime } from '@shared/thai-date';

describe('list dates (round 4: short Thai date, no time in tables)', () => {
  it('"18 พ.ย. 69": day, short month, 2-digit Buddhist year', () => {
    expect(listDate('2026-11-18T07:05:00Z')).toBe('18 พ.ย. 69');
    expect(listDate(new Date('2027-01-05T03:00:00Z'))).toBe('5 ม.ค. 70');
    expect(listDate(Date.parse('2026-06-01T00:00:00Z'))).toBe('1 มิ.ย. 69');
  });

  it('uses the Bangkok calendar whatever the time zone (17:00 UTC is already the next day)', () => {
    expect(listDate('2026-11-18T16:59:00Z')).toBe('18 พ.ย. 69');
    expect(listDate('2026-11-18T17:00:00Z')).toBe('19 พ.ย. 69');
    expect(listDate('2026-12-31T17:30:00Z')).toBe('1 ม.ค. 70');
  });

  it('time only where asked: listDateTime / listTime (24 h, Bangkok)', () => {
    expect(listDateTime('2026-11-18T07:05:00Z')).toBe('18 พ.ย. 69 14:05');
    expect(listTime('2026-11-18T16:59:00Z')).toBe('23:59');
  });

  it('empty or invalid -> "-"', () => {
    for (const v of [null, undefined, '', 'nope']) {
      expect(listDate(v)).toBe('-');
      expect(listDateTime(v)).toBe('-');
    }
  });

  it('formatListDate in lib/utils is the same formatter', async () => {
    const { formatListDate, formatListDateTime } = await import('@/lib/utils');
    expect(formatListDate('2026-11-18T07:05:00Z')).toBe('18 พ.ย. 69');
    expect(formatListDateTime('2026-11-18T07:05:00Z')).toBe('18 พ.ย. 69 14:05');
  });
});
