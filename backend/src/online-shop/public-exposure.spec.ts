import * as http from 'http';
import { cleanPath, isPublicRequest, publicApiAllowed, publicPathAllowed, startShopGateway } from './public-exposure';
import { issueSession, RateLimiter, readSession } from './shop-session';
import { qrPng } from './qr-png';

describe('public exposure rules', () => {
  it('detects tunnel requests (fail closed)', () => {
    expect(isPublicRequest({})).toBe(false);
    expect(isPublicRequest({ host: '192.168.1.10:3000', 'x-forwarded-for': '192.168.1.20' })).toBe(false);
    expect(isPublicRequest({ 'cf-ray': 'abc' })).toBe(true);
    expect(isPublicRequest({ 'cf-connecting-ip': '1.2.3.4' })).toBe(true);
    expect(isPublicRequest({ 'x-purim-public': '1' })).toBe(true);
    expect(isPublicRequest({ 'cdn-loop': 'cloudflare; loops=1' })).toBe(true);
    process.env.SHOP_PUBLIC_HOST = 'shop.example.com, www.shop.example.com';
    try {
      expect(isPublicRequest({ host: 'SHOP.example.com:443' })).toBe(true);
      expect(isPublicRequest({ 'x-forwarded-host': 'www.shop.example.com' })).toBe(true);
      expect(isPublicRequest({ host: 'localhost:3000' })).toBe(false);
    } finally {
      delete process.env.SHOP_PUBLIC_HOST;
    }
  });

  it('allows only the shop page, its API and static files', () => {
    for (const ok of ['/shop', '/shop/', '/shop/cart?x=1', '/shop/orders/abc', '/api/public/shop/config', '/_next/static/chunks/app-1.js', '/favicon.ico', '/icon.svg']) {
      expect([ok, publicPathAllowed(ok)]).toEqual([ok, true]);
    }
    for (const bad of ['/', '/pos', '/login', '/shopping', '/api/products', '/api/public/shop/', '/api/public/shopx', '/api/public/shop/../products',
      '/api/public/shop/%2e%2e/products', '/shop/..%2F..%2Fapi/products', '/_next/data/x.json', '/_next/image?url=x', '/uploads/a.png', '/api/events/stream', '/%zz']) {
      expect([bad, publicPathAllowed(bad)]).toEqual([bad, false]);
    }
    expect(publicApiAllowed('/shop')).toBe(false);
    // Round B: the LINE webhook, this exact path only
    expect(publicPathAllowed('/api/public/line/webhook')).toBe(true);
    expect(publicApiAllowed('/api/public/line/webhook')).toBe(true);
    for (const bad of ['/api/public/line', '/api/public/line/', '/api/public/line/webhook/x', '/api/public/line/webhookx', '/api/public/line/other', '/api/public/line/%2e%2e/webhook']) {
      expect([bad, publicPathAllowed(bad)]).toEqual([bad, false]);
    }
    expect(cleanPath('/a%2F..%2Fb')).toBe('');
  });
});

describe('gateway port', () => {
  let target: http.Server;
  let gw: http.Server;
  let seen: { url?: string; headers?: http.IncomingHttpHeaders } = {};
  let gwUrl = '';

  beforeAll(async () => {
    target = http.createServer((req, res) => {
      seen = { url: req.url, headers: req.headers };
      res.end('ok:' + req.url);
    });
    await new Promise<void>((r) => target.listen(0, '127.0.0.1', () => r()));
    const port = 30000 + Math.floor(Math.random() * 20000);
    gw = startShopGateway({ port, target: `http://127.0.0.1:${(target.address() as any).port}` });
    await new Promise((r) => gw.once('listening', r));
    gwUrl = `http://127.0.0.1:${port}`;
  });
  afterAll(async () => {
    await new Promise((r) => gw.close(r));
    await new Promise((r) => target.close(r));
  });

  const get = (path: string, headers: Record<string, string> = {}, method = 'GET') =>
    new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(gwUrl + path, { method, headers }, (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode || 0, body }));
      });
      req.on('error', reject);
      req.end();
    });

  it('forwards allowed paths with the public mark and the visitor address; strips client x-purim-*', async () => {
    seen = {};
    const r = await get('/shop/cart', { 'cf-connecting-ip': '203.0.113.5', 'x-purim-admin': 'yes', 'x-purim-public': '0' });
    expect(r).toEqual({ status: 200, body: 'ok:/shop/cart' });
    expect(seen.headers?.['x-purim-public']).toBe('1');
    expect(seen.headers?.['x-purim-admin']).toBeUndefined();
    expect(seen.headers?.['x-forwarded-for']).toBe('203.0.113.5');
    expect((await get('/api/public/shop/products?q=x')).status).toBe(200);
  });

  it('answers 404 itself for everything else (never reaches the server)', async () => {
    for (const p of ['/', '/pos', '/login', '/api/auth/login', '/api/products', '/uploads/x.png', '/api/public/shop/%2e%2e/auth/me']) {
      seen = {};
      expect((await get(p)).status).toBe(404);
      expect(seen.url).toBeUndefined();
    }
    expect((await get('/shop', {}, 'DELETE')).status).toBe(404);
  });
});

describe('shop session + rate limiter + QR PNG', () => {
  it('signs and checks session tokens', () => {
    const { token } = issueSession({ sub: 'U1', n: 'a' });
    expect(readSession(token)?.sub).toBe('U1');
    expect(readSession(token + 'x')).toBeNull();
    const [body, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ sub: 'U2', exp: 9999999999 })).toString('base64url');
    expect(readSession(`${forged}.${sig}`)).toBeNull();
    expect(readSession(`${body}.${sig}`, Date.now() + 8 * 86400_000)).toBeNull(); // expired after 7 days
  });
  it('limits per key and window', () => {
    const l = new RateLimiter(2, 1000);
    expect([l.take('a', 0), l.take('a', 1), l.take('a', 2), l.take('b', 2), l.take('a', 1001)]).toEqual([true, true, false, true, true]);
    expect(l.allowed('b', 3)).toBe(true);
  });
  it('makes a PNG', () => {
    const png = qrPng('hello', 2);
    expect(png.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(png.readUInt32BE(16)).toBe((21 + 8) * 2); // version 1 = 21 modules + quiet zone
  });
});
