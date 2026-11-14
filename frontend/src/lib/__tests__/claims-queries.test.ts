import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/api', () => ({ api: {}, apiFetch: h.apiFetch, getAuthToken: () => 't', isRetryableError: () => true }));
vi.mock('@/lib/offline-db', () => ({ cacheProducts: vi.fn(), applyCachedProductDelta: vi.fn(), getCachedProducts: async () => [] }));
vi.mock('@/lib/category-storage', () => ({ cacheServerCategories: () => [], readCachedCategories: () => [] }));
vi.mock('@/lib/store-settings-storage', () => ({ getLowStockThreshold: () => 5 }));

beforeEach(() => h.apiFetch.mockReset());

const claim = (no: string, extra: Record<string, unknown> = {}) => ({
  id: 'id-' + no, claimNumber: no, productId: 'p1', status: 'PENDING', frontendStatus: 'PENDING_SUPPLIER', claimType: 'EXCHANGE',
  quantity: 1, createdAt: '2026-11-01T00:00:00Z', ...extra,
});

describe('claims asked from the server for one screen', () => {
  it('fetchClaimedOrderIds asks for the given bills only (500 per request, no duplicates)', async () => {
    const ids = Array.from({ length: 501 }, (_, i) => `o${i}`);
    h.apiFetch.mockResolvedValueOnce(['o3']).mockResolvedValueOnce(['o500']);
    const { fetchClaimedOrderIds } = await import('@/lib/claim-service');
    const out = await fetchClaimedOrderIds([...ids, 'o3', '']);
    expect([...out]).toEqual(['o3', 'o500']);
    expect(h.apiFetch.mock.calls.map((c) => String(c[0]).split('=')[1].split(',').length)).toEqual([500, 1]);
    expect(String(h.apiFetch.mock.calls[0][0]).startsWith('/claims/claimed-orders?orderIds=o0,o1,')).toBe(true);
    h.apiFetch.mockResolvedValueOnce(null);
    await expect(fetchClaimedOrderIds(['o1'])).rejects.toThrow();
  });

  it('supplier returns: cards and dialog groups come from the server (no claims list in the browser)', async () => {
    h.apiFetch.mockResolvedValueOnce({ total: 3, totalCostValue: 150, suppliers: [{ supplierId: 's1', count: 3, totalCostValue: 150, top: [] }] });
    const svc = await import('@/lib/supplier-return-service');
    const sum = await svc.fetchReturnableSummary();
    expect(h.apiFetch.mock.calls[0][0]).toBe('/claims/returnable/summary');
    expect(sum.suppliers[0].count).toBe(3);
    h.apiFetch.mockResolvedValueOnce({ data: [], meta: { total: 0, page: 2, limit: 50 }, totals: { groups: 0, claims: 0, pieces: 0 } });
    await svc.fetchReturnableGroups({ supplierId: 's 1', scope: 'other', search: ' abc ', page: 2 });
    expect(h.apiFetch.mock.calls[1][0]).toBe('/claims/returnable/groups?supplierId=s+1&scope=other&page=2&limit=50&search=abc');
    h.apiFetch.mockResolvedValueOnce(null);
    await expect(svc.fetchReturnableSummary()).rejects.toThrow();
  });

  it('claims page / dashboard / eligibility ask for what they show', async () => {
    const claims = await import('@/lib/claim-service');
    h.apiFetch.mockResolvedValueOnce({ data: [claim('CLM-9', { returnDocId: 'SRN-1' })], meta: { total: 41 }, summary: { totalClaims: 41 } });
    const page = await claims.fetchClaimsPage({ page: 3, limit: 15, search: 'x', resolutionType: 'ALL', startDate: '2026-11-01', endDate: '', sort: 'oldest' });
    expect(h.apiFetch.mock.calls[0][0]).toBe('/claims/list?page=3&limit=15&search=x&startDate=2026-11-01&sort=oldest');
    expect(page.total).toBe(41);
    expect(page.rows[0].id).toBe('CLM-9');
    expect(page.rows[0].status).toBe('PENDING_SUPPLIER');
    h.apiFetch.mockResolvedValueOnce({ count: 2, amount: 300 });
    expect(await claims.fetchClaimRefundSummary(1700000000000.5)).toEqual({ count: 2, amount: 300 });
    expect(h.apiFetch.mock.calls[1][0]).toBe('/claims/refund-summary?from=1700000000000');
    h.apiFetch.mockResolvedValueOnce({ count: 0, amount: 0 });
    await claims.fetchClaimRefundSummary(undefined);
    expect(h.apiFetch.mock.calls[2][0]).toBe('/claims/refund-summary');
    h.apiFetch.mockResolvedValueOnce({ data: [claim('CLM-1', { orderId: 'o1' })], meta: { total: 1 } });
    const ofOrders = await claims.fetchClaimsOfOrders(['o1', 'o1', '']);
    expect(h.apiFetch.mock.calls[3][0]).toBe('/claims/by-orders?orderIds=o1');
    expect(ofOrders.map((c) => c.orderId)).toEqual(['o1']);
  });
});
