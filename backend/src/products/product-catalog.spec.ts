import { catalogStock, cleanThumb, cursorUsable, decodeCursor, decodeImageDataUrl, encodeCursor, productImageUrl, CURSOR_MAX_AGE_MS } from './product-catalog';

describe('POS catalogue helpers', () => {
  it('cursor round trip; malformed cursors are rejected', () => {
    const c = { epoch: '16384-24576', at: 1_763_000_000_000, snapshot: '742:745:742,744' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    expect(decodeCursor(encodeCursor({ ...c, snapshot: '10:10:' }))?.snapshot).toBe('10:10:');
    for (const bad of [undefined, '', 'v1', 'v2.1-2.3.YQ', 'v1.1-2.3.' + Buffer.from("1:2:'; drop").toString('base64url'), 'v1.1-2.3.' + Buffer.from('5:2:').toString('base64url'), 123]) {
      expect(decodeCursor(bad)).toBeNull();
    }
  });

  it('a cursor is usable only for the same database and while it is younger than 7 days', () => {
    const now = 1_763_000_000_000;
    const c = { epoch: '1-2', at: now - 1000, snapshot: '1:1:' };
    expect(cursorUsable(c, '1-2', now)).toBe(true);
    expect(cursorUsable(c, '1-3', now)).toBe(false);
    expect(cursorUsable({ ...c, at: now - CURSOR_MAX_AGE_MS - 1 }, '1-2', now)).toBe(false);
    expect(cursorUsable({ ...c, at: now + 3600_000 }, '1-2', now)).toBe(false);
    expect(cursorUsable(null, '1-2', now)).toBe(false);
  });

  it('stock: own batches, or complete sets of a bundle (same as the full product mapping)', () => {
    const stockOf = new Map([['a', 9], ['b', 2.5], ['bun', 99]]);
    expect(catalogStock({ id: 'a', isBundle: false, bundleItems: [] }, stockOf)).toBe(9);
    expect(catalogStock({ id: 'zz', isBundle: false, bundleItems: [] }, stockOf)).toBe(0);
    expect(catalogStock({ id: 'bun', isBundle: true, bundleItems: [] }, stockOf)).toBe(99);
    expect(catalogStock({ id: 'bun', isBundle: true, bundleItems: [{ childProductId: 'a', quantity: '2' }, { childProductId: 'b', quantity: 0.5 }] }, stockOf)).toBe(4);
    expect(catalogStock({ id: 'bun', isBundle: true, bundleItems: [{ childProductId: 'b', quantity: '0.5' }] }, stockOf)).toBe(5);
  });

  it('photos: only image data URLs decode; thumbnails must be small images', () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const d = decodeImageDataUrl(`data:image/png;base64,${png}`);
    expect(d?.contentType).toBe('image/png');
    expect(d?.body.equals(Buffer.from(png, 'base64'))).toBe(true);
    expect(decodeImageDataUrl('data:image/jpg;base64,AAAA')?.contentType).toBe('image/jpeg');
    expect(decodeImageDataUrl('data:text/html;base64,PGgxPg==')).toBeNull();
    expect(decodeImageDataUrl('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(decodeImageDataUrl('https://example.com/a.png')).toBeNull();
    expect(decodeImageDataUrl(null)).toBeNull();
    expect(cleanThumb(`data:image/png;base64,${png}`)).toBe(`data:image/png;base64,${png}`);
    expect(cleanThumb('data:image/png;base64,' + 'A'.repeat(400_000))).toBeNull();
    expect(cleanThumb('not an image')).toBeNull();
    expect(productImageUrl('abc')).toBe('/api/product-images/abc');
    expect(productImageUrl('abc', 'thumb')).toBe('/api/product-images/abc?size=thumb');
  });
});
