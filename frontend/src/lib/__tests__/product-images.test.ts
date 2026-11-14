import { describe, expect, it } from 'vitest';
import { getProductImages, productToApiPayload } from '@/components/products/product-helpers';
import type { ProductRecord } from '@/components/products/types';

const base: ProductRecord = { id: 'p1', name: 'สินค้า', sku: 'SKU-1', priceLevel1: 10 } as ProductRecord;

describe('product photos in the form: saved photos by URL, new uploads as data', () => {
  const saved = { id: 'img-1', isCover: true, name: 'a.jpg', url: '/api/product-images/img-1', thumbUrl: '/api/product-images/img-1?size=thumb' };

  it('the edit form keeps list photos (URL only) and uploads (data)', () => {
    const items = getProductImages({ ...base, images: [saved, { id: 'tmp', dataUrl: 'data:image/jpeg;base64,AA', thumbDataUrl: 'data:image/jpeg;base64,BB', name: 'b.jpg' }, { name: 'nothing' }] });
    expect(items).toEqual([
      { id: 'img-1', url: saved.url, thumbUrl: saved.thumbUrl, name: 'a.jpg', isCover: true },
      { id: 'tmp', dataUrl: 'data:image/jpeg;base64,AA', thumbDataUrl: 'data:image/jpeg;base64,BB', name: 'b.jpg', isCover: false },
    ]);
  });

  it('saving sends saved photos by id (server keeps the data) and new ones as data + thumbnail', () => {
    const payload = productToApiPayload({ ...base, images: getProductImages({ ...base, images: [saved, { id: 'tmp', dataUrl: 'data:image/jpeg;base64,AA', thumbDataUrl: 'data:image/jpeg;base64,BB', name: 'b.jpg' }] }) });
    expect(payload.images).toEqual([
      { id: 'img-1', name: 'a.jpg', isCover: true },
      { dataUrl: 'data:image/jpeg;base64,AA', thumbDataUrl: 'data:image/jpeg;base64,BB', name: 'b.jpg', isCover: false },
    ]);
  });

  it('rows that still carry the data (single product, old offline cache) are sent as data like before', () => {
    const payload = productToApiPayload({ ...base, images: [{ id: 'img-9', dataUrl: 'data:image/png;base64,CC', name: 'c.png', isCover: true }] });
    expect(payload.images).toEqual([{ dataUrl: 'data:image/png;base64,CC', name: 'c.png', isCover: true }]);
  });
});
