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

  it('supplier returns use every returnable claim, not the claims list', async () => {
    h.apiFetch.mockResolvedValueOnce({ data: [claim('CLM-1'), claim('CLM-2', { returnDocId: 'SRN-1' })], meta: { total: 2 } });
    const svc = await import('@/lib/supplier-return-service');
    const claims = await import('@/lib/claim-service');
    expect(svc.hasReturnableClaims()).toBe(false);
    await svc.fetchReturnableClaims();
    expect(h.apiFetch.mock.calls[0][0]).toBe('/claims/returnable');
    expect(svc.hasReturnableClaims()).toBe(true);
    // the page's own rule still applies on top (a claim on a return note is not offered)
    expect(svc.getEligibleClaimsForReturn().map((c) => c.id)).toEqual(['CLM-1']);
    expect(claims.loadAllClaimRecords()).toEqual([]);
  });
});
