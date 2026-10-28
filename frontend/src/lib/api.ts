import { saveBankAccounts } from './bank-account-storage';
import { getTerminalId } from './terminal-id';
// ==============================================================================
// Purim POS - Unified Real API Client with Offline-First Resilience
// ==============================================================================

import {
  cacheProducts,
  getCachedProducts,
  findCachedProductByBarcode,
} from './offline-db';
import { ApiError, isRetryableError } from './api-error';
import { reportConnection } from './connection-status';
export { ApiError, isRetryableError } from './api-error';

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return process.env.NEXT_PUBLIC_API_URL || 'http://127.0.0.1:3001/api';
  }
  return '/api';
}

let inMemoryAuthToken: string | null = null;

export function setInMemoryAuthToken(token: string | null) {
  inMemoryAuthToken = token;
}

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem('auth-storage');
    if (raw) {
      const parsed = JSON.parse(raw);
      const storedToken = parsed.state?.token || null;
      if (storedToken) {
        inMemoryAuthToken = storedToken;
        return storedToken;
      }
      // Recover token if localStorage was cleared by a transient 401 while memory still holds it
      if (inMemoryAuthToken && parsed.state) {
        parsed.state.token = inMemoryAuthToken;
        parsed.state.isAuthenticated = true;
        localStorage.setItem('auth-storage', JSON.stringify(parsed));
        return inMemoryAuthToken;
      }
    }
  } catch {}
  return inMemoryAuthToken;
}

export async function apiFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  const apiBase = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  const url = endpoint.startsWith('http') ? endpoint : `${apiBase}${cleanEndpoint}`;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const token = getAuthToken();
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const abort = () => controller.abort();
  options.signal?.addEventListener('abort', abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  try {
    let res: Response;
    try {
      res = await fetch(url, { ...options, headers, signal: controller.signal });
    } catch {
      reportConnection(true);
      throw new ApiError('ติดต่อฐานข้อมูลไม่ได้หรือหมดเวลารอ กรุณาตรวจสอบการเชื่อมต่อ');
    }

    if (!res.ok) {
      const isAuthEndpoint = cleanEndpoint.startsWith('/auth/login');
      if (res.status === 401 && typeof window !== 'undefined' && !isAuthEndpoint) {
        inMemoryAuthToken = null;
        try {
          const raw = localStorage.getItem('auth-storage');
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed.state) {
              parsed.state.token = null;
              parsed.state.isAuthenticated = false;
              localStorage.setItem('auth-storage', JSON.stringify(parsed));
            }
          }
        } catch {}
        window.dispatchEvent(new CustomEvent('purim:unauthorized'));
      }
      const errBody = await res.json().catch(() => null);
      reportConnection(res.status >= 500);
      throw new ApiError(Array.isArray(errBody?.message) ? errBody.message.join(', ') : errBody?.message || `HTTP ${res.status}: ${res.statusText}`, res.status);
    }

    reportConnection(false);

    const text = await res.text();
    if (!text || !text.trim()) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new ApiError('คำตอบจากเซิร์ฟเวอร์ไม่สมบูรณ์ กรุณาตรวจสอบสถานะรายการ', 502);
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', abort);
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
    getCurrent: () => apiFetch('/shifts/current?terminalId=' + encodeURIComponent(getTerminalId())),
    open: (startingCash: number, note?: string) =>
      apiFetch('/shifts/open', { method: 'POST', body: JSON.stringify({ startingCash, note, terminalId: getTerminalId() }) }),
    close: (shiftId: string, actualCash: number, note?: string) =>
      apiFetch(`/shifts/${shiftId}/close`, { method: 'POST', body: JSON.stringify({ actualCash, note }) }),
    getSummary: (shiftId: string) => apiFetch(`/shifts/${shiftId}/summary`),
    addCashMovement: (shiftId: string, p1: any, p2?: number, p3?: string) => {
      const body = typeof p1 === 'object' ? p1 : { type: p1, amount: p2, reason: p3 };
      return apiFetch(`/shifts/${shiftId}/cash-movements`, { method: 'POST', body: JSON.stringify(body) });
    },
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
          if (!search && !categoryId) void cacheProducts(data);
        }
        return data;
      } catch (err) {
        // Fallback to IndexedDB
        if (!isRetryableError(err)) throw err;
        const cached = await getCachedProducts();
        if (!cached.length) throw err;
        return cached;
      }
    },
    getByBarcode: async (barcode: string) => {
      try {
        return await apiFetch(`/products/barcode/${barcode}`);
      } catch (err) {
        if (!isRetryableError(err)) throw err;
        return await findCachedProductByBarcode(barcode);
      }
    },
    getOne: (id: string) => apiFetch(`/products/${id}`),
    create: (data: any) => apiFetch('/products', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    bulkUpsert: (products: any[]) => apiFetch('/products/bulk-upsert', { method: 'POST', body: JSON.stringify({ products }) }),
    delete: (id: string) => apiFetch(`/products/${id}`, { method: 'DELETE' }),
    deleteAll: () => apiFetch('/products', { method: 'DELETE' }),
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
      return (await import('./order-sync-service')).submitOrder(orderData);
    },
    void: (id: string, reason: string) =>
      apiFetch(`/orders/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    getAll: (query: any = {}) => {
      const q = new URLSearchParams(query);
      return apiFetch(`/orders?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch(`/orders/${id}`),
    syncOffline: async () => (await import('./order-sync-service')).syncPendingOrders(),
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
    getAll: async () => { const rows = await apiFetch('/bank-accounts'); saveBankAccounts(rows); return rows; },
    create: (data: any) => apiFetch('/bank-accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: any) => apiFetch(`/bank-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    setDefault: (id: string) => apiFetch(`/bank-accounts/${id}/set-default`, { method: 'PATCH' }),
    delete: (id: string) => apiFetch(`/bank-accounts/${id}`, { method: 'DELETE' }),
  },

  // 12. Settings & Reports
  settings: {
    get: () => apiFetch('/settings'),
    update: (data: any) => apiFetch('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
    resetDatabase: () => apiFetch('/settings/reset-database', { method: 'POST' }),
  },

  reports: {
    getDashboard: (startDate?: string, endDate?: string) => {
      const q = new URLSearchParams();
      if (startDate) q.append('startDate', startDate);
      if (endDate) q.append('endDate', endDate);
      return apiFetch(`/reports/dashboard${q.toString() ? `?${q.toString()}` : ''}`);
    },
  },

  // 13. Universal Document Search (ค้นหาเอกสารทุกประเภทผ่านบาร์โค้ดหรือเลขที่เอกสาร)
  documents: {
    search: (query: string) => apiFetch(`/documents/search?q=${encodeURIComponent(query)}`),
  },

  // Legacy convenience aliases
  getProducts: () => api.products.getAll(),
  getOrders: (query: any = {}) => api.orders.getAll(query),
  getCategories: () => api.categories.getAll(),
  getCustomers: (search?: string) => api.customers.getAll(search),
  getDashboardData: () => api.reports.getDashboard(),
  getStoreSettings: () => api.settings.get(),
};
