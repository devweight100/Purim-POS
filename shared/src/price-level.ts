/**
 * Price levels (ราคา 1-5): the ONE rule for which price a unit sells at, used by the POS cart, the server checkout
 * validation and the online shop (docs/pos-price-level.md). Pure functions, no dependencies.
 *
 * Owner's rule (2026-11-23) for level L:
 *   price L if > 0, else price 1 if > 0, else the first non-zero of price 2 -> 3 -> 4 -> 5.
 *   Never a 0 from level prices: an item without any price has NO price (null) and is not sold until priced.
 * Packs / cases: the same rule over the pack's own candidate per level, where a level the pack has no own price
 * for is base price of that level x pack size (the factor fallback the POS always used). A price computed that way is
 * never above the pack's own ราคา 1 (a pack sold cheaper than its pieces stays the cheapest for everyone).
 */
import { round2 } from './money';

export type PriceLevel = 1 | 2 | 3 | 4 | 5;
export const PRICE_LEVELS: readonly PriceLevel[] = [1, 2, 3, 4, 5];

/** Customer / bill price level from anything (profile JSON, query string, payload); unknown -> 1 (retail). */
export function normalizeLevel(raw: unknown): PriceLevel {
  const n = Number(raw);
  return (PRICE_LEVELS as readonly number[]).includes(n) ? (n as PriceLevel) : 1;
}

type Money = number | string | null | undefined | { toString(): string };
const pos = (v: Money): number => {
  const n = Number(v === null || v === undefined ? NaN : String(v));
  return Number.isFinite(n) && n > 0 ? n : 0;
};

/** Level prices of a product (base unit). `basePrice` is the legacy retail column, used when ราคา 1 is empty. */
export interface LevelPriced {
  basePrice?: Money;
  priceLevel1?: Money;
  priceLevel2?: Money;
  priceLevel3?: Money;
  priceLevel4?: Money;
  priceLevel5?: Money;
}

/** A packaging unit (products.packagingUnits, in sort order). */
export interface LevelPricedPack {
  id?: string | null;
  name?: string | null;
  /** how many of the previous unit make one of this unit */
  qtyPerPrev?: number | string | null;
  priceLevel1?: Money;
  priceLevel2?: Money;
  priceLevel3?: Money;
  priceLevel4?: Money;
  priceLevel5?: Money;
}

/** Candidate price of one unit per level, index 0 = ราคา 1 ... 4 = ราคา 5 (0 = no price at that level). */
export type LevelCandidates = [number, number, number, number, number];

const levelOf = (p: LevelPriced | LevelPricedPack, l: PriceLevel): number =>
  pos((p as unknown as Record<string, Money>)[`priceLevel${l}`]);

/** The base unit's candidates (ราคา 1 falls back to basePrice). */
export function baseCandidates(product: LevelPriced): LevelCandidates {
  return [levelOf(product, 1) || pos(product.basePrice), levelOf(product, 2), levelOf(product, 3), levelOf(product, 4), levelOf(product, 5)];
}

/** A pack's candidates: its own level price, else base level price x factor (capped at the pack's own ราคา 1). */
export function packCandidates(base: LevelCandidates, pack: LevelPricedPack | null | undefined, factor: number): LevelCandidates {
  if (!(factor > 0)) return [0, 0, 0, 0, 0];
  if (factor === 1 && !pack) return [...base] as LevelCandidates;
  const own = pack ? PRICE_LEVELS.map((l) => levelOf(pack, l)) : [0, 0, 0, 0, 0];
  const cap = own[0];
  return PRICE_LEVELS.map((l, i) => {
    if (own[i] > 0) return own[i];
    const derived = base[i] > 0 ? round2(base[i] * factor) : 0;
    return derived > 0 && cap > 0 ? Math.min(derived, cap) : derived;
  }) as LevelCandidates;
}

export interface LevelPick {
  price: number;
  /** level whose price is used (differs from the requested level when it falls back) */
  level: PriceLevel;
}

