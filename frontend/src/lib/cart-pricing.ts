import { addQty, mulQty, toHund } from './qty';
import { CartItem, ProductUnit } from './types';
import { useProductStore } from './store/product-store';
import { packCandidates, pickLevelPrice, type LevelCandidates, type PriceLevel } from '@shared/price-level';
import { posUnitTable } from './pos/price-level';
import type { Product } from './types';

/** The catalogue product of a cart line (by id, or SKU for old lines). */
export function findStoreProduct(productId: string): Product | undefined {
  try {
    return useProductStore.getState().products.find((p) => p.id === productId || p.sku === productId);
  } catch {
    return undefined;
  }
}

export interface PackagingUnitConfig {
  name: string;
  qtyPerPrev: number;
  multiplier: number; // total base units per 1 unit
  priceLevel1: number; // price for 1 of this unit
  barcode?: string;
}

export interface WholesaleStepConfig {
  minQuantity: number; // in base units
  unitPrice: number;   // price per base unit
}

// ─── Helpers to load configuration ───────────────────────────────────

export function getProductPackagingUnits(productId: string, fallbackUnits?: ProductUnit[]): PackagingUnitConfig[] {
  // Fallback to product units array if available
  if (fallbackUnits && fallbackUnits.length > 0) {
    return fallbackUnits
      .filter(u => u.factor > 0)
      .map(u => ({
        name: u.unitName,
        qtyPerPrev: u.factor,
        multiplier: u.factor,
        priceLevel1: u.price,
        barcode: u.barcode,
      }));
  }

  // Fallback to product store catalog
  try {
    const prods = useProductStore.getState().products;
    const found = prods.find(p => p.id === productId || p.sku === productId);
    if (found && found.units && found.units.length > 0) {
      return found.units
        .filter(u => u.factor > 0)
        .map(u => ({
          name: u.unitName,
          qtyPerPrev: u.factor,
          multiplier: u.factor,
          priceLevel1: u.price,
          barcode: u.barcode,
        }));
    }
  } catch {}

  return [];
}

export function getProductWholesaleSteps(productId: string): WholesaleStepConfig[] {
  const product = useProductStore.getState().products.find(p => p.id === productId || p.sku === productId);
  const steps = product?.wholesalePrices || [];
  return steps.map((step) => ({ minQuantity: Number(step.minQuantity), unitPrice: Number(step.unitPrice) }))
    .filter((step: WholesaleStepConfig) => step.minQuantity > 0 && step.unitPrice > 0)
    .sort((a: WholesaleStepConfig, b: WholesaleStepConfig) => b.minQuantity - a.minQuantity);
}

// ─── Smart Rollup & Pricing Optimizer ───────────────────────────────────

/** A line whose price the level rule must not touch: manual price, agreed online-order price. */
const keepsOwnPrice = (item: CartItem) => item.customPrice !== null || item.fixedPrice === true;

/** Re-price one line from its own candidates at `level` (lines kept out of the rollup: discount, claim). */
function repriceLine(item: CartItem, level: PriceLevel): CartItem {
  if (keepsOwnPrice(item) || !item.levelPrices) return item;
  const pick = pickLevelPrice(item.levelPrices, level);
  if (!pick) return item;
  return { ...item, originalPrice: pick.price, priceLevel: pick.level };
}

/**
 * Rolls the cart's pieces up into packs and prices every line at the bill's price level (shared rule,
 * docs/pos-price-level.md). Lines with a manual price, an agreed online-order price, an item discount or claim units
 * keep their quantity / unit; their price still follows the level unless it is manual or agreed.
 */
