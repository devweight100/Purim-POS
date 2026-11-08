import { BadRequestException } from '@nestjs/common';
import { bangkokDayKey, bangkokStartOfDay, bangkokStartOfMonth, dateRangeFilter } from './bangkok-date';

describe('Bangkok calendar helpers (independent of server TZ)', () => {
  it('day key uses Bangkok time, not UTC', () => {
    expect(bangkokDayKey(new Date('2026-11-06T17:30:00Z'))).toBe('2026-11-07'); // 00:30 Bangkok
    expect(bangkokDayKey(new Date('2026-11-06T16:59:59.999Z'))).toBe('2026-11-06'); // 23:59 Bangkok
  });
  it('start of day / month are Bangkok midnight', () => {
    expect(bangkokStartOfDay(new Date('2026-11-07T23:50:00Z')).toISOString()).toBe('2026-11-07T17:00:00.000Z');
    expect(bangkokStartOfDay(new Date('2026-11-07T16:00:00Z')).toISOString()).toBe('2026-11-06T17:00:00.000Z');
    expect(bangkokStartOfMonth(new Date('2026-11-30T18:00:00Z')).toISOString()).toBe('2026-11-30T17:00:00.000Z'); // already Dec 1 in Bangkok
  });
  it('date-only from=to covers the whole Bangkok day, end exclusive', () => {
    const r = dateRangeFilter('2026-11-07', '2026-11-07')!;
    expect(r.gte!.toISOString()).toBe('2026-11-06T17:00:00.000Z');
    expect(r.lt!.toISOString()).toBe('2026-11-07T17:00:00.000Z');
    expect(r.lte).toBeUndefined();
  });
  it('full ISO timestamps are used as given (inclusive end)', () => {
    const r = dateRangeFilter('2026-11-06T17:00:00.000Z', '2026-11-07T16:59:59.999Z')!;
    expect(r.lte!.toISOString()).toBe('2026-11-07T16:59:59.999Z');
  });
  it('no params = no filter; bad input = 400', () => {
    expect(dateRangeFilter(undefined, undefined)).toBeUndefined();
    expect(() => dateRangeFilter('garbage')).toThrow(BadRequestException);
    expect(() => dateRangeFilter('2026-02-30')).toThrow(BadRequestException);
    expect(() => dateRangeFilter('2026-11-08', '2026-11-07')).toThrow(BadRequestException);
  });
});
