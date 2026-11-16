import { NextResponse, type NextRequest } from 'next/server';
import { isPublicHeaders, parseHosts, publicPathAllowed } from '@shared/public-exposure';

/**
 * 1. Online shop isolation (docs/online-shop.md): a request that came through the Cloudflare Tunnel (gateway
 *    mark, Cloudflare headers or the shop's public host name SHOP_PUBLIC_HOST) may only reach the shop page, its
 *    public API and the static files it needs; anything else is 404 before any page or rewrite runs. The backend
 *    checks /api again on its side.
 * 2. `/api` is rewritten to the backend on 127.0.0.1:3001 (next.config.ts). That rewrite forwards only
 *    `x-forwarded-host`, so the backend saw every terminal as 127.0.0.1 (store monitor showed the server's address
 *    for every machine). Pass the caller's address on as `x-forwarded-for`; the backend trusts it only because the
 *    request reaches it from localhost (this server).
 */
export function proxy(request: NextRequest) {
  const isPublic = isPublicHeaders((n) => request.headers.get(n), parseHosts(process.env.SHOP_PUBLIC_HOST));
  const path = request.nextUrl.pathname;
  if (isPublic && !publicPathAllowed(path + request.nextUrl.search)) {
    return new NextResponse('Not Found', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  }
  if (!path.startsWith('/api/')) return NextResponse.next();
  const clientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (!clientIp) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-for', clientIp);
  return NextResponse.next({ request: { headers } });
}

// No matcher: the proxy runs for every request (public ones must be checked everywhere, static files included).
