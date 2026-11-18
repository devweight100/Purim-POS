import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveToken } from '@/lib/shop/shop-api';
import { repriceCart, useShopCart, useShopSession } from '@/lib/shop/shop-store';

/**
 * Owner 2026-11-18: a LINE customer linked to a level-2 member still saw ราคา 1. The shop page kept the visitor
 * (`me`) and the cart prices it had when it opened. refreshMe learns the new level and re-prices the cart.
 */
const member = (level: 1 | 2) => ({ name: 'สมาชิก', level, levelName: level === 2 ? 'ราคาส่ง' : 'ราคาปลีก', deliveryFee: null });
const me = (m: ReturnType<typeof member> | null) => ({ profile: { name: 'ลูกค้า', picture: null, test: true }, member: m, contact: { name: '', phone: '', address: '' }, linkRequest: null });

let level: 1 | 2 | null = null;
const calls: string[] = [];

beforeEach(() => {
  calls.length = 0;
  level = null;
  saveToken('t', new Date(Date.now() + 86_400_000).toISOString());
  useShopCart.setState({ lines: [{ productId: 'p', unitId: null, name: 'ปูน', unitName: 'ถุง', price: 200, imageUrl: null, quantity: 2 }] });
  useShopSession.setState({ status: 'ready', me: me(null) });
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    calls.push(String(url).replace('/api/public/shop', ''));
    const body = String(url).endsWith('/me')
      ? me(level ? member(level) : null)
      : { lines: [{ productId: 'p', unitId: null, ok: true, quantity: 2, unitPrice: level === 2 ? 180 : 200, total: 0, problem: null }], subtotal: 0, deliveryFee: 0, feePending: false, total: 0, fulfillment: 'PICKUP', level: level ?? 1 };
    return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
  }));
});
afterEach(() => vi.unstubAllGlobals());

describe('shop member level', () => {
  it('refreshMe after the link is approved: member + level, cart re-priced at ราคาส่ง', async () => {
    level = 2;
    await useShopSession.getState().refreshMe();
    expect(useShopSession.getState().me?.member).toMatchObject({ level: 2, levelName: 'ราคาส่ง' });
    expect(useShopCart.getState().lines[0].price).toBe(180);
    expect(calls).toEqual(['/me', '/quote']);
  });

  it('no level change: no re-quote; level back to retail re-prices again', async () => {
    await useShopSession.getState().refreshMe();
    expect(calls).toEqual(['/me']);
    level = 2;
    await useShopSession.getState().refreshMe();
    level = 1;
    await useShopSession.getState().refreshMe();
    expect(useShopCart.getState().lines[0].price).toBe(200);
  });

  it('concurrent calls share one request; nothing before the shop is ready', async () => {
    await Promise.all([useShopSession.getState().refreshMe(), useShopSession.getState().refreshMe()]);
    expect(calls).toEqual(['/me']);
    useShopSession.setState({ status: 'loading' });
    await useShopSession.getState().refreshMe();
    expect(calls).toEqual(['/me']);
  });

  it('repriceCart on open: the stored cart takes the server prices', async () => {
    level = 2;
    await repriceCart();
    expect(useShopCart.getState().lines[0].price).toBe(180);
  });
});
