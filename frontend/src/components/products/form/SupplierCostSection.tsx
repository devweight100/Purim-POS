"use client";

import { useMemo } from "react";
import { Building2, Info, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { NAME_LIMITS } from "@shared/product-names";
import { computeAverageSupplierCost, splitBarcodeList } from "@shared/product-supplier-import";
import type { ProductForm, ProductSupplierEntry, SetForm, SupplierOption, UpdateForm } from "../types";
import { FormSection } from "./FormSection";

/**
 * Unified "ผู้จำหน่าย บาร์โค้ด และต้นทุน" section (docs/product-supplier-excel.md):
 * - Replaces the old separate "บาร์โค้ดทั้งหมด" section so supplier, barcode(s), cost, and invoice name/code are entered once.
 * - Existing unassigned barcodes (e.g. a product with 3 barcodes and no suppliers yet) appear here as separate rows
 *   with blank supplier & cost, ready to be linked.
 */
export function SupplierCostSection({ form, setForm, updateForm, suppliers, onCreateSupplier }: {
  form: ProductForm;
  setForm: SetForm;
  updateForm: UpdateForm;
  suppliers: SupplierOption[];
  /** opens the "new supplier" dialog; omitted when the user may not create suppliers */
  onCreateSupplier?: () => void;
}) {
  const addSupplierEntry = () =>
    setForm((prev) => ({
      ...prev,
      supplierEntries: [
        ...prev.supplierEntries,
        { supplierId: "", barcode: "", lastCost: "", supplierProductName: "", supplierSku: "" },
      ],
    }));

  const updateSupplierEntry = (i: number, key: keyof ProductSupplierEntry, val: string) =>
    setForm((prev) => {
      const oldEntry = prev.supplierEntries[i];
      const supplierEntries = prev.supplierEntries.map((s, j) => (j === i ? { ...s, [key]: val } : s));
      let mainBarcode = prev.mainBarcode;
      if (key === "barcode" && i === 0 && oldEntry) {
        const oldFirst = splitBarcodeList(oldEntry.barcode)[0] || "";
        if (!mainBarcode.trim() || mainBarcode.trim() === oldEntry.barcode.trim() || mainBarcode.trim() === oldFirst) {
          mainBarcode = splitBarcodeList(val)[0] || "";
        }
      }
      return { ...prev, mainBarcode, supplierEntries };
    });

  const removeSupplierEntry = (i: number) =>
    setForm((prev) => {
      const removed = prev.supplierEntries[i];
      const supplierEntries = prev.supplierEntries.filter((_, j) => j !== i);
      let mainBarcode = prev.mainBarcode;
      if (removed) {
        const removedCodes = splitBarcodeList(removed.barcode);
        if (removedCodes.includes(mainBarcode.trim())) {
          mainBarcode = splitBarcodeList(supplierEntries.map((s) => s.barcode))[0] || "";
        }
      }
      return { ...prev, mainBarcode, supplierEntries };
    });

  const avgCostFromSuppliers = useMemo(() => {
    const avg = computeAverageSupplierCost(form.supplierEntries.map((s) => s.lastCost));
    return avg !== null ? avg.toFixed(2) : null;
  }, [form.supplierEntries]);

  const linkedCount = form.supplierEntries.filter((e) => Boolean(e.supplierId)).length;
  const waitingBarcodeCount = form.supplierEntries.filter((e) => !e.supplierId && Boolean(e.barcode.trim())).length;
  const sectionNote = useMemo(() => {
    const parts: string[] = [];
    if (linkedCount > 0) parts.push(`${linkedCount} ผู้จำหน่าย`);
    if (waitingBarcodeCount > 0) parts.push(`${waitingBarcodeCount} บาร์โค้ดรอระบุผู้จำหน่าย`);
    return parts.length > 0 ? parts.join(" · ") : "บาร์โค้ด / ต้นทุน / ชื่อ-รหัสตามบิลผู้ขาย";
  }, [linkedCount, waitingBarcodeCount]);

  return (
    <FormSection
      id="suppliers"
      icon={<Building2 />}
      title="ผู้จำหน่าย บาร์โค้ด และต้นทุน"
      note={sectionNote}
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
          <p className="font-semibold mb-1">ผู้จำหน่าย บาร์โค้ด และต้นทุนในจุดเดียว (FIFO Pool)</p>
          <p>
            สแกนบาร์โค้ดของผู้จำหน่ายรายไหนก็ขายและตัดสต็อกรวมกันในสินค้าเดียวกันได้ทันที · หากผู้จำหน่ายรายเดียวมีหลายบาร์โค้ดให้คั่นด้วยเครื่องหมายจุลภาค (,)
          </p>
        </div>
      </div>

      {form.supplierEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-slate-200 bg-slate-50 py-5 text-center text-sm text-slate-400">
          <Building2 className="w-7 h-7 mx-auto text-slate-200 mb-1" />
          <p>
            ยังไม่มีผู้จำหน่าย — คลิก &quot;เพิ่มแถวผู้จำหน่าย&quot; เพื่อระบุผู้จำหน่าย บาร์โค้ด และต้นทุน
            {suppliers.length === 0 ? " (ยังไม่มีผู้จำหน่ายในระบบ: กด \"+ เพิ่มผู้จำหน่าย\")" : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {form.supplierEntries.map((entry, i) => {
            const supplierName = suppliers.find((s) => s.id === entry.supplierId)?.name;
            const who = supplierName ? `ผู้จำหน่าย ${i + 1} (${supplierName})` : `ผู้จำหน่าย ${i + 1}`;
            const isUnassignedBarcode = !entry.supplierId && Boolean(entry.barcode.trim());
            return (
              <div
                key={i}
                data-testid="supplier-entry"
                className={`space-y-2 rounded-lg border p-3 ${
                  isUnassignedBarcode ? "border-amber-200 bg-amber-50/30" : "border-slate-200 bg-slate-50/40"
                }`}
              >
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_124px_auto] gap-2 items-end">
                  <div className="space-y-1 min-w-0">
                    <label className="text-xs font-medium text-slate-600">
                      ผู้จำหน่าย
                      {isUnassignedBarcode && (
                        <span className="ml-1.5 font-normal text-amber-700">(รอระบุผู้จำหน่าย)</span>
                      )}
                    </label>
                    <select
                      aria-label={`ผู้จำหน่าย ${i + 1}`}
                      value={entry.supplierId}
                      onChange={(e) => updateSupplierEntry(i, "supplierId", e.target.value)}
                      className="h-10 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary"
                    >
                      <option value="">เลือกผู้จำหน่าย</option>
                      {suppliers.map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-1 min-w-0">
                    <label className="text-xs font-medium text-slate-600">บาร์โค้ด (ผู้จำหน่ายนี้)</label>
                    <Input
                      aria-label={`บาร์โค้ด ผู้จำหน่าย ${i + 1}`}
                      placeholder="สแกนหรือพิมพ์ (คั่น , ได้)"
                      value={entry.barcode}
                      onChange={(e) => updateSupplierEntry(i, "barcode", e.target.value)}
                      data-own-enter
                      onKeyDown={(e) => {
                        if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                        e.preventDefault();
                        document.getElementById(`supplier-cost-${i}`)?.focus();
                      }}
                      autoComplete="off"
                      className="border-slate-300 bg-white tabular-nums"
                    />
                  </div>
                  <div className="space-y-1">
                    <label htmlFor={`supplier-cost-${i}`} className="text-xs font-medium text-slate-600">ต้นทุน/ชิ้น</label>
                    <Input
                      id={`supplier-cost-${i}`}
                      aria-label={`ต้นทุน/ชิ้น ผู้จำหน่าย ${i + 1}`}
                      type="number"
                      min="0"
                      step="0.01"
                      value={entry.lastCost}
                      onChange={(e) => updateSupplierEntry(i, "lastCost", e.target.value)}
                      className="border-slate-300 bg-white text-right tabular-nums"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`ลบ${who}`}
                    className="h-10 w-10 shrink-0 text-red-400 hover:text-red-600 hover:bg-red-50"
                    onClick={() => removeSupplierEntry(i)}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_180px_40px] gap-2 items-end">
                  <div className="space-y-1 min-w-0">
                    <label className="text-xs font-medium text-slate-500">
                      ชื่อสินค้าของผู้ขาย <span className="font-normal text-slate-400">(ตามบิลผู้ขาย ไม่บังคับ)</span>
                    </label>
                    <Input
                      aria-label={`ชื่อสินค้าของผู้ขาย ${i + 1}`}
                      maxLength={NAME_LIMITS.supplierProductName}
                      value={entry.supplierProductName}
                      onChange={(e) => updateSupplierEntry(i, "supplierProductName", e.target.value)}
                      className="border-slate-300 bg-white"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-500">รหัสสินค้าของผู้ขาย</label>
                    <Input
                      aria-label={`รหัสสินค้าของผู้ขาย ${i + 1}`}
                      maxLength={NAME_LIMITS.supplierSku}
                      value={entry.supplierSku}
                      onChange={(e) => updateSupplierEntry(i, "supplierSku", e.target.value)}
                      className="border-slate-300 bg-white tabular-nums"
                    />
                  </div>
                </div>
              </div>
            );
          })}

          {/* Auto-calculated average cost */}
          {avgCostFromSuppliers && (
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-2.5 text-sm">
              <span className="text-emerald-700">ต้นทุนเฉลี่ยจากทุก supplier:</span>
              <span className="font-bold text-emerald-800">{formatCurrency(parseFloat(avgCostFromSuppliers))}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="ml-auto text-emerald-600 hover:text-emerald-800 hover:bg-emerald-100"
                onClick={() => updateForm("basePrice", avgCostFromSuppliers)}
              >
                ใช้เป็นต้นทุน →
              </Button>
            </div>
          )}
        </div>
      )}

      <p className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
        ต้นทุนของสินค้าอยู่ด้านบนของฟอร์ม (ช่อง &quot;ต้นทุน&quot;) · ต้นทุนจริงคำนวณจาก FIFO เมื่อมีการขาย
      </p>
    </FormSection>
  );
}
