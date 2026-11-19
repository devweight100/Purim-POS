import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decideSellingDevice, posDataPlan, type SellingDeviceInput } from '@/lib/pos-data-policy';

const dev = (o: Partial<SellingDeviceInput> = {}): SellingDeviceInput => ({
  explicit: null, isDesktop: false, desktopPosOpened: false, soldHere: false, pendingOfflineBills: 0, ...o,
});
const plan = (path: string, sellingDevice = false, productDemand = 0, customerDemand = 0) =>
  posDataPlan({ path, sellingDevice, productDemand, customerDemand });

describe('posDataPlan (should this screen keep the POS catalogue / customer list)', () => {
  it('the POS always keeps both, on any device', () => {
    expect(plan('/pos')).toEqual({ products: true, customers: true });
    expect(plan('/pos/anything')).toEqual({ products: true, customers: true });
  });

  it('a back-office screen of a device that does not sell keeps nothing', () => {
    for (const p of ['/products', '/dashboard', '/orders', '/customers', '/inventory', '/settings', '/posters', '/'])
      expect(plan(p)).toEqual({ products: false, customers: false });
  });

  it('a selling device keeps both on every back-office screen (POS instant, offline copy current)', () => {
    expect(plan('/products', true)).toEqual({ products: true, customers: true });
    expect(plan('/dashboard', true)).toEqual({ products: true, customers: true });
  });

  it('a screen that needs the whole list keeps only that part while it is open', () => {
    expect(plan('/purchase-orders', false, 1, 0)).toEqual({ products: true, customers: false });
    expect(plan('/claims', false, 0, 2)).toEqual({ products: false, customers: true });
  });

  it('the phone summary never loads them, even on a selling device', () => {
    expect(plan('/m', true, 1, 1)).toEqual({ products: false, customers: false });
    expect(plan('/m/stock', true)).toEqual({ products: false, customers: false });
  });
});

describe('decideSellingDevice', () => {
  it('a plain browser that never sold is not a selling device (logging in lands on /pos: that does not count)', () => {
    expect(decideSellingDevice(dev())).toBe(false);
    expect(decideSellingDevice(dev({ desktopPosOpened: true }))).toBe(false); // marker only counts in the desktop app
  });

  it('desktop app with a POS session -> on; desktop app that never opened the POS -> off', () => {
    expect(decideSellingDevice(dev({ isDesktop: true, desktopPosOpened: true }))).toBe(true);
    expect(decideSellingDevice(dev({ isDesktop: true }))).toBe(false);
  });

  it('a browser that completed a bill, or still has offline bills to send, sells', () => {
    expect(decideSellingDevice(dev({ soldHere: true }))).toBe(true);
    expect(decideSellingDevice(dev({ pendingOfflineBills: 2 }))).toBe(true);
  });

  it('the explicit per-device setting wins', () => {
    expect(decideSellingDevice(dev({ explicit: false, isDesktop: true, desktopPosOpened: true, soldHere: true }))).toBe(false);
    expect(decideSellingDevice(dev({ explicit: true }))).toBe(true);
    // ...except bills waiting in the outbox are never stranded: they keep syncing (outbox runs on every device) but
    // the explicit "off" still decides about the catalogue
    expect(decideSellingDevice(dev({ explicit: false, pendingOfflineBills: 3 }))).toBe(false);
  });
});

describe('storage-backed answer', () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    vi.stubGlobal('window', { electronAPI: undefined });
  });

  it('sale on this device turns the automatic answer on; the setting overrides; demand counts per part', async () => {
    const m = await import('@/lib/pos-data-policy');
    expect(m.isSellingDevice()).toBe(false);
    m.noteSoldHere();
    expect(m.isSellingDevice()).toBe(true);
    m.setSellingDeviceSetting(false);
    expect(m.isSellingDevice()).toBe(false);
    expect(m.automaticSellingDevice()).toBe(true);
    m.setSellingDeviceSetting(null);
    expect(m.sellingDeviceSetting()).toBeNull();
    const release = m.acquirePosData({ products: true });
    expect(m.posDataDemand()).toEqual({ products: 1, customers: 0 });
    release();
    release(); // twice = once
    expect(m.posDataDemand()).toEqual({ products: 0, customers: 0 });
  });

  it('desktop app: opening the POS marks the device', async () => {
    vi.stubGlobal('window', { electronAPI: { isDesktop: true } });
    const m = await import('@/lib/pos-data-policy');
    m.setSellingDeviceSetting(null);
    expect(m.isSellingDevice()).toBe(false);
    m.notePosOpened();
    expect(m.isSellingDevice()).toBe(true);
  });
});
