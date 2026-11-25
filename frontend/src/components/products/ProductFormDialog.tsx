"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import { hasPermission } from "@/lib/permissions";
import { useAuthStore } from "@/lib/store/auth-store";
import { QuickCreateDialog } from "./form/QuickCreateDialog";
import { PackagePlus, Pencil } from "lucide-react";
import { useEnterSubmit } from "@/lib/keyboard/enter-submit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BarcodesSection } from "./form/BarcodesSection";
import { BundleItemsSection } from "./form/BundleItemsSection";
import { PackagingUnitsSection } from "./form/PackagingUnitsSection";
import { WholesaleSection } from "./form/PricingSections";
import { MainFieldsSection } from "./form/MainFieldsSection";
import { ProductDetailsSection } from "./form/ProductDetailsSection";
import { ProductImagesSection } from "./form/ProductImagesSection";
import { SupplierCostSection } from "./form/SupplierCostSection";
import type { ProductFormState } from "./useProductForm";
import type { CategoryOption, ProductRecord, SupplierOption } from "./types";

/**
 * Add / edit product dialog, by priority for fast entry (docs/product-form-bank-logos.md): on top ชื่อสินค้า, ต้นทุน,
 * ราคา 1-5, บาร์โค้ด, รหัสสินค้า, จำนวนสต็อก (Tab order = this order, the name has the focus); below "ข้อมูลเพิ่มเติม":
 * unit / category / details, bundle items, pack units, all barcodes, suppliers, wholesale steps, photos (each section
 * folds). Enter = save (a textarea needs Ctrl+Enter; the barcode fields' Enter = next field, scanners send Enter).
 */
export function ProductFormDialog({ state, products, onNeedCatalog, categories, suppliers, reloadCategories, reloadSuppliers }: {
  state: ProductFormState;
  /** every product (bundle item picker); loaded with onNeedCatalog when a bundle is edited */
  products: ProductRecord[];
  onNeedCatalog: () => Promise<unknown>;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  reloadCategories: () => Promise<void>;
  reloadSuppliers: () => Promise<void>;
}) {
  const { dialogMode, editingProduct, form, setForm, updateForm, handleSave, close, stockSeen, canEditStock } = state;
  // BUG-11: create a missing category / supplier without leaving (or losing) the form
  const user = useAuthStore((st) => st.user);
  const canCreateCategory = hasPermission(user, "MANAGE_INVENTORY");
  const canCreateSupplier = hasPermission(user, "MANAGE_PURCHASES");
  const [quick, setQuick] = useState<null | "category" | "supplier">(null);
  const createCategory = async (name: string) => {
    const created = await apiFetch<{ id: string }>("/categories", { method: "POST", body: JSON.stringify({ name }) });
    await reloadCategories().catch(() => undefined);
    updateForm("categoryId", created.id);
  };
  const createSupplier = async (name: string) => {
    const created = await apiFetch<{ id: string }>("/suppliers", { method: "POST", body: JSON.stringify({ name }) });
    await reloadSuppliers().catch(() => undefined);
    setForm(prev => {
      const blank = prev.supplierEntries.findIndex(e => !e.supplierId);
      const supplierEntries = blank >= 0
        ? prev.supplierEntries.map((e, i) => i === blank ? { ...e, supplierId: created.id } : e)
        : [...prev.supplierEntries, { supplierId: created.id, lastCost: "", supplierProductName: "", supplierSku: "" }];
      return { ...prev, supplierEntries };
    });
  };
  const needCatalog = dialogMode !== null && form.isBundle;
  // Enter anywhere in the form = save (not while the quick "new category / supplier" dialog is open)
  const onEnter = useEnterSubmit(() => handleSave(), { disabled: quick !== null });
  useEffect(() => {
    if (needCatalog) void onNeedCatalog().catch(() => undefined);
  }, [needCatalog, onNeedCatalog]);

  return (
    <Dialog open={dialogMode !== null} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent
        className="flex flex-col bg-white p-0 text-slate-900 sm:max-w-5xl max-h-[92dvh] overflow-hidden gap-0"
        onKeyDown={e => {
          // Ctrl+Enter saves from anywhere too (also from a textarea / button)
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && quick === null) { e.preventDefault(); void handleSave(); return; }
          onEnter(e);
        }}
      >
        <DialogHeader className="border-b border-slate-200 px-6 py-4 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            {dialogMode === "edit" ? <><Pencil className="h-5 w-5 text-primary" /> แก้ไขสินค้า: {editingProduct?.name}</> : <><PackagePlus className="h-5 w-5 text-primary" /> เพิ่มสินค้าใหม่</>}
          </DialogTitle>
        </DialogHeader>
        <div className="flex-1 overflow-y-auto px-6 py-5 pb-6">
          <div className="space-y-4">
            <MainFieldsSection form={form} updateForm={updateForm} setForm={setForm} editing={dialogMode === "edit"} stockSeen={stockSeen} canEditStock={canEditStock} />
            <h3 className="section-title pt-2">ข้อมูลเพิ่มเติม</h3>
            <ProductDetailsSection form={form} updateForm={updateForm} categories={categories} onCreateCategory={canCreateCategory ? () => setQuick("category") : undefined} />
            {form.isBundle && <BundleItemsSection form={form} setForm={setForm} products={products} editingProductId={editingProduct?.id} />}
            <PackagingUnitsSection form={form} setForm={setForm} updateForm={updateForm} />
            <BarcodesSection form={form} setForm={setForm} suppliers={suppliers} />
            <SupplierCostSection form={form} setForm={setForm} updateForm={updateForm} suppliers={suppliers} onCreateSupplier={canCreateSupplier ? () => setQuick("supplier") : undefined} />
            <WholesaleSection steps={form.wholesaleSteps} setForm={setForm} />
            <ProductImagesSection images={form.images} setForm={setForm} />
          </div>
        </div>
        <DialogFooter className="mx-0 mb-0 shrink-0 flex-row items-center justify-end gap-btn border-t border-slate-200 bg-slate-50 px-6 py-4">
          <span className="mr-auto text-sub text-muted-foreground">Enter = บันทึก · Esc = ยกเลิก</span>
          <Button variant="outline" onClick={close}>ยกเลิก</Button>
          <Button onClick={() => void handleSave()} title="Enter">
            {dialogMode === "edit" ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}
          </Button>
        </DialogFooter>
        <QuickCreateDialog
          open={quick === "category"}
          onOpenChange={o => setQuick(o ? "category" : null)}
          title="สร้างหมวดหมู่ใหม่"
          label="ชื่อหมวดหมู่"
          placeholder="เช่น เครื่องดื่ม"
          onCreate={createCategory}
        />
        <QuickCreateDialog
          open={quick === "supplier"}
          onOpenChange={o => setQuick(o ? "supplier" : null)}
          title="เพิ่มผู้จำหน่ายใหม่"
          label="ชื่อบริษัท / ผู้จำหน่าย"
          placeholder="เช่น บริษัท ปุริม ซัพพลาย จำกัด"
          onCreate={createSupplier}
        />
      </DialogContent>
    </Dialog>
  );
}
