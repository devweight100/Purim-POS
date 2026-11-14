import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mergeProductDelta, syncSince } from '@/lib/product-delta';

describe('mergeProductDelta', () => {
  const a = { id: 'a', v: 1 };
  const b = { id: 'b', v: 1 };
  const c = { id: 'c', v: 1 };

  it('replaces changed rows in place, appends new ones, drops deleted ones', () => {
    const out = mergeProductDelta([a, b, c], [{ id: 'b', v: 2 }, { id: 'd', v: 1 }], ['c']);
    expect(out).toEqual([a, { id: 'b', v: 2 }, { id: 'd', v: 1 }]);
    expect(out[0]).toBe(a); // untouched rows keep their identity
  });

  it('returns the same array when nothing changed (no re-render)', () => {
    const list = [a, b];
    expect(mergeProductDelta(list, [], [])).toBe(list);
  });

  it('a product both changed and deleted in one delta is removed; unknown deletes are ignored', () => {
    expect(mergeProductDelta([a, b], [{ id: 'b', v: 3 }, { id: 'x', v: 1 }], ['b', 'x', 'zz'])).toEqual([a]);
  });

  it('full load + deltas == the final list (order aside)', () => {
    let list = [a, b, c];
    list = mergeProductDelta(list, [{ id: 'a', v: 2 }], []);
    list = mergeProductDelta(list, [], ['b']);
    list = mergeProductDelta(list, [{ id: 'b', v: 9 }, { id: 'c', v: 5 }], []);
    expect([...list].sort((x, y) => x.id.localeCompare(y.id))).toEqual([{ id: 'a', v: 2 }, { id: 'b', v: 9 }, { id: 'c', v: 5 }]);
  });
});

describe('syncSince', () => {
  const st = { cursor: 'v1.x', cursorKey: 'tok', count: 5, fromOfflineCache: false };
  it('sends the cursor only for the same login, a non-empty list and server data', () => {
    expect(syncSince(st, 'tok')).toBe('v1.x');
    expect(syncSince(st, 'other')).toBeUndefined();
    expect(syncSince(st, null)).toBeUndefined();
    expect(syncSince({ ...st, count: 0 }, 'tok')).toBeUndefined();
    expect(syncSince({ ...st, fromOfflineCache: true }, 'tok')).toBeUndefined();
    expect(syncSince({ ...st, cursor: null }, 'tok')).toBeUndefined();
  });
});

// ─── product store: full load once, then deltas; offline cache follows ─────────────
const h = vi.hoisted(() => ({
  sync: vi.fn(),
  token: 'tok-1',
  cacheProducts: vi.fn(async () => undefined),
  applyDelta: vi.fn(async () => true),
  cached: [] as unknown[],
}));
vi.mock('@/lib/api', () => ({
  api: { products: { sync: (since?: string) => h.sync(since) } },
  apiFetch: vi.fn(async () => []),
  getAuthToken: () => h.token,
  isRetryableError: () => true,
}));
vi.mock('@/lib/offline-db', () => ({
  cacheProducts: h.cacheProducts,
  applyCachedProductDelta: h.applyDelta,
  getCachedProducts: async () => h.cached,
}));
vi.mock('@/lib/category-storage', () => ({ cacheServerCategories: () => [], readCachedCategories: () => [] }));
vi.mock('@/lib/store-settings-storage', () => ({ getLowStockThreshold: () => 5 }));

const row = (id: string, extra: Record<string, unknown> = {}) => ({
  id, name: `สินค้า ${id}`, sku: `SKU-${id}`, basePrice: '10', priceLevel1: '10', unit: 'ชิ้น', stock: 3, computedStock: 3,
  barcodes: [{ barcode: `885${id}`, label: null }], packagingUnits: [], wholesalePrices: [], supplierEntries: [], bundleItems: [],
  images: [{ id: `img-${id}`, isCover: true, url: `/api/product-images/img-${id}`, thumbUrl: `/api/product-images/img-${id}?size=thumb` }],
  ...extra,
});

