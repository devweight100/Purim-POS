import { create } from 'zustand';
import { apiFetch } from '../api';
import { Product, Category, ProductUnit } from '../types';
import { products as mockProducts, categories as mockCategories } from '../mock-data';
import sampleProducts from '../sample-products.json';
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
      // 1. Load Master Products Catalog (Try backend API first, fallback to localStorage / sampleProducts / mock-data)
      let rawCatalog: any[] = [];

      try {
        const fetchedProds = await apiFetch('/products');
        if (Array.isArray(fetchedProds) && fetchedProds.length > 0) {
          rawCatalog = fetchedProds;
        }
      } catch {}

      if (typeof window !== 'undefined') {
        try {
          const savedCustom = localStorage.getItem('custom_products');
          if (savedCustom) {
            const parsed = JSON.parse(savedCustom);
            if (Array.isArray(parsed) && parsed.length >= 100) {
              // If local storage has old 1000+ items catalog, sync to reduced sample catalog (844 items)
              if (parsed.length > 1000 && sampleProducts && sampleProducts.length < 1000) {
                rawCatalog = sampleProducts;
                localStorage.setItem('custom_products', JSON.stringify(rawCatalog));
              } else {
                rawCatalog = parsed;
              }
            }
          }
        } catch {}
      }

      if (rawCatalog.length === 0) {
        rawCatalog = sampleProducts && sampleProducts.length > 0 ? sampleProducts : mockProducts;
        if (typeof window !== 'undefined') {
          try {
            localStorage.setItem('custom_products', JSON.stringify(rawCatalog));
          } catch {}
        }
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

      // Guarantee PD68000054 has packaging units initialized with 3 levels: ชิ้น (1), แพ็ค (10), ลัง (120)
      if (typeof window !== 'undefined') {
        try {
          const rawExisting = localStorage.getItem('pkg_PD68000054');
          const parsedExisting = rawExisting ? JSON.parse(rawExisting) : null;
          if (!parsedExisting || (Array.isArray(parsedExisting) && parsedExisting.length < 3)) {
            const defaultPkgPD68000054 = [
              { name: 'ชิ้น', qtyPerPrev: '1', priceLevel1: '85', barcode: '8858599027821' },
              { name: 'แพ็ค', qtyPerPrev: '10', priceLevel1: '800', barcode: '8858599027822' },
              { name: 'ลัง', qtyPerPrev: '12', priceLevel1: '9000', barcode: '8858599027823' }
            ];
            localStorage.setItem('pkg_PD68000054', JSON.stringify(defaultPkgPD68000054));
          }
        } catch {}
      }

      // 4. Map Master Products with all Units, Barcodes, Images & Live Stock
      const formattedProducts: Product[] = rawCatalog.map((p: any) => {
        const pId = p.id || p.sku;
        
        const baseUnitName = p.unit || 'ชิ้น';
        const basePrice = Number(p.priceLevel1 || p.price || p.basePrice || 0);
        const baseBarcode = p.barcodes?.[0]?.barcode || p.sku;

        // Base unit (factor = 1) is ALWAYS first!
        const baseUnitItem: ProductUnit = {
          id: `u-${pId}-base`,
          unitName: baseUnitName,
          factor: 1,
          price: basePrice,
          barcode: baseBarcode,
        };

        let unitsList: ProductUnit[] = [baseUnitItem];

        // Check customPkg from localStorage or p.packagingUnits or p.units
        let customPkg: any[] | null = null;
        if (typeof window !== 'undefined') {
          try {
            const rawPkg = localStorage.getItem(`pkg_${pId}`);
            if (rawPkg) customPkg = JSON.parse(rawPkg);
          } catch {}
        }

        if (customPkg && customPkg.length > 0) {
          let cumFactor = 1;
          customPkg.forEach((pkg: any, idx: number) => {
            const qty = parseInt(pkg.qtyPerPrev) || 1;
            cumFactor *= qty;
            const uName = pkg.name || `หน่วย ${idx + 1}`;
            
            if (uName.toLowerCase() !== baseUnitName.toLowerCase()) {
              unitsList.push({
                id: `u-${pId}-${uName}`,
                unitName: uName,
                factor: cumFactor,
                price: parseFloat(pkg.priceLevel1) || (basePrice * cumFactor),
                barcode: pkg.barcode || baseBarcode,
              });
            } else {
              baseUnitItem.price = parseFloat(pkg.priceLevel1) || basePrice;
              if (pkg.barcode) baseUnitItem.barcode = pkg.barcode;
            }
          });
        } else if (Array.isArray(p.packagingUnits) && p.packagingUnits.length > 0) {
          let cumFactor = 1;
          p.packagingUnits.forEach((pkg: any, idx: number) => {
            if (pkg.name) {
              const mult = Number(pkg.multiplier || pkg.qtyPerPrev || 1);
              cumFactor *= mult;
              const uName = pkg.name;
              if (uName.toLowerCase() !== baseUnitName.toLowerCase()) {
                unitsList.push({
                  id: `u-${pId}-pkg-${idx}`,
                  unitName: uName,
                  factor: cumFactor,
                  price: Number(pkg.priceLevel1 || (basePrice * cumFactor)),
                  barcode: pkg.barcode || baseBarcode,
                });
              }
            }
          });
        } else if (Array.isArray(p.units) && p.units.length > 0) {
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

        // Cover image
        let coverImg: string | null = p.image || p.imageUrl || null;
        if (!coverImg && Array.isArray(p.images) && p.images.length > 0) {
          const foundCover = p.images.find((img: any) => img.isCover);
          coverImg = foundCover ? foundCover.dataUrl : p.images[0].dataUrl;
        }

        const liveStock = stockMap[pId] !== undefined 
          ? stockMap[pId] 
          : Number(p.stock !== undefined ? p.stock : (Math.floor(Math.random() * 96) + 5));

        const mainCost = p.cost !== undefined ? p.cost : (p.basePrice || 0);
        const mainPrice = p.price !== undefined ? p.price : (p.priceLevel1 || 0);
        const mainBarcode = unitsList[0]?.barcode || p.barcodes?.[0]?.barcode || p.sku;
        const mainBarcodes = Array.isArray(p.barcodes) && p.barcodes.length > 0 
          ? p.barcodes 
          : [{ barcode: mainBarcode }];

        return {
          id: pId,
          name: p.name || 'สินค้า',
          sku: p.sku || 'SKU',
          categoryId: p.categoryId || 'c6',
          stock: liveStock,
          hasVat: p.hasVat !== false,
          image: coverImg,
          imageUrl: coverImg,
          unit: p.unit || 'ชิ้น',
          cost: mainCost,
          basePrice: mainCost,
          price: mainPrice,
          priceLevel1: mainPrice,
          barcodes: mainBarcodes,
          units: unitsList,
          defaultSellingUnitId: p.defaultSellingUnitId || null,
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
