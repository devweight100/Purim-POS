// Run: node --experimental-strip-types --test scripts/test-doc-format.mts   (from frontend/)
// Checks the shared document helpers: Thai baht text and the document date format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { thaiBahtText, formatDocDate, formatDocDateTime } from '../src/lib/utils.ts';

const bahtCases: Array<[number | string | null, string]> = [
  [0, 'ศูนย์บาทถ้วน'],
  [null, 'ศูนย์บาทถ้วน'],
  [0.01, 'หนึ่งสตางค์'],
  [0.5, 'ห้าสิบสตางค์'],
  [0.21, 'ยี่สิบเอ็ดสตางค์'],
  [1, 'หนึ่งบาทถ้วน'],
  [1.01, 'หนึ่งบาทหนึ่งสตางค์'],
  [11, 'สิบเอ็ดบาทถ้วน'],
  [11.11, 'สิบเอ็ดบาทสิบเอ็ดสตางค์'],
  [21, 'ยี่สิบเอ็ดบาทถ้วน'],
  [101, 'หนึ่งร้อยเอ็ดบาทถ้วน'],
  [1001, 'หนึ่งพันเอ็ดบาทถ้วน'],
  [340.99, 'สามร้อยสี่สิบบาทเก้าสิบเก้าสตางค์'],
  [1234.5, 'หนึ่งพันสองร้อยสามสิบสี่บาทห้าสิบสตางค์'],
  [1_000_000, 'หนึ่งล้านบาทถ้วน'],
  [1_000_001, 'หนึ่งล้านเอ็ดบาทถ้วน'],
  [11_000_000, 'สิบเอ็ดล้านบาทถ้วน'],
  [21_000_000, 'ยี่สิบเอ็ดล้านบาทถ้วน'],
  [101_000_000, 'หนึ่งร้อยเอ็ดล้านบาทถ้วน'],
  [1_000_000_000_000, 'หนึ่งล้านล้านบาทถ้วน'],
  [-5, 'ลบห้าบาทถ้วน'],
  [-184.32, 'ลบหนึ่งร้อยแปดสิบสี่บาทสามสิบสองสตางค์'],
  ['1,250.50', 'หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์'],
];

test('thaiBahtText', () => {
  for (const [input, expected] of bahtCases) {
    assert.equal(thaiBahtText(input), expected, `thaiBahtText(${input})`);
  }
});

test('formatDocDate: 4-digit Buddhist year, Asia/Bangkok', () => {
  // 2026-11-06T18:30Z is already 7 Nov 01:30 in Bangkok
  assert.equal(formatDocDate('2026-11-06T18:30:00Z'), '07/11/2569');
  assert.equal(formatDocDateTime('2026-11-06T18:30:00Z'), '07/11/2569 01:30');
  assert.equal(formatDocDate('2026-01-02T03:04:05Z', { time: true, seconds: true }), '02/01/2569 10:04:05');
  assert.equal(formatDocDate(null), '-');
  assert.equal(formatDocDate('not a date'), '-');
});
