/**
 * Online shop (LINE LIFF) rules shared by the server (order prices, delivery fee) and the screens
 * (shop page, back-office online orders). Pure functions, no dependencies. docs/online-shop.md.
 */
import { round2 } from './money';
import { pickLevelPrice, productUnitPrices, type PriceLevel } from './price-level';

export { PRICE_LEVELS, DEFAULT_LEVEL_NAMES, normalizeLevel, levelNames } from './price-level';
export type { PriceLevel } from './price-level';

type Money = number | string | null | undefined | { toString(): string };

export interface ShopProductPrices {
  basePrice: Money;
  priceLevel1?: Money;
  priceLevel2?: Money;
  priceLevel3?: Money;
  priceLevel4?: Money;
  priceLevel5?: Money;
  /** base unit name (ชิ้น) */
  unit?: string | null;
}

export interface ShopPackPrices {
  id: string;
  name: string;
  /** how many of the previous unit make one of this unit (packaging units in sort order) */
  qtyPerPrev: number;
  priceLevel1?: Money;
  priceLevel2?: Money;
  priceLevel3?: Money;
  priceLevel4?: Money;
  priceLevel5?: Money;
}

export interface ShopUnitOption {
  /** packaging unit id; null = base unit */
  id: string | null;
  name: string;
  /** base units in one of this unit */
  factor: number;
  price: number;
  /**
   * true when `price` is the price of the requested level; false when the level has no price for this unit and
   * another level's price is used (shared pickLevelPrice). Always true at level 1. Display only (the shop says
   * "ราคาปลีก · สินค้านี้ยังไม่มี<ชื่อระดับ>" to a member, docs/bugfix-member-price.md).
   */
  atLevel: boolean;
}

/**
 * Units a customer can order and their price at `level`: the shared price-level rule (shared/src/price-level.ts,
 * the same one the POS and the checkout use). Units without any price are left out. Packs of size 1 are skipped.
 */
export function shopUnits(product: ShopProductPrices, packs: ShopPackPrices[], level: PriceLevel): ShopUnitOption[] {
  const out: ShopUnitOption[] = [];
  for (const u of productUnitPrices(product, packs)) {
    if (u.packIndex >= 0 && u.factor === 1) continue; // same size as the base unit
    const pick = pickLevelPrice(u.candidates, level);
    if (!pick) continue;
    out.push({ id: u.id, name: u.packIndex < 0 ? product.unit || 'ชิ้น' : u.name || 'หน่วย', factor: u.factor, price: pick.price, atLevel: level === 1 || pick.level === level });
  }
  return out;
}

export type Fulfillment = 'PICKUP' | 'DELIVERY';

/** Delivery fee typed by staff / stored on a customer: null = not set; throws message on bad input. */
export function parseDeliveryFee(raw: unknown): { ok: true; value: number | null } | { ok: false; error: string } {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
  if (typeof raw === 'boolean' || !Number.isFinite(n) || n < 0 || n > 10000) return { ok: false, error: 'ค่าส่งต้องเป็นตัวเลข 0 - 10,000 บาท' };
  if (Math.abs(n * 100 - Math.round(n * 100)) > 1e-6) return { ok: false, error: 'ค่าส่งมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' };
  return { ok: true, value: round2(n) };
}

/**
 * Fee of a new order: pickup = 0; delivery = the linked member's fee (customers.profile.deliveryFee),
 * null when unknown (guest / member without a fee) -> "ร้านจะแจ้งค่าส่ง", staff sets it when accepting.
 */
export function deliveryFeeFor(fulfillment: Fulfillment, memberFee: unknown): number | null {
  if (fulfillment === 'PICKUP') return 0;
  const f = parseDeliveryFee(memberFee);
  return f.ok ? f.value : null;
}

export interface OnlineLine {
  quantity: number;
  unitPrice: number;
}

export function onlineLineTotal(l: OnlineLine): number {
  return round2(Number(l.quantity) * Number(l.unitPrice));
}

