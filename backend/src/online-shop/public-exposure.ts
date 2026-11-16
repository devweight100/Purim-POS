import * as http from 'http';
import type { NextFunction, Request, Response } from 'express';

import { cleanPath, isPublicHeaders, parseHosts, PUBLIC_API_PREFIX, PUBLIC_MARK, publicApiAllowed, publicPathAllowed } from '../../../shared/src/public-exposure';

export { cleanPath, PUBLIC_API_PREFIX, PUBLIC_MARK, publicApiAllowed, publicPathAllowed };

type HeaderBag = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) || '';

/** The shop's public host names (SHOP_PUBLIC_HOST, comma separated): requests for them are public. */
export function publicHosts(): string[] {
  return parseHosts(process.env.SHOP_PUBLIC_HOST);
}

/** Came through the Cloudflare Tunnel (rules in shared/src/public-exposure.ts). */
export function isPublicRequest(headers: HeaderBag): boolean {
  return isPublicHeaders((n) => (headers[n] === undefined ? undefined : first(headers[n])), publicHosts());
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
