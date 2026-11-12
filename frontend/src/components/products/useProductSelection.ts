"use client";

import { useMemo, useState } from "react";
import type { ProductRecord } from "./types";

const toggled = (prev: Set<string>, id: string) => {
  const next = new Set(prev);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

/** Row checkboxes (bulk actions) and expanded pack-unit rows of the product table. */
export function useProductSelection(paginatedList: ProductRecord[]) {
  const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => setExpandedRows(prev => toggled(prev, id));
  const currentPageIds = useMemo(() => paginatedList.map((p) => p.id).filter(Boolean), [paginatedList]);
  const isCurrentPageSelected = currentPageIds.length > 0 && currentPageIds.every((id) => selectedProductIds.has(id));

  const toggleSelectProduct = (id: string) => setSelectedProductIds((prev) => toggled(prev, id));

  const toggleSelectCurrentPage = () => {
    setSelectedProductIds((prev) => {
      const next = new Set(prev);
      if (isCurrentPageSelected) {
        currentPageIds.forEach((id) => next.delete(id));
      } else {
        currentPageIds.forEach((id) => next.add(id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedProductIds(new Set());

  return {
    selectedProductIds, toggleSelectProduct, toggleSelectCurrentPage, isCurrentPageSelected, clearSelection,
    expandedRows, setExpandedRows, toggleExpand,
  };
}

export type ProductSelection = ReturnType<typeof useProductSelection>;
