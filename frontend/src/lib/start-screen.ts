/**
 * Start screen (/start) after logging in and when the program opens with a session:
 * two big buttons "หน้าขาย (POS)" and "หลังบ้าน" (docs/round-start-dashboard.md).
 */
import { backOfficeHomeFor, canAccessRoute, type PermissionUser } from './permissions';

export const START_PATH = '/start';

export interface StartChoices {
  /** may open the POS */
  pos: boolean;
  /** first back-office page this user may open (the POS "เมนูหลัก" logic), null = no back office */
  backOffice: string | null;
}

/**
 * What the start screen offers this user.
 * Back office = some back-office page beyond the bills / customers / shifts lists that POS_SELL alone opens
 * (those are part of the cashier's own work and stay reachable from the POS "เมนูหลัก" button). A cashier with
 * only POS_SELL (+ POS_DISCOUNT) therefore has the POS only; a cashier who also handles claims, stock, reports,
 * debts ... gets both buttons, and "หลังบ้าน" opens backOfficeHomeFor(user) (the first page they may use).
 */
export function startChoices(user: PermissionUser | null | undefined): StartChoices {
  const pos = canAccessRoute(user, '/pos');
  const home = backOfficeHomeFor(user);
  if (!home || !user) return { pos, backOffice: home };
  if (user.role === 'ADMIN') return { pos, backOffice: home };
  const perms = Array.isArray(user.permissions) ? user.permissions : [];
  if (perms.includes('ALL')) return { pos, backOffice: home };
  const withoutPos = { ...user, permissions: perms.filter((p) => p !== 'POS_SELL') };
  return { pos, backOffice: backOfficeHomeFor(withoutPos) ? home : null };
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
  | { kind: 'go'; to: string; reason: 'only-pos' | 'only-backoffice' | 'offline' | 'asked' | 'nothing' }
  | { kind: 'choose'; recommended: StartChoice };

/**
 * Go straight to a page, or show the two buttons.
 * - one option only -> that page (POS-only cashier -> POS; no POS -> back office);
 * - a selling device that cannot reach the server -> POS (offline selling is never behind the chooser);
 * - ?go= names an allowed option -> that page;
 * - otherwise the chooser; the button that matches the device setting is pre-selected (focused): a device set to
 *   "ไม่ใช้ขาย" -> หลังบ้าน, anything else -> หน้าขาย. The setting never skips the chooser by itself.
 */
export function startDecision(choices: StartChoices, ctx: StartContext): StartDecision {
  if (!choices.pos && !choices.backOffice) return { kind: 'go', to: '/pos', reason: 'nothing' };
  if (choices.pos && !choices.backOffice) return { kind: 'go', to: '/pos', reason: 'only-pos' };
  if (!choices.pos && choices.backOffice) return { kind: 'go', to: choices.backOffice, reason: 'only-backoffice' };
  if (ctx.offline && ctx.sellingDevice) return { kind: 'go', to: '/pos', reason: 'offline' };
  if (ctx.go === 'pos') return { kind: 'go', to: '/pos', reason: 'asked' };
  if (ctx.go === 'backoffice') return { kind: 'go', to: choices.backOffice!, reason: 'asked' };
  return { kind: 'choose', recommended: ctx.sellingSetting === false ? 'backoffice' : 'pos' };
}

/** "ผู้ดูแลระบบ" / "ผู้จัดการ" / "แคชเชียร์" */
export function roleLabel(role?: string | null): string {
  if (role === 'ADMIN') return 'ผู้ดูแลระบบ';
  if (role === 'MANAGER') return 'ผู้จัดการ';
  if (role === 'CASHIER') return 'แคชเชียร์';
  return role || '';
}
