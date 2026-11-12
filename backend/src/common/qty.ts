import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { DECIMAL_QTY_DISABLED, hasMax2Decimals, isWholeQty, MAX_QTY, roundQty } from '../../../shared/src/qty';

/**
 * Server side of the quantity rules. The arithmetic (hundredths, rounding, add/sub/mul) is the
 * shared implementation in shared/src/qty.ts, re-exported here; this file adds request validation
 * (400 errors) and the Prisma Decimal -> number response conversion.
 */
export { MAX_QTY, DECIMAL_QTY_DISABLED, qn, toHund, fromHund, roundQty, addQty, subQty, mulQty, hasMax2Decimals, isWholeQty } from '../../../shared/src/qty';

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
