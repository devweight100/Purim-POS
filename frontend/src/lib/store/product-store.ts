import { create } from 'zustand';
import { apiFetch } from '../api';
import { Product, Category, ProductUnit } from '../types';
import { products as mockProducts, categories as mockCategories } from '../mock-data';
import { loadCategories } from '../category-storage';

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
      // 1. Load Master Products Catalog (from custom_products localStorage / mock-data / backend)
      let rawCatalog: any[] = [];

      if (typeof window !== 'undefined') {
        try {
          const savedCustom = localStorage.getItem('custom_products');
          if (savedCustom) {
            const parsed = JSON.parse(savedCustom);
            if (Array.isArray(parsed) && parsed.length > 0) {
              rawCatalog = parsed;
            }
          }
        } catch {}
      }

      if (rawCatalog.length === 0) {
        try {
          const fetchedProds = await apiFetch('/products');
          if (Array.isArray(fetchedProds) && fetchedProds.length > 0) {
            rawCatalog = fetchedProds;
          }
        } catch {}
      }

      if (rawCatalog.length === 0) {
        rawCatalog = mockProducts;
      }

      // 2. Load Categories
      let loadedCategories: any[] = loadCategories();
      if (!loadedCategories || loadedCategories.length === 0) {
        try {
          loadedCategories = await apiFetch('/categories');
        } catch {
          loadedCategories = mockCategories;
        }
      }

      // 3. Load Stock Inventory Levels if available
      let stockMap: Record<string, number> = {};
      try {
        const stockData = await apiFetch('/inventory/stock');
        if (Array.isArray(stockData)) {
          stockData.forEach((s: any) => {
            if (s.id) stockMap[s.id] = Number(s.computedStock || s.stock || 0);
            if (s.sku) stockMap[s.sku] = Number(s.computedStock || s.stock || 0);
          });
        }
      } catch {}

      // 4. Map Master Products with all Units, Barcodes, Images & Live Stock
      const formattedProducts: Product[] = rawCatalog.map((p: any) => {
        const pId = p.id || p.sku;
        
        // Build units array from packagingUnits or existing units or base price
        let unitsList: ProductUnit[] = [];
        if (Array.isArray(p.units) && p.units.length > 0) {
          unitsList = p.units.map((u: any, idx: number) => ({
            id: u.id || `u-${pId}-${idx}`,
            unitName: u.unitName || 'ชิ้น',
            factor: Number(u.factor || 1),
            price: Number(u.price || p.priceLevel1 || p.basePrice || p.price || 0),
            barcode: u.barcode || p.barcodes?.[0]?.barcode || p.sku
          }));
        } else if (Array.isArray(p.packagingUnits) && p.packagingUnits.length > 0) {
          // Add base unit first
          unitsList.push({
            id: `u-${pId}-base`,
            unitName: p.unit || 'ชิ้น',
            factor: 1,
            price: Number(p.priceLevel1 || p.basePrice || p.price || 0),
            barcode: p.barcodes?.[0]?.barcode || p.sku
          });

          // Add extra packaging units
          p.packagingUnits.forEach((pkg: any, idx: number) => {
            if (pkg.name) {
              unitsList.push({
                id: `u-${pId}-pkg-${idx}`,
                unitName: pkg.name,
                factor: Number(pkg.multiplier || 1),
                price: Number(pkg.priceLevel1 || (Number(p.priceLevel1 || p.basePrice || 0) * Number(pkg.multiplier || 1))),
                barcode: pkg.barcode || p.barcodes?.[0]?.barcode || p.sku
              });
            }
          });
        } else {
          unitsList = [{
            id: `u-${pId}`,
            unitName: p.unit || 'ชิ้น',
            factor: 1,
            price: Number(p.priceLevel1 || p.basePrice || p.price || 0),
            barcode: p.barcodes?.[0]?.barcode || p.sku
          }];
        }

        // Cover image
        let coverImg: string | null = p.image || p.imageUrl || null;
        if (!coverImg && Array.isArray(p.images) && p.images.length > 0) {
          const foundCover = p.images.find((img: any) => img.isCover);
          coverImg = foundCover ? foundCover.dataUrl : p.images[0].dataUrl;
        }

        const liveStock = stockMap[pId] !== undefined ? stockMap[pId] : Number(p.stock || 0);

        return {
          id: pId,
          name: p.name || 'สินค้า',
          sku: p.sku || 'SKU',
          categoryId: p.categoryId || 'c1',
          stock: liveStock,
          hasVat: p.hasVat !== false,
          image: coverImg,
          imageUrl: coverImg,
          units: unitsList
        };
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
