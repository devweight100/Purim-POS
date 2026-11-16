/**
 * What the internet may reach through the Cloudflare Tunnel (online shop). Used by the backend (middleware +
 * gateway port) and the Next.js proxy. docs/online-shop.md "Tunnel isolation".
 *
 * A request is PUBLIC when it came through the tunnel: it carries our gateway mark (`x-purim-public`), any header
 * Cloudflare adds to proxied requests, or its Host is one of the shop's public host names. Public requests may
 * only reach the shop page, its public API and the static files the page needs. Fail closed: a LAN request that
 * fakes those headers only restricts itself.
 */
export const PUBLIC_MARK = 'x-purim-public';
export const CF_HEADERS = ['cf-ray', 'cf-connecting-ip', 'cf-visitor', 'cf-ipcountry', 'cf-worker', 'cf-access-jwt-assertion'];
export const PUBLIC_API_PREFIX = '/api/public/shop/';

/** Reads a header (lower-case name); '' when missing. */
export type HeaderGet = (name: string) => string | null | undefined;

export function parseHosts(raw: string | null | undefined): string[] {
  return String(raw || '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
}

export function isPublicHeaders(get: HeaderGet, publicHosts: string[]): boolean {
  const has = (n: string) => {
    const v = get(n);
    return v !== null && v !== undefined;
  };
  if (has(PUBLIC_MARK)) return true;
  for (const h of CF_HEADERS) if (has(h)) return true;
  if (/cloudflare/i.test(get('cdn-loop') || '')) return true;
  if (publicHosts.length) {
    const hosts = [get('host') || '', get('x-forwarded-host') || ''].map((h) => h.split(',')[0].trim().toLowerCase().replace(/:\d+$/, ''));
    if (hosts.some((h) => h && publicHosts.includes(h))) return true;
  }
  return false;
}

/** Path part of a URL without query, decoded once; '' when it cannot be decoded or looks like traversal. */
export function cleanPath(url: string): string {
  const p = String(url || '').split('?')[0].split('#')[0];
  try {
    const d = decodeURIComponent(p);
    if (d.includes('..') || d.includes('\\') || d.includes('\0')) return '';
    return d;
  } catch {
    return '';
  }
}

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
    /^\/_next\/static\/[A-Za-z0-9._\-/~[\]()@+]+$/.test(p) ||
    p === '/favicon.ico' ||
    p === '/icon.svg'
  );
}
