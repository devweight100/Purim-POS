/** Tunnel isolation rules (online shop). Runs under backend jest and frontend vitest (the Next proxy uses them). */
import { cleanPath, isPublicHeaders, parseHosts, publicApiAllowed, publicPathAllowed } from '../src/public-exposure';

const headers = (h: Record<string, string>) => (n: string) => h[n];

describe('public exposure', () => {
  it('a request is public when it carries the gateway mark, a Cloudflare header or the shop host name', () => {
    const hosts = parseHosts(' Shop.Example.com ,www.shop.example.com');
    expect(hosts).toEqual(['shop.example.com', 'www.shop.example.com']);
    expect(isPublicHeaders(headers({ host: '192.168.1.5:3000' }), hosts)).toBe(false);
    expect(isPublicHeaders(headers({ host: 'localhost:3000', 'x-forwarded-for': '10.0.0.2' }), [])).toBe(false);
    for (const h of [{ 'x-purim-public': '1' }, { 'cf-ray': 'x' }, { 'cf-connecting-ip': '1.1.1.1' }, { 'cf-visitor': '{}' }, { 'cf-ipcountry': 'TH' }, { 'cdn-loop': 'cloudflare' }]) {
      expect(isPublicHeaders(headers(h), [])).toBe(true);
    }
    expect(isPublicHeaders(headers({ host: 'shop.example.com:443' }), hosts)).toBe(true);
    expect(isPublicHeaders(headers({ host: 'localhost', 'x-forwarded-host': 'www.shop.example.com' }), hosts)).toBe(true);
  });
  it('public requests reach only the shop page, its API and static files', () => {
    expect(['/shop', '/shop/orders/1', '/api/public/shop/products?q=a', '/_next/static/css/a.css', '/icon.svg'].every(publicPathAllowed)).toBe(true);
    expect(['/', '/pos', '/m', '/login', '/api/auth/login', '/api/public/shop', '/api/public/shop/..%2Fx', '/_next/image', '/manifest.webmanifest'].some(publicPathAllowed)).toBe(false);
    expect(publicApiAllowed('/api/public/shop/config')).toBe(true);
    expect(publicApiAllowed('/shop')).toBe(false);
    expect(cleanPath('/a%ZZ')).toBe('');
  });
  it('the LINE webhook (Round B): exactly /api/public/line/webhook, nothing next to it', () => {
    expect(publicApiAllowed('/api/public/line/webhook')).toBe(true);
    expect(publicPathAllowed('/api/public/line/webhook')).toBe(true);
    expect(['/api/public/line', '/api/public/line/webhook/', '/api/public/line/webhook2', '/api/public/line/x', '/api/public/line/%2E%2E/webhook'].some(publicPathAllowed)).toBe(false);
  });
});
