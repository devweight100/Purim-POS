"use client";

import { useMemo, useState } from "react";
import { getProductBarcodes, lowStockThreshold, normalizeKey } from "./product-helpers";
import type { PackagingUnitForm, ProductRecord, SortDir, SortKey, StockFilter } from "./types";

export const ITEMS_PER_PAGE = 50;

/** Search / filters / sort / pagination of the product list. Changing a filter goes back to page 1. */
export function useProductFilters(products: ProductRecord[], allPackaging: Record<string, PackagingUnitForm[]>) {
  const [search, setSearchRaw] = useState("");
  const [categoryFilter, setCategoryFilterRaw] = useState("all");
  const [supplierFilter, setSupplierFilterRaw] = useState("all");
  const [sizeFilter, setSizeFilterRaw] = useState("all");
  const [colorFilter, setColorFilterRaw] = useState("all");
  const [stockFilter, setStockFilterRaw] = useState<StockFilter>("all");
  const [sortKey, setSortKey] = useState<SortKey | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const [currentPage, setCurrentPage] = useState(1);

  // page 1 whenever a filter value actually changes (was an effect on the filter values)
  const withPageReset = <T,>(current: T, set: (v: T) => void) => (v: T) => { set(v); if (v !== current) setCurrentPage(1); };
  const setSearch = withPageReset(search, setSearchRaw);
  const setSupplierFilter = withPageReset(supplierFilter, setSupplierFilterRaw);
  const setSizeFilter = withPageReset(sizeFilter, setSizeFilterRaw);
  const setColorFilter = withPageReset(colorFilter, setColorFilterRaw);
  const setStockFilter = withPageReset(stockFilter, setStockFilterRaw);
  /** a new category clears the size and color filters */
  const setCategoryFilter = (v: string) => {
    setCategoryFilterRaw(v);
    setSizeFilterRaw("all");
    setColorFilterRaw("all");
    if (v !== categoryFilter || sizeFilter !== "all" || colorFilter !== "all") setCurrentPage(1);
  };

  const sizeOptions = useMemo(() => [...new Set((categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter)).map((p) => p.size).filter(Boolean))] as string[], [products, categoryFilter]);
  const colorOptions = useMemo(() => [...new Set((categoryFilter === "all" ? products : products.filter(p => p.categoryId === categoryFilter)).map((p) => p.color).filter(Boolean))] as string[], [products, categoryFilter]);

  const filtered = useMemo(() => {
    let list = products.filter((p) => {
      const q = search.toLowerCase();
      const allBarcodes = [...getProductBarcodes(p), ...(allPackaging[p.id] || []).map(u => u.barcode).filter(Boolean)];
      const matchSearch = (p.name || "").toLowerCase().includes(q) || (p.sku || "").toLowerCase().includes(q) || allBarcodes.some(b => normalizeKey(b).includes(q));
      const matchCat = categoryFilter === "all" || p.categoryId === categoryFilter;
      const matchSupplier = supplierFilter === "all" ||
        (p.supplierId === supplierFilter) ||
        (Array.isArray(p.barcodes) && p.barcodes.some((b) => typeof b !== "string" && b.supplierId === supplierFilter)) ||
        (Array.isArray(p.supplierEntries) && p.supplierEntries.some((s) => s.supplierId === supplierFilter));
      const matchSize = sizeFilter === "all" || p.size === sizeFilter;
      const matchColor = colorFilter === "all" || p.color === colorFilter;
      const stock = p.stock ?? 0;
      const lowThreshold = lowStockThreshold(p);
      const matchStock = stockFilter === "all" ? true : stockFilter === "out" ? stock === 0 : stock > 0 && stock <= lowThreshold;
      return matchSearch && matchCat && matchSupplier && matchSize && matchColor && matchStock;
    });
    if (sortKey) {
      list = [...list].sort((a, b) => {
        const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
        if (typeof av === "string") return sortDir === "asc" ? av.localeCompare(String(bv)) : String(bv).localeCompare(av);
        return sortDir === "asc" ? Number(av) - Number(bv) : Number(bv) - Number(av);
      });
    }
    return list;
  }, [products, search, categoryFilter, supplierFilter, sizeFilter, colorFilter, stockFilter, sortKey, sortDir, allPackaging]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filtered.slice(start, start + ITEMS_PER_PAGE);
  }, [filtered, currentPage]);

  const handleSort = (key: SortKey) => { if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc"); else { setSortKey(key); setSortDir("asc"); } };

  return {
    search, setSearch,
    categoryFilter, setCategoryFilter,
    supplierFilter, setSupplierFilter,
    sizeFilter, setSizeFilter,
    colorFilter, setColorFilter,
    stockFilter, setStockFilter,
    sizeOptions, colorOptions,
    sortKey, sortDir, handleSort,
    filtered, paginatedList,
    currentPage, setCurrentPage, totalPages,
  };
}

export type ProductFiltersState = ReturnType<typeof useProductFilters>;
