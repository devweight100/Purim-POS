/**
 * Pure helpers of the mobile summary page (/m): pack breakdown of a stock quantity, sales period
 * chips -> /reports/dashboard query, period-over-period change, phone detection for the login redirect.
 */
import { bangkokDayKey, DAY_MS } from '@shared/bangkok-date';
import { canAccessRoute, type PermissionUser } from './permissions';
import { formatQty, roundQty } from './qty';

export const MOBILE_PATH = '/m';

export interface PackSize {
  name: string;
  /** size in base units (product of qtyPerPrev along the chain) */
  factor: number;
}

/**
 * "7 ลัง 4 ขวด": the quantity in the largest packs first, the rest in the base unit. null when the
 * product has no packs bigger than one base unit, the quantity is not positive or is smaller than the
 * smallest pack (then the base quantity alone says it all).
 */
export function packBreakdown(qty: number, baseUnit: string, packs: PackSize[] | null | undefined): string | null {
  const q = roundQty(qty);
  const sizes = (packs || []).filter((p) => p && p.name && Number(p.factor) > 1).sort((a, b) => b.factor - a.factor);
  if (!(q > 0) || sizes.length === 0 || q < sizes[sizes.length - 1].factor) return null;
  const parts: string[] = [];
  let rest = q;
  for (const p of sizes) {
    const n = Math.floor(rest / p.factor + 1e-9);
    if (n > 0) {
      parts.push(`${n.toLocaleString('en-US')} ${p.name}`);
      rest = roundQty(rest - n * p.factor);
    }
  }
  if (rest > 0) parts.push(`${formatQty(rest)} ${baseUnit}`);
  return parts.join(' ');
}

/** "88 ขวด = 7 ลัง 4 ขวด" (or "3 ขวด" when there is no breakdown). */
export function stockText(qty: number, baseUnit: string, packs: PackSize[] | null | undefined): string {
  const base = `${formatQty(qty, { grouping: true })} ${baseUnit}`;
  const br = packBreakdown(qty, baseUnit, packs);
  return br ? `${base} = ${br}` : base;
}

export type MobileRange = 'today' | 'yesterday' | '7days' | 'month';

export const MOBILE_RANGES: { key: MobileRange; label: string; compareLabel: string }[] = [
  { key: 'today', label: 'วันนี้', compareLabel: 'เทียบเมื่อวาน ณ เวลาเดียวกัน' },
  { key: 'yesterday', label: 'เมื่อวาน', compareLabel: 'เทียบวันก่อนหน้า' },
  { key: '7days', label: '7 วัน', compareLabel: 'เทียบ 7 วันก่อนหน้า' },
  { key: 'month', label: 'เดือนนี้', compareLabel: 'เทียบช่วงเดียวกันของเดือนก่อน' },
];

/**
 * GET /reports/dashboard query for a chip (the same endpoint and ranges as the back-office dashboard,
 * so the figures match): top 10 products and the previous period of the same length.
 */
export function dashboardQuery(range: MobileRange, now: number): string {
  const extra = 'top=10&compare=1';
  if (range === 'yesterday') {
    const y = bangkokDayKey(now - DAY_MS);
    return `/reports/dashboard?startDate=${y}&endDate=${y}&${extra}`;
  }
  return `/reports/dashboard?range=${range}&${extra}`;
}

/** Change in percent (1 decimal); null when there is nothing to compare with. */
export function pctChange(current: number, previous: number): number | null {
  const c = Number(current) || 0;
  const p = Number(previous) || 0;
  if (p === 0) return null;
  return Math.round(((c - p) / Math.abs(p)) * 1000) / 10;
}

export interface DeviceTraits {
  width: number;
  coarsePointer: boolean;
  canHover: boolean;
}

/** A phone: narrow screen, or a touch screen without a mouse. */
export function isPhoneDevice(d: DeviceTraits): boolean {
  return d.width < 768 || (d.coarsePointer && !d.canHover);
}

/** Traits of this browser (desktop defaults outside the browser). */
export function currentDeviceTraits(): DeviceTraits {
  if (typeof window === 'undefined') return { width: 1366, coarsePointer: false, canHover: true };
  const mq = (q: string) => (typeof window.matchMedia === 'function' ? window.matchMedia(q).matches : false);
  return { width: window.innerWidth, coarsePointer: mq('(pointer: coarse)'), canHover: mq('(hover: hover)') };
}

/** Where to go after logging in: phones of users who may see the summary go to /m, everything else to the POS. */
export function homePathFor(user: PermissionUser | null | undefined, device: DeviceTraits = currentDeviceTraits()): string {
  if (user && isPhoneDevice(device) && canAccessRoute(user, MOBILE_PATH)) return MOBILE_PATH;
  return '/pos';
}
