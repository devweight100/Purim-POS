"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { cacheServerCategories } from "@/lib/category-storage";
import { toStoreProduct, useProductStore } from "@/lib/store/product-store";
import type { ApiCategory, ApiProduct } from "@/lib/types";
import { errorMessage, getProductImages, getProductPackagingUnits } from "./product-helpers";
import type { CategoryOption, PackagingUnitForm, ProductImageItem, ProductRecord, SupplierOption } from "./types";
import type { ProductPageQuery } from "./useProductFilters";

interface ProductPageResponse {
  data: ApiProduct[];
  meta: { total: number; page: number; limit: number; totalPages: number; allCount: number };
}

/** Query string of GET /products/page for the table's filters. */
export function productPageUrl(q: ProductPageQuery): string {
  const params = new URLSearchParams({ page: String(q.page), limit: String(q.limit) });
  if (q.search) params.set("q", q.search);
  if (q.categoryId && q.categoryId !== "all") params.set("categoryId", q.categoryId);
  if (q.supplierId && q.supplierId !== "all") params.set("supplierId", q.supplierId);
  if (q.stock && q.stock !== "all") params.set("stock", q.stock);
  if (q.sort) {
    params.set("sort", q.sort);
    params.set("dir", q.dir);
  }
  return `/products/page?${params.toString()}`;
}

/**
 * Products page data: one page of the table from the server (GET /products/page: filtered, searched, sorted
 * and paged by the database), categories and suppliers. The whole catalogue (product store, delta-synced) is
 * loaded only when something needs every product: export, import diff, bundle item picker.
 */
export function useProducts(query: ProductPageQuery) {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [allCount, setAllCount] = useState(0);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allPackaging, setAllPackaging] = useState<Record<string, PackagingUnitForm[]>>({});
  const [allImages, setAllImages] = useState<Record<string, ProductImageItem[]>>({});
  const [catalog, setCatalog] = useState<ProductRecord[]>([]);
  const url = productPageUrl(query);
  const latestUrl = useRef(url);

  /** Loads the current page; state is only updated after the request (and only for the latest query). */
  const fetchPage = useCallback(async (pageUrl: string) => {
    try {
      const res = await apiFetch<ProductPageResponse>(pageUrl);
      if (latestUrl.current !== pageUrl) return;
      const rows = (Array.isArray(res?.data) ? res.data : []).map(toStoreProduct) as ProductRecord[];
      const pkgMap: Record<string, PackagingUnitForm[]> = {};
      const imgMap: Record<string, ProductImageItem[]> = {};
      rows.forEach((p) => {
        pkgMap[p.id] = getProductPackagingUnits(p);
        imgMap[p.id] = getProductImages(p);
      });
      setProducts(rows);
      setTotal(Number(res?.meta?.total) || 0);
      setAllCount(Number(res?.meta?.allCount) || 0);
      setAllPackaging(pkgMap);
      setAllImages(imgMap);
      setLoadError(null);
    } catch (err) {
      if (latestUrl.current !== pageUrl) return;
      setProducts([]);
      setTotal(0);
      setLoadError(errorMessage(err) || "ติดต่อเซิร์ฟเวอร์ไม่ได้");
    } finally {
      if (latestUrl.current === pageUrl) setLoading(false);
    }
  }, []);

  useEffect(() => {
    latestUrl.current = url;
    const run = async () => { await fetchPage(url); };
    void run();
  }, [url, fetchPage]);

  // categories + suppliers once
  useEffect(() => {
    const run = async () => {
      try {
        const cats = await apiFetch<ApiCategory[] | null>("/categories");
        setCategories(cacheServerCategories(cats) as CategoryOption[]);
      } catch (err) {
        setLoadError((prev) => prev || errorMessage(err) || "ติดต่อเซิร์ฟเวอร์ไม่ได้");
      }
      try {
        const supps: unknown = await apiFetch("/suppliers");
        setSuppliers(Array.isArray(supps) ? (supps as SupplierOption[]) : []);
      } catch (err) {
        setSuppliers([]);
        setLoadError((prev) => prev || errorMessage(err) || "ติดต่อเซิร์ฟเวอร์ไม่ได้");
      }
    };
    void run();
  }, []);

  /** Reload the current page (retry button / after saving). */
  const loadData = useCallback(() => {
    setLoading(true);
    void fetchPage(latestUrl.current);
  }, [fetchPage]);

  /** Re-read the current page from the server (after bulk changes). */
  const refreshProducts = useCallback(async () => {
    await fetchPage(latestUrl.current);
  }, [fetchPage]);

  /** Every product (product store catalogue: full load the first time, then only changes). Throws on failure. */
  const ensureCatalog = useCallback(async (): Promise<ProductRecord[]> => {
    await useProductStore.getState().fetchProducts();
    const st = useProductStore.getState();
    if (st.error) throw new Error(st.error);
    const list = st.products as ProductRecord[];
    setCatalog(list);
    return list;
  }, []);

  return {
    products, total, allCount,
    categories, suppliers,
    loading, loadError,
    allPackaging, setAllPackaging,
    allImages, setAllImages,
    loadData, refreshProducts,
    catalog, ensureCatalog,
  };
}

export type ProductsData = ReturnType<typeof useProducts>;
