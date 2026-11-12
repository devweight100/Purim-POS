import { describe, expect, it } from 'vitest';
import { formatDocDate, formatDocDateTime, thaiBahtText } from '@/lib/utils';

describe('thaiBahtText', () => {
  it.each([
    [0, 'ศูนย์บาทถ้วน'],
    [1, 'หนึ่งบาทถ้วน'],
    [10, 'สิบบาทถ้วน'],
    [11, 'สิบเอ็ดบาทถ้วน'],
    [21, 'ยี่สิบเอ็ดบาทถ้วน'],
    [101, 'หนึ่งร้อยเอ็ดบาทถ้วน'],
    [1250.5, 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์'],
    [100000, 'หนึ่งแสนบาทถ้วน'],
    [1000000, 'หนึ่งล้านบาทถ้วน'],
    [1000001, 'หนึ่งล้านเอ็ดบาทถ้วน'],
    [11000000, 'สิบเอ็ดล้านบาทถ้วน'],
    [21000021, 'ยี่สิบเอ็ดล้านยี่สิบเอ็ดบาทถ้วน'],
    [0.25, 'ยี่สิบห้าสตางค์'],
    [0.01, 'หนึ่งสตางค์'],
    [0.21, 'ยี่สิบเอ็ดสตางค์'],
    [-5, 'ลบห้าบาทถ้วน'],
  ])('%s -> %s', (n, words) => {
    expect(thaiBahtText(n)).toBe(words);
  });

  it('accepts strings with thousands separators', () => {
    expect(thaiBahtText('1,234.75')).toBe('หนึ่งพันสองร้อยสามสิบสี่บาทเจ็ดสิบห้าสตางค์');
  });

  it('rounds to the satang (floating point)', () => {
    expect(thaiBahtText(0.1 + 0.2)).toBe('สามสิบสตางค์');
    expect(thaiBahtText(19.999)).toBe('ยี่สิบบาทถ้วน');
  });

  it('empty / invalid values read as zero', () => {
    expect(thaiBahtText(null)).toBe('ศูนย์บาทถ้วน');
    expect(thaiBahtText(undefined)).toBe('ศูนย์บาทถ้วน');
    expect(thaiBahtText('')).toBe('ศูนย์บาทถ้วน');
    expect(thaiBahtText('abc')).toBe('ศูนย์บาทถ้วน');
  });
});

describe('formatDocDate', () => {
  it('uses Bangkok time and the Buddhist year, whatever the machine time zone', () => {
    // 2026-11-07 07:05 UTC = 14:05 in Bangkok
    expect(formatDocDate('2026-11-07T07:05:09Z')).toBe('07/11/2569');
    expect(formatDocDate('2026-11-07T07:05:09Z', { time: true })).toBe('07/11/2569 14:05');
    expect(formatDocDate('2026-11-07T07:05:09Z', { time: true, seconds: true })).toBe('07/11/2569 14:05:09');
    expect(formatDocDateTime('2026-11-07T07:05:09Z')).toBe('07/11/2569 14:05');
  });

  it('crosses midnight / year end in Bangkok, not UTC', () => {
    // 2026-12-31 17:30 UTC = 2027-01-01 00:30 Bangkok
    expect(formatDocDate('2026-12-31T17:30:00Z', { time: true })).toBe('01/01/2570 00:30');
    expect(formatDocDate('2026-12-31T16:59:00Z', { time: true })).toBe('31/12/2569 23:59');
  });

  it('accepts Date and epoch numbers', () => {
    const t = Date.UTC(2026, 0, 2, 3, 4);
    expect(formatDocDate(t, { time: true })).toBe('02/01/2569 10:04');
    expect(formatDocDate(new Date(t))).toBe('02/01/2569');
  });

  it('returns "-" for empty or invalid input', () => {
    expect(formatDocDate(null)).toBe('-');
    expect(formatDocDate('')).toBe('-');
    expect(formatDocDate('not a date')).toBe('-');
  });
});
