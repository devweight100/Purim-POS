/**
 * The price-level rule shared by the POS cart, the checkout validation and the online shop
 * (docs/pos-price-level.md). Runs under backend jest and frontend vitest.
 */
import { baseCandidates, hasNoPrice, lineUnitCandidates, normalizeLevel, packCandidates, pickLevelPrice, productUnitPrices, shortLevelName } from '../src/price-level';

const product = { basePrice: 12, priceLevel1: 12, priceLevel2: 11, priceLevel3: 10, priceLevel4: null, priceLevel5: 0, unit: 'ชิ้น' };
const packs = [
  { id: 'pk', name: 'แพ็ค', qtyPerPrev: 6, priceLevel1: 66, priceLevel2: 60, priceLevel3: null },
  { id: 'cs', name: 'ลัง', qtyPerPrev: 4, priceLevel1: null, priceLevel2: null, priceLevel3: null },
];

describe('pickLevelPrice (owner rule: L, else 1, else first of 2..5, never 0)', () => {
  it('uses the requested level when it has a price', () => {
    expect(pickLevelPrice([12, 11, 10, 0, 0], 2)).toEqual({ price: 11, level: 2 });
    expect(pickLevelPrice([12, 11, 10, 0, 0], 3)).toEqual({ price: 10, level: 3 });
  });
  it('falls back to price 1 when the level has no price', () => {
    expect(pickLevelPrice([12, 0, 10, 0, 0], 2)).toEqual({ price: 12, level: 1 });
    expect(pickLevelPrice([12, 11, 10, 0, 0], 4)).toEqual({ price: 12, level: 1 });
  });
  it('no price 1: first non-zero of 2 -> 3 -> 4 -> 5', () => {
    expect(pickLevelPrice([0, 0, 9, 8, 0], 1)).toEqual({ price: 9, level: 3 });
    expect(pickLevelPrice([0, 0, 0, 0, 7], 2)).toEqual({ price: 7, level: 5 });
    expect(pickLevelPrice([0, 15, 9, 0, 0], 4)).toEqual({ price: 15, level: 2 });
  });
  it('every level 0 (or missing) = no price, never 0', () => {
    expect(pickLevelPrice([0, 0, 0, 0, 0], 1)).toBeNull();
    expect(pickLevelPrice([0, 0, 0, 0, 0], 3)).toBeNull();
    expect(pickLevelPrice(null, 1)).toBeNull();
    expect(hasNoPrice({ basePrice: 0, priceLevel1: '0', priceLevel2: null })).toBe(true);
    expect(hasNoPrice({ basePrice: 0 }, [{ qtyPerPrev: 6, priceLevel2: 50 }])).toBe(false);
    expect(hasNoPrice(product, packs)).toBe(false);
  });
  it('unknown level -> 1; Decimal strings', () => {
    expect(normalizeLevel('3')).toBe(3);
    expect(normalizeLevel(9)).toBe(1);
    expect(pickLevelPrice(baseCandidates({ basePrice: '0', priceLevel1: '12.50', priceLevel2: '11.25' }), 2)).toEqual({ price: 11.25, level: 2 });
    expect(baseCandidates({ basePrice: '9.5', priceLevel1: null })[0]).toBe(9.5);
  });
});

describe('packs: same rule per unit with the factor fallback', () => {
  it('own pack price per level, else base level x factor', () => {
    const units = productUnitPrices(product, packs);
    expect(units.map((u) => [u.id, u.factor])).toEqual([[null, 1], ['pk', 6], ['cs', 24]]);
    expect(units[1].candidates).toEqual([66, 60, 60, 0, 0]); // ราคา 3 = 10 x 6 = 60 (cap 66)
    expect(units[2].candidates).toEqual([288, 264, 240, 0, 0]); // no own prices: base x 24
    expect(pickLevelPrice(units[1].candidates, 2)).toEqual({ price: 60, level: 2 });
    expect(pickLevelPrice(units[2].candidates, 3)).toEqual({ price: 240, level: 3 });
    expect(pickLevelPrice(units[2].candidates, 4)).toEqual({ price: 288, level: 1 });
  });
  it('a derived pack price is never above the pack\'s own ราคา 1', () => {
    // base ราคา 2 = 11 x 6 = 66 > pack ราคา 1 = 60 -> 60
    expect(packCandidates(baseCandidates({ priceLevel1: 12, priceLevel2: 11 }), { qtyPerPrev: 6, priceLevel1: 60 }, 6)).toEqual([60, 60, 0, 0, 0]);
    // a typed pack level price is used as typed
    expect(packCandidates(baseCandidates({ priceLevel1: 12 }), { qtyPerPrev: 6, priceLevel1: 60, priceLevel2: 62 }, 6)[1]).toBe(62);
  });
  it('line unit lookup: by id, by name, by factor, else base x factor; broken chain stops', () => {
    expect(lineUnitCandidates(product, packs, { factor: 6, unitId: 'pk' })[1]).toBe(60);
    expect(lineUnitCandidates(product, packs, { factor: 6, unitId: 'pkg-x-แพ็ค', unitName: 'แพ็ค' })[1]).toBe(60);
    expect(lineUnitCandidates(product, packs, { factor: 24, unitId: 'u-1-ลัง' })[2]).toBe(240);
    expect(lineUnitCandidates(product, packs, { factor: 1 })).toEqual([12, 11, 10, 0, 0]);
    expect(lineUnitCandidates(product, [], { factor: 10 })).toEqual([120, 110, 100, 0, 0]);
    expect(productUnitPrices(product, [{ qtyPerPrev: 0 }, packs[0]])).toHaveLength(1);
  });
  it('short level names for the POS indicator', () => {
    expect(shortLevelName('ราคาส่ง', 2)).toBe('ส่ง');
    expect(shortLevelName('ราคาปลีก', 1)).toBe('ปลีก');
    expect(shortLevelName('', 4)).toBe('ระดับ 4');
  });
});
