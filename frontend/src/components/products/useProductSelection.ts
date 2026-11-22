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

  // active / inactive of every product row seen (any page), so the bulk bar offers only the action that applies
  const [activeById, setActiveById] = useState<Record<string, boolean>>({});
  const pageStatusKey = paginatedList.map((p) => `${p.id}:${p.isActive === false ? 0 : 1}`).join(",");
  const [pageStatusSeen, setPageStatusSeen] = useState("");
  if (pageStatusSeen !== pageStatusKey) {
    // adjusted while rendering (no extra effect pass)
    setPageStatusSeen(pageStatusKey);
    setActiveById((prev) => ({ ...prev, ...Object.fromEntries(paginatedList.map((p) => [p.id, p.isActive !== false])) }));
  }

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
  /** drop products that no longer exist (deleted) from the selection and the expanded rows */
  const forget = (ids: string[]) => {
    const drop = (prev: Set<string>) => {
      if (!ids.some((id) => prev.has(id))) return prev;
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    };
    setSelectedProductIds(drop);
    setExpandedRows(drop);
  };

  return {
    selectedProductIds, activeById, toggleSelectProduct, toggleSelectCurrentPage, isCurrentPageSelected, clearSelection, forget,
    expandedRows, setExpandedRows, toggleExpand,
  };
}

export type ProductSelection = ReturnType<typeof useProductSelection>;
