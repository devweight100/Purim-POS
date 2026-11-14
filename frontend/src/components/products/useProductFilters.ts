"use client";

import { useState } from "react";
import type { ProductRecord, SortDir, SortKey, StockFilter } from "./types";
import { useDebouncedValue } from "@/lib/use-debounced-value";

export const ITEMS_PER_PAGE = 50;

/** What the table asks the server for (GET /products/page). */
export interface ProductPageQuery {
  page: number;
  limit: number;
  search: string;
  categoryId: string;
  supplierId: string;
  stock: StockFilter;
  sort: SortKey | null;
  dir: SortDir;
}

/**
 * Search / filters / sort / pagination of the product list. Filtering, sorting and paging run on the server
 * (the search box is debounced 300 ms); changing a filter goes back to page 1.
 */
export function useProductFilters() {
  const [search, setSearchRaw] = useState("");
  const [categoryFilter, setCategoryFilterRaw] = useState("all");
  const [supplierFilter, setSupplierFilterRaw] = useState("all");
  const [stockFilter, setStockFilterRaw] = useState<StockFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [currentPage, setCurrentPage] = useState(1);
  const debouncedSearch = useDebouncedValue(search.trim(), 300);

  const withPageReset = <T,>(current: T, set: (v: T) => void) => (v: T) => { set(v); if (v !== current) setCurrentPage(1); };
  const setSearch = withPageReset(search, setSearchRaw);
  const setSupplierFilter = withPageReset(supplierFilter, setSupplierFilterRaw);
  const setStockFilter = withPageReset(stockFilter, setStockFilterRaw);
  const setCategoryFilter = withPageReset(categoryFilter, setCategoryFilterRaw);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("asc"); }
    setCurrentPage(1);
  };

  const query: ProductPageQuery = {
    page: currentPage, limit: ITEMS_PER_PAGE, search: debouncedSearch,
    categoryId: categoryFilter, supplierId: supplierFilter, stock: stockFilter, sort: sortKey, dir: sortDir,
  };

  return {
    search, setSearch,
    categoryFilter, setCategoryFilter,
    supplierFilter, setSupplierFilter,
    stockFilter, setStockFilter,
    sortKey, sortDir, handleSort,
    currentPage, setCurrentPage,
    query,
  };
}

export type ProductFilterControls = ReturnType<typeof useProductFilters>;

/** Filter controls plus the server's answer for the current page. */
export function productFilterView(f: ProductFilterControls, rows: ProductRecord[], filteredCount: number) {
  return {
    ...f,
    paginatedList: rows,
    filteredCount,
    totalPages: Math.max(1, Math.ceil(filteredCount / ITEMS_PER_PAGE)),
  };
}

export type ProductFiltersState = ReturnType<typeof productFilterView>;
