import { HttpException, HttpStatus } from '@nestjs/common';

const MAX_FAILURES = 5;
const WINDOW_MS = 15 * 60 * 1000;
const LOCK_MS = 15 * 60 * 1000;

type Entry = { failures: number; firstAt: number; lockedUntil: number };
const entries = new Map<string, Entry>();

/** In-memory brute-force guard for password and PIN login (single backend instance). */
export const loginThrottle = {
  assertAllowed(key: string) {
    const entry = entries.get(key);
    const now = Date.now();
    if (entry && entry.lockedUntil > now) {
      const minutes = Math.ceil((entry.lockedUntil - now) / 60000);
      throw new HttpException(`พยายามเข้าสู่ระบบผิดหลายครั้ง กรุณารอ ${minutes} นาทีแล้วลองใหม่`, HttpStatus.TOO_MANY_REQUESTS);
    }
  },
  fail(key: string) {
    const now = Date.now();
    let entry = entries.get(key);
    if (!entry || now - entry.firstAt > WINDOW_MS) entry = { failures: 0, firstAt: now, lockedUntil: 0 };
    entry.failures += 1;
    if (entry.failures >= MAX_FAILURES) {
      entry.lockedUntil = now + LOCK_MS;
      entry.failures = 0;
      entry.firstAt = now;
    }
    entries.set(key, entry);
    if (entries.size > 10000) {
      for (const [k, v] of entries) if (v.lockedUntil < now && now - v.firstAt > WINDOW_MS) entries.delete(k);
    }
  },
  succeed(key: string) {
    entries.delete(key);
  },
  reset() {
    entries.clear();
  },
};

export function clientIp(req: any): string {
  const raw = req?.ip || req?.socket?.remoteAddress || 'unknown';
  return String(raw).replace('::ffff:', '');
}
