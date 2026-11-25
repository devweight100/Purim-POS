import { describe, expect, it } from 'vitest';
import {
  LEGACY_SCAN_MAX_KEY_GAP_MS,
  SCAN_MAX_KEY_GAP_MS,
  SCAN_MIN_LENGTH,
  SCAN_TERMINATOR_MAX_GAP_MS,
  ScanBurstDetector,
  type BurstStep,
} from '../pos/scan-burst';

/** Feed "keys" typed `gap` ms apart (then the terminator `endGap` ms later); returns every step. */
function type(d: ScanBurstDetector, text: string, gap: number, opts: { start?: number; end?: string; endGap?: number } = {}) {
  let t = opts.start ?? 1000;
  const steps: BurstStep[] = [];
  [...text].forEach((ch, i) => {
    if (i > 0) t += gap;
    steps.push(d.step({ key: ch, time: t }));
  });
  if (opts.end !== undefined) steps.push(d.step({ key: opts.end, time: t + (opts.endGap ?? gap) }));
  return steps;
}
const last = (s: BurstStep[]) => s[s.length - 1];

describe('scanner burst detector (POS global scan)', () => {
  it('thresholds are the documented constants', () => {
    expect(SCAN_MAX_KEY_GAP_MS).toBe(35);
    expect(SCAN_MIN_LENGTH).toBe(4);
    expect(SCAN_TERMINATOR_MAX_GAP_MS).toBeGreaterThanOrEqual(SCAN_MAX_KEY_GAP_MS);
    expect(LEGACY_SCAN_MAX_KEY_GAP_MS).toBe(200);
  });

  it('a scanner (5-20 ms per key) ending with Enter is a strict burst with the whole code', () => {
    const d = new ScanBurstDetector();
    expect(last(type(d, '8851234567890', 8, { end: 'Enter' }))).toEqual({ kind: 'end', code: '8851234567890', strict: true });
    expect(last(type(d, 'ABC-123', 20, { end: 'Tab', start: 5000 }))).toEqual({ kind: 'end', code: 'ABC-123', strict: true });
  });

  it('exactly at the limits still counts; one ms over does not', () => {
    const d = new ScanBurstDetector();
    expect(last(type(d, '1234', SCAN_MAX_KEY_GAP_MS, { end: 'Enter', endGap: SCAN_TERMINATOR_MAX_GAP_MS }))).toMatchObject({ strict: true, code: '1234' });
    expect(last(type(d, '1234', SCAN_MAX_KEY_GAP_MS + 1, { end: 'Enter', start: 9000 }))).toMatchObject({ strict: false });
    expect(last(type(d, '1234', 10, { end: 'Enter', endGap: SCAN_TERMINATOR_MAX_GAP_MS + 1, start: 20000 }))).toMatchObject({ strict: false });
  });

  it('fewer than SCAN_MIN_LENGTH fast characters is not a strict burst', () => {
    const d = new ScanBurstDetector();
    expect(last(type(d, '123', 5, { end: 'Enter' }))).toEqual({ kind: 'end', code: '123', strict: false });
  });

  it('human typing (~120 ms per key) is never strict; very slow typing is nothing at all', () => {
    const d = new ScanBurstDetector();
    expect(last(type(d, '12345678', 120, { end: 'Enter' }))).toEqual({ kind: 'end', code: '12345678', strict: false });
    expect(last(type(d, '1234', 400, { end: 'Enter', start: 9000 }))).toEqual({ kind: 'none' });
  });

  it('the first character of a run asks for a snapshot; the following fast ones do not', () => {
    const d = new ScanBurstDetector();
    const steps = type(d, 'ab', 300).concat(type(d, '5555', 6, { start: 2000 }));
    expect(steps.map((s) => (s.kind === 'char' ? s.runStart : null))).toEqual([true, true, true, false, false, false]);
  });

  it('text typed by a person before the scan is not part of the code', () => {
    const d = new ScanBurstDetector();
    type(d, 'ปูน', 150);
    expect(last(type(d, '8850001', 5, { start: 3000, end: 'Enter' }))).toEqual({ kind: 'end', code: '8850001', strict: true });
  });

  it('Shift (capital letters) does not break a burst; Ctrl / Backspace / IME reset it', () => {
    const d = new ScanBurstDetector();
    let t = 0;
    const k = (key: string, extra: object = {}) => d.step({ key, time: (t += 5), ...extra });
    ['Shift', 'A', 'Shift', 'B', '1', '2'].forEach((x) => k(x));
    expect(k('Enter')).toEqual({ kind: 'end', code: 'AB12', strict: true });
    ['1', '2', '3'].forEach((x) => k(x));
    k('c', { ctrlKey: true });
    expect(k('Enter')).toEqual({ kind: 'none' });
    ['1', '2', '3', '4'].forEach((x) => k(x));
    k('Backspace');
    expect(k('Enter')).toEqual({ kind: 'none' });
    ['1', '2', '3', '4'].forEach((x) => k(x));
    k('Process', { isComposing: true });
    expect(k('Enter')).toEqual({ kind: 'none' });
  });

  it('Thai-layout scanner keys are passed on raw (converted later by the scan processor)', () => {
    const d = new ScanBurstDetector();
    expect(last(type(d, 'ๅ/-ภ', 4, { end: 'Enter' }))).toEqual({ kind: 'end', code: 'ๅ/-ภ', strict: true });
  });

  it('Enter alone, or a second Enter right after a burst, is nothing', () => {
    const d = new ScanBurstDetector();
    expect(d.step({ key: 'Enter', time: 1 })).toEqual({ kind: 'none' });
    type(d, '99999', 5, { end: 'Enter', start: 100 });
    expect(d.step({ key: 'Enter', time: 130 })).toEqual({ kind: 'none' });
  });
});
