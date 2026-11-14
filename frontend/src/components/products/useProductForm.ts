"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getLowStockThreshold } from "@/lib/store-settings-storage";
import { useProductStore } from "@/lib/store/product-store";
import { errorMessage, errorStatus, generateEAN13, makeInitialForm, productToApiPayload, productToForm } from "./product-helpers";
import type { ProductsData } from "./useProducts";
import type { ProductForm, ProductRecord, SetForm, UpdateForm } from "./types";

/** Add / edit dialog state and saving (server first; the dialog stays open with the typed form on failure). */
export function useProductForm(data: ProductsData, setExpandedRows: Dispatch<SetStateAction<Set<string>>>) {
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [form, setFormState] = useState<ProductForm>(makeInitialForm);

  const setForm: SetForm = useCallback((updater) => setFormState(updater), []);
  const updateForm: UpdateForm = useCallback((key, value) => setFormState(prev => ({ ...prev, [key]: value })), []);

  const handleOpenAdd = () => {
    setFormState(makeInitialForm());
    setEditingProduct(null);
    setDialogMode("add");
  };

  const handleOpenEdit = (p: ProductRecord) => {
    setEditingProduct(p);
    setFormState(productToForm(p));
    setDialogMode("edit");
  };

  const close = () => setDialogMode(null);

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error("กรุณาระบุชื่อสินค้า"); return; }
    if (form.isBundle) {
      const validItems = form.bundleItems.filter((bi) => bi.childProductId);
      if (validItems.length === 0) {
        toast.error("สินค้าจัดเซ็ตต้องมีสินค้าส่วนประกอบอย่างน้อย 1 รายการ");
        return;
      }
    }

    let targetId = editingProduct?.id;
    if (!targetId) {
      targetId = "prod_" + Date.now();
    }

    // Stock cannot be edited from product details dialog - must be adjusted via Inventory page for stock card tracking
    const finalStock = editingProduct?.id ? (editingProduct.stock ?? 0) : 0;

    const updatedProductObj: ProductRecord = {
      id: targetId,
      name: form.name.trim(),
      sku: form.sku.trim() || generateEAN13(),
      unit: form.unit.trim(),
      size: form.size.trim(),
      color: form.color.trim(),
      categoryId: form.categoryId,
      // the "ต้นทุนอ้างอิง" field (form.basePrice) is the reference COST; selling price = ราคา 1
      basePrice: form.priceLevel1 ? parseFloat(form.priceLevel1) : null,
      costPrice: form.basePrice !== "" && form.basePrice != null ? parseFloat(form.basePrice) : undefined,
      minStockAlert: form.minStockAlert ? parseInt(form.minStockAlert) : getLowStockThreshold(),
      priceLevel1: form.priceLevel1 ? parseFloat(form.priceLevel1) : null,
      priceLevel2: form.priceLevel2 ? parseFloat(form.priceLevel2) : null,
      priceLevel3: form.priceLevel3 ? parseFloat(form.priceLevel3) : null,
      priceLevel4: form.priceLevel4 ? parseFloat(form.priceLevel4) : null,
      priceLevel5: form.priceLevel5 ? parseFloat(form.priceLevel5) : null,
      stock: finalStock,
      defaultSellingUnitId: form.defaultSellingUnitId || null,
      packagingUnits: form.packagingUnits,
      images: form.images,
      wholesalePrices: form.wholesaleSteps,
      isBundle: Boolean(form.isBundle),
      bundleItems: form.isBundle
        ? form.bundleItems
            .filter((bi) => bi.childProductId)
            .map((bi) => ({
              childProductId: bi.childProductId,
              quantity: Math.max(1, Number(bi.quantity) || 1),
            }))
        : [],
      barcodes: form.barcodes.filter(b => b.barcode.trim()).map(b => ({
        barcode: b.barcode.trim(),
        supplierId: b.supplierId || "",
        label: b.label || "",
      })),
    };

    let persistedProduct: Partial<ProductRecord> | null = null;
    try {
      const payload = productToApiPayload(updatedProductObj);
      persistedProduct = editingProduct?.id
        ? await api.products.update(editingProduct.id, payload)
        : await api.products.create(payload);
      targetId = persistedProduct?.id || targetId;
    } catch (err) {
      // Not saved: keep the dialog open with the form as typed, never add a local-only product
      const offline = !(Number(errorStatus(err)) > 0); // ApiError status 0 = no answer from the server
      toast.error(
        offline
          ? 'บันทึกสินค้าไม่สำเร็จ: เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่อีกครั้ง'
          : `บันทึกสินค้าไม่สำเร็จ: ${errorMessage(err) || 'เกิดข้อผิดพลาด'}`
      );
      return;
    }

    const savedId = targetId;

    // show the saved row as the server lists it (its page / position may change with the sort)
    await data.refreshProducts();
    void useProductStore.getState().fetchProducts();

    data.setAllPackaging(prev => ({ ...prev, [savedId]: form.packagingUnits }));
    if (form.packagingUnits.length > 0) setExpandedRows(prev => new Set([...prev, savedId]));
    data.setAllImages(prev => ({ ...prev, [savedId]: form.images }));

    toast.success(`${dialogMode === "edit" ? "แก้ไข" : "เพิ่ม"}สินค้าสำเร็จ`);
    setDialogMode(null);
  };

  return { dialogMode, editingProduct, form, setForm, updateForm, handleOpenAdd, handleOpenEdit, handleSave, close };
}

export type ProductFormState = ReturnType<typeof useProductForm>;
