/**
 * Quantity arithmetic (stock, sales, purchases, returns, claims) shared by the server and the
 * screens. Quantities are DECIMAL(12,2): up to 2 decimals when the store turns on
 * StoreSettings.allowDecimalQty. All maths works in whole hundredths so FIFO deductions and unit
 * conversions never leave 0.0000001 residues.
 *
 * Input validation that needs the framework stays next to it: backend/src/common/qty.ts (400
 * errors) and frontend/src/lib/qty.ts (what the user typed, React hook).
 */
export const MAX_QTY = 10_000_000;
export const DECIMAL_QTY_DISABLED = 'ร้านไม่ได้เปิดใช้จำนวนทศนิยม';

/** Prisma Decimal / string / number / null -> number (null, NaN, Infinity -> 0). */
export const qn = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v as any);
  return Number.isFinite(n) ? n : 0;
};

/** Whole hundredths of a quantity (1.25 -> 125), safe against float noise. */
export const toHund = (v: unknown): number => {
  const n = qn(v);
  return Math.round(n * 100 + (n >= 0 ? 1e-7 : -1e-7));
};
export const fromHund = (h: number): number => h / 100;
/** Round to 2 decimals without float residue. */
export const roundQty = (v: unknown): number => fromHund(toHund(v));
/** a + b + ..., a - b, a x factor (pack size) rounded to 2 decimals. */
export const addQty = (...vals: unknown[]): number => fromHund(vals.reduce<number>((s, v) => s + toHund(v), 0));
export const subQty = (a: unknown, b: unknown): number => fromHund(toHund(a) - toHund(b));
export const mulQty = (a: unknown, factor: unknown): number => roundQty(qn(a) * qn(factor));

/** True when n has at most 2 decimals. */
export const hasMax2Decimals = (n: number): boolean => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
export const isWholeQty = (n: unknown): boolean => Math.abs(qn(n) - Math.round(qn(n))) < 1e-9;
