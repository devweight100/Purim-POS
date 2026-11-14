import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: {}, apiFetch: h.apiFetch, getAuthToken: () => 't', isRetryableError: () => true }));
vi.mock('@/lib/offline-db', () => ({ cacheProducts: vi.fn(), applyCachedProductDelta: vi.fn(), getCachedProducts: async () => [] }));
vi.mock('@/lib/category-storage', () => ({ cacheServerCategories: () => [], readCachedCategories: () => [] }));
vi.mock('@/lib/store-settings-storage', () => ({ getLowStockThreshold: () => 5 }));

beforeEach(() => h.apiFetch.mockReset());

describe('products table query', () => {
  it('sends only the filters that are set', async () => {
    const { productPageUrl } = await import('@/components/products/useProducts');
    const base = { page: 1, limit: 50, search: '', categoryId: 'all', supplierId: 'all', stock: 'all' as const, sort: null, dir: 'asc' as const };
    expect(productPageUrl(base)).toBe('/products/page?page=1&limit=50');
    const url = productPageUrl({ ...base, page: 3, search: 'ปากกา 50%', categoryId: 'c1', supplierId: 's1', stock: 'low', sort: 'priceLevel2', dir: 'desc' });
    const q = new URLSearchParams(url.split('?')[1]);
    expect(Object.fromEntries(q)).toEqual({ page: '3', limit: '50', q: 'ปากกา 50%', categoryId: 'c1', supplierId: 's1', stock: 'low', sort: 'priceLevel2', dir: 'desc' });
  });
});

describe('debts page', () => {
  it('asks the server for one page with the filters and maps the rows', async () => {
    h.apiFetch.mockResolvedValue({
      data: [{
        id: 'd1', orderId: 'o1', customerId: 'c1', totalDebt: '100', paidAmount: '40', remainingAmount: '60', createdAt: '2026-11-01T00:00:00Z',
        order: { orderNumber: 'ORD-1', createdAt: '2026-11-01T00:00:00Z' },
        customer: { name: 'บริษัท ก', phone: '081', profile: { type: 'COMPANY', code: 'CUST-0007', companyName: 'บจก. ก', taxId: '123' } },
        payments: [],
      }],
      meta: { total: 41, page: 2, limit: 10, totalPages: 5 },
      stats: { totalBills: 50, totalDebtValue: 1, totalCollected: 2, totalOutstanding: 3, paidCount: 4, unpaidCount: 5, overdueCount: 6 },
    });
    const { fetchDebtPage } = await import('@/lib/debt-service');
    const res = await fetchDebtPage({ page: 2, limit: 10, search: ' ก ', statusGroup: 'overdue', customerId: 'c1', customerType: 'COMPANY' });
    const url = String(h.apiFetch.mock.calls[0][0]);
    expect(Object.fromEntries(new URLSearchParams(url.split('?')[1]))).toEqual({
      page: '2', limit: '10', stats: '1', search: 'ก', statusGroup: 'overdue', customerId: 'c1', customerType: 'COMPANY',
    });
    expect(res.total).toBe(41);
    expect(res.stats?.overdueCount).toBe(6);
    expect(res.rows[0]).toMatchObject({ orderNumber: 'ORD-1', customerType: 'COMPANY', customerCode: 'CUST-0007', companyName: 'บจก. ก', remainingDebt: 60, status: 'PARTIAL' });
  });

  it('all / no filters: only paging + stats', async () => {
    h.apiFetch.mockResolvedValue({ data: [], meta: { total: 0 } });
    const { fetchDebtPage } = await import('@/lib/debt-service');
    await fetchDebtPage({ page: 1, limit: 10, statusGroup: 'all', customerType: 'all', customerId: null });
    expect(h.apiFetch.mock.calls[0][0]).toBe('/debts?page=1&limit=10&stats=1');
  });
});

describe('customers page', () => {
  it('normalises rows with their position in the whole list (fallback code)', async () => {
    h.apiFetch.mockResolvedValue({
      data: [{ id: 'a', name: 'ก', listIndex: 41 }, { id: 'b', name: 'ข', code: 'CUST-0099', type: 'COMPANY', listIndex: 42 }],
      meta: { total: 60 },
      stats: { total: 60, individualCount: 59, companyCount: 1, totalCreditCustomers: 0, totalDebt: 0, totalPoints: 0, nextCode: 'CUST-0100' },
    });
    const { fetchCustomerPage } = await import('@/lib/customer-service');
    const res = await fetchCustomerPage({ page: 3, limit: 20, search: 'x', type: 'credit', priceLevel: '2' });
    expect(Object.fromEntries(new URLSearchParams(String(h.apiFetch.mock.calls[0][0]).split('?')[1]))).toEqual({
      page: '3', limit: '20', search: 'x', type: 'credit', priceLevel: '2',
    });
    expect(res.rows.map((c) => [c.code, c.type])).toEqual([['CUST-0042', 'INDIVIDUAL'], ['CUST-0099', 'COMPANY']]);
    expect(res.rows[0]).not.toHaveProperty('listIndex');
    expect(res.total).toBe(60);
    expect(res.stats.nextCode).toBe('CUST-0100');
  });
});
