"use client";

import { Barcode, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProductBarcodeForm, ProductForm, SetForm, SupplierOption } from "../types";

/** Scan barcodes of the product, each optionally tied to a supplier and labelled. */
export function BarcodesSection({ form, setForm, suppliers }: { form: ProductForm; setForm: SetForm; suppliers: SupplierOption[] }) {
  const addBarcode = () => setForm(prev => ({ ...prev, barcodes: [...prev.barcodes, { barcode: "", supplierId: "", label: "" }] }));
  const updateBarcode = (i: number, key: keyof ProductBarcodeForm, val: string) =>
    setForm(prev => ({ ...prev, barcodes: prev.barcodes.map((b, j) => j === i ? { ...b, [key]: val } : b) }));
  const removeBarcode = (i: number) => setForm(prev => ({ ...prev, barcodes: prev.barcodes.filter((_, j) => j !== i) }));

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Barcode className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-slate-900">บาร์โค้ดทั้งหมด</h3>
          <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">สแกนบาร์โค้ดไหนก็ได้ → ตัดสต็อกสินค้าเดียวกัน</span>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-primary text-primary hover:bg-primary/5" onClick={addBarcode}>
          <Plus className="w-3 h-3 mr-1" /> เพิ่มบาร์โค้ด
        </Button>
      </div>
      <div className="space-y-2">
        {form.barcodes.map((b, i) => (
          <div key={i} className="flex gap-2 items-center">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input value={b.barcode} onChange={e => updateBarcode(i, "barcode", e.target.value)} className="h-9 border-slate-300 font-mono text-sm" />
              <select
                value={b.supplierId || ""}
                onChange={e => updateBarcode(i, "supplierId", e.target.value)}
                className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary"
              >
                <option value="">เลือกผู้จำหน่าย (ถ้ามี)</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <Input value={b.label || ""} onChange={e => updateBarcode(i, "label", e.target.value)} className="h-9 border-slate-300 text-sm" />
            </div>
            {form.barcodes.length > 1 && (
              <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removeBarcode(i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">เพิ่มบาร์โค้ดได้หลายอัน และสามารถเลือกผู้จำหน่ายที่ผูกกับแต่ละบาร์โค้ดได้</p>
    </section>
  );
}
