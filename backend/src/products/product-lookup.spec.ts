import { packChain, priceLevels, rankCandidates, searchTokens, stockLevel } from './product-lookup';
import { previousPeriod } from '../reports/sales-math';

describe('mobile product lookup helpers', () => {
  it('splits the search text into words, dropping zero-width characters', () => {
    expect(searchTokens('  น้ำดื่ม​   ช้าง ')).toEqual(['น้ำดื่ม', 'ช้าง']);
    expect(searchTokens(undefined)).toEqual([]);
  });

  it('stock levels use the store threshold (low = above 0 up to the threshold)', () => {
    expect(stockLevel(0, 5)).toBe('out');
    expect(stockLevel(-2, 5)).toBe('out');
    expect(stockLevel(5, 5)).toBe('low');
    expect(stockLevel(5.01, 5)).toBe('ok');
  });

  it('ranks exact code hits first, then names starting with the text, then Thai name order', () => {
    const rows = [
      { id: '1', name: 'ขนม น้ำดื่ม', sku: 'A1', isBundle: false, barcodes: [] },
      { id: '2', name: 'น้ำดื่มตราช้าง', sku: 'DRK-001', isBundle: false, barcodes: ['885'] },
      { id: '3', name: 'กาแฟ', sku: 'น้ำดื่ม', isBundle: false, barcodes: [] },
    ];
    expect(rankCandidates(rows, 'น้ำดื่ม').map((r) => r.id)).toEqual(['3', '2', '1']);
    expect(rankCandidates(rows, '885').map((r) => r.id)[0]).toBe('2');
  });

  it('pack sizes multiply along the chain; base price level 1 falls back to basePrice', () => {
    const packs = packChain([
      { name: 'แพ็ค', qtyPerPrev: 6, barcode: 'p', priceLevel1: '39' },
      { name: 'ลัง', qtyPerPrev: 2, barcode: null, priceLevel1: 75, priceLevel2: '72.5' },
    ]);
    expect(packs.map((p) => [p.name, p.factor])).toEqual([['แพ็ค', 6], ['ลัง', 12]]);
    expect(packs[1].prices).toEqual([75, 72.5, null, null, null]);
    expect(priceLevels({ priceLevel1: null, priceLevel3: '9' }, '7')).toEqual([7, null, 9, null, null]);
  });
});

describe('previous period (dashboard compare=1)', () => {
  const at = (iso: string) => new Date(iso);
  it('today so far -> yesterday up to the same time', () => {
    const p = previousPeriod('today', at('2026-11-12T17:00:00Z'), at('2026-11-13T03:30:00Z'))!;
    expect(p.gte.toISOString()).toBe('2026-11-11T17:00:00.000Z');
    expect(p.lt.toISOString()).toBe('2026-11-12T03:30:00.000Z');
  });
  it('a whole custom day -> the day before', () => {
    const p = previousPeriod('custom', at('2026-11-11T17:00:00Z'), at('2026-11-12T17:00:00Z'))!;
    expect([p.gte.toISOString(), p.lt.toISOString()]).toEqual(['2026-11-10T17:00:00.000Z', '2026-11-11T17:00:00.000Z']);
  });
  it('this month so far -> the same days of last month, capped at its end', () => {
    // 1-13 Nov (Bangkok) -> 1-13 Oct
    const p = previousPeriod('month', at('2026-10-31T17:00:00Z'), at('2026-11-13T03:00:00Z'))!;
    expect(p.gte.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(p.lt.toISOString()).toBe('2026-10-13T03:00:00.000Z');
    // 1-31 Mar -> February only
    const q = previousPeriod('month', at('2027-02-28T17:00:00Z'), at('2027-03-31T10:00:00Z'))!;
    expect(q.lt.toISOString()).toBe('2027-02-28T17:00:00.000Z');
  });
  it('no previous period for "all"', () => {
    expect(previousPeriod('all', null, new Date())).toBeNull();
  });
});
