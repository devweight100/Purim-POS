"use client";

import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import { toast } from "sonner";
import { api, apiFetch } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { askConfirm } from "@/lib/ask-dialog";
import { hasPermission } from "@/lib/permissions";
import { decimalQtyEnabled, formatQty } from "@/lib/qty";
import { useAuthStore } from "@/lib/store/auth-store";
import { getLowStockThreshold } from "@/lib/store-settings-storage";
import { useProductStore } from "@/lib/store/product-store";
import { errorMessage, errorStatus, makeInitialForm, productToApiPayload, productToForm } from "./product-helpers";
import type { ProductsData } from "./useProducts";
import type { ProductForm, ProductRecord, SetForm, UpdateForm } from "./types";

/** Add / edit dialog state and saving (server first; the dialog stays open with the typed form on failure). */
export function useProductForm(data: ProductsData, setExpandedRows: Dispatch<SetStateAction<Set<string>>>) {
  const [dialogMode, setDialogMode] = useState<"add" | "edit" | null>(null);
  const [editingProduct, setEditingProduct] = useState<ProductRecord | null>(null);
  const [form, setFormState] = useState<ProductForm>(makeInitialForm);
  /** edit: the stock the form showed when it opened (sent as expectedStock; null = adding) */
  const [stockSeen, setStockSeen] = useState<number | null>(null);
  /** the stock field may change stock (same permission as the stock adjustment, MANAGE_INVENTORY) */
  const canEditStock = hasPermission(useAuthStore((st) => st.user), "MANAGE_INVENTORY");

  const setForm: SetForm = useCallback((updater) => setFormState(updater), []);
  const updateForm: UpdateForm = useCallback((key, value) => setFormState(prev => ({ ...prev, [key]: value })), []);

  const handleOpenAdd = () => {
    setFormState(makeInitialForm());
    setStockSeen(null);
    setEditingProduct(null);
    setDialogMode("add");
  };

  const handleOpenEdit = (p: ProductRecord) => {
    setEditingProduct(p);
    const f = productToForm(p);
    setFormState(f);
    const listed = Number(p.stock ?? 0) || 0;
    setStockSeen(listed);
    setDialogMode("edit");
    // the list may be a few minutes old: show the stock as it is now (unless the user already typed one)
    void apiFetch<{ computedStock?: number | string }>(`/products/${encodeURIComponent(p.id)}/stock`).then((r) => {
      const now = Number(r?.computedStock);
      if (!Number.isFinite(now) || now === listed) return;
      let applied = false;
      setFormState((prev) => {
        if (prev.stock !== f.stock) return prev;
        applied = true;
        return { ...prev, stock: String(now) };
      });
      if (applied) setStockSeen(now);
    }, () => undefined);
  };

  /**
   * "สร้างสินค้าคล้ายกัน": the add form prefilled from `p` - name + " (สำเนา)", prices, cost, unit, category, packs,
   * wholesale steps, suppliers and bundle items. Not copied: the SKU (the server makes a new one), barcodes and pack
   * barcodes (they belong to one product only), photos and stock.
   */
  const handleOpenDuplicate = (p: ProductRecord) => {
    const f = productToForm(p);
    setFormState({
      ...f,
      name: `${f.name} (สำเนา)`,
      sku: "",
      stock: "",
      barcodes: [{ barcode: "", supplierId: "", label: "" }],
      packagingUnits: f.packagingUnits.map((u) => ({ ...u, barcode: "" })),
      images: [],
    });
    setStockSeen(null);
    setEditingProduct(null);
    setDialogMode("add");
  };

  const close = () => setDialogMode(null);

  /**
   * The stock field as sent to the server (docs/product-form-bank-logos.md): add = opening stock (when not 0),
   * edit = the new count with the stock the user saw (only when it changed). null = invalid (message shown).
   */
  const stockPayload = (expected: number | null): { stockQuantity?: number; expectedStock?: number } | null => {
    if (form.isBundle || !canEditStock) return {};
    const text = form.stock.trim().replace(/,/g, "");
    const n = text === "" ? 0 : Number(text);
    if (!Number.isFinite(n) || n < 0) { toast.error("จำนวนสต็อกต้องเป็นตัวเลขตั้งแต่ 0 ขึ้นไป"); return null; }
    if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) { toast.error("จำนวนสต็อกมีทศนิยมได้ไม่เกิน 2 ตำแหน่ง"); return null; }
    if (!decimalQtyEnabled() && !Number.isInteger(n)) { toast.error("ร้านตั้งค่าให้ใช้จำนวนเต็มเท่านั้น (ตั้งค่า > จำนวนทศนิยม)"); return null; }
    if (!editingProduct?.id) return n !== 0 ? { stockQuantity: n } : {};
    if (expected === null || Math.round(n * 100) === Math.round(expected * 100)) return {};
    return { stockQuantity: n, expectedStock: expected };
  };

  const handleSave = async (opts: { expectedStock?: number } = {}) => {
    if (!form.name.trim()) { toast.error("กรุณาระบุชื่อสินค้า"); return; }
    const stockPart = stockPayload(opts.expectedStock ?? stockSeen);
    if (!stockPart) return;
    if (form.isBundle) {
      const validItems = form.bundleItems.filter((bi) => bi.childProductId);
      if (validItems.length === 0) {
        toast.error("สินค้าจัดเซ็ตต้องมีสินค้าส่วนประกอบอย่างน้อย 1 รายการ");
        return;
      }
    }

    // placeholder until the server answers with the new product's id
    let targetId = editingProduct?.id || "prod_new";

    // stock goes to the server as stockQuantity (an audited movement there); the local record keeps the shown value
    const finalStock = editingProduct?.id ? (editingProduct.stock ?? 0) : 0;

    const updatedProductObj: ProductRecord = {
      id: targetId,
      name: form.name.trim(),
      // blank = none (null clears a stored one)
      manufacturerName: form.manufacturerName.replace(/\s+/g, " ").trim() || null,
      sku: form.sku.trim(), // typed code; blank = generated on create / kept on edit (Round B)
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
      const payload = {
        ...productToApiPayload(updatedProductObj),
        ...stockPart,
        // supplier rows of the form (BUG-06: never sent, so they were lost on save). A blank cost is left out:
        // the server then keeps the stored one (users who may not see costs get blank costs in the form).
        supplierEntries: form.supplierEntries
          .filter((e) => e.supplierId)
          .map((e, i) => ({
            supplierId: e.supplierId,
            ...(e.lastCost !== '' && Number.isFinite(Number(e.lastCost)) ? { unitCost: Number(e.lastCost) } : {}),
            // name / code on this supplier's invoices (blank = none)
            supplierProductName: e.supplierProductName.replace(/\s+/g, " ").trim(),
            supplierSku: e.supplierSku.replace(/\s+/g, " ").trim(),
            isPreferred: i === 0,
          })),
      };
      persistedProduct = editingProduct?.id
        ? await api.products.update(editingProduct.id, payload)
        : await api.products.create(payload);
      targetId = persistedProduct?.id || targetId;
    } catch (err) {
      // the stock changed after the form opened (a sale / receipt / adjustment elsewhere): ask, never overwrite blindly
      if (err instanceof ApiError && err.status === 409 && (err.data as { code?: string } | undefined)?.code === "STOCK_CHANGED") {
        const current = Number((err.data as { currentStock?: unknown }).currentStock);
        const unit = form.unit.trim() || "ชิ้น";
        const typed = stockPart.stockQuantity ?? 0;
        const setIt = await askConfirm({
          title: "สต็อกของสินค้านี้เปลี่ยนระหว่างที่แก้ไข",
          description: `ตอนเปิดฟอร์ม: ${formatQty(stockPart.expectedStock ?? 0, { grouping: true })} ${unit}\nตอนนี้: ${formatQty(current, { grouping: true })} ${unit} (มีการขาย รับเข้า หรือปรับสต็อกจากที่อื่น)\n\nยังไม่ได้บันทึกอะไร ต้องการตั้งสต็อกเป็น ${formatQty(typed, { grouping: true })} ${unit} ตามที่พิมพ์หรือไม่?`,
          confirmLabel: `ตั้งเป็น ${formatQty(typed, { grouping: true })} ${unit}`,
          cancelLabel: "ใช้ยอดปัจจุบัน",
          testId: "stock-changed-dialog",
        });
        setStockSeen(current);
        if (setIt) return handleSave({ expectedStock: current });
        setFormState((prev) => ({ ...prev, stock: String(current) }));
        toast.info(`ใช้สต็อกปัจจุบัน ${formatQty(current, { grouping: true })} ${unit} ตรวจสอบแล้วกดบันทึกอีกครั้ง`);
        return;
      }
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
    void useProductStore.getState().refreshIfLoaded();

    data.setAllPackaging(prev => ({ ...prev, [savedId]: form.packagingUnits }));
    if (form.packagingUnits.length > 0) setExpandedRows(prev => new Set([...prev, savedId]));
    data.setAllImages(prev => ({ ...prev, [savedId]: form.images }));

    toast.success(`${dialogMode === "edit" ? "แก้ไข" : "เพิ่ม"}สินค้าสำเร็จ`);
    setDialogMode(null);
  };

  return { dialogMode, editingProduct, form, setForm, updateForm, handleOpenAdd, handleOpenEdit, handleOpenDuplicate, handleSave, close, stockSeen, canEditStock };
}

export type ProductFormState = ReturnType<typeof useProductForm>;
