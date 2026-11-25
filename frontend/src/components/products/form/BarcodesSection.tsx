"use client";

import { Barcode, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ProductBarcodeForm, ProductForm, SetForm, SupplierOption } from "../types";
import { FormSection } from "./FormSection";

/**
 * Every scan barcode of the product, each optionally tied to a supplier and labelled. The first one is typed at the
 * top of the form (บาร์โค้ด); here it shows read-only with its supplier / label, extra barcodes are typed here.
 */
export function BarcodesSection({ form, setForm, suppliers }: { form: ProductForm; setForm: SetForm; suppliers: SupplierOption[] }) {
  const addBarcode = () => setForm(prev => ({ ...prev, barcodes: [...prev.barcodes, { barcode: "", supplierId: "", label: "" }] }));
  const updateBarcode = (i: number, key: keyof ProductBarcodeForm, val: string) =>
    setForm(prev => ({ ...prev, barcodes: prev.barcodes.map((b, j) => j === i ? { ...b, [key]: val } : b) }));
  const removeBarcode = (i: number) => setForm(prev => ({ ...prev, barcodes: prev.barcodes.filter((_, j) => j !== i) }));

  return (
    <FormSection
      id="barcodes"
      icon={<Barcode />}
      title="บาร์โค้ดทั้งหมด"
      note={`${form.barcodes.filter((b) => b.barcode.trim()).length} รายการ · สแกนอันไหนก็ได้ ตัดสต็อกสินค้าเดียวกัน`}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={addBarcode}>
          <Plus className="w-3 h-3 mr-1" /> เพิ่มบาร์โค้ด
        </Button>
      }
    >
      <div className="space-y-2">
        {form.barcodes.map((b, i) => (
          <div key={i} className="flex gap-2 items-center">
            <div className="flex-1 grid grid-cols-1 sm:grid-cols-3 gap-2">
              {i === 0 ? (
                <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm tabular-nums text-fg" title="แก้ที่ช่องบาร์โค้ดด้านบน">
                  {b.barcode || <span className="text-subtle">ยังไม่มี (ช่องบาร์โค้ดด้านบน)</span>}
                </div>
              ) : (
                <Input aria-label={`บาร์โค้ด ${i + 1}`} value={b.barcode} onChange={e => updateBarcode(i, "barcode", e.target.value)} data-own-enter onKeyDown={e => { if (e.key === "Enter") e.preventDefault(); }} className="border-slate-300 tabular-nums" />
              )}
              <select
                value={b.supplierId || ""}
                onChange={e => updateBarcode(i, "supplierId", e.target.value)}
                className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary"
              >
                <option value="">เลือกผู้จำหน่าย (ถ้ามี)</option>
                {suppliers.map(s => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
              <Input aria-label={`ป้ายบาร์โค้ด ${i + 1}`} placeholder="ป้าย เช่น บาร์โค้ดจากโรงงาน" value={b.label || ""} onChange={e => updateBarcode(i, "label", e.target.value)} className="border-slate-300" />
            </div>
            {form.barcodes.length > 1 && i === 0 && <div aria-hidden className="w-9 shrink-0" />}
            {form.barcodes.length > 1 && i > 0 && (
              <Button type="button" variant="ghost" size="icon" aria-label={`ลบบาร์โค้ด ${i + 1}`} className="h-9 w-9 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removeBarcode(i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-slate-400">เพิ่มบาร์โค้ดได้หลายอัน และสามารถเลือกผู้จำหน่ายที่ผูกกับแต่ละบาร์โค้ดได้</p>
    </FormSection>
  );
}
