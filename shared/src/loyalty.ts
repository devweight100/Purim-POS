/**
 * Member points: ONE rule for the POS, the server checkout, the customer pages and slips
 * (owner 2026-11-26, docs/round-shift-today-bundle-replace.md section 5).
 *
 * Shop-wide rate (ตั้งค่าคะแนนสะสม, store_settings.loyalty_config): every `earnBaht` baht spent earns `earnPoints`
 * points; every `redeemPoints` points give `redeemBaht` baht off; at least `minRedeemPoints` points per use (0 = no
 * minimum). A member's own rate field is used when it is set (a number > 0); a field left empty uses the shop's.
 */

export interface ShopPointRates {
  earnBaht: number;
  earnPoints: number;
  redeemPoints: number;
  redeemBaht: number;
  minRedeemPoints: number;
  enabled: boolean;
}

/** The rates the system always used when nothing was set (500 baht -> 10 points, 100 points -> 1 baht). */
export const DEFAULT_SHOP_POINT_RATES: ShopPointRates = {
  earnBaht: 500,
  earnPoints: 10,
  redeemPoints: 100,
  redeemBaht: 1,
  minRedeemPoints: 0,
  enabled: true,
};

/** A set value: a number (or numeric text) > 0. */
export function rateValue(v: unknown): number | null {
  if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
  const n = typeof v === 'number' ? v : Number(String(v).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Shop rates from store_settings.loyalty_config (keys defaultPointEarnRateBaht ...), defaults where not set. */
export function shopPointRates(config: unknown): ShopPointRates {
  const c = (config && typeof config === 'object' ? config : {}) as Record<string, unknown>;
  const d = DEFAULT_SHOP_POINT_RATES;
  const min = Number(c.minRedeemPoints);
  return {
    earnBaht: rateValue(c.defaultPointEarnRateBaht) ?? d.earnBaht,
    earnPoints: rateValue(c.defaultPointEarnUnits) ?? d.earnPoints,
    redeemPoints: rateValue(c.defaultPointRedeemRatePoints) ?? d.redeemPoints,
    redeemBaht: rateValue(c.defaultPointRedeemDiscountBaht) ?? d.redeemBaht,
    minRedeemPoints: Number.isInteger(min) && min > 0 ? min : 0,
    enabled: c.isLoyaltyEnabled !== false,
  };
}

/** Member fields (customers.profile): pointEarnRateBaht, pointEarnUnits, pointRedeemRatePoints, pointRedeemDiscountBaht. */
export interface MemberPointFields {
  pointEarnRateBaht?: unknown;
  pointEarnUnits?: unknown;
  pointRedeemRatePoints?: unknown;
  pointRedeemDiscountBaht?: unknown;
}

export interface EffectivePointRates extends ShopPointRates {
  /** which values come from the member (true) or the shop (false) */
  fromMember: { earnBaht: boolean; earnPoints: boolean; redeemPoints: boolean; redeemBaht: boolean };
}

/** The rates that apply to this member: their own field when set (> 0), else the shop's. */
export function effectivePointRates(member: MemberPointFields | null | undefined, shop: ShopPointRates = DEFAULT_SHOP_POINT_RATES): EffectivePointRates {
  const m = member || {};
  const earnBaht = rateValue(m.pointEarnRateBaht);
  const earnPoints = rateValue(m.pointEarnUnits);
  const redeemPoints = rateValue(m.pointRedeemRatePoints);
  const redeemBaht = rateValue(m.pointRedeemDiscountBaht);
  return {
    ...shop,
    earnBaht: earnBaht ?? shop.earnBaht,
    earnPoints: earnPoints ?? shop.earnPoints,
    redeemPoints: redeemPoints ?? shop.redeemPoints,
    redeemBaht: redeemBaht ?? shop.redeemBaht,
    fromMember: { earnBaht: earnBaht !== null, earnPoints: earnPoints !== null, redeemPoints: redeemPoints !== null, redeemBaht: redeemBaht !== null },
  };
}

/** Points earned on a bill total: one block of earnPoints per full earnBaht (0 when the shop turned points off). */
export function pointsForSale(totalBaht: number, r: Pick<ShopPointRates, 'earnBaht' | 'earnPoints' | 'enabled'>): number {
  if (!r.enabled || !(totalBaht > 0) || !(r.earnBaht > 0)) return 0;
  return Math.floor(totalBaht / r.earnBaht) * r.earnPoints;
}

/** Baht off for using `points` (whole redeemPoints blocks only). */
export function discountForPoints(points: number, r: Pick<ShopPointRates, 'redeemPoints' | 'redeemBaht'>): number {
  if (!(points > 0) || !(r.redeemPoints > 0)) return 0;
  return Math.round(Math.floor(points / r.redeemPoints) * r.redeemBaht * 100) / 100;
}

/** "ซื้อ 500฿ = 10 แต้ม · ใช้ 100 แต้ม = ลด 1฿" */
export function pointRatesText(r: Pick<ShopPointRates, 'earnBaht' | 'earnPoints' | 'redeemPoints' | 'redeemBaht'>): string {
  const f = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
  return `ซื้อ ${f(r.earnBaht)}฿ = ${f(r.earnPoints)} แต้ม · ใช้ ${f(r.redeemPoints)} แต้ม = ลด ${f(r.redeemBaht)}฿`;
}
