import { Product, ProductUnit } from './types';

/**
 * Returns all available units for a product (combining packaging units and base units).
 * Base unit (e.g. ชิ้น, factor = 1) is ALWAYS guaranteed to be first!
 */
export function getProductAvailableUnits(product: Product): ProductUnit[] {
  if (!product) return [];
  const pAny = product as any;

  // 1. Resolve base unit name & price
  const baseUnitName = pAny.unit || product.units?.[0]?.unitName || 'ชิ้น';
  const basePrice = product.units?.[0]?.price || pAny.priceLevel1 || pAny.basePrice || pAny.price || 0;
  const baseBarcode = product.units?.[0]?.barcode || pAny.barcodes?.[0]?.barcode || product.sku;

  const baseUnitItem: ProductUnit = {
    id: `u-${product.id}-base`,
    unitName: baseUnitName,
    factor: 1,
    price: basePrice,
    barcode: baseBarcode,
  };

  if (Array.isArray(product.units) && product.units.length > 0) {
    // Check if base unit is already inside product.units
    const baseInUnits = product.units.find(u => u.factor === 1 || u.unitName.toLowerCase() === baseUnitName.toLowerCase());
    
    // Extra packaging units (factor > 1 or different unitName)
    const extraUnits = product.units.filter(u => u.unitName.toLowerCase() !== baseUnitName.toLowerCase() && u.factor > 1);

    const actualBase = baseInUnits || baseUnitItem;
    return [actualBase, ...extraUnits];
  }

  return [baseUnitItem];
}

/**
 * Resolves the default selected unit for a product based on:
 * 1. Exact barcode match if searchQuery is a scanned unit barcode.
 * 2. Admin configured defaultSellingUnitId.
 * 3. Lowest conversion factor unit (smallest unit).
 * 4. Fallback to next available in-stock unit if pre-selected unit is out of stock.
 */
export function getDefaultSelectedUnit(
  product: Product,
  units: ProductUnit[],
  searchQuery?: string
): ProductUnit {
  const pAny = product as any;

  if (!units || units.length === 0) {
    return {
      id: `u-${product.id}`,
      unitName: pAny.unit || 'ชิ้น',
      factor: 1,
      price: pAny.price || 0,
    };
  }

  // 1. Exact barcode match check (if user scanned a unit barcode)
  if (searchQuery && searchQuery.trim()) {
    const q = searchQuery.trim().toLowerCase();
    const barcodeMatch = units.find(u => u.barcode && u.barcode.toLowerCase() === q);
    if (barcodeMatch && product.stock >= barcodeMatch.factor) {
      return barcodeMatch;
    }
  }

  // 2. Admin default_selling_unit check
  let targetUnit: ProductUnit | undefined = undefined;
  if (product.defaultSellingUnitId) {
    targetUnit = units.find(u => u.id === product.defaultSellingUnitId || u.unitName === product.defaultSellingUnitId);
  }

  // 3. Fallback to smallest conversion factor (lowest factor)
  if (!targetUnit) {
    const sorted = [...units].sort((a, b) => a.factor - b.factor);
    targetUnit = sorted[0];
  }

  // 4. Stock Out edge case: If pre-selected unit requires more stock than available, auto-select next in-stock unit
  if (targetUnit && product.stock < targetUnit.factor) {
    const sortedUnits = [...units].sort((a, b) => a.factor - b.factor);
    const inStockUnit = sortedUnits.find(u => product.stock >= u.factor);
    if (inStockUnit) {
      return inStockUnit;
    }
  }

  return targetUnit || units[0];
}
