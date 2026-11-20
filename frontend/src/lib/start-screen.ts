/**
 * Start screen (/start) after logging in and when the program opens with a session:
 * two big buttons "หน้าขาย (POS)" and "หลังบ้าน" (docs/round-start-dashboard.md).
 */
import { backOfficeHomeFor, canAccessRoute, ROUTE_PERMISSIONS, type PermissionUser } from './permissions';

export const START_PATH = '/start';

export interface StartChoices {
  /** may open the POS */
  pos: boolean;
  /** first back-office page this user may open (the POS "เมนูหลัก" logic), null = no back office */
  backOffice: string | null;
}

/** Not back-office pages: the POS itself, the store monitor, the phone summary. */
const NOT_BACK_OFFICE = new Set(['/pos', '/monitor', '/m']);

/**
 * First back-office page: the POS "เมนูหลัก" home (dashboard, products, bills ...); a user who may open none of
 * those (e.g. a manager for settings / users only) gets the first other page they may open, settings first.
 */
export function firstBackOfficePage(user: PermissionUser | null | undefined): string | null {
  const home = backOfficeHomeFor(user);
  if (home) return home;
  const rest = ['/settings', '/users', ...Object.keys(ROUTE_PERMISSIONS)].filter((r) => !NOT_BACK_OFFICE.has(r));
  return rest.find((r) => canAccessRoute(user, r)) ?? null;
}

/**
 * What the start screen offers this user.
 * Back office = some back-office page beyond the bills / customers / shifts lists that POS_SELL alone opens
 * (those are part of the cashier's own work and stay reachable from the POS "เมนูหลัก" button). A cashier with
 * only POS_SELL (+ POS_DISCOUNT) therefore has the POS only; a cashier who also handles claims, stock, reports,
 * debts ... gets both buttons, and "หลังบ้าน" opens firstBackOfficePage(user) (the first page they may use).
 * Without a back office the start screen still shows "หลังบ้าน", disabled ("ไม่มีสิทธิ์เข้าหลังบ้าน").
 */
export function startChoices(user: PermissionUser | null | undefined): StartChoices {
  const pos = canAccessRoute(user, '/pos');
  const home = firstBackOfficePage(user);
  if (!home || !user) return { pos, backOffice: home };
  if (user.role === 'ADMIN') return { pos, backOffice: home };
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('ALL')) return { pos, backOffice: home };
  const withoutPos = { ...user, permissions: perms.filter((p) => p !== 'POS_SELL') };
  return { pos, backOffice: firstBackOfficePage(withoutPos) ? home : null };
}

export type StartChoice = 'pos' | 'backoffice';

export interface StartContext {
  /** this device keeps the POS data for offline selling (pos-data-policy isSellingDevice) */
  sellingDevice: boolean;
  /** the per-device setting "ใช้ขายหน้าร้าน": true / false / null = automatic */
  sellingSetting: boolean | null;
  /** the server cannot be reached (browser offline or the server did not answer) */
  offline: boolean;
  /** ?go=pos | ?go=backoffice (desktop F2, links) */
  go?: string | null;
}

export type StartDecision =
  | { kind: 'go'; to: string; reason: 'offline' | 'asked' }
  | { kind: 'choose'; recommended: StartChoice };

/**
 * Go straight to a page, or show the two buttons (owner 2026-11-20: the chooser is ALWAYS shown, also to a
 * cashier who may only sell; rights to the back office may be granted later, and a button the user may not
 * use is shown disabled with the reason, so it simply becomes active once the right is granted).
 * - a selling device that cannot reach the server -> POS (offline selling is never behind the chooser);
 * - ?go= names an allowed option -> that page (desktop F2);
 * - otherwise the chooser. Pre-selected (focused): the only allowed option; with both allowed the one that
 *   matches the device setting ("ไม่ใช้ขาย" -> หลังบ้าน, anything else -> หน้าขาย).
 */
export function startDecision(choices: StartChoices, ctx: StartContext): StartDecision {
  if (ctx.offline && ctx.sellingDevice && choices.pos) return { kind: 'go', to: '/pos', reason: 'offline' };
  if (ctx.go === 'pos' && choices.pos) return { kind: 'go', to: '/pos', reason: 'asked' };
  if (ctx.go === 'backoffice' && choices.backOffice) return { kind: 'go', to: choices.backOffice, reason: 'asked' };
  if (!choices.pos && choices.backOffice) return { kind: 'choose', recommended: 'backoffice' };
  if (choices.pos && !choices.backOffice) return { kind: 'choose', recommended: 'pos' };
  return { kind: 'choose', recommended: ctx.sellingSetting === false ? 'backoffice' : 'pos' };
}

/** Shown on a disabled start button. */
export const NO_BACK_OFFICE_TEXT = 'ไม่มีสิทธิ์เข้าหลังบ้าน';
export const NO_POS_TEXT = 'ไม่มีสิทธิ์ใช้หน้าขาย';

/** "ผู้ดูแลระบบ" / "ผู้จัดการ" / "แคชเชียร์" */
export function roleLabel(role?: string | null): string {
  if (role === 'ADMIN') return 'ผู้ดูแลระบบ';
  if (role === 'MANAGER') return 'ผู้จัดการ';
  if (role === 'CASHIER') return 'แคชเชียร์';
  return role || '';
}
