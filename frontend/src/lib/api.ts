import { rememberServerBankAccounts } from './bank-account-storage';
import { getTerminalId } from './terminal-id';
// ==============================================================================
// Purim POS - Unified Real API Client with Offline-First Resilience
// ==============================================================================

import {
  cacheProducts,
  getCachedProducts,
  findCachedProductByBarcode,
} from './offline-db';
import { ApiError, isRetryableError, type UntypedJson } from './api-error';
import type { ProductSyncResponse } from './product-delta';
import { reportConnection } from './connection-status';
import type {
  ApiAuthUser, ApiCategory, ApiClaim, ApiClaimInventoryItem, ApiCustomer, ApiDebt, ApiDebtPayment, ApiDocumentSearchResult,
  ApiListResponse, ApiPage, ApiPaymentVoucher, ApiProduct, ApiPurchaseOrder, ApiShiftLike, ApiShiftRecord,
  ApiShiftSummary, ApiStoreSettings, ApiSupplier, ApiSupplierReturnNote, ApiUserRow, ApiCashMovement,
  ApiBankAccount, BankAccountWriteRequest, BulkUpsertResponse, CashMovementRequest, CategoryWriteRequest,
  CheckoutRequest, CheckoutResult, Customer, DebtPayRequest, DebtPayResponse, LoginRequest, LoginResponse,
  ProductWriteRequest, PurchaseOrderWriteRequest, PurchaseReceiveRequest, QueryParams, SettleMultipleRequest,
  SettleMultipleResponse, SupplierReturnWriteRequest, SupplierWriteRequest, UpdateUserRequest, ApiOrderLike,
} from './types';
import type { CachedProduct } from './offline-db';
export { ApiError, isRetryableError } from './api-error';
export type { UntypedJson } from './api-error';

/** JSON error body the backend sends with a non-2xx status. */
interface ApiErrorBody {
  message?: string | string[];
  code?: string;
}

/** A product list from the server, or (POS only) from the offline cache when the server is unreachable. */
export type ProductListResult = (ApiProduct | CachedProduct)[] & { fromOfflineCache?: boolean };

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

/**
 * Call the backend and parse its JSON answer as T. An empty body resolves to null, so endpoints
 * that can answer without a body should include null in T.
 */
