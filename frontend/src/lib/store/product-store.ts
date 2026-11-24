import { baseCandidates, packCandidates, pickLevelPrice } from '@shared/price-level';
import { getLowStockThreshold } from '@/lib/store-settings-storage';
import { create } from 'zustand';
import { api, apiFetch, getAuthToken, isRetryableError } from '../api';
import { Product, Category, ProductUnit, ApiProduct, ApiCategory } from '../types';
import { errorText } from '../api-error';
import { cacheServerCategories, readCachedCategories } from '../category-storage';
import { addQty } from '../qty';
import { applyCachedProductDelta, cacheProducts, getCachedProducts, type CachedProduct } from '../offline-db';
import { mergeProductDelta, syncSince } from '../product-delta';
import { noteCatalogueSynced } from '../sync-status';

interface ProductStore {
  products: Product[];
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  /** true when the list came from the POS offline cache because the server was unreachable */
  fromOfflineCache: boolean;
  /**
   * Load products + categories from the server. `offlineCache` (default: on POS screens only)
   * allows falling back to the read-only offline cache so selling keeps working offline. `full`: ask for the whole
   * catalogue instead of a delta (POS F5 รีเฟรชข้อมูล).
   */
  fetchProducts: (opts?: { offlineCache?: boolean; full?: boolean }) => Promise<void>;
  /** delta-sync cursor of `products` (GET /products/sync) and the login it belongs to (cost fields differ per user) */
  syncCursor: string | null;
  syncCursorKey: string | null;
  /** store low-stock threshold the rows were mapped with (a change re-maps everything: full load) */
  syncThreshold: number | null;
  /** refresh only when the catalogue is in memory (after a save on a screen that does not keep it: nothing to do) */
  refreshIfLoaded: () => Promise<void>;
  /** forget the catalogue (back-office screen of a device that does not sell): frees the memory, next load is full */
  release: () => void;
}

function onPosScreen(): boolean {
  return typeof window !== 'undefined' && /^\/pos(\/|$)/.test(window.location.pathname);
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

  fetchProducts: (opts) => {
    // A refresh asked while a load runs (stock changed, a sale was just saved) is not dropped: it runs once more
    // right after, so the screen always ends with the server's latest stock.
    if (inflight) {
      // a full reload (F5) is never folded into a queued delta
      if (opts?.full) return inflight.catch(() => undefined).then(() => get().fetchProducts(opts));
      queued ||= inflight.then(() => {
        queued = null;
        return get().fetchProducts(opts);
      });
      return queued;
    }
    inflight = loadProducts(opts).finally(() => {
      inflight = null;
    });
    return inflight;
  },

  refreshIfLoaded: () => (get().products.length || inflight ? get().fetchProducts() : Promise.resolve()),

  release: () => {
    epoch++;
    queued = null;
    if (!get().products.length && get().syncCursor === null && !get().error) return;
    set({ products: [], isLoading: false, error: null, fromOfflineCache: false, syncCursor: null, syncCursorKey: null, syncThreshold: null });
  },
}));

/** bumped by release(): a load that was running when the catalogue was released does not put it back */
let epoch = 0;

let inflight: Promise<void> | null = null;
let queued: Promise<void> | null = null;

async function loadProducts(opts?: { offlineCache?: boolean; full?: boolean }): Promise<void> {
  const started = epoch;
  const set = (partial: Partial<ProductStore>) => {
    if (started === epoch) useProductStore.setState(partial);
  };
  const get = useProductStore.getState;
  {
    const offlineCache = opts?.offlineCache ?? onPosScreen();
    set({ isLoading: true, error: null });
    try {
      // 1. Product catalogue from the server: everything the first time, afterwards only what changed
      //    (GET /products/sync). The offline cache (IndexedDB) follows the same full load / delta.
      const key = getAuthToken();
      const threshold = getLowStockThreshold();
      const since = opts?.full || threshold !== get().syncThreshold ? undefined : syncSince(
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
      if (sync && started === epoch) noteCatalogueSynced();
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
  }
}

/** A product that may be sold / picked (not ปิดการใช้งาน). Rows without the flag (old offline cache) count as active. */
export function isSellable(p: { isActive?: boolean | null }): boolean {
  return p.isActive !== false;
}

const sellableCache = new WeakMap<readonly Product[], Product[]>();
/**
 * The products that may be sold / picked: the POS, the item pickers (PO, adjust stock, claims, supplier returns,
 * bundle items) leave disabled products out. The store keeps every product, so documents and history still find
 * a disabled product by id. Same input array = same output array (memo for React).
 */
export function sellableProducts<T extends Product>(products: readonly T[]): T[] {
  const hit = sellableCache.get(products);
  if (hit) return hit as T[];
  const out = products.every(isSellable) ? (products as T[]) : products.filter(isSellable);
  sellableCache.set(products, out);
  return out;
}

/** Cover photo of a product: its small copy (catalogue rows carry URLs), else old cached rows' base64 data. */
function coverImage(p: ApiProduct | CachedProduct): string | null {
  const images = Array.isArray(p.images) ? p.images : [];
  const cover = images.find((image) => image.isCover) || images[0];
  return cover?.thumbUrl || cover?.url || cover?.dataUrl || p.imageUrl || p.image || null;
}

/** A server (or offline-cached) product as the POS / back office use it. */
export function toStoreProduct(p: ApiProduct | CachedProduct): Product {
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
          supplierProductName: ps.supplierProductName || '',
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

  // no ราคา 1: the unit shows the first non-zero of ราคา 2..5 (shared rule; never a 0 when any level has a price)
  const baseCands = baseCandidates({ basePrice, priceLevel1: p.priceLevel1, priceLevel2: p.priceLevel2, priceLevel3: p.priceLevel3, priceLevel4: p.priceLevel4, priceLevel5: p.priceLevel5 });
  if (!(basePrice > 0)) baseUnitItem.price = pickLevelPrice(baseCands, 1)?.price ?? 0;
  let unitsList: ProductUnit[] = [baseUnitItem];
  if (packagingUnits.length > 0) {
    let cumulativeFactor = 1;
    // shown unit price = its ราคา 1 by the shared rule (pack without its own price = base x pack size, never 0
    // when any level has a price); the cart prices every line at the bill's level (docs/pos-price-level.md)
    const mappedPackaging = packagingUnits.map((u, idx: number) => {
      cumulativeFactor *= Number(u.qtyPerPrev || u.factor || 1);
      const own = u.priceLevel1 != null || u.priceLevel2 != null ? u : { priceLevel1: u.price };
      const unitPrice = pickLevelPrice(packCandidates(baseCands, own, cumulativeFactor), 1)?.price ?? 0;
      return {
        id: u.id || `u-${pId}-pkg-${idx}`,
        unitName: u.name || u.unitName || 'หน่วย',
        factor: cumulativeFactor,
        price: unitPrice,
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
    manufacturerName: p.manufacturerName || null,
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
    ...(p.unitCost !== undefined && p.unitCost !== null && 'unitCost' in p ? { stockUnitCost: Number(p.unitCost) } : {}),
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
    isActive: p.isActive !== false,
    minStockAlert:
      p.minStockAlert !== undefined && p.minStockAlert !== null
        ? Number(p.minStockAlert)
        : getLowStockThreshold(),
  };
}

