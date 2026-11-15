import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BUG-01 (v1.5.3): a sale must never wait forever (greyed-out confirm button, no message) when the order outbox is
 * held by someone else; it reports instead, and work that has started is never cut short.
 */
const saved: unknown[] = [];
vi.mock('@/lib/offline-db', () => ({
  getPendingOfflineOrders: vi.fn(async () => []),
  saveOfflineOrder: vi.fn(async (o: unknown) => { saved.push(o); }),
  removeOfflineOrder: vi.fn(async () => undefined),
}));
const apiFetch = vi.fn();
vi.mock('@/lib/api', () => ({ apiFetch: (...a: unknown[]) => apiFetch(...a), getAuthToken: () => 'token' }));
vi.mock('sonner', () => ({ toast: { warning: vi.fn(), success: vi.fn() } }));

type LockCb = () => Promise<unknown>;
let held: Promise<void> | null = null;
let release: (() => void) | null = null;

beforeEach(() => {
  saved.length = 0;
  apiFetch.mockReset();
  held = new Promise<void>((r) => { release = r; });
  // a lock that another tab holds until release()
  const locks = {
    request: (_name: string, a: unknown, b?: unknown) => {
      const opts = (typeof a === 'function' ? {} : a) as { signal?: AbortSignal };
      const cb = (typeof a === 'function' ? a : b) as LockCb;
      return new Promise((resolve, reject) => {
        opts.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        void held!.then(() => cb().then(resolve, reject));
      });
    },
  };
  vi.stubGlobal('navigator', { locks });
  vi.stubGlobal('localStorage', { getItem: () => JSON.stringify({ state: { user: { id: 'u1' } } }) });
  vi.stubGlobal('window', {});
});
afterEach(() => {
  release?.();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const order = { clientOrderId: 'op-1', shiftId: 's1', items: [], payments: [] };

describe('submitOrder', () => {
  it('reports "busy" after the wait limit instead of hanging, and saves nothing', async () => {
    vi.useFakeTimers();
    const { submitOrder, CHECKOUT_LOCK_WAIT_MS } = await import('@/lib/order-sync-service');
    const p = submitOrder(order as never);
    const settled = expect(p).rejects.toThrow('ระบบกำลังส่งบิลค้างอยู่');
    await vi.advanceTimersByTimeAsync(CHECKOUT_LOCK_WAIT_MS + 10);
    await settled;
    expect(saved).toEqual([]);
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('saves normally once the lock is free in time', async () => {
    const { submitOrder } = await import('@/lib/order-sync-service');
    apiFetch.mockResolvedValue({ id: 'o1', orderNumber: 'ORD-1' });
    const p = submitOrder({ ...order, clientOrderId: 'op-2' } as never);
    release!();
    await expect(p).resolves.toMatchObject({ id: 'o1', orderNumber: 'ORD-1' });
  });
});
