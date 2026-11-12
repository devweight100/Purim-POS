"use client";

import { useMemo } from "react";
import { Building2, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import type { ProductForm, ProductSupplierEntry, SetForm, SupplierOption, UpdateForm } from "../types";

/** Suppliers with their last cost, the average of those costs, and the reference cost field (form.basePrice). */
export function SupplierCostSection({ form, setForm, updateForm, suppliers }: {
  form: ProductForm;
  setForm: SetForm;
  updateForm: UpdateForm;
  suppliers: SupplierOption[];
}) {
  const addSupplierEntry = () => setForm(prev => ({ ...prev, supplierEntries: [...prev.supplierEntries, { supplierId: "", lastCost: "", notes: "" }] }));
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
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Building2 className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-slate-900">ผู้จำหน่ายและต้นทุน</h3>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-primary text-primary hover:bg-primary/5" onClick={addSupplierEntry}>
          <Plus className="w-3 h-3 mr-1" /> เพิ่มผู้จำหน่าย
        </Button>
      </div>

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
          <p>ยังไม่มีผู้จำหน่าย — คลิก &quot;เพิ่มผู้จำหน่าย&quot; เพื่อเพิ่ม</p>
        </div>
      ) : (
        <div className="space-y-2">
          {form.supplierEntries.map((entry, i) => (
            <div key={i} className="grid grid-cols-[1fr_120px_1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                {i === 0 && <label className="text-xs font-medium text-slate-500">ผู้จำหน่าย</label>}
                <select value={entry.supplierId} onChange={e => updateSupplierEntry(i, "supplierId", e.target.value)} className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary">
                  <option value="">เลือกผู้จำหน่าย</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div className="space-y-1">
                {i === 0 && <label className="text-xs font-medium text-slate-500">ต้นทุน/ชิ้น</label>}
                <Input type="number" min="0" step="0.01" value={entry.lastCost} onChange={e => updateSupplierEntry(i, "lastCost", e.target.value)} className="h-9 border-slate-300 text-sm text-right" />
              </div>
              <div className="space-y-1">
                {i === 0 && <label className="text-xs font-medium text-slate-500">หมายเหตุ</label>}
                <Input value={entry.notes} onChange={e => updateSupplierEntry(i, "notes", e.target.value)} className="h-9 border-slate-300 text-sm" />
              </div>
              <Button type="button" variant="ghost" size="icon" className={`h-9 w-9 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50 ${i === 0 ? "mt-5" : ""}`} onClick={() => removeSupplierEntry(i)}>
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          ))}

          {/* Auto-calculated average cost */}
          {avgCostFromSuppliers && (
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm">
              <span className="text-emerald-700">ต้นทุนเฉลี่ยจากทุก supplier:</span>
              <span className="font-bold text-emerald-800">{formatCurrency(parseFloat(avgCostFromSuppliers))}</span>
              <Button type="button" variant="ghost" size="sm" className="ml-auto h-7 text-xs text-emerald-600 hover:text-emerald-800 hover:bg-emerald-100" onClick={() => updateForm("basePrice", avgCostFromSuppliers)}>
                ใช้เป็นต้นทุนอ้างอิง →
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Reference cost */}
      <div className="mt-4 pt-4 border-t border-slate-100 flex items-center gap-3">
        <div className="flex-1 space-y-1.5">
          <label className="text-sm font-medium text-slate-700">ต้นทุนอ้างอิง (สำหรับแสดงผล/ประมาณการ)</label>
          <Input type="number" min="0" step="0.01" value={form.basePrice} onChange={e => updateForm("basePrice", e.target.value)} className="h-10 border-slate-300 text-right max-w-[160px]" />
        </div>
        <p className="text-xs text-slate-400 flex-1">ต้นทุนจริงคำนวณจาก FIFO เมื่อมีการขาย ตัวเลขนี้ใช้แสดงในรายงานประมาณการเท่านั้น</p>
      </div>
    </section>
  );
}
