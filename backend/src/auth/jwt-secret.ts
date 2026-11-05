import { randomBytes } from 'crypto';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const WEAK_SECRETS = new Set(['fallback_secret', 'secret', 'changeme', 'jwt_secret']);
let cached: string | null = null;

/**
 * Resolve the JWT signing secret.
 * 1. JWT_SECRET from the environment (must be >= 32 chars and not a known placeholder).
 * 2. Otherwise a random secret persisted in `<backend>/.jwt-secret`, generated on first start,
 *    so desktop installs work without manual setup but never share a guessable secret.
 */
export function getJwtSecret(): string {
  if (cached) return cached;
  const fromEnv = (process.env.JWT_SECRET || '').trim();
  if (fromEnv) {
    if (fromEnv.length < 32 || WEAK_SECRETS.has(fromEnv.toLowerCase())) {
      throw new Error('JWT_SECRET ไม่ปลอดภัย: ต้องยาวอย่างน้อย 32 ตัวอักษรและไม่ใช่ค่าตัวอย่าง');
    }
    cached = fromEnv;
    return cached;
  }
  const file = process.env.JWT_SECRET_FILE || join(process.cwd(), '.jwt-secret');
  if (existsSync(file)) {
    const stored = readFileSync(file, 'utf8').trim();
    if (stored.length >= 32) {
      cached = stored;
      return cached;
    }
  }
  const generated = randomBytes(48).toString('hex');
  writeFileSync(file, generated, { encoding: 'utf8', mode: 0o600 });
  console.warn(`[auth] ไม่ได้ตั้ง JWT_SECRET จึงสร้าง secret แบบสุ่มไว้ที่ ${file}`);
  cached = generated;
  return cached;
}
