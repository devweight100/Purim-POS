import { describe, expect, it } from 'vitest';
import { bangkokDate, bangkokDayKey, bangkokDayStart, bangkokParts, bangkokStartOfDay } from '@shared/bangkok-date';

describe('bangkok-date', () => {
  it('bangkokDayKey uses the Bangkok calendar day', () => {
    expect(bangkokDayKey('2026-11-10T16:59:59Z')).toBe('2026-11-10');
    expect(bangkokDayKey('2026-11-10T17:00:00Z')).toBe('2026-11-11');
    expect(bangkokDayKey('nope')).toBe('');
  });

  it('bangkokStartOfDay is 00:00 Bangkok = 17:00 UTC the day before', () => {
    expect(new Date(bangkokStartOfDay('2026-11-11T05:00:00Z')).toISOString()).toBe('2026-11-10T17:00:00.000Z');
    expect(new Date(bangkokStartOfDay('2026-11-10T18:00:00Z')).toISOString()).toBe('2026-11-10T17:00:00.000Z');
    // exactly midnight stays on that day
    expect(bangkokStartOfDay('2026-11-10T17:00:00Z')).toBe(Date.parse('2026-11-10T17:00:00Z'));
  });

  it('bangkokDayStart parses YYYY-MM-DD keys', () => {
    expect(bangkokDayStart('2026-11-11')).toBe(Date.parse('2026-11-10T17:00:00Z'));
    expect(bangkokDayStart('11/11/2026')).toBeNaN();
    expect(bangkokDayStart('')).toBeNaN();
  });

  it('day key and day start round-trip', () => {
    const key = '2027-01-01';
    expect(bangkokDayKey(bangkokDayStart(key))).toBe(key);
  });

  it('bangkokParts gives the Bangkok year / month / day', () => {
    expect(bangkokParts('2026-12-31T17:30:00Z')).toEqual({ year: 2027, month: 0, day: 1 });
  });

  it('bangkokDate allows month overflow like Date.UTC', () => {
    expect(bangkokDate(2026, 12, 1)).toBe(bangkokDayStart('2027-01-01'));
    expect(bangkokDate(2026, 1)).toBe(bangkokDayStart('2026-02-01'));
  });
});