/** Order totals; the grand total leaves out a fee the shop has not told yet (feePending). */
export function onlineOrderTotals(lines: OnlineLine[], deliveryFee: number | null) {
  const subtotal = round2(lines.reduce((s, l) => s + onlineLineTotal(l), 0));
  const fee = deliveryFee === null || deliveryFee === undefined ? null : round2(Number(deliveryFee));
  return { subtotal, deliveryFee: fee, feePending: fee === null, total: round2(subtotal + (fee ?? 0)) };
}

/** Limits of one order placed from the shop page (checked by the server). */
export const ONLINE_LIMITS = {
  maxLines: 60,
  maxQtyPerLine: 9999,
  maxTotal: 500_000,
  /** orders still waiting for the shop (ใหม่) per LINE account */
  maxOpenOrders: 5,
  nameMax: 80,
  addressMax: 400,
  noteMax: 300,
} as const;

export type OnlineOrderStatus = 'NEW' | 'ACCEPTED' | 'PREPARING' | 'READY' | 'DELIVERING' | 'DONE' | 'CANCELLED';

/** Accepted and not closed: can be opened as a POS bill and paid (by any cashier; the claim lock is for picking only). */
export const ONLINE_PAYABLE_STATUSES: readonly OnlineOrderStatus[] = ['ACCEPTED', 'PREPARING', 'READY', 'DELIVERING'];
/** Open orders (staff list "open", claimable). */
export const ONLINE_OPEN_STATUSES: readonly OnlineOrderStatus[] = ['NEW', ...ONLINE_PAYABLE_STATUSES];
/** Statuses from which "จัดของเสร็จ" (mark picked) is allowed. */
export const ONLINE_PICKABLE_STATUSES: readonly OnlineOrderStatus[] = ['ACCEPTED', 'PREPARING'];

export const ONLINE_STATUS_LABELS: Record<OnlineOrderStatus, string> = {
  NEW: 'ใหม่',
  ACCEPTED: 'รับแล้ว',
  PREPARING: 'กำลังเตรียมของ',
  READY: 'จัดเสร็จ รอรับเงิน/รอส่ง',
  DELIVERING: 'กำลังไปส่ง',
  DONE: 'เสร็จแล้ว',
  CANCELLED: 'ยกเลิก',
};

/** What the customer sees for each status (plain words). */
export const ONLINE_STATUS_CUSTOMER: Record<OnlineOrderStatus, string> = {
  NEW: 'ร้านได้รับออเดอร์แล้ว รอร้านยืนยัน',
  ACCEPTED: 'ร้านยืนยันแล้ว',
  PREPARING: 'ร้านกำลังจัดของ',
  READY: 'จัดของเสร็จแล้ว',
  DELIVERING: 'กำลังนำของไปส่ง',
  DONE: 'เรียบร้อยแล้ว',
  CANCELLED: 'ยกเลิกแล้ว',
};

/**
 * Status changes staff may make with the status buttons (accept / reject / "จัดของเสร็จ" -> READY have their own
 * actions). Flow: NEW -> ACCEPTED -> (PREPARING) -> READY -> (DELIVERING) -> DONE, CANCELLED from any open status.
 */
export function nextStatuses(status: OnlineOrderStatus, fulfillment: Fulfillment): OnlineOrderStatus[] {
  switch (status) {
    case 'ACCEPTED':
      return fulfillment === 'DELIVERY' ? ['PREPARING', 'DELIVERING', 'DONE', 'CANCELLED'] : ['PREPARING', 'DONE', 'CANCELLED'];
    case 'PREPARING':
    case 'READY':
      return fulfillment === 'DELIVERY' ? ['DELIVERING', 'DONE', 'CANCELLED'] : ['DONE', 'CANCELLED'];
    case 'DELIVERING':
      return ['DONE', 'CANCELLED'];
    default:
      return [];
  }
}

/** Thai mobile / phone typed by a customer -> digits only (9-10 digits starting with 0), else null. */
export function normalizeThaiPhone(raw: unknown): string | null {
  let d = String(raw ?? '').replace(/[\s\-().]/g, '');
  if (d.startsWith('+66')) d = '0' + d.slice(3);
  else if (d.startsWith('66') && d.length === 11) d = '0' + d.slice(2);
  return /^0\d{8,9}$/.test(d) ? d : null;
}
