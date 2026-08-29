import { products, categories, customers, dashboardData, orders, storeSettings } from './mock-data';
import { useAuthStore } from './store/auth-store';

// We mock apiFetch so any existing code using it doesn't break,
// but it just simulates a fast resolved promise or specific endpoints if needed.
export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  console.log(`[MOCK API] Fetched ${endpoint}`, options);
  await new Promise((resolve) => setTimeout(resolve, 50));
  
  if (typeof window !== 'undefined') {
    // Return single PO if requested
    if (endpoint.startsWith('/purchase-orders/')) {
      const id = endpoint.replace('/purchase-orders/', '').split('/')[0];
      try {
        const raw = localStorage.getItem('custom_purchase_orders');
        if (raw) {
          const list = JSON.parse(raw);
          const found = list.find((p: any) => p.id === id || p.poNumber === id);
          if (found) return found;
        }
      } catch {}
      return null;
    }

    // Return PO list
    if (endpoint === '/purchase-orders' || endpoint.startsWith('/purchase-orders?')) {
      try {
        const raw = localStorage.getItem('custom_purchase_orders');
        if (raw) return JSON.parse(raw);
      } catch {}
      return [];
    }

    // Return single Supplier or Supplier list
    if (endpoint.startsWith('/suppliers/')) {
      const id = endpoint.replace('/suppliers/', '').split('/')[0];
      try {
        const raw = localStorage.getItem('custom_suppliers');
        if (raw) {
          const list = JSON.parse(raw);
          const found = list.find((s: any) => s.id === id);
          if (found) return found;
        }
      } catch {}
      return null;
    }

    if (endpoint === '/suppliers') {
      try {
        const raw = localStorage.getItem('custom_suppliers');
        if (raw) return JSON.parse(raw);
      } catch {}
      return [];
    }
  }

  if (endpoint.includes('/products')) return [];
  if (endpoint.includes('/categories')) return [];
  if (endpoint.includes('/orders')) return [];
  if (endpoint.includes('/suppliers')) return [];
  if (endpoint.includes('/purchase-orders')) return [];
  if (endpoint.includes('/inventory')) return [];

  return null;
}

// Mock API object to not break existing pages that use it directly
export const api = {
  getStoreSettings: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return storeSettings;
  },
  getCustomers: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return customers;
  },
  getDashboardData: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return dashboardData;
  },
  getOrders: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return orders;
  },
  getProducts: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return products;
  },
  getCategories: async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return categories;
  },
};
