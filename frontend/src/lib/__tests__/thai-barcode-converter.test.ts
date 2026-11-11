import { describe, expect, it } from 'vitest';
import { barcodeLookupCandidates, convertThaiToEnBarcode, hasThaiCharacters } from '@/lib/thai-barcode-converter';

describe('convertThaiToEnBarcode', () => {
  it.each(['RICE-JAS-5KG', 'ABC-123', '1.5L', '8850001111111', 'A/B', 'x(1)'])('leaves ASCII "%s" unchanged', (code) => {
    expect(convertThaiToEnBarcode(code)).toBe(code);
  });

  it('converts digits typed on the Thai Kedmanee layout', () => {
    // keys 1..0 unshifted on a Thai keyboard: ๅ / - ภ ถ ุ ึ ค ต จ
    expect(convertThaiToEnBarcode('ๅ/-ภถุึคตจ')).toBe('1234567890');
    expect(convertThaiToEnBarcode('คคถจจจๅๅๅๅๅๅๅ')).toBe('8850001111111');
  });

  it('converts letters and the hyphen of a SKU typed in Thai layout', () => {
    // "rice-jas" : r=พ i=ร c=แ e=ำ -=ข j=่ a=ฟ s=ห
    expect(convertThaiToEnBarcode('พรแำข่ฟห')).toBe('rice-jas');
    // shifted letters: R=ฑ I=ณ C=ฉ E=ฎ
    expect(convertThaiToEnBarcode('ฑณฉฎ')).toBe('RICE');
  });

  it('turns shifted number symbols back into digits when the result is a barcode', () => {
    // Thai shift row: ๑=@ ๒=# ... -> unshifted digits
    expect(convertThaiToEnBarcode('๑๒๓')).toBe('234');
  });

  it('empty input', () => {
    expect(convertThaiToEnBarcode('')).toBe('');
  });
});

describe('barcodeLookupCandidates', () => {
  it('raw text first, then the conversion', () => {
    expect(barcodeLookupCandidates('  ๅ/- ')).toEqual(['ๅ/-', '123']);
  });
  it('only the raw text when nothing changes', () => {
    expect(barcodeLookupCandidates('ABC-123')).toEqual(['ABC-123']);
    expect(barcodeLookupCandidates('   ')).toEqual([]);
  });
  it('hasThaiCharacters', () => {
    expect(hasThaiCharacters('abcก')).toBe(true);
    expect(hasThaiCharacters('abc-1/2')).toBe(false);
  });
});
