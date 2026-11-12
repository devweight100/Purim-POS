"use client";

import { useCallback, useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { useProductStore } from "@/lib/store/product-store";
import { errorMessage, getProductImages, getProductPackagingUnits } from "./product-helpers";
import type { CategoryOption, PackagingUnitForm, ProductImageItem, ProductRecord, SupplierOption } from "./types";

/** Products, categories and suppliers of the products page, loaded from the server (product store + /suppliers). */
export function useProducts() {
  const [products, setProducts] = useState<ProductRecord[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [allPackaging, setAllPackaging] = useState<Record<string, PackagingUnitForm[]>>({});
  const [allImages, setAllImages] = useState<Record<string, ProductImageItem[]>>({});

  /** Fetches everything; `loading` must already be true (initial state, or set by loadData). */
  const fetchAll = useCallback(async () => {
    await useProductStore.getState().fetchProducts();
    const storeProducts = useProductStore.getState().products;
    const storeCategories = useProductStore.getState().categories;
    setLoadError(useProductStore.getState().error);
    setProducts(storeProducts);
    setCategories(storeCategories);

    const pkgMap: Record<string, PackagingUnitForm[]> = {};
    const imgMap: Record<string, ProductImageItem[]> = {};
    storeProducts.forEach((p) => {
      pkgMap[p.id] = getProductPackagingUnits(p);
      imgMap[p.id] = getProductImages(p);
    });
    setAllPackaging(pkgMap);
    setAllImages(imgMap);

    // Load real suppliers from database API
    try {
      const supps: unknown = await apiFetch('/suppliers');
      if (Array.isArray(supps)) {
        setSuppliers(supps as SupplierOption[]);
      } else {
        setSuppliers([]);
      }
    } catch (err) {
      setSuppliers([]);
      setLoadError((prev) => prev || errorMessage(err) || 'ติดต่อเซิร์ฟเวอร์ไม่ได้');
    }

    setLoading(false);
  }, []);

  const loadData = useCallback(() => {
    setLoading(true);
    void fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    // initial load (loading starts true)
    const run = async () => { await fetchAll(); };
    void run();
  }, [fetchAll]);

  /** Re-read the product list from the server (after bulk changes). */
  const refreshProducts = useCallback(async () => {
    await useProductStore.getState().fetchProducts();
    setProducts(useProductStore.getState().products);
  }, []);

  return {
    products, setProducts,
    categories, suppliers,
    loading, loadError,
    allPackaging, setAllPackaging,
    allImages, setAllImages,
    loadData, refreshProducts,
  };
}

export type ProductsData = ReturnType<typeof useProducts>;
