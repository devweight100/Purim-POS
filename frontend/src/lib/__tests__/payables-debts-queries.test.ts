import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: {}, apiFetch: h.apiFetch, getAuthToken: () => 't', isRetryableError: () => true }));
vi.mock('@/lib/offline-db', () => ({ cacheProducts: vi.fn(), applyCachedProductDelta: vi.fn(), getCachedProducts: async () => [] }));
vi.mock('@/lib/category-storage', () => ({ cacheServerCategories: () => [], readCachedCategories: () => [] }));
vi.mock('@/lib/store-settings-storage', () => ({ getLowStockThreshold: () => 5 }));

beforeEach(() => h.apiFetch.mockReset());

const query = (url: unknown) => Object.fromEntries(new URLSearchParams(String(url).split('?')[1]));
const emptySummary = { billCount: 0, unpaidCount: 0, totalOutstanding: 0, totalPaid: 0, availableCredit: 0, availableCreditCount: 0, suppliers: [] };

describe('payables bills (server)', () => {
  it('sends only the filters that are set', async () => {
    const { payableBillsUrl } = await import('@/lib/payable-service');
    expect(payableBillsUrl()).toBe('/payables/bills?page=1&limit=50');
    expect(query(payableBillsUrl({ page: 3, search: ' PO-1 ', supplierId: 'ALL', paymentStatus: 'ALL' }))).toEqual({ page: '3', limit: '50', search: 'PO-1' });
    expect(query(payableBillsUrl({ supplierId: 's1', paymentStatus: 'UNPAID', open: true, slim: true, limit: 500 }))).toEqual({
      page: '1', limit: '500', supplierId: 's1', paymentStatus: 'UNPAID', open: '1', slim: '1',
    });
  });

  it('the settle dialog gets every open bill (all pages, slim)', async () => {
    const bill = (n: number) => ({ poId: `po${n}`, remainingPayable: n });
    h.apiFetch
      .mockResolvedValueOnce({ data: Array.from({ length: 5000 }, (_, i) => bill(i)), meta: { total: 5001, page: 1, limit: 5000, totalPages: 2 }, summary: emptySummary })
      .mockResolvedValueOnce({ data: [bill(5000)], meta: { total: 5001, page: 2, limit: 5000, totalPages: 2 }, summary: emptySummary });
    const { fetchOpenPayableBills } = await import('@/lib/payable-service');
    const rows = await fetchOpenPayableBills();
    expect(rows).toHaveLength(5001);
    expect(h.apiFetch.mock.calls.map((c) => query(c[0]))).toEqual([
      { page: '1', limit: '5000', open: '1', slim: '1' },
      { page: '2', limit: '5000', open: '1', slim: '1' },
    ]);
  });

  it('a response without summary is an error (no half-filled page)', async () => {
    h.apiFetch.mockResolvedValue({ data: [], meta: { total: 0 } });
    const { fetchPayableBillsPage } = await import('@/lib/payable-service');
    await expect(fetchPayableBillsPage()).rejects.toThrow();
  });
});

describe('debts asked by bill / for the POS picker', () => {
  const debt = (orderId: string, remaining: string) => ({
    id: 'd-' + orderId, orderId, customerId: 'c1', totalDebt: '100', paidAmount: '0', remainingAmount: remaining, createdAt: '2026-11-01T00:00:00Z',
    order: { orderNumber: 'ORD-' + orderId, createdAt: '2026-11-01T00:00:00Z' }, customer: { name: 'ก' }, payments: [],
  });

  it('fetchDebtsForOrders asks for those bills only and getDebtRecordByOrderId reads them (by id or bill number)', async () => {
    h.apiFetch.mockResolvedValueOnce({ data: [debt('o1', '60')], meta: { total: 1 } });
    const svc = await import('@/lib/debt-service');
    await svc.fetchDebtsForOrders(['o1', 'o2', 'o1']);
    expect(query(h.apiFetch.mock.calls[0][0])).toEqual({ limit: '500', orderIds: 'o1,o2' });
    expect(svc.getDebtRecordByOrderId('o1')?.remainingDebt).toBe(60);
    expect(svc.getDebtRecordByOrderId('ORD-o1')?.orderId).toBe('o1');
    expect(svc.getDebtRecordByOrderId('o2')).toBeNull();
    // paid off since: the next read replaces it; a bill no longer returned is forgotten
    h.apiFetch.mockResolvedValueOnce({ data: [], meta: { total: 0 } });
    await svc.fetchDebtsForOrders(['o1']);
    expect(svc.getDebtRecordByOrderId('o1')).toBeNull();
  });

  it('POS picker query: owing, customer or search, no cards', async () => {
    h.apiFetch.mockResolvedValue({ data: [], meta: { total: 0 } });
    const { fetchDebtPage } = await import('@/lib/debt-service');
    await fetchDebtPage({ page: 1, limit: 100, statusGroup: 'owing', stats: false, customerId: 'c9' });
    expect(query(h.apiFetch.mock.calls[0][0])).toEqual({ page: '1', limit: '100', statusGroup: 'owing', customerId: 'c9' });
  });
});