export async function apiFetch<T = UntypedJson>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
      const errBody: ApiErrorBody | null = await res.json().catch(() => null);
      if (res.status === 403 && errBody?.code === 'MUST_CHANGE_PASSWORD' && typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('purim:must-change-password'));
      } else if (res.status === 403 && typeof window !== 'undefined') {
        // Shown by (main)/layout so a page never silently stays empty when an API refuses this user
        window.dispatchEvent(new CustomEvent('purim:forbidden', { detail: { endpoint: cleanEndpoint, message: errBody?.message } }));
      }
      reportConnection(res.status >= 500);
      const fallbackMessage =
        res.status >= 500 && !errBody?.message
          ? `ติดต่อเซิร์ฟเวอร์ไม่ได้ (HTTP ${res.status}) กรุณาลองใหม่`
          : `HTTP ${res.status}: ${res.statusText}`;
      throw new ApiError(Array.isArray(errBody?.message) ? errBody.message.join(', ') : errBody?.message || fallbackMessage, res.status, errBody);
    }

    reportConnection(false);

    const text = await res.text();
    if (!text || !text.trim()) {
      return null as T;
    }
    try {
      return JSON.parse(text) as T;
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
    login: (loginDto: LoginRequest) => apiFetch<LoginResponse>('/auth/login', { method: 'POST', body: JSON.stringify(loginDto) }),
    loginWithPin: (pin: string) => apiFetch<LoginResponse>('/auth/login-pin', { method: 'POST', body: JSON.stringify({ pin }) }),
    getProfile: () => apiFetch<ApiAuthUser>('/auth/me'),
    getUsers: () => apiFetch<ApiUserRow[]>('/auth/users'),
    updateUser: (id: string, data: UpdateUserRequest) => apiFetch<ApiUserRow>(`/auth/users/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    toggleUserActive: (id: string) => apiFetch<ApiUserRow>(`/auth/users/${id}/toggle-active`, { method: 'PATCH' }),
  },

  // 2. Shifts
  shifts: {
    getCurrent: () => apiFetch<ApiShiftSummary | null>('/shifts/current?terminalId=' + encodeURIComponent(getTerminalId())),
    open: (startingCash: number, note?: string) =>
      apiFetch<ApiShiftSummary>('/shifts/open', { method: 'POST', body: JSON.stringify({ startingCash, note, terminalId: getTerminalId() }) }),
    close: (shiftId: string, actualCash: number, note?: string) =>
      apiFetch<ApiShiftRecord>(`/shifts/${shiftId}/close`, { method: 'POST', body: JSON.stringify({ actualCash, note }) }),
    getSummary: (shiftId: string) => apiFetch<ApiShiftSummary>(`/shifts/${shiftId}/summary`),
    addCashMovement: (shiftId: string, p1: CashMovementRequest | 'in' | 'out', p2?: number, p3?: string) => {
      const body = typeof p1 === 'object' ? p1 : { type: p1, amount: p2, reason: p3 };
      return apiFetch<ApiCashMovement>(`/shifts/${shiftId}/cash-movements`, { method: 'POST', body: JSON.stringify(body) });
    },
    getHistory: (page = 1, limit = 20, search?: string) => {
      const q = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) q.append('search', search);
      return apiFetch<ApiPage<ApiShiftLike>>(`/shifts/history?${q.toString()}`);
    },
  },

  // 3. Products & Categories
  // Every full server response refreshes the READ-ONLY offline product cache (IndexedDB). The
  // cache is read back only when the caller asks for it (the POS, so selling keeps working
  // offline); back-office pages get the error instead of stale data.
  products: {
    getAll: async (search?: string, categoryId?: string, opts?: { offlineCache?: boolean }): Promise<ProductListResult> => {
      try {
        const q = new URLSearchParams();
        if (search) q.append('search', search);
        if (categoryId) q.append('categoryId', categoryId);
        const data = await apiFetch<ApiProduct[]>(`/products${q.toString() ? `?${q.toString()}` : ''}`);
        // Cache to IndexedDB in background
        if (Array.isArray(data)) {
          if (!search && !categoryId) void cacheProducts(data);
        }
        return data;
      } catch (err) {
        // POS only: fall back to the offline cache when the server cannot be reached
        if (!opts?.offlineCache || !isRetryableError(err)) throw err;
        const cached = await getCachedProducts();
        if (!cached.length) throw err;
        return Object.assign(cached, { fromOfflineCache: true });
      }
    },
    getByBarcode: async (barcode: string): Promise<ApiProduct | CachedProduct | null> => {
      try {
        return await apiFetch<ApiProduct | null>(`/products/barcode/${barcode}`);
      } catch (err) {
        if (!isRetryableError(err)) throw err;
        return await findCachedProductByBarcode(barcode);
      }
    },
    /** POS catalogue: every product (no / unusable cursor) or the changes since `since` (see product-delta.ts). */
    sync: (since?: string) =>
      apiFetch<ProductSyncResponse<ApiProduct>>(`/products/sync${since ? `?since=${encodeURIComponent(since)}` : ''}`),
    getOne: (id: string) => apiFetch<ApiProduct>(`/products/${id}`),
    // generic so callers can read the saved product into their own view type (default: the server shape)
    create: <T = ApiProduct>(data: ProductWriteRequest) => apiFetch<T>('/products', { method: 'POST', body: JSON.stringify(data) }),
    update: <T = ApiProduct>(id: string, data: ProductWriteRequest) => apiFetch<T>(`/products/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    bulkUpsert: (products: ProductWriteRequest[]) => apiFetch<BulkUpsertResponse>('/products/bulk-upsert', { method: 'POST', body: JSON.stringify({ products }) }),
    delete: (id: string) => apiFetch<ApiProduct>(`/products/${id}`, { method: 'DELETE' }),
    deleteAll: () => apiFetch<{ deleted: number }>('/products', { method: 'DELETE' }),
    getStock: (id: string) => apiFetch<{ productId: string; computedStock?: number }>(`/products/${id}/stock`),
  },

  categories: {
    getAll: () => apiFetch<ApiCategory[]>('/categories'),
    create: (data: CategoryWriteRequest) => apiFetch<ApiCategory>('/categories', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: CategoryWriteRequest) => apiFetch<ApiCategory>(`/categories/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => apiFetch<ApiCategory>(`/categories/${id}`, { method: 'DELETE' }),
  },

  // 4. Orders & Offline-First POS Checkout
  orders: {
    checkout: async (orderData: CheckoutRequest): Promise<CheckoutResult> => {
      return (await import('./order-sync-service')).submitOrder(orderData);
    },
    void: (id: string, reason: string) =>
      apiFetch<ApiOrderLike>(`/orders/${id}/void`, { method: 'POST', body: JSON.stringify({ reason }) }),
    getAll: (query: QueryParams = {}) => {
      const q = new URLSearchParams(query);
      return apiFetch<ApiListResponse<ApiOrderLike>>(`/orders?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch<ApiOrderLike>(`/orders/${id}`),
    syncOffline: async () => (await import('./order-sync-service')).syncPendingOrders(),
  },

  // 5. Customer Debts (ลูกหนี้การค้า)
  debts: {
    getAll: (page = 1, limit = 20, search?: string, status?: string) => {
      const q = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) q.append('search', search);
      if (status) q.append('status', status);
      return apiFetch<ApiPage<ApiDebt>>(`/debts?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch<ApiDebt>(`/debts/${id}`),
    pay: (id: string, data: DebtPayRequest) =>
      apiFetch<DebtPayResponse>(`/debts/${id}/pay`, { method: 'POST', body: JSON.stringify(data) }),
    getPaymentsHistory: (page = 1, limit = 20, search?: string) => {
      const q = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search) q.append('search', search);
      return apiFetch<ApiPage<ApiDebtPayment>>(`/debts/payments-history?${q.toString()}`);
    },
  },

  // 6. Payables & Payment Vouchers (เจ้าหนี้การค้า & ใบสำคัญจ่าย)
  payables: {
    getBills: (params: QueryParams = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch<ApiPage<ApiPurchaseOrder>>(`/payables/bills?${q.toString()}`);
    },
    getSuppliersSummary: () => apiFetch<unknown[]>('/payables/suppliers-summary'),
    settleMultiple: (dto: SettleMultipleRequest) => apiFetch<SettleMultipleResponse>('/payables/settle-multiple', { method: 'POST', body: JSON.stringify(dto) }),
    getVouchers: (params: QueryParams = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch<ApiPage<ApiPaymentVoucher>>(`/payables/vouchers?${q.toString()}`);
    },
    getVoucher: (id: string) => apiFetch<ApiPaymentVoucher>(`/payables/vouchers/${id}`),
    cancelVoucher: (id: string, reason: string) =>
      apiFetch<ApiPaymentVoucher>(`/payables/vouchers/${id}/cancel`, { method: 'POST', body: JSON.stringify({ reason }) }),
  },

  // 7. Supplier Returns (ใบลดหนี้ส่งเคลมคู่ค้า)
  supplierReturns: {
    getAll: (params: QueryParams = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch<ApiListResponse<ApiSupplierReturnNote>>(`/supplier-returns?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch<ApiSupplierReturnNote>(`/supplier-returns/${id}`),
    create: (data: SupplierReturnWriteRequest) => apiFetch<ApiSupplierReturnNote>('/supplier-returns', { method: 'POST', body: JSON.stringify(data) }),
  },

  // 8. Claims & Claim Inventory (เคลมลูกค้า & คลังสต๊อกของเคลม)
  claims: {
    getAll: (params: QueryParams = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch<ApiListResponse<ApiClaim>>(`/claims?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch<ApiClaim>(`/claims/${id}`),
    create: (data: Partial<ApiClaim>) => apiFetch<ApiClaim>('/claims', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<ApiClaim>) => apiFetch<ApiClaim>(`/claims/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    getInventory: () => apiFetch<ApiListResponse<ApiClaimInventoryItem>>('/claims/inventory'),
    updateInventory: (id: string, data: Partial<ApiClaimInventoryItem>) =>
      apiFetch<ApiClaimInventoryItem>(`/claims/inventory/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  },

  // 9. Suppliers & Purchase Orders (ผู้จำหน่าย & จัดซื้อ)
  suppliers: {
    getAll: () => apiFetch<ApiSupplier[]>('/suppliers'),
    getOne: (id: string) => apiFetch<ApiSupplier>(`/suppliers/${id}`),
    create: (data: SupplierWriteRequest) => apiFetch<ApiSupplier>('/suppliers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: SupplierWriteRequest) => apiFetch<ApiSupplier>(`/suppliers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => apiFetch<ApiSupplier>(`/suppliers/${id}`, { method: 'DELETE' }),
  },

  purchaseOrders: {
    getAll: (params: QueryParams = {}) => {
      const q = new URLSearchParams(params);
      return apiFetch<ApiListResponse<ApiPurchaseOrder>>(`/purchase-orders?${q.toString()}`);
    },
    getOne: (id: string) => apiFetch<ApiPurchaseOrder>(`/purchase-orders/${id}`),
    create: (data: PurchaseOrderWriteRequest) => apiFetch<ApiPurchaseOrder>('/purchase-orders', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: PurchaseOrderWriteRequest) => apiFetch<ApiPurchaseOrder>(`/purchase-orders/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    issue: (id: string) => apiFetch<ApiPurchaseOrder>(`/purchase-orders/${id}/issue`, { method: 'POST' }),
    receive: (id: string, data: PurchaseReceiveRequest) => apiFetch<ApiPurchaseOrder>(`/purchase-orders/${id}/receive`, { method: 'POST', body: JSON.stringify(data) }),
  },

  // 10. Customers
  customers: {
    getAll: (search?: string) => {
      const q = search ? `?search=${encodeURIComponent(search)}` : '';
      return apiFetch<ApiCustomer[]>(`/customers${q}`);
    },
    getOne: (id: string) => apiFetch<ApiCustomer>(`/customers/${id}`),
    create: (data: Partial<Customer>) => apiFetch<ApiCustomer>('/customers', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Partial<Customer>) => apiFetch<ApiCustomer>(`/customers/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    delete: (id: string) => apiFetch<ApiCustomer>(`/customers/${id}`, { method: 'DELETE' }),
  },

  // 11. Bank Accounts
  bankAccounts: {
    getAll: async () => { return rememberServerBankAccounts(await apiFetch<ApiBankAccount[]>('/bank-accounts')); },
    create: (data: BankAccountWriteRequest) => apiFetch<ApiBankAccount>('/bank-accounts', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: BankAccountWriteRequest) => apiFetch<ApiBankAccount>(`/bank-accounts/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    setDefault: (id: string) => apiFetch<ApiBankAccount>(`/bank-accounts/${id}/set-default`, { method: 'PATCH' }),
    delete: (id: string) => apiFetch<ApiBankAccount>(`/bank-accounts/${id}`, { method: 'DELETE' }),
  },

  // 12. Settings & Reports
  settings: {
    get: () => apiFetch<ApiStoreSettings>('/settings'),
    update: (data: ApiStoreSettings) => apiFetch<ApiStoreSettings>('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
    resetDatabase: () => apiFetch<{ success?: boolean; message?: string }>('/settings/reset-database', { method: 'POST' }),
  },

  reports: {
    getDashboard: (startDate?: string, endDate?: string) => {
      const q = new URLSearchParams();
      if (startDate) q.append('startDate', startDate);
      if (endDate) q.append('endDate', endDate);
      return apiFetch<Record<string, unknown>>(`/reports/dashboard${q.toString() ? `?${q.toString()}` : ''}`);
    },
  },

  // 13. Universal Document Search (ค้นหาเอกสารทุกประเภทผ่านบาร์โค้ดหรือเลขที่เอกสาร)
  documents: {
    search: (query: string) => apiFetch<ApiDocumentSearchResult[]>(`/documents/search?q=${encodeURIComponent(query)}`),
  },

  // Legacy convenience aliases
  getProducts: () => api.products.getAll(),
  getOrders: (query: QueryParams = {}) => api.orders.getAll(query),
  getCategories: () => api.categories.getAll(),
  getCustomers: (search?: string) => api.customers.getAll(search),
  getDashboardData: () => api.reports.getDashboard(),
  getStoreSettings: () => api.settings.get(),
};
