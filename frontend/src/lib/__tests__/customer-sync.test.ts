import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiFetch = vi.fn();
let token = 'tok-1';
vi.mock('@/lib/api', () => ({
  api: { customers: {}, settings: {} },
  apiFetch: (...args: unknown[]) => apiFetch(...args),
  getAuthToken: () => token,
}));

const row = (id: string, name: string, extra: Record<string, unknown> = {}) => ({ id, name, phone: '', ...extra });

describe('applyCustomerSync', () => {
  it('full = the server list in order, fallback codes by position (as GET /customers was mapped)', async () => {
    const { applyCustomerSync } = await import('@/lib/customer-service');
    const out = applyCustomerSync([], { cursor: 'c', full: true, customers: [row('a', 'A'), row('b', 'B', { profile: { code: 'CUST-0099' } })], deleted: [] })!;
    expect(out.map((x) => [x.customer.id, x.customer.code, x.listIndex])).toEqual([['a', 'CUST-0001', 0], ['b', 'CUST-0099', 1]]);
  });

  it('delta: changed rows replaced in place, new rows at their list index, nothing changed = null', async () => {
    const { applyCustomerSync } = await import('@/lib/customer-service');
    const base = applyCustomerSync([], { cursor: 'c', full: true, customers: [row('a', 'A'), row('b', 'B')], deleted: [] })!;
    expect(applyCustomerSync(base, { cursor: 'c2', full: false, customers: [], deleted: [] })).toBeNull();
    const out = applyCustomerSync(base, { cursor: 'c2', full: false, customers: [{ ...row('c', 'C'), listIndex: 2 }, { ...row('a', 'A2', { currentDebt: 50 }), listIndex: 0 }], deleted: [] })!;
    expect(out.map((x) => [x.customer.id, x.customer.name, x.customer.code, x.customer.currentDebt])).toEqual([
      ['a', 'A2', 'CUST-0001', 50], ['b', 'B', 'CUST-0002', 0], ['c', 'C', 'CUST-0003', 0],
    ]);
  });
});

describe('fetchCustomers (delta sync)', () => {
  beforeEach(() => {
    vi.resetModules();
    apiFetch.mockReset();
    token = 'tok-1';
  });

  it('first call is a full load, then ?since=cursor; another login starts over; concurrent calls share a request', async () => {
    const svc = await import('@/lib/customer-service');
    apiFetch.mockResolvedValueOnce({ cursor: 'v1.a', full: true, customers: [row('a', 'A'), row('b', 'B')], deleted: [] });
    expect((await svc.fetchCustomers()).map((c) => c.id)).toEqual(['a', 'b']);
    expect(apiFetch).toHaveBeenLastCalledWith('/customers/sync');

    apiFetch.mockResolvedValueOnce({ cursor: 'v1.b', full: false, customers: [{ ...row('b', 'B2'), listIndex: 1 }], deleted: [] });
    const [x, y] = await Promise.all([svc.fetchCustomers(), svc.fetchCustomers()]);
    expect(apiFetch).toHaveBeenCalledTimes(2);
    expect(apiFetch).toHaveBeenLastCalledWith('/customers/sync?since=v1.a');
    expect(x).toBe(y);
    expect(svc.getCustomerById('b')?.name).toBe('B2');

    // nothing changed: same array (no re-render of useCustomerById users)
    const before = svc.loadCustomers();
    apiFetch.mockResolvedValueOnce({ cursor: 'v1.c', full: false, customers: [], deleted: [] });
    await svc.fetchCustomers();
    expect(svc.loadCustomers()).toBe(before);

    token = 'tok-2';
    apiFetch.mockResolvedValueOnce({ cursor: 'v1.d', full: true, customers: [row('z', 'Z')], deleted: [] });
    expect((await svc.fetchCustomers()).map((c) => c.id)).toEqual(['z']);
    expect(apiFetch).toHaveBeenLastCalledWith('/customers/sync');
  });

  it('a bad response throws and keeps the list', async () => {
    const svc = await import('@/lib/customer-service');
    apiFetch.mockResolvedValueOnce({ cursor: 'v1.a', full: true, customers: [row('a', 'A')], deleted: [] });
    await svc.fetchCustomers();
    apiFetch.mockResolvedValueOnce({ nope: true });
    await expect(svc.fetchCustomers()).rejects.toThrow();
    expect(svc.loadCustomers().map((c) => c.id)).toEqual(['a']);
  });
});
