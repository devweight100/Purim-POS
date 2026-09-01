// ==============================================================================
// Purim POS - Unified Real API Client with Offline-First Resilience
// ==============================================================================

import {
  cacheProducts,
  getCachedProducts,
  findCachedProductByBarcode,
  enqueueOfflineOrder,
  syncOfflineOrdersNow,
  OfflineOrder,
} from './offline-db';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api';

function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('auth-storage');
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed.state?.token || null;
    }
  } catch {}
  return null;
}

export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint.startsWith('/') ? endpoint : `/${endpoint}`}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const token = getAuthToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  try {
    const res = await fetch(url, {
      ...options,
      headers,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => null);
      throw new Error(errBody?.message || `HTTP ${res.status}: ${res.statusText}`);
    }

    return await res.json();
  } catch (err: any) {
    // Offline Fallbacks
    if (typeof window !== 'undefined' && !navigator.onLine) {
      if (endpoint.includes('/products')) {
        console.warn('[API] Offline detected, serving products from IndexedDB cache');
        return await getCachedProducts();
      }
    }
    throw err;
  }
}

// ──────────────────────────────────────────────
// UNIFIED API METHODS FOR ALL MODULES
// ──────────────────────────────────────────────

export const api = {
  // 1. Auth & Users (Admin Panel ready)
  auth: {
    login: (loginDto: any) => apiFetch('/auth/login', { method: 'POST', body: JSON.stringify(loginDto) }),
    loginWithPin: (pin: string) => apiFetch('/auth/login-pin', { method: 'POST', body: JSON.stringify({ pin }) }),
    getProfile: () => apiFetch('/auth/me'),
    getUsers: () => apiFetch('/auth/users'),
    updateUser: (id: string, data: any) => apiFetch(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    toggleUserActive: (id: string) => apiFetch(`/auth/users/${id}/toggle-active`, { method: 'PATCH' }),
  },

  // 2. Shifts
  shifts: {
    getCurrent: () => apiFetch('/shifts/current'),
    open: (startingCash: number, note?: string) =>
      apiFetch('/shifts/open', { method: 'POST', body: JSON.stringify({ startingCash, note }) }),
    close: (shiftId: string, actualCash: number, note?: string) =>
      apiFetch(`/shifts/${shiftId}/close`, { method: 'POST', body: JSON.stringify({ actualCash, note }) }),
    getSummary: (shiftId: string) => apiFetch(`/shifts/${shiftId}/summary`),
    getHistory: (page = 1, limit = 20, search?: string) => {
      const q = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) q.append('search', search);
      return apiFetch(`/shifts/history?${q.toString()}`);
    },
  },

  // 3. Products & Categories (With automatic offline caching)
  products: {
    getAll: async (search?: string, categoryId?: string) => {
      try {
        const q = new URLSearchParams();
        if (search) q.append('search', search);
        if (categoryId) q.append('categoryId', categoryId);
        const data = await apiFetch(`/products${q.toString() ? `?${q.toString()}` : ''}`);
        // Cache to IndexedDB in background
        if (Array.isArray(data)) {
          cacheProducts(data);
        }
        return data;
      } catch (err) {
        // Fallback to IndexedDB
        return await getCachedProducts();
      }
    },
    getByBarcode: async (barcode: string) => {
      try {
        return await apiFetch(`/products/barcode/${barcode}`);
      } catch {
        return await findCachedProductByBarcode(barcode);
      }
    },
    getOne: (id: string) => apiFetch(`/products/${id}`),
    create: (data: any) => apiFetch('/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => apiFetch(`/products/${id}`, { method: 'DELETE' }),
    getStock: (id: string) => apiFetch(`/products/${id}/stock`),
  },

  categories: {
    getAll: () => apiFetch('/categories'),
    create: (data: any) => apiFetch('/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => apiFetch(`/categories/${id}`, { method: 'DELETE' }),
  },

  // 4. Orders & Offline-First POS Checkout
  orders: {
    checkout: async (orderData: any) => {
      // Generate clientOrderId if not present
      if (!orderData.clientOrderId) {
        orderData.clientOrderId = 'ord_' + Math.random().toString(36).substring(2, 9) + '_' + Date.now();
      }

      if (typeof window !== 'undefined' && !navigator.onLine) {
        console.warn('[POS] Device is offline. Saving order to IndexedDB outbox queue...');
        await enqueueOfflineOrder({
          clientOrderId: orderData.clientOrderId,
          orderNumber: orderData.orderNumber || 'OFFLINE-' + Date.now(),
          items: orderData.items,
          payments: orderData.payments,
          customerId: orderData.customerId,
          shiftId: orderData.shiftId,
          discountAmount: orderData.discountAmount,
          totalAmount: orderData.totalAmount,
          createdAt: new Date().toISOString(),
        });
        return {
          ...orderData,
          status: 'COMPLETED',
          isOfflineSaved: true,
        };
      }

      return apiFetch('/orders/checkout', { method: 'POST', body: JSON.stringify(orderData) });
    },
    void: (id: string, reason: string) =>
      apiFetch(`/orders/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    getAll: (query: any = {}) => {
      const q = new URLSearchParams(query);
      return apiFetch(`/orders?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch(`/orders/${id}`),
    syncOffline: () => syncOfflineOrdersNow(API_BASE, getAuthToken()),
  },

  // 5. Customer Debts (ลูกหนี้การค้า)
  debts: {
    getAll: (page = 1, limit = 20, search?: string, status?: string) => {
      const q = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) q.append('search', search);
      if (status) q.append('status', status);
      return apiFetch(`/debts?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch(`/debts/${id}`),
    pay: (id: string, data: { amount: number; paymentMethod?: string; referenceNo?: string; cashierName?: string; note?: string }) =>
      apiFetch(`/debts/${id}/pay`, { method: 'POST', body: JSON.stringify(data) }),
    getPaymentsHistory: (page = 1, limit = 20, search?: string) => {
      const q = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) q.append('search', search);
      return apiFetch(`/debts/payments-history?${q.toString()}`);
    },
  },

  // 6. Payables & Payment Vouchers (เจ้าหนี้การค้า & ใบสำคัญจ่าย)
  payables: {
    getBills: (params: any = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch(`/payables/bills?${q.toString()}`);
    },
    getSuppliersSummary: () => apiFetch('/payables/suppliers-summary'),
    settleMultiple: (dto: any) => apiFetch('/payables/settle-multiple', { method: 'POST', body: JSON.stringify(dto) }),
    getVouchers: (params: any = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch(`/payables/vouchers?${q.toString()}`);
    },
    getVoucher: (id: string) => apiFetch(`/payables/vouchers/${id}`),
    cancelVoucher: (id: string, reason: string) =>
      apiFetch(`/payables/vouchers/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  },

  // 7. Supplier Returns (ใบลดหนี้ส่งเคลมคู่ค้า)
  supplierReturns: {
    getAll: (params: any = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch(`/supplier-returns?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch(`/supplier-returns/${id}`),
    create: (data: any) => apiFetch('/supplier-returns', { method: 'POST', body: JSON.stringify(data) }),
  },

  // 8. Claims & Claim Inventory (เคลมลูกค้า & คลังสต๊อกของเคลม)
  claims: {
    getAll: (params: any = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch(`/claims?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch(`/claims/${id}`),
    create: (data: any) => apiFetch('/claims', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/claims/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    getInventory: () => apiFetch('/claims/inventory'),
    updateInventory: (id: string, data: any) =>
      apiFetch(`/claims/inventory/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },

  // 9. Suppliers & Purchase Orders (ผู้จำหน่าย & จัดซื้อ)
  suppliers: {
    getAll: () => apiFetch('/suppliers'),
    getOne: (id: string) => apiFetch(`/suppliers/${id}`),
    create: (data: any) => apiFetch('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => apiFetch(`/suppliers/${id}`, { method: 'DELETE' }),
  },

  purchaseOrders: {
    getAll: (params: any = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch(`/purchase-orders?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch(`/purchase-orders/${id}`),
    create: (data: any) => apiFetch('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/purchase-orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    issue: (id: string) => apiFetch(`/purchase-orders/${id}/issue`, { method: 'POST' }),
    receive: (id: string, data: any) => apiFetch(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }),
  },

  // 10. Customers
  customers: {
    getAll: (search?: string) => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      return apiFetch(`/customers${q}`);
    },
    getOne: (id: string) => apiFetch(`/customers/${id}`),
    create: (data: any) => apiFetch('/customers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => apiFetch(`/customers/${id}`, { method: 'DELETE' }),
  },

  // 11. Bank Accounts
  bankAccounts: {
    getAll: () => apiFetch('/bank-accounts'),
    create: (data: any) => apiFetch('/bank-accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/bank-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    setDefault: (id: string) => apiFetch(`/bank-accounts/${id}/set-default`, { method: 'PATCH' }),
    delete: (id: string) => apiFetch(`/bank-accounts/${id}`, { method: 'DELETE' }),
  },

  // 12. Settings & Reports
  settings: {
    get: () => apiFetch('/settings'),
    update: (data: any) => apiFetch('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  },

  reports: {
    getDashboard: (startDate?: string, endDate?: string) => {
      const q = new URLSearchParams();
      if (startDate) q.append('startDate', startDate);
      if (endDate) q.append('endDate', endDate);
      return apiFetch(`/reports/dashboard${q.toString() ? `?${q.toString()}` : ''}`);
    },
  },

  // Legacy convenience aliases
  getProducts: () => api.products.getAll(),
  getOrders: (query: any = {}) => api.orders.getAll(query),
  getCategories: () => api.categories.getAll(),
  getCustomers: (search?: string) => api.customers.getAll(search),
  getDashboardData: () => api.reports.getDashboard(),
  getStoreSettings: () => api.settings.get(),
};
