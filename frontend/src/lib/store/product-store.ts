import { create } from 'zustand';
import { api, apiFetch } from '../api';
import { Product, Category, ProductUnit } from '../types';
import { mirrorCategoriesToStorage } from '../category-storage';

interface ProductStore {
  products: Product[];
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  fetchProducts: () => Promise<void>;
}

export const useProductStore = create<ProductStore>((set, get) => ({
  products: [],
  categories: [],
  isLoading: false,
  error: null,

  fetchProducts: async () => {
    if (get().isLoading) return;
    set({ isLoading: true, error: null });
    try {
      // 1. Load Master Products Catalog directly from Backend Database
      let rawCatalog: any[] = [];
      const fetchedProds = await api.products.getAll();
      if (Array.isArray(fetchedProds)) {
        rawCatalog = fetchedProds;
      }

      // 2. Load Categories directly from Backend Database and mirror to localStorage
      let loadedCategories: any[] = get().categories;
      try {
        const fetchedCats = await apiFetch('/categories');
        if (Array.isArray(fetchedCats)) {
          loadedCategories = mirrorCategoriesToStorage(fetchedCats);
        }
      } catch (e) {
        console.warn('[ProductStore] Failed to fetch categories from backend:', e);
      }

      // If database has 0 products, clear stale localStorage mirror and return empty list!
      if (rawCatalog.length === 0) {
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('custom_products', JSON.stringify([]));
          } catch {}
        }
        set({
          products: [],
          categories: loadedCategories,
          isLoading: false,
        });
        return;
      }

      // 3. Format products from PostgreSQL
      const formattedProducts: Product[] = rawCatalog.map((p: any) => {
        const pId = p.id || p.sku;
        const basePrice = Number(p.price || p.priceLevel1 || p.basePrice || 0);
        const baseCost = Number(p.cost || p.costPrice || 0);
        const baseUnitName = p.unit ?? '';
        const baseBarcode =
          (typeof p.barcodes?.[0] === 'string' ? p.barcodes[0] : p.barcodes?.[0]?.barcode) ||
          p.barcode ||
          p.sku;
        const packagingUnits = Array.isArray(p.packagingUnits) ? p.packagingUnits : [];
        const productImages = Array.isArray(p.images) ? p.images : [];
        const wholesalePrices = Array.isArray(p.wholesalePrices) ? p.wholesalePrices : [];

        const supplierEntries = Array.isArray(p.supplierEntries)
          ? p.supplierEntries
          : Array.isArray(p.suppliers)
          ? p.suppliers.map((ps: any) => {
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
          supplierEntries.find((s: any) => s.isPreferred) || supplierEntries[0] || null;

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
          const mappedPackaging = packagingUnits.map((u: any, idx: number) => {
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
            (u: any) => (u.unitName || u.name || '').toLowerCase() !== baseUnitName.toLowerCase(),
          );
          const mappedExtra = extraUnits.map((u: any, idx: number) => ({
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
            : p.stockBatches?.reduce(
                (sum: number, b: any) => sum + (b.quantityRemaining || 0),
                0,
              ) ?? Number(p.stock || 0);

        return {
          id: pId,
          name: p.name || 'สินค้า',
          sku: p.sku || 'SKU',
          categoryId: p.categoryId || '',
          category: p.category,
          stock: liveStock,
          hasVat: p.hasVat !== false,
          image:
            productImages.find((image: any) => image.isCover)?.dataUrl ||
            productImages[0]?.dataUrl ||
            p.imageUrl ||
            p.image ||
            null,
          imageUrl:
            productImages.find((image: any) => image.isCover)?.dataUrl ||
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
          barcodes: Array.isArray(p.barcodes) ? p.barcodes : [{ barcode: baseBarcode }],
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
              : 10,
        } as any;
      });

      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem('custom_products', JSON.stringify(formattedProducts));
        } catch {}
      }

      set({
        products: formattedProducts,
        categories: loadedCategories,
        isLoading: false,
      });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  },
}));
