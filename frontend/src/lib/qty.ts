/**
 * Quantities (cart, PO, stock adjust, returns, claims, supplier returns, import) may have up to 2
 * decimals when the store turns on "อนุญาตจำนวนทศนิยม" (StoreSettings.allowDecimalQty): sell rope by
 * the metre, nails by the kg. Off = whole units only, exactly as before. Use these helpers for every
 * quantity input / display instead of ad-hoc parseInt / Math.round / Number.isInteger.
 */
import { useEffect, useState } from 'react';
import { DECIMAL_QTY_DISABLED, hasMax2Decimals, MAX_QTY, roundQty } from '@shared/qty';
import { loadStoreSettings } from './store-settings-storage';

// The arithmetic is the server's own implementation (shared/src/qty.ts); this file adds parsing of
// what the user typed, display and the store-setting hook.
export { MAX_QTY, toHund, roundQty, addQty, subQty, mulQty } from '@shared/qty';
export const DECIMAL_QTY_DISABLED_MESSAGE = DECIMAL_QTY_DISABLED;

/** Store setting (mirrored from the backend into localStorage by ClientDbSync / the settings page). */
export function decimalQtyEnabled(): boolean {
  return loadStoreSettings().allowDecimalQty === true;
}

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
