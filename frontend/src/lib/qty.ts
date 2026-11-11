/**
 * Quantities (cart, PO, stock adjust, returns, claims, supplier returns, import) may have up to 2
 * decimals when the store turns on "อนุญาตจำนวนทศนิยม" (StoreSettings.allowDecimalQty): sell rope by
 * the metre, nails by the kg. Off = whole units only, exactly as before. Use these helpers for every
 * quantity input / display instead of ad-hoc parseInt / Math.round / Number.isInteger.
 */
import { useEffect, useState } from 'react';
import { loadStoreSettings } from './store-settings-storage';

export const MAX_QTY = 10_000_000;
export const DECIMAL_QTY_DISABLED_MESSAGE = 'ร้านไม่ได้เปิดใช้จำนวนทศนิยม';

/** Store setting (mirrored from the backend into localStorage by ClientDbSync / the settings page). */
export function decimalQtyEnabled(): boolean {
  return loadStoreSettings().allowDecimalQty === true;
}

/** Whole hundredths of a quantity (1.25 -> 125), safe against float noise. */
export const toHund = (n: unknown): number => {
  const v = Number(n) || 0;
  return Math.round(v * 100 + (v >= 0 ? 1e-7 : -1e-7));
};
/** Round to 2 decimals without float residue. */
export const roundQty = (n: unknown): number => toHund(n) / 100;
export const addQty = (...vals: unknown[]): number => vals.reduce<number>((s, v) => s + toHund(v), 0) / 100;
export const subQty = (a: unknown, b: unknown): number => (toHund(a) - toHund(b)) / 100;
/** qty x unit factor (pack size), rounded to 2 decimals. */
export const mulQty = (a: unknown, factor: unknown): number => roundQty((Number(a) || 0) * (Number(factor) || 0));

const hasMax2Decimals = (n: number) => Number.isFinite(n) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

/**
 * Parse what the user typed. Decimal mode: up to 2 decimals (more are rounded to 2), "," accepted
 * as thousands separator. Integer mode: whole units (like parseInt: "2.7" -> 2). NaN when not a number.
 */
export function parseQty(input: unknown, allowDecimal: boolean = decimalQtyEnabled()): number {
  if (input === null || input === undefined) return NaN;
  const text = typeof input === 'number' ? String(input) : String(input).replace(/,/g, '').trim();
  if (text === '' || text === '-' || text === '.') return NaN;
  const n = Number(text);
  if (!Number.isFinite(n)) return NaN;
  return allowDecimal ? roundQty(n) : Math.trunc(n);
}

/** True when n is a usable quantity: > 0 (or >= 0 with min 'nonneg'), <= MAX_QTY, integer unless decimals are on (max 2 decimals). */
export function isValidQty(n: unknown, opts: { allowDecimal?: boolean; min?: 'positive' | 'nonneg'; max?: number } = {}): boolean {
  const v = typeof n === 'number' ? n : Number(n);
  if (!Number.isFinite(v)) return false;
  const allowDecimal = opts.allowDecimal ?? decimalQtyEnabled();
  if (opts.min === 'nonneg' ? v < 0 : v <= 0) return false;
  if (v > (opts.max ?? MAX_QTY)) return false;
  return allowDecimal ? hasMax2Decimals(v) : Number.isInteger(v);
}

/** Display: up to 2 decimals, no trailing zeros (1.5, 3, 0.25). `grouping` adds thousands separators. */
export function formatQty(n: unknown, opts: { grouping?: boolean } = {}): string {
  const v = roundQty(n);
  return v.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 0, useGrouping: opts.grouping === true });
}

/** `step` for <input type="number">. */
export const qtyStep = (allowDecimal: boolean = decimalQtyEnabled()): string => (allowDecimal ? '0.01' : '1');
/** `inputMode` for quantity inputs (mobile keyboards). */
export const qtyInputMode = (allowDecimal: boolean = decimalQtyEnabled()): 'decimal' | 'numeric' => (allowDecimal ? 'decimal' : 'numeric');
/** Smallest quantity a "-" button may leave. */
export const minQty = (allowDecimal: boolean = decimalQtyEnabled()): number => (allowDecimal ? 0.01 : 1);

/** React hook: the store's allowDecimalQty, updated live when the settings change. */
export function useAllowDecimalQty(): boolean {
  const [allow, setAllow] = useState(false);
  useEffect(() => {
    setAllow(decimalQtyEnabled());
    const onChange = (e: Event) => setAllow((e as CustomEvent).detail?.allowDecimalQty === true);
    window.addEventListener('purim:store-settings', onChange);
    return () => window.removeEventListener('purim:store-settings', onChange);
  }, []);
  return allow;
}
