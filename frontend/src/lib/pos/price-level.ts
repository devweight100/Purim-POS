/**
 * POS side of the shared price-level rule (shared/src/price-level.ts, docs/pos-price-level.md): which candidates
 * (ราคา 1-5) a product unit has, from a store product (catalogue row, offline cache or a test fixture).
 */
import {
  baseCandidates, packCandidates, pickLevelPrice, productUnitPrices,
  type LevelCandidates, type LevelPick, type LevelPricedPack, type PriceLevel,
} from '@shared/price-level';
import type { Product } from '../types';

export interface PosUnitPrices {
  id: string | null;
  name: string;
  factor: number;
  candidates: LevelCandidates;
}

/** The product carries level prices (catalogue rows always do; minimal fixtures only have unit prices). */
function hasLevelData(p: Product): boolean {
  return p.priceLevel1 != null || p.basePrice != null || (Array.isArray(p.packagingUnits) && p.packagingUnits.length > 0);
}

/** Every unit of a product with its candidates per level (base first). */
export function posUnitTable(product: Product): PosUnitPrices[] {
  const units = product.units || [];
  if (!hasLevelData(product)) {
    const base = units.find((u) => (u.factor || 1) === 1);
    const baseCands: LevelCandidates = [Number(base?.price) || 0, 0, 0, 0, 0];
    return units.map((u) => ({
      id: u.id, name: u.unitName, factor: u.factor || 1,
      candidates: (u.factor || 1) === 1 ? baseCands : packCandidates(baseCands, { priceLevel1: u.price }, u.factor),
    }));
  }
  const table: PosUnitPrices[] = productUnitPrices(product, (product.packagingUnits || []) as LevelPricedPack[])
    .map((u) => ({ id: u.id, name: u.packIndex < 0 ? product.unit || u.name : u.name, factor: u.factor, candidates: u.candidates }));
  // older catalogue shapes: units without a packagingUnits row (unit price = its ราคา 1)
  const base = table[0].candidates;
  for (const u of units) {
    if ((u.factor || 1) > 1 && !table.some((t) => t.factor === u.factor)) {
      table.push({ id: u.id, name: u.unitName, factor: u.factor, candidates: packCandidates(base, { priceLevel1: u.price }, u.factor) });
    }
  }
  return table;
}

/** Candidates of one unit (by id, name or size); a size without a unit = base x size. */
export function unitCandidates(product: Product, unit: { id?: string | null; unitName?: string; factor?: number }): LevelCandidates {
  const table = posUnitTable(product);
  const factor = Number(unit.factor) > 0 ? Number(unit.factor) : 1;
  const hit =
    table.find((t) => t.factor === factor && t.id != null && t.id === unit.id) ||
    table.find((t) => t.factor === factor && !!unit.unitName && t.name === unit.unitName) ||
    table.find((t) => t.factor === factor);
  if (hit) return hit.candidates;
  return packCandidates(table[0]?.candidates || baseCandidates({}), null, factor);
}

/** Price of a product unit at a level (owner rule); null = the product has no price for this unit. */
export function unitPriceAt(product: Product, unit: { id?: string | null; unitName?: string; factor?: number }, level: PriceLevel): LevelPick | null {
  return pickLevelPrice(unitCandidates(product, unit), level);
}

/** Every level price of every unit is 0: "สินค้านี้ยังไม่ได้ตั้งราคา" (not added to the cart). */
export function productHasNoPrice(product: Product): boolean {
  return posUnitTable(product).every((u) => pickLevelPrice(u.candidates, 1) === null);
}
