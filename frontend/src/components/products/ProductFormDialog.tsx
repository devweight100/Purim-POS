"use client";

import { useEffect } from "react";
import { PackagePlus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BarcodesSection } from "./form/BarcodesSection";
import { BundleItemsSection } from "./form/BundleItemsSection";
import { PackagingUnitsSection } from "./form/PackagingUnitsSection";
import { PricesSection, WholesaleSection } from "./form/PricingSections";
import { ProductDetailsSection } from "./form/ProductDetailsSection";
import { ProductImagesSection } from "./form/ProductImagesSection";
import { SupplierCostSection } from "./form/SupplierCostSection";
import type { ProductFormState } from "./useProductForm";
import type { CategoryOption, ProductRecord, SupplierOption } from "./types";

/** Add / edit product dialog: images, details, bundle, barcodes, suppliers & cost, prices, pack units, wholesale. */
export function ProductFormDialog({ state, products, onNeedCatalog, categories, suppliers }: {
  state: ProductFormState;
  /** every product (bundle item picker); loaded with onNeedCatalog when a bundle is edited */
  products: ProductRecord[];
  onNeedCatalog: () => Promise<unknown>;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
}) {
  const { dialogMode, editingProduct, form, setForm, updateForm, handleSave, close } = state;
  const needCatalog = dialogMode !== null && form.isBundle;
  useEffect(() => {
    if (needCatalog) void onNeedCatalog().catch(() => undefined);
  }, [needCatalog, onNeedCatalog]);

  return (
    <Dialog open={dialogMode !== null} onOpenChange={open => { if (!open) close(); }}>
      <DialogContent className="flex flex-col bg-white p-0 text-slate-900 sm:max-w-5xl max-h-[92dvh] overflow-hidden gap-0">
        <DialogHeader className="border-b border-slate-200 px-6 py-4 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            {dialogMode === "edit" ? <><Pencil className="h-5 w-5 text-primary" /> แก้ไขสินค้า: {editingProduct?.name}</> : <><PackagePlus className="h-5 w-5 text-primary" /> เพิ่มสินค้าใหม่</>}
          </DialogTitle>
        </DialogHeader>
        {/* ✅ เพิ่ม pb-6 กัน content ไม่ชนกับ footer */}
        <div className="flex-1 overflow-y-auto px-6 py-5 pb-6">
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
            <div className="space-y-5">
              {/* 0. รูปภาพสินค้า */}
              <ProductImagesSection images={form.images} setForm={setForm} />
              {/* 1. รายละเอียดสินค้า */}
              <ProductDetailsSection form={form} updateForm={updateForm} categories={categories} currentStock={editingProduct ? (editingProduct.stock ?? 0) : 0} />
              {/* รายการสินค้าในชุด (Bundle Items) */}
              {form.isBundle && <BundleItemsSection form={form} setForm={setForm} products={products} editingProductId={editingProduct?.id} />}
              {/* 2. บาร์โค้ดทั้งหมด */}
              <BarcodesSection form={form} setForm={setForm} suppliers={suppliers} />
              {/* 3. ผู้จำหน่ายและต้นทุน */}
              <SupplierCostSection form={form} setForm={setForm} updateForm={updateForm} suppliers={suppliers} />
              {/* 4. ราคาขาย */}
              <PricesSection form={form} updateForm={updateForm} />
              {/* 5. Packaging units */}
              <PackagingUnitsSection form={form} setForm={setForm} updateForm={updateForm} />
            </div>

            {/* Right: Wholesale */}
            <div>
              <WholesaleSection steps={form.wholesaleSteps} setForm={setForm} />
            </div>
          </div>
        </div>
        {/* ✅ Footer มี padding ด้านล่าง pb-7 เพื่อเว้นระยะห่างขอบล่างกับปุ่มไม่ให้ชิดกัน */}
        <DialogFooter className="border-t border-slate-200 bg-slate-50 px-6 pt-5 pb-7 shrink-0 flex-row gap-3 justify-end">
          <Button variant="outline" className="border-slate-300 text-slate-600 px-6 h-10 font-medium" onClick={close}>ยกเลิก</Button>
          <Button className={`px-8 h-10 font-bold ${dialogMode === "edit" ? "bg-sky-500 text-white hover:bg-sky-600" : "bg-primary text-white hover:bg-primary/90"}`} onClick={handleSave}>
            {dialogMode === "edit" ? "บันทึกการแก้ไข" : "บันทึกสินค้า"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
