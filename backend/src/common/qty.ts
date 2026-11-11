import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/**
 * Quantities (stock, sales, purchases, returns, claims) are DECIMAL(12,2) in the database: up to
 * 2 decimals when the store turns on StoreSettings.allowDecimalQty (sell rope by the metre, nails by
 * the kg). Do quantity arithmetic through these helpers: they work in whole hundredths so FIFO
 * deductions and unit conversions never leave 0.0000001 residues.
 */
export const MAX_QTY = 10_000_000;
export const DECIMAL_QTY_DISABLED = 'ร้านไม่ได้เปิดใช้จำนวนทศนิยม';

/** Prisma Decimal / string / number / null -> number (null -> 0). */
export const qn = (v: unknown): number => {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v as any);
  return Number.isFinite(n) ? n : 0;
};

/** Whole hundredths of a quantity (1.25 -> 125). */
export const toHund = (v: unknown): number => Math.round(qn(v) * 100 + (qn(v) >= 0 ? 1e-7 : -1e-7));
export const fromHund = (h: number): number => h / 100;
/** Round to 2 decimals without float residue. */
export const roundQty = (v: unknown): number => fromHund(toHund(v));
/** a + b, a - b, a * factor rounded to 2 decimals. */
export const addQty = (...vals: unknown[]): number => fromHund(vals.reduce<number>((s, v) => s + toHund(v), 0));
export const subQty = (a: unknown, b: unknown): number => fromHund(toHund(a) - toHund(b));
export const mulQty = (a: unknown, factor: unknown): number => roundQty(qn(a) * qn(factor));

/** True when n has at most 2 decimals. */
export const hasMax2Decimals = (n: number): boolean => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;
export const isWholeQty = (n: unknown): boolean => Math.abs(qn(n) - Math.round(qn(n))) < 1e-9;

export interface QtyRule {
  /** StoreSettings.allowDecimalQty */
  allowDecimal: boolean;
  /** 'positive' (> 0, default) or 'nonneg' (>= 0) */
  min?: 'positive' | 'nonneg';
  max?: number;
  /** Thai message used when the value is not a valid number / out of range. */
  message?: string;
}

/**
 * Parse and validate a quantity from a request. Accepts numbers or numeric strings with at most
 * 2 decimals; rejects 3+ decimals, negatives, zero (unless min = 'nonneg') and > MAX_QTY. When the
 * store has not enabled decimal quantities a non-integer value is rejected with DECIMAL_QTY_DISABLED.
 */
export function parseQty(value: unknown, rule: QtyRule): number {
  const message = rule.message || 'จำนวนไม่ถูกต้อง';
  if (value === null || value === undefined || value === '' || typeof value === 'boolean' || (typeof value !== 'number' && typeof value !== 'string')) {
    throw new BadRequestException(message);
  }
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) throw new BadRequestException(message);
  const max = rule.max ?? MAX_QTY;
  if (n < 0 || (rule.min !== 'nonneg' && n <= 0) || n > max) throw new BadRequestException(message);
  if (!hasMax2Decimals(n)) throw new BadRequestException(rule.allowDecimal ? 'จำนวนมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง' : DECIMAL_QTY_DISABLED);
  if (!rule.allowDecimal && !isWholeQty(n)) throw new BadRequestException(DECIMAL_QTY_DISABLED);
  return roundQty(n);
}

/** Reject non-integer quantities when the store has decimal quantities turned off. */
export function assertQtyAllowed(n: unknown, allowDecimal: boolean): void {
  if (!allowDecimal && !isWholeQty(n)) throw new BadRequestException(DECIMAL_QTY_DISABLED);
}

/** StoreSettings.allowDecimalQty (false when there is no settings row). */
export async function decimalQtyAllowed(tx: any): Promise<boolean> {
  const s = await tx.storeSettings.findFirst({ select: { allowDecimalQty: true } });
  return !!s?.allowDecimalQty;
}

/** Response keys that hold quantities: Prisma Decimal values under these keys are sent as numbers. */
export const QTY_KEYS = new Set([
  'quantity', 'quantityReceived', 'quantityRemaining', 'receivedQty', 'baseQuantity', 'totalQuantity',
  'replacementBaseQuantity', 'minQuantity', 'lowStockThreshold', 'qty', 'stock', 'totalStock',
  'currentStock', 'stockQuantity', 'claimQuantity', 'returnedQuantity', 'remainingQuantity',
]);

const isDecimal = (v: any): boolean => Prisma.Decimal.isDecimal(v);

/**
 * Walk a response body and turn Prisma Decimal quantities (keys in QTY_KEYS) into plain numbers so
 * the frontend never receives "1.50" strings for quantities. Other Decimals (money) are untouched.
 */
export function quantitiesToNumbers<T>(body: T, depth = 0): T {
  if (depth > 12 || body === null || typeof body !== 'object') return body;
  if (Array.isArray(body)) {
    for (let i = 0; i < body.length; i++) body[i] = quantitiesToNumbers(body[i], depth + 1);
    return body;
  }
  if (body instanceof Date || Buffer.isBuffer(body) || isDecimal(body)) return body;
  const proto = Object.getPrototypeOf(body);
  if (proto !== Object.prototype && proto !== null) return body;
  for (const key of Object.keys(body as any)) {
    const v = (body as any)[key];
    // Decimal quantities kept in JSON columns (audit logs, idempotent replays) come back as strings
    if (typeof v === 'string' && QTY_KEYS.has(key) && /^-?\d+(\.\d+)?$/.test(v)) {
      (body as any)[key] = Number(v);
      continue;
    }
    if (v && typeof v === 'object') {
      if (isDecimal(v)) {
        if (QTY_KEYS.has(key)) (body as any)[key] = Number(v);
      } else {
        (body as any)[key] = quantitiesToNumbers(v, depth + 1);
      }
    }
  }
  return body;
}
