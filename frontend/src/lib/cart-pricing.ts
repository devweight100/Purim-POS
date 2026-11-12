import { addQty, mulQty, toHund } from './qty';
import { CartItem, ProductUnit } from './types';
import { useProductStore } from './store/product-store';

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

export function calculateSmartRollupAndPricing(items: CartItem[]): CartItem[] {
  if (!items || items.length === 0) return [];

  // Group items by productId
  const productGroups: Record<string, CartItem[]> = {};
  const customOverrideItems: CartItem[] = [];

  for (const item of items) {
    // If cashier manually customized price or manual discount, or has claim replacement, keep it untouched
    if (item.customPrice !== null || item.discountType !== 'none' || (item.claimQuantity && item.claimQuantity > 0)) {
      customOverrideItems.push(item);
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

    // Load available packaging units
    const rawPkg = getProductPackagingUnits(productId);
    const wholesaleSteps = getProductWholesaleSteps(productId);

    // Identify base unit details (factor = 1)
    const baseItem = group.find(i => (i.conversionFactor || 1) === 1) || firstItem;
    const baseUnitName = baseItem.unitName && (baseItem.conversionFactor || 1) === 1 ? baseItem.unitName : 'ชิ้น';
    const baseUnitPrice = (baseItem.conversionFactor || 1) === 1 ? baseItem.originalPrice : (baseItem.originalPrice / (baseItem.conversionFactor || 1));

    // Combine all available packaging units (multiplier > 1) + base unit (multiplier = 1)
    const extraPackagingUnits = rawPkg.filter(u => u.multiplier > 1 && u.name.toLowerCase() !== baseUnitName.toLowerCase());

    const allUnitsSorted = [
      ...extraPackagingUnits,
      { name: baseUnitName, qtyPerPrev: 1, multiplier: 1, priceLevel1: baseUnitPrice }
    ].sort((a, b) => b.multiplier - a.multiplier);

    // Roll up totalBaseQty into largest possible packaging units
    // whole hundredths of a base unit: decimal quantities (1.25 m) roll up without float residue
    let remH = toHund(totalBaseQty);
    const rolledUpList: {
      unitName: string;
      factor: number;
      qty: number;
      unitPrice: number;
      unitId: string;
    }[] = [];

    for (const unit of allUnitsSorted) {
      if (unit.multiplier > 1) {
        const unitH = Math.round(unit.multiplier * 100);
        const count = Math.floor(remH / unitH);
        if (count > 0) {
          rolledUpList.push({
            unitName: unit.name,
            factor: unit.multiplier,
            qty: count,
            unitPrice: unit.priceLevel1 > 0 ? unit.priceLevel1 : (baseUnitPrice * unit.multiplier),
            unitId: `u-${productId}-${unit.name}`,
          });
          remH = remH % unitH;
        }
      } else {
        // Base unit (multiplier = 1)
        if (remH > 0) {
          rolledUpList.push({
            unitName: unit.name,
            factor: 1,
            qty: remH / 100,
            unitPrice: baseUnitPrice,
            unitId: `u-${productId}-base`,
          });
          remH = 0;
        }
      }
    }

    // Convert rolledUpList into CartItems
    for (const r of rolledUpList) {
      const lineBaseQty = mulQty(r.qty, r.factor);
      const applicableWholesale = wholesaleSteps.find(s => lineBaseQty >= s.minQuantity);
      
      let finalUnitPrice = r.unitPrice;
      let isWholesaleApplied = false;
      let pricingNote: string | undefined = undefined;

      if (applicableWholesale) {
        const wholesaleUnitPrice = r.factor * applicableWholesale.unitPrice;
        if (wholesaleUnitPrice < r.unitPrice) {
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
      });
    }
  }

  return resultItems;
}