/** Owner's rule over one unit's candidates; null = no price at any level (do not sell). */
export function pickLevelPrice(candidates: readonly number[] | null | undefined, level: PriceLevel | number): LevelPick | null {
  if (!candidates) return null;
  const want = normalizeLevel(level);
  const order: PriceLevel[] = [want, 1, 2, 3, 4, 5];
  for (const l of order) {
    const v = Number(candidates[l - 1]);
    if (Number.isFinite(v) && v > 0) return { price: round2(v), level: l };
  }
  return null;
}

export interface UnitLevelPrices {
  /** packaging unit id; null = base unit */
  id: string | null;
  name: string;
  /** base units in one of this unit (factors multiply in sort order, like the checkout) */
  factor: number;
  /** index in products.packagingUnits; -1 = base unit */
  packIndex: number;
  candidates: LevelCandidates;
}

/**
 * Every unit of a product with its candidates: the base unit, then each pack in sort order. A broken chain
 * (qtyPerPrev < 1) stops: later units cannot be priced. Packs of size 1 are kept (the caller decides).
 */
export function productUnitPrices(product: LevelPriced & { unit?: string | null }, packs: readonly LevelPricedPack[] | null | undefined): UnitLevelPrices[] {
  const base = baseCandidates(product);
  const out: UnitLevelPrices[] = [{ id: null, name: product.unit || 'ชิ้น', factor: 1, packIndex: -1, candidates: base }];
  let factor = 1;
  (packs || []).some((pack, i) => {
    const step = Math.floor(Number(pack.qtyPerPrev));
    if (!(step >= 1)) return true;
    factor *= step;
    out.push({ id: pack.id ?? null, name: pack.name || 'หน่วย', factor, packIndex: i, candidates: packCandidates(base, pack, factor) });
    return false;
  });
  return out;
}

/**
 * Candidates of the unit a POS / checkout line names: by pack id, else pack name, else by factor; a factor with no
 * pack = base x factor. Factor 1 = the base unit.
 */
export function lineUnitCandidates(
  product: LevelPriced & { unit?: string | null },
  packs: readonly LevelPricedPack[] | null | undefined,
  line: { factor: number; unitId?: string | null; unitName?: string | null },
): LevelCandidates {
  const units = productUnitPrices(product, packs);
  const factor = Number(line.factor) > 0 ? Number(line.factor) : 1;
  if (factor === 1) return units[0].candidates;
  const byId = line.unitId ? units.find((u) => u.id && u.id === line.unitId && u.factor === factor) : undefined;
  const byName = line.unitName ? units.find((u) => u.packIndex >= 0 && u.name === line.unitName && u.factor === factor) : undefined;
  const byFactor = units.find((u) => u.packIndex >= 0 && u.factor === factor);
  const hit = byId || byName || byFactor;
  return hit ? hit.candidates : packCandidates(units[0].candidates, null, factor);
}

/** True when no unit of the product has any price (every level 0): "สินค้านี้ยังไม่ได้ตั้งราคา". */
export function hasNoPrice(product: LevelPriced, packs?: readonly LevelPricedPack[] | null): boolean {
  return productUnitPrices(product, packs).every((u) => pickLevelPrice(u.candidates, 1) === null);
}

/** Names the customer / cashier sees for each price level (shop settings `levelNames`). */
export const DEFAULT_LEVEL_NAMES: Record<PriceLevel, string> = {
  1: 'ราคาปลีก',
  2: 'ราคาส่ง',
  3: 'ราคาส่งพิเศษ',
  4: 'ราคาระดับ 4',
  5: 'ราคาระดับ 5',
};

export function levelNames(raw: unknown): Record<PriceLevel, string> {
  const out = { ...DEFAULT_LEVEL_NAMES };
  if (raw && typeof raw === 'object') {
    for (const l of PRICE_LEVELS) {
      const v = (raw as Record<string, unknown>)[String(l)];
      if (typeof v === 'string' && v.trim()) out[l] = v.trim().slice(0, 40);
    }
  }
  return out;
}

/** "ราคาส่ง" -> "ส่ง" (short label for the POS indicator "ราคา: ส่ง"); "ราคาระดับ 4" -> "ระดับ 4". */
export function shortLevelName(name: string | undefined, level: PriceLevel | number): string {
  const s = (name || '').trim().replace(/^ราคา\s*/, '').trim();
  return s || `ระดับ ${level}`;
}
