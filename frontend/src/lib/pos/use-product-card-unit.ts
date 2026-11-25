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
    /** back to the default unit (the arrow keys left the card without adding it) */
    resetUnit: () => setPicked(null),
    /**
     * ← / → inside a card with several units: the next / previous unit that is in stock, or null at the end
     * (the arrow then moves on to the neighbouring card).
     */
    unitStep: (dir: 1 | -1): ProductUnit | null => {
      const i = units.findIndex((u) => unitKey(u) === unitKey(activeUnit));
      for (let j = i + dir; j >= 0 && j < units.length; j += dir) {
        if (product.stock >= units[j].factor) return units[j];
      }
      return null;
    },
  };
}
