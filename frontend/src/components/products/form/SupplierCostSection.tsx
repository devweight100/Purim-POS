"use client";

import { useMemo } from "react";
import { Building2, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { NAME_LIMITS } from "@shared/product-names";
import type { ProductForm, ProductSupplierEntry, SetForm, SupplierOption, UpdateForm } from "../types";
import { FormSection } from "./FormSection";

/** Suppliers with their last cost and the average of those costs ("ใช้เป็นต้นทุน" fills the cost field at the top). */
export function SupplierCostSection({ form, setForm, updateForm, suppliers, onCreateSupplier }: {
  form: ProductForm;
  setForm: SetForm;
  updateForm: UpdateForm;
  suppliers: SupplierOption[];
  /** opens the "new supplier" dialog; omitted when the user may not create suppliers */
  onCreateSupplier?: () => void;
}) {
  const addSupplierEntry = () => setForm(prev => ({ ...prev, supplierEntries: [...prev.supplierEntries, { supplierId: "", lastCost: "", supplierProductName: "", supplierSku: "" }] }));
  const updateSupplierEntry = (i: number, key: keyof ProductSupplierEntry, val: string) =>
    setForm(prev => ({ ...prev, supplierEntries: prev.supplierEntries.map((s, j) => j === i ? { ...s, [key]: val } : s) }));
  const removeSupplierEntry = (i: number) => setForm(prev => ({ ...prev, supplierEntries: prev.supplierEntries.filter((_, j) => j !== i) }));

  // Auto-calculate average cost from supplier entries
  const avgCostFromSuppliers = useMemo(() => {
    const valid = form.supplierEntries.filter(s => s.lastCost && parseFloat(s.lastCost) > 0);
    if (!valid.length) return null;
    return (valid.reduce((sum, s) => sum + parseFloat(s.lastCost), 0) / valid.length).toFixed(2);
  }, [form.supplierEntries]);

  return (
    <FormSection
      id="suppliers"
      icon={<Building2 />}
      title="ผู้จำหน่ายและต้นทุน"
      note={form.supplierEntries.length ? `${form.supplierEntries.length} ราย` : "ชื่อ / รหัสสินค้าตามบิลผู้ขาย"}
      actions={
        <>
          {onCreateSupplier && (
            <Button type="button" variant="ghost" size="sm" className="text-primary hover:bg-primary/5" onClick={onCreateSupplier}>
              + เพิ่มผู้จำหน่าย
            </Button>
          )}
          <Button type="button" variant="outline" size="sm" onClick={addSupplierEntry}>
            <Plus className="w-3 h-3 mr-1" /> เพิ่มแถวผู้จำหน่าย
          </Button>
        </>
      }
    >
      {/* Cost strategy note */}
      <div className="mb-4 flex gap-2 rounded-lg bg-amber-50 border border-amber-100 px-4 py-3 text-xs text-amber-800">
        <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-500" />
        <div>
          <p className="font-semibold mb-1">กลยุทธ์ต้นทุน (FIFO Pool)</p>
          <p>สต็อกรวมจากทุก supplier เป็น <b>pool เดียว</b> → ตัดสต็อกถูกต้องเสมอ<br />
          ต้นทุนขายคิดแบบ FIFO จาก pool เดียวกัน → อาจคลาดเคลื่อนเล็กน้อยถ้าต้นทุนต่าง supplier ต่างกัน<br />
          แต่ถ้าสินค้าจีนประเภทเดียวกัน ต้นทุนมักใกล้เคียงกัน ≈ยอมรับได้</p>
        </div>
      </div>

      {form.supplierEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-5 text-center text-sm text-slate-400">
          <Building2 className="w-7 h-7 mx-auto text-slate-200 mb-1" />
          <p>ยังไม่มีผู้จำหน่าย — คลิก &quot;เพิ่มแถวผู้จำหน่าย&quot; เพื่อเลือก{suppliers.length === 0 ? " (ยังไม่มีผู้จำหน่ายในระบบ: กด \"+ เพิ่มผู้จำหน่าย\")" : ""}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {form.supplierEntries.map((entry, i) => {
            const supplierName = suppliers.find((s) => s.id === entry.supplierId)?.name;
            const who = supplierName ? `ผู้จำหน่าย ${i + 1} (${supplierName})` : `ผู้จำหน่าย ${i + 1}`;
            return (
              // one supplier = two lines: supplier / cost / remove, then the name + code printed on its invoices
              <div key={i} data-testid="supplier-entry" className={`space-y-2 ${i > 0 ? "border-t border-slate-100 pt-3" : ""}`}>
                <div className="grid grid-cols-[minmax(0,1fr)_120px_auto] gap-2 items-end">
                  <div className="space-y-1 min-w-0">
                    <label className="text-xs font-medium text-slate-500">ผู้จำหน่าย</label>
                    <select aria-label={`ผู้จำหน่าย ${i + 1}`} value={entry.supplierId} onChange={e => updateSupplierEntry(i, "supplierId", e.target.value)} className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
                      <option value="">เลือกผู้จำหน่าย</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">ต้นทุน/ชิ้น</label>
                    <Input aria-label={`ต้นทุน/ชิ้น ผู้จำหน่าย ${i + 1}`} type="number" min="0" step="0.01" value={entry.lastCost} onChange={e => updateSupplierEntry(i, "lastCost", e.target.value)} className="border-slate-300 text-right" />
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`ลบ${who}`} className="h-9 w-9 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removeSupplierEntry(i)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="grid grid-cols-[minmax(0,1fr)_160px_36px] gap-2 items-end">
                  <div className="space-y-1 min-w-0">
                    <label className="text-xs font-medium text-slate-500">ชื่อสินค้าของผู้ขาย <span className="font-normal text-slate-400">(ตามบิลผู้ขาย ไม่บังคับ)</span></label>
                    <Input aria-label={`ชื่อสินค้าของผู้ขาย ${i + 1}`} maxLength={NAME_LIMITS.supplierProductName} value={entry.supplierProductName} onChange={e => updateSupplierEntry(i, "supplierProductName", e.target.value)} className="border-slate-300" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">รหัสสินค้าของผู้ขาย</label>
                    <Input aria-label={`รหัสสินค้าของผู้ขาย ${i + 1}`} maxLength={NAME_LIMITS.supplierSku} value={entry.supplierSku} onChange={e => updateSupplierEntry(i, "supplierSku", e.target.value)} className="border-slate-300 tabular-nums" />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Auto-calculated average cost */}
          {avgCostFromSuppliers && (
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm">
              <span className="text-emerald-700">ต้นทุนเฉลี่ยจากทุก supplier:</span>
              <span className="font-bold text-emerald-800">{formatCurrency(parseFloat(avgCostFromSuppliers))}</span>
              <Button type="button" variant="ghost" size="sm" className="ml-auto text-emerald-600 hover:text-emerald-800 hover:bg-emerald-100" onClick={() => updateForm("basePrice", avgCostFromSuppliers)}>
                ใช้เป็นต้นทุน →
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">ต้นทุนของสินค้าอยู่ด้านบนของฟอร์ม (ช่อง &quot;ต้นทุน&quot;) · ต้นทุนจริงคำนวณจาก FIFO เมื่อมีการขาย</p>
    </FormSection>
  );
}