describe('product store sync', () => {
  beforeEach(async () => {
    h.sync.mockReset();
    h.cacheProducts.mockClear();
    h.applyDelta.mockClear();
    h.token = 'tok-1';
    const { useProductStore } = await import('@/lib/store/product-store');
    useProductStore.setState({ products: [], syncCursor: null, syncCursorKey: null, syncThreshold: null, fromOfflineCache: false, isLoading: false });
  });

  it('loads everything once, then asks for changes since the cursor and merges them', async () => {
    const { useProductStore } = await import('@/lib/store/product-store');
    h.sync.mockResolvedValueOnce({ cursor: 'c1', full: true, products: [row('a'), row('b')], deleted: [] });
    await useProductStore.getState().fetchProducts({ offlineCache: true });
    expect(h.sync).toHaveBeenLastCalledWith(undefined);
    expect(h.cacheProducts).toHaveBeenCalledTimes(1);
    const first = useProductStore.getState().products;
    expect(first.map((p) => [p.id, p.stock])).toEqual([['a', 3], ['b', 3]]);
    // photos by URL: the POS card shows the small copy
    expect(first[0].imageUrl).toBe('/api/product-images/img-a?size=thumb');

    // nothing changed: same array (no re-render), cursor advanced
    h.sync.mockResolvedValueOnce({ cursor: 'c2', full: false, products: [], deleted: [] });
    await useProductStore.getState().fetchProducts({ offlineCache: true });
    expect(h.sync).toHaveBeenLastCalledWith('c1');
    expect(useProductStore.getState().products).toBe(first);
    expect(useProductStore.getState().syncCursor).toBe('c2');

    // a sale + a new product + a deleted one
    h.sync.mockResolvedValueOnce({ cursor: 'c3', full: false, products: [row('a', { stock: 1, computedStock: 1 }), row('n')], deleted: ['b'] });
    await useProductStore.getState().fetchProducts({ offlineCache: true });
    expect(h.sync).toHaveBeenLastCalledWith('c2');
    expect(h.applyDelta).toHaveBeenLastCalledWith([expect.objectContaining({ id: 'a' }), expect.objectContaining({ id: 'n' })], ['b']);
    expect(useProductStore.getState().products.map((p) => [p.id, p.stock])).toEqual([['a', 1], ['n', 3]]);
    expect(h.cacheProducts).toHaveBeenCalledTimes(1);
  });

  it('another login (cost fields differ) or a failed offline-cache write -> full load next time', async () => {
    const { useProductStore } = await import('@/lib/store/product-store');
    h.sync.mockResolvedValueOnce({ cursor: 'c1', full: true, products: [row('a')], deleted: [] });
    await useProductStore.getState().fetchProducts();
    h.token = 'tok-2';
    h.sync.mockResolvedValueOnce({ cursor: 'c2', full: true, products: [row('a', { costPrice: undefined })], deleted: [] });
    await useProductStore.getState().fetchProducts();
    expect(h.sync).toHaveBeenLastCalledWith(undefined);

    h.applyDelta.mockResolvedValueOnce(false);
    h.sync.mockResolvedValueOnce({ cursor: 'c3', full: false, products: [row('a', { stock: 2, computedStock: 2 })], deleted: [] });
    await useProductStore.getState().fetchProducts();
    expect(useProductStore.getState().products[0].stock).toBe(2);
    expect(useProductStore.getState().syncCursor).toBeNull();
    h.sync.mockResolvedValueOnce({ cursor: 'c4', full: true, products: [row('a', { stock: 2, computedStock: 2 })], deleted: [] });
    await useProductStore.getState().fetchProducts();
    expect(h.sync).toHaveBeenLastCalledWith(undefined);
  });

  it('server unreachable on the POS: offline cache, then a full load when back online', async () => {
    const { useProductStore } = await import('@/lib/store/product-store');
    h.sync.mockResolvedValueOnce({ cursor: 'c1', full: true, products: [row('a')], deleted: [] });
    await useProductStore.getState().fetchProducts({ offlineCache: true });
    h.cached = [{ ...row('a'), basePrice: 10, costPrice: 0, barcodes: ['885a'] }];
    h.sync.mockRejectedValueOnce(new Error('offline'));
    await useProductStore.getState().fetchProducts({ offlineCache: true });
    expect(useProductStore.getState().fromOfflineCache).toBe(true);
    h.sync.mockResolvedValueOnce({ cursor: 'c2', full: true, products: [row('a')], deleted: [] });
    await useProductStore.getState().fetchProducts({ offlineCache: true });
    expect(h.sync).toHaveBeenLastCalledWith(undefined);
    expect(useProductStore.getState().fromOfflineCache).toBe(false);
  });
});
