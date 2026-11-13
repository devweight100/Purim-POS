/**
 * Read-only product lookup for the mobile summary page (/m, GET /products/lookup): search by name /
 * SKU / barcode, stock in the base unit, packaging units with their prices, filter by stock level.
 * The pure parts live here so they can be unit tested without a database.
 */

export type LookupFilter = 'all' | 'low' | 'out';
export const LOOKUP_FILTERS: readonly LookupFilter[] = ['all', 'low', 'out'];

/** Words of a search text (Thai has no spaces between words, so each word is a substring match). */
export function searchTokens(q: string | undefined | null): string[] {
  return String(q ?? '')
    .normalize('NFC')
    .replace(/[​-‍﻿]/g, '') // zero-width characters (copied Thai text)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 5);
}

/** Stock level of a product: out = at or below 0; low = above 0 and at or below the store threshold. */
export function stockLevel(qty: number, threshold: number): 'out' | 'low' | 'ok' {
  if (qty <= 0) return 'out';
  if (qty <= threshold) return 'low';
  return 'ok';
}

export interface LookupCandidate {
  id: string;
  name: string;
  sku: string;
  isBundle: boolean;
  barcodes: string[];
}

/**
 * Order of results: exact SKU / barcode hit first, then names starting with the text, then by name
 * (Thai collation).
 */
export function rankCandidates<T extends LookupCandidate>(rows: T[], q: string): T[] {
  const text = searchTokens(q).join(' ').toLowerCase();
  const score = (r: T) => {
    if (!text) return 2;
    if (r.sku.toLowerCase() === text || r.barcodes.some((b) => b.toLowerCase() === text)) return 0;
    if (r.name.toLowerCase().startsWith(text)) return 1;
    return 2;
  };
  const collator = new Intl.Collator('th');
  return rows
    .map((r) => ({ r, s: score(r) }))
    .sort((a, b) => a.s - b.s || collator.compare(a.r.name, b.r.name) || a.r.sku.localeCompare(b.r.sku))
    .map((x) => x.r);
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Price levels 1-5; level 1 of the base unit falls back to basePrice (as the POS does). */
export function priceLevels(src: Record<string, unknown>, baseFallback?: unknown): (number | null)[] {
  const levels = [1, 2, 3, 4, 5].map((i) => num(src[`priceLevel${i}`]));
  if (levels[0] === null && baseFallback !== undefined) levels[0] = num(baseFallback);
  return levels;
}

/** Packaging units with their size in base units (each unit's qtyPerPrev multiplies the one before). */
export function packChain(units: { name: string; qtyPerPrev: number; barcode?: string | null; [k: string]: unknown }[]) {
  let factor = 1;
  return units.map((u) => {
    factor *= Number(u.qtyPerPrev) > 0 ? Number(u.qtyPerPrev) : 1;
    return { name: u.name, qtyPerPrev: Number(u.qtyPerPrev) || 1, factor, barcode: u.barcode || null, prices: priceLevels(u) };
  });
}
