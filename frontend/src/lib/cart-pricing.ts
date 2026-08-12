import { CartItem } from './types';

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

export function getProductPackagingUnits(productId: string, fallbackUnits?: any[]): PackagingUnitConfig[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(`pkg_${productId}`) : null;
    if (raw) {
      const units = JSON.parse(raw);
      let cum = 1;
      return units.map((u: any) => {
        cum *= parseInt(u.qtyPerPrev) || 1;
        return {
          name: u.name || 'หน่วย',
          qtyPerPrev: parseInt(u.qtyPerPrev) || 1,
          multiplier: cum,
          priceLevel1: parseFloat(u.priceLevel1) || 0,
          barcode: u.barcode,
        };
      });
    }
  } catch {}

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

  return [];
}

export function getProductWholesaleSteps(productId: string): WholesaleStepConfig[] {
  try {
    const raw = typeof window !== 'undefined' ? localStorage.getItem(`ws_${productId}`) : null;
    if (raw) {
      const steps = JSON.parse(raw);
      return steps
        .map((s: any) => ({
          minQuantity: parseInt(s.minQuantity) || 0,
          unitPrice: parseFloat(s.unitPrice) || 0,
        }))
        .filter((s: WholesaleStepConfig) => s.minQuantity > 0 && s.unitPrice > 0)
        .sort((a: WholesaleStepConfig, b: WholesaleStepConfig) => b.minQuantity - a.minQuantity);
    }
  } catch {}
  return [];
}

// ─── Smart Rollup & Cheapest Price Optimizer ───────────────────────────

export function calculateSmartRollupAndPricing(items: CartItem[]): CartItem[] {
  if (!items || items.length === 0) return [];

  // Group cart items by productId
  const productGroups: Record<string, CartItem[]> = {};
  const customOverrideItems: CartItem[] = [];

  for (const item of items) {
    // If cashier manually customized price or manual discount, keep it untouched
    if (item.customPrice !== null || item.discountType !== 'none') {
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
    const totalBaseQty = group.reduce(
      (sum, i) => sum + i.quantity * (i.conversionFactor || 1),
      0
    );

    if (totalBaseQty <= 0) continue;

    // Load configurations
    const packagingUnits = getProductPackagingUnits(productId);
    const wholesaleSteps = getProductWholesaleSteps(productId);

    // Identify base unit details (factor = 1)
    const baseUnitName = firstItem.unitName && firstItem.conversionFactor === 1 ? firstItem.unitName : 'ชิ้น';
    const baseUnitPrice = firstItem.conversionFactor === 1 ? firstItem.originalPrice : (firstItem.originalPrice / (firstItem.conversionFactor || 1));

    // Check if wholesale step is applicable
    const applicableWholesale = wholesaleSteps.find(s => totalBaseQty >= s.minQuantity);

    // Build all available units sorted descending by multiplier
    const allUnitsSorted = [
      ...packagingUnits.filter(u => u.multiplier > 1),
      { name: baseUnitName, qtyPerPrev: 1, multiplier: 1, priceLevel1: baseUnitPrice }
    ].sort((a, b) => b.multiplier - a.multiplier);

    // Roll up totalBaseQty into largest possible packaging units
    let remQty = totalBaseQty;
    const rolledUpList: {
      unitName: string;
      factor: number;
      qty: number;
      unitPrice: number;
      isWholesaleApplied: boolean;
      pricingNote?: string;
    }[] = [];

    for (const unit of allUnitsSorted) {
      if (remQty <= 0) break;
      const count = Math.floor(remQty / unit.multiplier);
      if (count > 0) {
        let chosenPrice = unit.priceLevel1 > 0 ? unit.priceLevel1 : (baseUnitPrice * unit.multiplier);
        let isWholesaleApplied = false;
        let pricingNote: string | undefined = undefined;

        // Smart price comparison: Wholesale Step vs Larger Unit Price
        if (applicableWholesale) {
          const wholesaleEquivalentPrice = unit.multiplier * applicableWholesale.unitPrice;
          if (chosenPrice === 0 || wholesaleEquivalentPrice < chosenPrice) {
            chosenPrice = wholesaleEquivalentPrice;
            isWholesaleApplied = true;
            pricingNote = `ราคาส่ง (฿${applicableWholesale.unitPrice}/ชิ้น)`;
          } else {
            pricingNote = `ราคา ${unit.name} (ถูกกว่าราคาส่ง ฿${(wholesaleEquivalentPrice / unit.multiplier).toFixed(2)}/ชิ้น)`;
          }
        }

        rolledUpList.push({
          unitName: unit.name,
          factor: unit.multiplier,
          qty: count,
          unitPrice: chosenPrice,
          isWholesaleApplied,
          pricingNote,
        });

        remQty %= unit.multiplier;
      }
    }

    // Convert rolled up units to CartItems
    for (const rolled of rolledUpList) {
      resultItems.push({
        productId: firstItem.productId,
        name: firstItem.name,
        sku: firstItem.sku,
        originalPrice: rolled.unitPrice,
        customPrice: null,
        quantity: rolled.qty,
        unitId: `auto-${firstItem.productId}-${rolled.unitName}`,
        unitName: rolled.unitName,
        conversionFactor: rolled.factor,
        discountType: 'none',
        discountValue: 0,
        hasVat: firstItem.hasVat,
        isWholesaleApplied: rolled.isWholesaleApplied,
        pricingNote: rolled.pricingNote,
      });
    }
  }

  return resultItems;
}
