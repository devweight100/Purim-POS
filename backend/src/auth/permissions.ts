import { BadRequestException } from '@nestjs/common';

/** Every permission string the system knows (backend guards + frontend menus). */
export const KNOWN_PERMISSIONS = [
  'ALL',
  'POS_SELL',
  'POS_DISCOUNT',
  'POS_VOID',
  'VIEW_COST',
  'APPROVE_OVERRIDES',
  'MANAGE_INVENTORY',
  'MANAGE_PURCHASES',
  'MANAGE_PAYABLES',
  'MANAGE_DEBTS',
  'MANAGE_FINANCE',
  'MANAGE_CLAIMS',
  'MANAGE_USERS',
  'VIEW_REPORTS',
  'MANAGE_SETTINGS',
] as const;

export const MIN_PASSWORD_LENGTH = 6;

/** Permissions must be an array of known permission strings (deduplicated). */
export function normalizePermissions(raw: unknown): string[] {
  if (!Array.isArray(raw)) throw new BadRequestException('สิทธิ์การใช้งานต้องเป็นรายการ (array)');
  const out: string[] = [];
  for (const p of raw) {
    if (typeof p !== 'string' || !(KNOWN_PERMISSIONS as readonly string[]).includes(p)) {
      throw new BadRequestException(`ไม่รู้จักสิทธิ์ "${String(p).slice(0, 40)}"`);
    }
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

/** Whether a user (JWT user object) holds a permission; ADMIN/MANAGER and ALL hold everything. */
export function userHasPermission(user: { role?: string; permissions?: unknown } | null | undefined, perm: string) {
  if (!user) return false;
  if (user.role === 'ADMIN' || user.role === 'MANAGER') return true;
  const perms = Array.isArray(user.permissions) ? (user.permissions as unknown[]).map(String) : [];
  return perms.includes('ALL') || perms.includes(perm);
}
