import { createHmac, timingSafeEqual } from 'crypto';
import { getJwtSecret } from '../auth/jwt-secret';

/**
 * Shop session tokens (not staff JWTs): `<base64url payload>.<base64url HMAC>` signed with a key derived from
 * the server secret. Payload: { sub: LINE user id, n: display name, p: picture, dev: test profile, exp }.
 */
export interface ShopSession {
  sub: string;
  n?: string;
  p?: string;
  dev?: boolean;
  exp: number;
}

export const SESSION_DAYS = 7;
const key = () => createHmac('sha256', getJwtSecret()).update('purim-online-shop-session-v1').digest();
const b64 = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export function signValue(text: string): string {
  return createHmac('sha256', key()).update(text).digest('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function issueSession(s: Omit<ShopSession, 'exp'>, now = Date.now()): { token: string; expiresAt: string } {
  const exp = Math.floor(now / 1000) + SESSION_DAYS * 86400;
  const body = b64(JSON.stringify({ ...s, exp }));
  return { token: `${body}.${signValue(body)}`, expiresAt: new Date(exp * 1000).toISOString() };
}

export function readSession(token: unknown, now = Date.now()): ShopSession | null {
  if (typeof token !== 'string' || token.length > 2000) return null;
  const [body, sig, extra] = token.split('.');
  if (!body || !sig || extra !== undefined || !safeEqual(sig, signValue(body))) return null;
  try {
    const s = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as ShopSession;
    if (typeof s.sub !== 'string' || !s.sub || typeof s.exp !== 'number' || s.exp * 1000 < now) return null;
    return s;
  } catch {
    return null;
  }
}

/** Simple fixed-window rate limiter (in memory, one backend process). */
export class RateLimiter {
  private hits = new Map<string, { n: number; until: number }>();
  constructor(private readonly max: number, private readonly windowMs: number) {}

  /** true = one more would be allowed (does not count) */
  allowed(key: string, now = Date.now()): boolean {
    const cur = this.hits.get(key);
    return !cur || cur.until <= now || cur.n < this.max;
  }

  /** true = allowed */
  take(key: string, now = Date.now()): boolean {
    if (this.hits.size > 20000) {
      for (const [k, v] of this.hits) if (v.until <= now) this.hits.delete(k);
      if (this.hits.size > 20000) this.hits.clear();
    }
    const cur = this.hits.get(key);
    if (!cur || cur.until <= now) {
      this.hits.set(key, { n: 1, until: now + this.windowMs });
      return true;
    }
    cur.n++;
    return cur.n <= this.max;
  }
}
