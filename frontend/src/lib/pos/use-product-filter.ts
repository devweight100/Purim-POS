'use client';

import { useMemo, useState } from 'react';
import type { Product } from '@/lib/types';

/** Products matching the search text (name, SKU, unit barcode or unit name) and the chosen category. */
export function filterPosProducts(products: Product[], searchQuery: string, categoryId: string | null): Product[] {
  const q = searchQuery.toLowerCase();
  return products.filter((p) => {
    const matchesSearch =
      p.name.toLowerCase().includes(q) ||
      p.sku.toLowerCase().includes(q) ||
      p.units.some((u) => (u.barcode && u.barcode.includes(searchQuery)) || (u.unitName && u.unitName.toLowerCase().includes(q)));
    const matchesCategory = categoryId ? p.categoryId === categoryId : true;
    return matchesSearch && matchesCategory;
  });
}

/**
 * Search text, category and "load more" paging of the product grid. Changing the search or the
 * category starts again from the first page.
 */
export function useProductFilter(products: Product[], pageSize: number) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  // the page count belongs to one search + category; any other filter shows the first page
  const filterKey = `${activeCategory ?? ''}\u0000${searchQuery}`;
  const [paging, setPaging] = useState({ key: filterKey, limit: pageSize });
  const displayLimit = paging.key === filterKey ? paging.limit : pageSize;

  const filteredProducts = useMemo(
    () => filterPosProducts(products, searchQuery, activeCategory),
    [products, searchQuery, activeCategory],
  );
  const visibleProducts = useMemo(() => filteredProducts.slice(0, displayLimit), [filteredProducts, displayLimit]);

  return {
    searchQuery,
    setSearchQuery,
    activeCategory,
    setActiveCategory,
    filteredProducts,
    visibleProducts,
    /** products not shown yet */
    hiddenCount: Math.max(0, filteredProducts.length - displayLimit),
    loadMore: () => setPaging({ key: filterKey, limit: displayLimit + pageSize }),
  };
}

export type ProductFilter = ReturnType<typeof useProductFilter>;
