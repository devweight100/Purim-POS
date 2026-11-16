import * as http from 'http';
import type { NextFunction, Request, Response } from 'express';

/**
 * What the internet may reach through the Cloudflare Tunnel (docs/online-shop.md, "Tunnel isolation").
 *
 * A request is PUBLIC when it came through the tunnel: it carries our gateway mark (`x-purim-public`, set by
 * the gateway port cloudflared points at), any header Cloudflare adds to proxied requests, or its Host is the
 * shop's public host name (SHOP_PUBLIC_HOST). Public requests may only reach the shop page, its public API and
 * the static files the page needs. The check fails closed: a LAN request that fakes those headers only
 * restricts itself.
 */
export const PUBLIC_MARK = 'x-purim-public';
const CF_HEADERS = ['cf-ray', 'cf-connecting-ip', 'cf-visitor', 'cf-ipcountry', 'cf-worker', 'cf-access-jwt-assertion'];

type HeaderBag = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

export function publicHosts(): string[] {
  return String(process.env.SHOP_PUBLIC_HOST || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isPublicRequest(headers: HeaderBag): boolean {
  if (headers[PUBLIC_MARK] !== undefined) return true;
  for (const h of CF_HEADERS) if (headers[h] !== undefined) return true;
  if (/cloudflare/i.test(first(headers['cdn-loop']))) return true;
  const hosts = publicHosts();
  if (hosts.length) {
    const host = [first(headers['host']), first(headers['x-forwarded-host'])]
      .map((h) => h.split(',')[0].trim().toLowerCase().replace(/:\d+$/, ''));
    if (host.some((h) => h && hosts.includes(h))) return true;
  }
  return false;
}

/** Path part of a URL without query, decoded once; '' when it cannot be decoded (rejected). */
export function cleanPath(url: string): string {
  const p = String(url || '').split('?')[0].split('#')[0];
  try {
    const d = decodeURIComponent(p);
    // no traversal / backslashes / encoded slashes games
    if (d.includes('..') || d.includes('\\') || d.includes('\0')) return '';
    return d;
  } catch {
    return '';
  }
}

export const PUBLIC_API_PREFIX = '/api/public/shop/';

/** Backend: the only API paths a public request may call. */
export function publicApiAllowed(path: string): boolean {
  const p = cleanPath(path);
  return p.startsWith(PUBLIC_API_PREFIX) && p.length > PUBLIC_API_PREFIX.length;
}

/** Gateway / Next: every path the shop page needs (page, its API, static build files, icon). */
export function publicPathAllowed(path: string): boolean {
  const p = cleanPath(path);
  if (!p) return false;
  return (
    p === '/shop' ||
    p.startsWith('/shop/') ||
    publicApiAllowed(p) ||
    /^\/_next\/static\/[A-Za-z0-9._\-/~]+$/.test(p) ||
    p === '/favicon.ico' ||
    p === '/icon.svg'
  );
}

/** Express middleware: public requests reach only the public shop API; everything else is 404. */
export function publicExposureMiddleware(req: Request, res: Response, next: NextFunction) {
  if (!isPublicRequest(req.headers as HeaderBag)) return next();
  if (publicApiAllowed(req.originalUrl || req.url)) return next();
  res.status(404).json({ statusCode: 404, message: 'Not Found' });
}

/**
 * The port cloudflared points at (127.0.0.1 only). Forwards the allowed paths to the Next.js server with the
 * public mark; everything else is answered 404 here. Client-sent `x-purim-*` headers are dropped.
 */
export function startShopGateway(opts: { port: number; host?: string; target: string; log?: (m: string) => void }): http.Server {
  const target = new URL(opts.target);
  const server = http.createServer((req, res) => {
    const url = req.url || '/';
    if (!/^(GET|HEAD|POST|OPTIONS)$/.test(req.method || '') || !publicPathAllowed(url)) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const headers: http.OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.startsWith('x-purim-') || k === 'connection' || k === 'keep-alive' || k === 'upgrade') continue;
      headers[k] = v;
    }
    headers[PUBLIC_MARK] = '1';
    // the visitor's address for rate limits (Cloudflare's header; the socket is cloudflared on this PC)
    const visitor = first(req.headers['cf-connecting-ip']) || req.socket.remoteAddress || '';
    if (visitor) headers['x-forwarded-for'] = visitor;
    const upstream = http.request(
      { protocol: target.protocol, hostname: target.hostname, port: target.port, method: req.method, path: url, headers },
      (up) => {
        res.writeHead(up.statusCode || 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.setTimeout(30000, () => upstream.destroy(new Error('timeout')));
    upstream.on('error', () => {
      if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('ร้านปิดชั่วคราว กรุณาลองใหม่');
    });
    req.pipe(upstream);
  });
  server.on('clientError', (_e, socket) => socket.destroy());
  server.listen(opts.port, opts.host || '127.0.0.1', () => opts.log?.(`🛒 Online shop gateway (Cloudflare Tunnel target): http://${opts.host || '127.0.0.1'}:${opts.port}/shop`));
  server.on('error', (e) => opts.log?.(`Online shop gateway not started: ${e.message}`));
  return server;
}
