"use client";

import { Gift, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { qtyInputMode, qtyStep, useAllowDecimalQty } from "@/lib/qty";
import type { BundleItemForm, ProductForm, ProductRecord, SetForm } from "../types";

function BundleSummary({ bundleItems, products }: { bundleItems: BundleItemForm[]; products: ProductRecord[] }) {
  const totalComponentPrice = bundleItems.reduce((sum, bi) => {
    const child = products.find((p) => p.id === bi.childProductId);
    const pPrice = child ? Number(child.priceLevel1 ?? child.basePrice ?? 0) : 0;
    return sum + pPrice * (Number(bi.quantity) || 1);
  }, 0);

  const totalComponentCost = bundleItems.reduce((sum, bi) => {
    const child = products.find((p) => p.id === bi.childProductId);
    const pCost = child ? Number(child.costPrice ?? child.basePrice ?? 0) : 0;
    return sum + pCost * (Number(bi.quantity) || 1);
  }, 0);

  const maxPossibleSets = bundleItems.length > 0 && bundleItems.every(bi => bi.childProductId)
    ? Math.min(
        ...bundleItems.map((bi) => {
          const child = products.find((p) => p.id === bi.childProductId);
          const childStock = child ? Number(child.stock ?? 0) : 0;
          return Math.floor(childStock / Math.max(1, Number(bi.quantity) || 1));
        })
      )
    : 0;

  return (
    <div className="p-3.5 bg-purple-100/60 rounded-xl border border-purple-200 grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
      <div>
        <span className="text-slate-500 block">ราคาสินค้าปกติรวมกัน:</span>
        <span className="text-sm font-bold text-slate-800">{formatCurrency(totalComponentPrice)}</span>
      </div>
      <div>
        <span className="text-slate-500 block">ต้นทุนสินค้ารวมกัน:</span>
        <span className="text-sm font-bold text-slate-800">{formatCurrency(totalComponentCost)}</span>
      </div>
      <div>
        <span className="text-slate-500 block">สต็อกชุดที่จัดได้สูงสุด:</span>
        <span className={`text-sm font-black ${maxPossibleSets > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
          {maxPossibleSets.toLocaleString()} ชุด
        </span>
      </div>
    </div>
  );
}

/** Components of a bundle product (child product + quantity per set) with price / cost / max-sets summary. */
export function BundleItemsSection({ form, setForm, products, editingProductId }: {
  form: ProductForm;
  setForm: SetForm;
  products: ProductRecord[];
  editingProductId?: string;
}) {
  const allowDecimalQty = useAllowDecimalQty();

  const addBundleItem = () => {
    setForm((f) => ({
      ...f,
      bundleItems: [...f.bundleItems, { childProductId: "", quantity: 1 }],
    }));
  };

  const removeBundleItem = (idx: number) => {
    setForm((f) => ({
      ...f,
      bundleItems: f.bundleItems.filter((_, i) => i !== idx),
    }));
  };

  const updateBundleItem = <K extends keyof BundleItemForm>(idx: number, field: K, val: BundleItemForm[K]) => {
    setForm((f) => ({
      ...f,
      bundleItems: f.bundleItems.map((item, i) => (i === idx ? { ...item, [field]: val } : item)),
    }));
  };

  return (
    <section className="rounded-xl border-2 border-purple-200 bg-purple-50/20 p-5 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 pb-3 border-b border-purple-100">
        <div className="flex items-center gap-2">
          <Gift className="h-5 w-5 text-purple-600 shrink-0" />
          <div>
            <h3 className="font-bold text-slate-900 text-base">รายการสินค้าในชุด (Bundle Items)</h3>
            <p className="text-xs text-slate-500">เลือกสินค้าและจำนวนที่จะรวมอยู่ในชุดนี้ เมื่อขายจะตัดสต็อกและเคลมแยกชิ้นตามรายการนี้</p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 text-xs border-purple-400 bg-white text-purple-700 hover:bg-purple-50 font-bold shadow-2xs cursor-pointer"
          onClick={addBundleItem}
        >
          <Plus className="w-3.5 h-3.5 mr-1" /> เพิ่มสินค้าเข้าชุด
        </Button>
      </div>

      {form.bundleItems.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-purple-200 bg-white/70 py-6 text-center text-sm text-slate-400">
          <Gift className="w-8 h-8 mx-auto text-purple-300 mb-2" />
          <p className="font-medium text-slate-600">ยังไม่มีรายการสินค้าในชุด</p>
          <p className="text-xs text-slate-400 mt-0.5">คลิก &quot;เพิ่มสินค้าเข้าชุด&quot; เพื่อเลือกสินค้ามารวมเป็นเซ็ต</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {form.bundleItems.map((bi, idx) => {
            const child = products.find((p) => p.id === bi.childProductId);
            const childPrice = child ? Number(child.priceLevel1 ?? child.basePrice ?? 0) : 0;
            const childStock = child ? Number(child.stock ?? 0) : 0;
            const itemLineTotal = childPrice * (Number(bi.quantity) || 1);

            return (
              <div
                key={idx}
                className="bg-white p-3 rounded-xl border border-purple-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 space-y-1 min-w-[200px]">
                  <label className="text-xs font-semibold text-slate-600">สินค้าส่วนประกอบ #{idx + 1}</label>
                  <select
                    value={bi.childProductId}
                    onChange={(e) => updateBundleItem(idx, "childProductId", e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-purple-500 font-medium text-slate-800"
                  >
                    <option value="">-- เลือกสินค้า --</option>
                    {products
                      .filter((p) => p.id !== editingProductId && !p.isBundle)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name} ({p.sku}) - สต็อก: {p.stock ?? 0} {p.unit || "ชิ้น"}
                        </option>
                      ))}
                  </select>
                </div>

                <div className="w-32 space-y-1">
                  <label className="text-xs font-semibold text-slate-600">จำนวนใน 1 ชุด</label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={qtyStep(allowDecimalQty)}
                      step={qtyStep(allowDecimalQty)}
                      inputMode={qtyInputMode(allowDecimalQty)}
                      value={bi.quantity}
                      onChange={(e) => updateBundleItem(idx, "quantity", e.target.value)}
                      className="h-9 border-slate-300 font-bold text-center"
                    />
                    <span className="text-xs text-slate-500 shrink-0">{child?.unit || "ชิ้น"}</span>
                  </div>
                </div>

                <div className="text-right sm:w-36 space-y-0.5">
                  <div className="text-[11px] text-slate-400">ราคาปกติ/ชิ้น: {formatCurrency(childPrice)}</div>
                  <div className="text-xs font-bold text-slate-700">
                    รวม {formatCurrency(itemLineTotal)}
                  </div>
                  <div className="text-[10px] text-slate-400">สต็อกคงเหลือ: {childStock}</div>
                </div>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-rose-500 hover:bg-rose-50 self-end sm:self-center cursor-pointer"
                  onClick={() => removeBundleItem(idx)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}

          {/* Summary card for Bundle */}
          <BundleSummary bundleItems={form.bundleItems} products={products} />
        </div>
      )}
    </section>
  );
}
