"use client";

import { useMemo } from "react";
import { Layers, Plus, RefreshCw, Tags, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { computeMultipliers, emptyPackagingUnit, generateEAN13 } from "../product-helpers";
import { PRICE_LEVELS, priceLevelKey, type PackagingUnitForm, type ProductForm, type SetForm, type UpdateForm } from "../types";

/** Pack units (แพ็ค / ลัง ...) built on the smallest unit, each with barcode and prices 1-5, plus the default selling unit. */
export function PackagingUnitsSection({ form, setForm, updateForm }: { form: ProductForm; setForm: SetForm; updateForm: UpdateForm }) {
  const addPackagingUnit = () => setForm(prev => ({ ...prev, packagingUnits: [...prev.packagingUnits, emptyPackagingUnit()] }));
  const updatePackagingUnit = (i: number, key: keyof PackagingUnitForm, val: string) =>
    setForm(prev => ({ ...prev, packagingUnits: prev.packagingUnits.map((u, j) => j === i ? { ...u, [key]: val } : u) }));
  const removePackagingUnit = (i: number) => setForm(prev => ({ ...prev, packagingUnits: prev.packagingUnits.filter((_, j) => j !== i) }));

  const packagingMultipliers = useMemo(() => computeMultipliers(form.packagingUnits), [form.packagingUnits]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Layers className="h-4 w-4 text-primary" />
          <h3 className="font-semibold text-slate-900">สินค้าสัมพันธ์ — หน่วยบรรจุ</h3>
        </div>
        <Button type="button" variant="outline" size="sm" className="h-8 text-xs border-primary text-primary hover:bg-primary/5" onClick={addPackagingUnit}>
          <Plus className="w-3 h-3 mr-1" /> เพิ่มหน่วยบรรจุ
        </Button>
      </div>

      {form.packagingUnits.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-6 text-center text-sm text-slate-400">
          <Layers className="w-7 h-7 mx-auto text-slate-200 mb-1" />
          <p>ยังไม่มีหน่วยบรรจุ — คลิก &quot;เพิ่มหน่วยบรรจุ&quot; เพื่อเพิ่ม</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-lg bg-slate-50 px-4 py-2.5 text-sm border border-slate-200">
            <div className="w-6 h-6 rounded-full bg-slate-400 text-white flex items-center justify-center text-xs font-bold shrink-0">0</div>
            <span className="text-slate-500">หน่วยย่อยสุด:</span>
            <span className="font-bold text-slate-900">{form.unit || "—"}</span>
            <span className="ml-auto text-xs text-slate-400 bg-slate-200 px-2 py-0.5 rounded">× 1</span>
          </div>
          {form.packagingUnits.map((unit, idx) => {
            const multiplier = packagingMultipliers[idx];
            const prevName = idx === 0 ? (form.unit || "หน่วยย่อย") : form.packagingUnits[idx - 1].name || `หน่วย ${idx}`;
            const autoCost = form.basePrice ? (parseFloat(form.basePrice) * multiplier).toFixed(2) : "";
            return (
              <div key={idx} className="rounded-xl border border-slate-200 bg-slate-50 overflow-hidden">
                <div className="flex items-center justify-between bg-sky-50 border-b border-sky-100 px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-sky-500 text-white flex items-center justify-center text-xs font-bold shrink-0">{idx + 1}</div>
                    <span className="text-sm font-semibold text-sky-900">หน่วยบรรจุ #{idx + 1}</span>
                    {multiplier > 1 && <span className="text-xs text-sky-600 bg-sky-100 px-2 py-0.5 rounded-full font-medium">1 {unit.name || "หน่วยนี้"} = {multiplier.toLocaleString()} {form.unit || "หน่วยย่อย"}</span>}
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="h-7 w-7 text-red-400 hover:text-red-600 hover:bg-red-50" onClick={() => removePackagingUnit(idx)}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
                <div className="p-4 space-y-4">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600">ชื่อหน่วย</label>
                      <Input value={unit.name} onChange={e => updatePackagingUnit(idx, "name", e.target.value)} className="h-9 border-slate-300 bg-white text-sm" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600">จำนวน {prevName} ต่อ 1 {unit.name || "หน่วยนี้"}</label>
                      <Input type="number" min="1" value={unit.qtyPerPrev} onChange={e => updatePackagingUnit(idx, "qtyPerPrev", e.target.value)} className="h-9 border-slate-300 bg-white text-sm text-right" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-slate-600">บาร์โค้ดหน่วยนี้</label>
                      <div className="flex gap-1">
                        <Input value={unit.barcode} onChange={e => updatePackagingUnit(idx, "barcode", e.target.value)} className="h-9 border-slate-300 bg-white text-sm font-mono flex-1" />
                        <Button type="button" variant="ghost" size="icon" className="h-9 w-9 shrink-0 text-slate-400 hover:text-primary" onClick={() => updatePackagingUnit(idx, "barcode", generateEAN13())}><RefreshCw className="w-3.5 h-3.5" /></Button>
                      </div>
                    </div>
                  </div>
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Tags className="w-3.5 h-3.5 text-primary" />
                      <label className="text-xs font-semibold text-slate-700 uppercase tracking-wide">ราคาขาย 1–5 ของ {unit.name || "หน่วยนี้"}</label>
                      {autoCost && <span className="text-xs text-slate-400">(ต้นทุน ≈ {formatCurrency(parseFloat(autoCost))})</span>}
                    </div>
                    <div className="grid grid-cols-5 gap-2">
                      {PRICE_LEVELS.map(n => (
                        <div key={n} className="space-y-1">
                          <label className="text-[10px] text-slate-500">ราคา {n}</label>
                          <Input type="number" min="0" step="0.01" value={unit[priceLevelKey(n)]} onChange={e => updatePackagingUnit(idx, priceLevelKey(n), e.target.value)} className="h-8 border-slate-300 bg-white text-xs text-right" />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Default Selling Unit Picker */}
      <div className="mt-4 pt-4 border-t border-slate-200">
        <label className="text-sm font-bold text-slate-900 block mb-1">
          🎯 หน่วยเริ่มต้นในการขาย (Default Selling Unit)
        </label>
        <p className="text-xs text-slate-500 mb-2">
          เลือกหน่วยที่จะถูกเลือกเป็นค่าเริ่มต้นเมื่อพิมพ์ค้นหาในหน้าขาย POS (หากไม่ระบุ ระบบจะใช้หน่วยย่อยสุดเป็นค่าเริ่มต้น)
        </p>
        <select
          value={form.defaultSellingUnitId || ""}
          onChange={e => updateForm("defaultSellingUnitId", e.target.value)}
          className="h-10 w-full sm:w-80 rounded-lg border border-slate-300 bg-white px-3 text-sm font-bold text-slate-800 outline-none focus:border-primary"
        >
          <option value="">หน่วยย่อยสุด ({form.unit || "ชิ้น"}) — ค่าเริ่มต้นระบบ</option>
          {form.packagingUnits.map((u, i) => (
            <option key={i} value={u.name}>
              {u.name} (1 {u.name} = {packagingMultipliers[i]} {form.unit || "หน่วยย่อย"})
            </option>
          ))}
        </select>
      </div>
    </section>
  );
}
