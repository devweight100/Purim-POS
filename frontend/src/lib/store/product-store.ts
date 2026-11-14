import { getLowStockThreshold } from '@/lib/store-settings-storage';
import { create } from 'zustand';
import { api, apiFetch, getAuthToken, isRetryableError } from '../api';
import { Product, Category, ProductUnit, ApiProduct, ApiCategory } from '../types';
import { errorText } from '../api-error';
import { cacheServerCategories, readCachedCategories } from '../category-storage';
import { addQty } from '../qty';
import { applyCachedProductDelta, cacheProducts, getCachedProducts, type CachedProduct } from '../offline-db';
import { mergeProductDelta, syncSince } from '../product-delta';

interface ProductStore {
  products: Product[];
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  /** true when the list came from the POS offline cache because the server was unreachable */
  fromOfflineCache: boolean;
  /**
   * Load products + categories from the server. `offlineCache` (default: on POS screens only)
   * allows falling back to the read-only offline cache so selling keeps working offline.
   */
  fetchProducts: (opts?: { offlineCache?: boolean }) => Promise<void>;
  /** delta-sync cursor of `products` (GET /products/sync) and the login it belongs to (cost fields differ per user) */
  syncCursor: string | null;
  syncCursorKey: string | null;
  /** store low-stock threshold the rows were mapped with (a change re-maps everything: full load) */
  syncThreshold: number | null;
}

function onPosScreen(): boolean {
  return typeof window !== 'undefined' && /^\/pos(-neo)?(\/|$)/.test(window.location.pathname);
}

export const useProductStore = create<ProductStore>((set, get) => ({
  products: [],
  categories: [],
  isLoading: false,
  error: null,
  fromOfflineCache: false,
  syncCursor: null,
  syncCursorKey: null,
  syncThreshold: null,

  fetchProducts: async (opts) => {
    if (get().isLoading) return;
    const offlineCache = opts?.offlineCache ?? onPosScreen();
    set({ isLoading: true, error: null });
    try {
      // 1. Product catalogue from the server: everything the first time, afterwards only what changed
      //    (GET /products/sync). The offline cache (IndexedDB) follows the same full load / delta.
      const key = getAuthToken();
      const threshold = getLowStockThreshold();
      const since = threshold !== get().syncThreshold ? undefined : syncSince(
        { cursor: get().syncCursor, cursorKey: get().syncCursorKey, count: get().products.length, fromOfflineCache: get().fromOfflineCache },
        key,
      );
      let sync: Awaited<ReturnType<typeof api.products.sync>> | null = null;
      let cached: CachedProduct[] | null = null;
      try {
        sync = await api.products.sync(since);
      } catch (err) {
        // POS only: fall back to the offline cache when the server cannot be reached
        if (!offlineCache || !isRetryableError(err)) throw err;
        cached = await getCachedProducts();
        if (!cached.length) throw err;
      }
      const fromOfflineCache = cached !== null;
      let rawCatalog: Array<ApiProduct | CachedProduct> = cached || [];
      if (sync && !sync.full) {
        // delta: only the changed rows are re-mapped; nothing changed = no state change at all
        const ok = await applyCachedProductDelta(sync.products, sync.deleted);
        const changed = sync.products.map(toStoreProduct);
        const merged = mergeProductDelta(get().products, changed, sync.deleted);
        let loadedCategories = get().categories;
        try {
          const fetchedCats = await apiFetch<ApiCategory[] | null>('/categories');
          if (Array.isArray(fetchedCats)) loadedCategories = cacheServerCategories(fetchedCats);
        } catch (e) {
          console.warn('[ProductStore] Failed to fetch categories from backend:', e);
        }
        set({
          ...(merged !== get().products ? { products: merged } : {}),
          ...(loadedCategories !== get().categories ? { categories: loadedCategories } : {}),
          isLoading: false,
          fromOfflineCache: false,
          // offline cache not updated: reload everything next time so it catches up
          syncCursor: ok ? sync.cursor : null,
          syncCursorKey: key,
          syncThreshold: threshold,
        });
        return;
      }
      if (sync) {
        rawCatalog = sync.products;
        void cacheProducts(sync.products);
      }

      // 2. Load Categories from the server (refreshes the read-only offline cache)
      let loadedCategories: Category[] = get().categories;
      try {
        const fetchedCats = await apiFetch<ApiCategory[] | null>('/categories');
        if (Array.isArray(fetchedCats)) {
          loadedCategories = cacheServerCategories(fetchedCats);
        }
      } catch (e) {
        console.warn('[ProductStore] Failed to fetch categories from backend:', e);
        if (offlineCache && !loadedCategories.length) loadedCategories = readCachedCategories();
      }

      const cursorState = { syncCursor: sync ? sync.cursor : null, syncCursorKey: sync ? key : null, syncThreshold: threshold };
      if (rawCatalog.length === 0) {
        set({
          products: [],
          categories: loadedCategories,
          isLoading: false,
          fromOfflineCache,
          ...cursorState,
        });
        return;
      }

      // 3. Format products from PostgreSQL
      const formattedProducts: Product[] = rawCatalog.map(toStoreProduct);

      set({
        products: formattedProducts,
        categories: loadedCategories,
        isLoading: false,
        fromOfflineCache,
        ...cursorState,
      });
    } catch (err) {
      // Back office: never keep showing a list the server did not just confirm
      if (offlineCache) set({ error: errorText(err) ?? null, isLoading: false });
      else set({ error: errorText(err) || 'ติดต่อเซิร์ฟเวอร์ไม่ได้', isLoading: false, products: [], fromOfflineCache: false, syncCursor: null, syncCursorKey: null });
    }
  },
}));

