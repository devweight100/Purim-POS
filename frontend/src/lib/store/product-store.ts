import { getLowStockThreshold } from '@/lib/store-settings-storage';
import { create } from 'zustand';
import { api, apiFetch } from '../api';
import { Product, Category, ProductUnit, ApiProduct, ApiCategory } from '../types';
import { errorText } from '../api-error';
import { cacheServerCategories, readCachedCategories } from '../category-storage';
import { addQty } from '../qty';

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

  fetchProducts: async (opts) => {
    if (get().isLoading) return;
    const offlineCache = opts?.offlineCache ?? onPosScreen();
    set({ isLoading: true, error: null });
    try {
      // 1. Load Master Products Catalog directly from Backend Database
      let rawCatalog: ApiProduct[] = [];
      const fetchedProds = await api.products.getAll(undefined, undefined, { offlineCache });
      const fromOfflineCache = Boolean(fetchedProds?.fromOfflineCache);
      if (Array.isArray(fetchedProds)) {
        rawCatalog = fetchedProds;
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

      if (rawCatalog.length === 0) {
        set({
          products: [],
          categories: loadedCategories,
          isLoading: false,
          fromOfflineCache,
        });
        return;
      }

      // 3. Format products from PostgreSQL
      const formattedProducts: Product[] = rawCatalog.map((p): Product => {
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
          image:
            productImages.find((image) => image.isCover)?.dataUrl ||
            productImages[0]?.dataUrl ||
            p.imageUrl ||
            p.image ||
            null,
          imageUrl:
            productImages.find((image) => image.isCover)?.dataUrl ||
            productImages[0]?.dataUrl ||
            p.imageUrl ||
            p.image ||
            null,
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
      });

      set({
        products: formattedProducts,
        categories: loadedCategories,
        isLoading: false,
        fromOfflineCache,
      });
    } catch (err) {
      // Back office: never keep showing a list the server did not just confirm
      if (offlineCache) set({ error: errorText(err) ?? null, isLoading: false });
      else set({ error: errorText(err) || 'ติดต่อเซิร์ฟเวอร์ไม่ได้', isLoading: false, products: [], fromOfflineCache: false });
    }
  },
}));
