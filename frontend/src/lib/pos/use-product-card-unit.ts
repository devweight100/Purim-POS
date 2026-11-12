'use client';

import { useMemo, useState } from 'react';
import { getDefaultSelectedUnit, getProductAvailableUnits } from '@/lib/product-unit-helpers';
import { getLowStockThreshold } from '@/lib/store-settings-storage';
import type { Product, ProductUnit } from '@/lib/types';

const unitKey = (u: ProductUnit) => u.id || u.unitName;

/**
 * Units of a product card and the highlighted one. The highlight starts at the unit the search text
 * points to and goes back to it whenever that default changes (new search, product refresh).
 */
export function useProductCardUnit(product: Product, searchQuery: string) {
  const units = useMemo(() => getProductAvailableUnits(product), [product]);
  const defaultUnit = useMemo(() => getDefaultSelectedUnit(product, units, searchQuery), [product, units, searchQuery]);
  // the cashier's pick only counts for the default it was made under
  const [picked, setPicked] = useState<{ key: string; forDefault: ProductUnit } | null>(null);
  const activeUnitId = picked && picked.forDefault === defaultUnit ? picked.key : unitKey(defaultUnit);
  const activeUnit = units.find((u) => u.id === activeUnitId || u.unitName === activeUnitId) || defaultUnit;

  const isLowStock =
    product.stock <=
    (product.minStockAlert !== undefined && product.minStockAlert !== null
      ? Number(product.minStockAlert)
      : getLowStockThreshold());

  return {
    units,
    activeUnit,
    isLowStock,
    pickUnit: (u: ProductUnit) => setPicked({ key: unitKey(u), forDefault: defaultUnit }),
  };
}
