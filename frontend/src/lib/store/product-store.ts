import { create } from 'zustand';
import { apiFetch } from '../api';
import { Product, Category } from '../types';

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
      const [productsData, categoriesData] = await Promise.all([
        apiFetch('/inventory/stock'),
        apiFetch('/categories')
      ]);
      
      const formattedProducts: Product[] = productsData.map((p: any) => ({
        id: p.id,
        name: p.name,
        sku: p.sku,
        categoryId: p.categoryId,
        stock: p.computedStock, // Use computed stock from backend FIFO
        hasVat: p.hasVat !== false, // Assuming true by default if not specified
        image: p.imageUrl || null,
        units: [
          // For now, map base price as the primary unit
          // In Phase 4 we will expand real multi-unit mapping from backend
          { id: 'u-' + p.id, unitName: 'ชิ้น', factor: 1, price: parseFloat(p.basePrice), barcode: p.sku }
        ]
      }));

      set({ 
        products: formattedProducts, 
        categories: categoriesData,
        isLoading: false 
      });
    } catch (err: any) {
      set({ error: err.message, isLoading: false });
    }
  }
}));
