import { create } from 'zustand';
import { apiFetch } from '../api';
import { Product, Category, ProductUnit } from '../types';

interface ProductStore {
  products: Product[];
  categories: Category[];
  isLoading: boolean;
  error: string | null;
  fetchProducts: () => Promise<void>;
}

export const useProductStore = create<ProductStore>((set) => ({
  products: [],
  categories: [],
  isLoading: false,
  error: null,
  
  fetchProducts: async () => {
    set({ isLoading: true, error: null });
    try {
      // 1. Load Master Products Catalog directly from Backend Database
      let rawCatalog: any[] = [];
      try {
        const fetchedProds = await apiFetch('/products');
        if (Array.isArray(fetchedProds)) {
          rawCatalog = fetchedProds;
        }
      } catch (e) {
        console.warn('[ProductStore] Failed to fetch products from backend:', e);
      }

      // 2. Load Categories directly from Backend Database
      let loadedCategories: any[] = [];
      try {
        const fetchedCats = await apiFetch('/categories');
        if (Array.isArray(fetchedCats)) {
          loadedCategories = fetchedCats;
        }
      } catch (e) {
        console.warn('[ProductStore] Failed to fetch categories from backend:', e);
      }

      // If database has 0 products, return empty list!
      if (rawCatalog.length === 0) {
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
        const baseUnitName = p.unit || 'ชิ้น';
        const baseBarcode = p.barcodes?.[0]?.barcode || p.barcode || p.sku;

        const baseUnitItem: ProductUnit = {
          id: `u-${pId}-base`,
          unitName: baseUnitName,
          factor: 1,
          price: basePrice,
          barcode: baseBarcode,
        };

        let unitsList: ProductUnit[] = [baseUnitItem];
        if (Array.isArray(p.units) && p.units.length > 0) {
          const extraUnits = p.units.filter((u: any) => (u.unitName || u.name || '').toLowerCase() !== baseUnitName.toLowerCase());
          const mappedExtra = extraUnits.map((u: any, idx: number) => ({
            id: u.id || `u-${pId}-${idx}`,
            unitName: u.unitName || u.name || 'หน่วย',
            factor: Number(u.factor || 1),
            price: Number(u.price || basePrice),
            barcode: u.barcode || baseBarcode,
          }));
          unitsList = [baseUnitItem, ...mappedExtra];
        }

        const liveStock = p.computedStock !== undefined 
          ? Number(p.computedStock) 
          : (p.stockBatches?.reduce((sum: number, b: any) => sum + (b.quantityRemaining || 0), 0) ?? Number(p.stock || 0));

        return {
          id: pId,
          name: p.name || 'สินค้า',
          sku: p.sku || 'SKU',
          categoryId: p.categoryId || '',
          category: p.category,
          stock: liveStock,
          hasVat: p.hasVat !== false,
          image: p.imageUrl || p.image || null,
          imageUrl: p.imageUrl || p.image || null,
          unit: baseUnitName,
          cost: baseCost,
          basePrice: baseCost,
          price: basePrice,
          priceLevel1: basePrice,
          barcodes: Array.isArray(p.barcodes) ? p.barcodes : [{ barcode: baseBarcode }],
          units: unitsList,
          minStockAlert: p.minStockAlert !== undefined && p.minStockAlert !== null ? Number(p.minStockAlert) : 10,
        } as any;
      });

      set({ 
        products: formattedProducts, 
        categories: loadedCategories,
        isLoading: false 
      });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  }
}));
