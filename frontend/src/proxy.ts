import { NextResponse, type NextRequest } from 'next/server';

/**
 * `/api` is rewritten to the backend on 127.0.0.1:3001 (next.config.ts). That rewrite forwards
 * only `x-forwarded-host`, so the backend saw every terminal as 127.0.0.1 (store monitor showed
 * the server's address for every machine). Pass the caller's address on as `x-forwarded-for`;
 * the backend trusts it only because the request reaches it from localhost (this server).
 */
export function proxy(request: NextRequest) {
  const clientIp = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim();
  if (!clientIp) return NextResponse.next();
  const headers = new Headers(request.headers);
  headers.set('x-forwarded-for', clientIp);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ['/api/:path*'],
};