/** Cover photo of a product: its small copy (catalogue rows carry URLs), else old cached rows' base64 data. */
function coverImage(p: ApiProduct | CachedProduct): string | null {
  const images = Array.isArray(p.images) ? p.images : [];
  const cover = images.find((image) => image.isCover) || images[0];
  return cover?.thumbUrl || cover?.url || cover?.dataUrl || p.imageUrl || p.image || null;
}

/** A server (or offline-cached) product as the POS / back office use it. */
function toStoreProduct(p: ApiProduct | CachedProduct): Product {
  const pId = p.id || p.sku;
  const basePrice = Number(p.price || p.priceLevel1 || p.basePrice || 0);
  // Cost is only sent to users with VIEW_COST / ADMIN; without it, cost stays undefined
  // (not 0) so nothing mistakes it for a real zero cost or writes it back.
  const rawCost = p.costPrice ?? p.cost;
  const baseCost: number | undefined = rawCost !== undefined && rawCost !== null ? Number(rawCost) || 0 : undefined;
  const baseUnitName = p.unit ?? '';
  const firstBarcode = p.barcodes?.[0];
  const baseBarcode =
    (typeof firstBarcode === 'string' ? firstBarcode : firstBarcode?.barcode) ||
    p.barcode ||
    p.sku;
  const packagingUnits = Array.isArray(p.packagingUnits) ? p.packagingUnits : [];
  const productImages = Array.isArray(p.images) ? p.images : [];
  const wholesalePrices = Array.isArray(p.wholesalePrices) ? p.wholesalePrices : [];

  const supplierEntries = Array.isArray(p.supplierEntries)
    ? p.supplierEntries
    : Array.isArray(p.suppliers)
    ? p.suppliers.map((ps) => {
        const costNum =
          ps.unitCost !== null && ps.unitCost !== undefined && ps.unitCost !== ''
            ? Number(ps.unitCost)
            : baseCost;
        return {
          id: ps.id,
          supplierId: ps.supplierId,
          supplierName: ps.supplier?.name || ps.supplierName || '',
          supplierSku: ps.supplierSku || '',
          unitCost: costNum,
          lastCost: ps.lastCost !== undefined ? Number(ps.lastCost) : costNum,
          isPreferred: Boolean(ps.isPreferred),
          notes: ps.notes ?? ps.supplierSku ?? '',
        };
      })
    : [];

  const preferredSupplier =
    supplierEntries.find((s) => s.isPreferred) || supplierEntries[0] || null;

  const baseUnitItem: ProductUnit = {
    id: `u-${pId}-base`,
    unitName: baseUnitName,
    factor: 1,
    price: basePrice,
    barcode: baseBarcode,
  };

  let unitsList: ProductUnit[] = [baseUnitItem];
  if (packagingUnits.length > 0) {
    let cumulativeFactor = 1;
    const mappedPackaging = packagingUnits.map((u, idx: number) => {
      cumulativeFactor *= Number(u.qtyPerPrev || u.factor || 1);
      return {
        id: u.id || `u-${pId}-pkg-${idx}`,
        unitName: u.name || u.unitName || 'หน่วย',
        factor: cumulativeFactor,
        price: Number(u.priceLevel1 || u.price || basePrice),
        barcode: u.barcode || baseBarcode,
      };
    });
    unitsList = [baseUnitItem, ...mappedPackaging];
  } else if (Array.isArray(p.units) && p.units.length > 0) {
    const extraUnits = p.units.filter(
      (u) => (u.unitName || u.name || '').toLowerCase() !== baseUnitName.toLowerCase(),
    );
    const mappedExtra = extraUnits.map((u, idx: number) => ({
      id: u.id || `u-${pId}-${idx}`,
      unitName: u.unitName || u.name || 'หน่วย',
      factor: Number(u.factor || 1),
      price: Number(u.price || basePrice),
      barcode: u.barcode || baseBarcode,
    }));
    unitsList = [baseUnitItem, ...mappedExtra];
  }

  const liveStock =
    p.computedStock !== undefined
      ? Number(p.computedStock)
      : p.stockBatches
        ? addQty(...p.stockBatches.map((b) => b.quantityRemaining || 0))
        : Number(p.stock || 0);

  return {
    id: pId,
    name: p.name || 'สินค้า',
    sku: p.sku || 'SKU',
    categoryId: p.categoryId || '',
    category: p.category,
    stock: liveStock,
    hasVat: p.hasVat !== false,
    image: coverImage(p),
    imageUrl: coverImage(p),
    unit: baseUnitName,
    cost: baseCost,
    costPrice: baseCost,
    basePrice: basePrice,
    price: basePrice,
    priceLevel1: p.priceLevel1 != null ? Number(p.priceLevel1) : basePrice,
    priceLevel2: p.priceLevel2 != null ? Number(p.priceLevel2) : null,
    priceLevel3: p.priceLevel3 != null ? Number(p.priceLevel3) : null,
    priceLevel4: p.priceLevel4 != null ? Number(p.priceLevel4) : null,
    priceLevel5: p.priceLevel5 != null ? Number(p.priceLevel5) : null,
    // offline-cached rows (POS, server unreachable) keep their barcodes as plain strings
    barcodes: (Array.isArray(p.barcodes) ? p.barcodes : [{ barcode: baseBarcode }]) as Product['barcodes'],
    units: unitsList,
    packagingUnits,
    images: productImages,
    wholesalePrices,
    suppliers: Array.isArray(p.suppliers) ? p.suppliers : [],
    supplierEntries,
    supplierId: p.supplierId || preferredSupplier?.supplierId || null,
    isBundle: Boolean(p.isBundle),
    bundleItems: Array.isArray(p.bundleItems) ? p.bundleItems : [],
    minStockAlert:
      p.minStockAlert !== undefined && p.minStockAlert !== null
        ? Number(p.minStockAlert)
        : getLowStockThreshold(),
  };
}