export function calculateSmartRollupAndPricing(items: CartItem[], level: PriceLevel = 1): CartItem[] {
  if (!items || items.length === 0) return [];

  // Group items by productId
  const productGroups: Record<string, CartItem[]> = {};
  const customOverrideItems: CartItem[] = [];

  for (const item of items) {
    // manual price, agreed price, manual discount or claim replacement: quantity / unit untouched
    if (keepsOwnPrice(item) || item.discountType !== 'none' || (item.claimQuantity && item.claimQuantity > 0)) {
      customOverrideItems.push(repriceLine(item, level));
    } else {
      if (!productGroups[item.productId]) {
        productGroups[item.productId] = [];
      }
      productGroups[item.productId].push(item);
    }
  }

  const resultItems: CartItem[] = [...customOverrideItems];

  for (const productId of Object.keys(productGroups)) {
    const group = productGroups[productId];
    if (!group || group.length === 0) continue;

    const firstItem = group[0];

    // Compute total base quantity across all items for this product
    const totalBaseQty = addQty(...group.map((i) => mulQty(i.quantity, i.conversionFactor || 1)));

    if (totalBaseQty <= 0) continue;

    const product = findStoreProduct(productId);
    const wholesaleSteps = getProductWholesaleSteps(productId);

    // Identify base unit details (factor = 1)
    const baseItem = group.find(i => (i.conversionFactor || 1) === 1) || firstItem;
    const baseUnitName = baseItem.unitName && (baseItem.conversionFactor || 1) === 1 ? baseItem.unitName : (product?.unit || 'ชิ้น');

    // Units with their candidates per level: from the catalogue, else (product not loaded) from the lines themselves
    let table: { name: string; factor: number; candidates: LevelCandidates }[];
    if (product) {
      table = posUnitTable(product).map((u, idx) => ({ name: idx === 0 ? baseUnitName : u.name, factor: u.factor, candidates: u.candidates }));
    } else {
      const baseCands = (baseItem.levelPrices && (baseItem.conversionFactor || 1) === 1
        ? baseItem.levelPrices
        : [baseItem.originalPrice / (baseItem.conversionFactor || 1), 0, 0, 0, 0]) as LevelCandidates;
      table = [{ name: baseUnitName, factor: 1, candidates: baseCands }];
      for (const i of group) {
        if ((i.conversionFactor || 1) > 1 && !table.some((t) => t.factor === i.conversionFactor)) {
          table.push({ name: i.unitName, factor: i.conversionFactor, candidates: (i.levelPrices || packCandidates(baseCands, null, i.conversionFactor)) as LevelCandidates });
        }
      }
    }
    const baseCandidates = table[0].candidates;

    // packs (size > 1, one per size) + base unit, biggest first
    const seen = new Set<number>();
    const allUnitsSorted = [
      ...table.slice(1).filter((u) => u.factor > 1 && u.name.toLowerCase() !== baseUnitName.toLowerCase() && !seen.has(u.factor) && seen.add(u.factor)),
      { name: baseUnitName, factor: 1, candidates: baseCandidates },
    ].sort((a, b) => b.factor - a.factor);

    // Roll up totalBaseQty into largest possible packaging units
    // whole hundredths of a base unit: decimal quantities (1.25 m) roll up without float residue
    let remH = toHund(totalBaseQty);
    const rolledUpList: {
      unitName: string;
      factor: number;
      qty: number;
      candidates: LevelCandidates;
      unitId: string;
    }[] = [];

    for (const unit of allUnitsSorted) {
      if (unit.factor > 1) {
        const unitH = Math.round(unit.factor * 100);
        const count = Math.floor(remH / unitH);
        if (count > 0) {
          rolledUpList.push({ unitName: unit.name, factor: unit.factor, qty: count, candidates: unit.candidates, unitId: `u-${productId}-${unit.name}` });
          remH = remH % unitH;
        }
      } else if (remH > 0) {
        // Base unit (factor = 1)
        rolledUpList.push({ unitName: unit.name, factor: 1, qty: remH / 100, candidates: unit.candidates, unitId: `u-${productId}-base` });
        remH = 0;
      }
    }

    // Convert rolledUpList into CartItems
    for (const r of rolledUpList) {
      const lineBaseQty = mulQty(r.qty, r.factor);
      const applicableWholesale = wholesaleSteps.find(s => lineBaseQty >= s.minQuantity);
      const pick = pickLevelPrice(r.candidates, level);
      const levelPrice = pick ? pick.price : 0;

      let finalUnitPrice = levelPrice;
      let isWholesaleApplied = false;
      let pricingNote: string | undefined = undefined;

      if (applicableWholesale) {
        const wholesaleUnitPrice = r.factor * applicableWholesale.unitPrice;
        if (wholesaleUnitPrice < levelPrice) {
          finalUnitPrice = wholesaleUnitPrice;
          isWholesaleApplied = true;
          pricingNote = `ราคาส่ง (฿${applicableWholesale.unitPrice}/หน่วยฐาน)`;
        }
      }

      resultItems.push({
        productId: firstItem.productId,
        name: firstItem.name,
        sku: firstItem.sku,
        originalPrice: finalUnitPrice,
        customPrice: null,
        quantity: r.qty,
        unitId: r.unitId,
        unitName: r.unitName,
        conversionFactor: r.factor,
        discountType: 'none',
        discountValue: 0,
        hasVat: firstItem.hasVat,
        isWholesaleApplied,
        pricingNote,
        itemNote: firstItem.itemNote,
        levelPrices: r.candidates,
        priceLevel: pick ? pick.level : undefined,
        ...(firstItem.isBundle ? { isBundle: true } : {}),
        ...(firstItem.bundleData ? { bundleData: firstItem.bundleData.map((b) => ({ ...b, totalQuantity: mulQty(b.quantityPerBundle, lineBaseQty) })) } : {}),
      });
    }
  }

  return resultItems;
}
