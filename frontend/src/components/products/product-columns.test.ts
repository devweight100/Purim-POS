import { describe, expect, it } from 'vitest';
import { productColumns } from './product-columns';
import { levelSubtitle } from '@/lib/use-level-names';

// table widths measured in the browser (page padding + card border): sidebar open / collapsed
const W = { w1093open: 795, w1093rail: 971, w1366open: 1068, w1366rail: 1244, w1920open: 1542, w1920rail: 1718 };

describe('productColumns (round 3: price levels as columns; round 4: narrow category column)', () => {
  it('shows ราคา 1-5 at 1920 and 1366, at least 1-3 at 1093 with the sidebar open, 1-5 with it collapsed', () => {
    for (const w of [W.w1920open, W.w1920rail, W.w1366open, W.w1366rail, W.w1093rail]) {
      expect(productColumns(w, { showCost: true, force45: false }).levels).toEqual([1, 2, 3, 4, 5]);
    }
    const narrow = productColumns(W.w1093open, { showCost: true, force45: false });
    expect(narrow.levels).toEqual([1, 2, 3]);
    expect(narrow.canForce).toBe(true);
  });

  it('never fewer than 3 levels, never more than 5', () => {
    expect(productColumns(500, { showCost: true, force45: false }).levels).toEqual([1, 2, 3]);
    expect(productColumns(4000, { showCost: true, force45: false }).levels).toHaveLength(5);
    expect(productColumns(0, { showCost: true, force45: false }).levels.length).toBeGreaterThanOrEqual(3);
  });

  it('"แสดงราคา 4–5" forces 5 narrow columns only when they do not fit by themselves', () => {
    const forced = productColumns(W.w1093open, { showCost: true, force45: true });
    expect(forced).toMatchObject({ levels: [1, 2, 3, 4, 5], tight: true, priceWidth: 68 });
    expect(productColumns(W.w1366open, { showCost: true, force45: true })).toMatchObject({ tight: false, canForce: false });
  });

  it('category is a narrow column from 1366x768 (both sidebar states), a chip on narrower tables; no cost column leaves room for more prices', () => {
    for (const w of [W.w1920open, W.w1366open, W.w1366rail]) expect(productColumns(w, { showCost: true, force45: false }).showCategory).toBe(true);
    expect(productColumns(W.w1366open, { showCost: true, force45: false }).categoryWidth).toBeLessThanOrEqual(104);
    expect(productColumns(W.w1093rail, { showCost: true, force45: false }).showCategory).toBe(false);
    expect(productColumns(W.w1093open, { showCost: true, force45: false }).showCategory).toBe(false);
    expect(productColumns(860, { showCost: false, force45: false }).levels.length)
      .toBeGreaterThanOrEqual(productColumns(860, { showCost: true, force45: false }).levels.length);
  });
});

describe('levelSubtitle', () => {
  it('drops the leading "ราคา" and repeats of the number', () => {
    expect(levelSubtitle('ราคาปลีก', 1)).toBe('ปลีก');
    expect(levelSubtitle('ราคาส่งพิเศษ', 3)).toBe('ส่งพิเศษ');
    expect(levelSubtitle('ราคาระดับ 4', 4)).toBe('');
    expect(levelSubtitle('ราคา 5', 5)).toBe('');
    expect(levelSubtitle('ช่าง', 2)).toBe('ช่าง');
    expect(levelSubtitle(undefined, 2)).toBe('');
  });
});
