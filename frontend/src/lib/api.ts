import { useAuthStore } from './store/auth-store';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = useAuthStore.getState().token;
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    let errorMsg = 'API Error';
    try {
      const errorData = await response.json();
      errorMsg = errorData.message || response.statusText;
    } catch (e) {
      errorMsg = response.statusText;
    }
    throw new Error(errorMsg);
  }

  return response.json();
}

import { products, categories, customers, dashboardData, orders, storeSettings } from './mock-data';

// Temporary Mock API object to not break existing placeholder pages
export const api = {
  getStoreSettings: async () => storeSettings,
  getCustomers: async () => customers,
  getDashboardData: async () => dashboardData,
  getOrders: async () => orders,
  getProducts: async () => products,
  getCategories: async () => categories,
};
