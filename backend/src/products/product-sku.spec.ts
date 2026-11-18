import { ean13CheckDigit, generateProductSku, isInternalEan13, randomInternalEan13 } from './product-sku';

const fakeTx = (used: { skus?: string[]; barcodes?: string[]; packs?: string[] }) => ({
  product: { findUnique: async ({ where }: any) => ((used.skus || []).includes(where.sku) ? { id: 'p' } : null) },
  productBarcode: { findUnique: async ({ where }: any) => ((used.barcodes || []).includes(where.barcode) ? { id: 'b' } : null) },
  productPackagingUnit: { findFirst: async ({ where }: any) => ((used.packs || []).includes(where.barcode) ? { id: 'u' } : null) },
});

/** rand() that returns the digits of the given codes' 9-digit bodies, one code after another */
const scripted = (...bodies: string[]) => {
  const digits = bodies.join('').split('').map(Number);
  let i = 0;
  return () => digits[i++];
};

describe('product SKU (system ID)', () => {
  it('check digit matches known EAN-13 codes', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1); // 4006381333931
    expect(ean13CheckDigit('200689323792')).toBe(7); // the owner's screenshot: 2006893237927
    expect(isInternalEan13('2006893237927')).toBe(true);
    expect(isInternalEan13('2006893237928')).toBe(false);
    expect(isInternalEan13('4006381333931')).toBe(false);
  });

  it('random codes are internal EAN-13 (prefix 200, valid check digit)', () => {
    for (let i = 0; i < 200; i++) {
      const code = randomInternalEan13();
      expect(code).toMatch(/^200\d{10}$/);
      expect(isInternalEan13(code)).toBe(true);
    }
  });

  it('skips codes already used as SKU, barcode, pack barcode or reserved in the same request', async () => {
    const a = '200' + '111111111';
    const b = '200' + '222222222';
    const c = '200' + '333333333';
    const d = '200' + '444444444';
    const e = '200' + '555555555';
    const full = (x: string) => x + ean13CheckDigit(x);
    const taken = new Set([full(d)]);
    const sku = await generateProductSku(
      fakeTx({ skus: [full(a)], barcodes: [full(b)], packs: [full(c)] }),
      taken,
      scripted('111111111', '222222222', '333333333', '444444444', '555555555'),
    );
    expect(sku).toBe(full(e));
    expect(taken.has(full(e))).toBe(true);
  });
});
