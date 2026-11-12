"use client";

import { Tags, Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { qtyStep, useAllowDecimalQty } from "@/lib/qty";
import { PRICE_LEVELS, priceLevelKey, type ProductForm, type SetForm, type UpdateForm, type WholesaleStepForm } from "../types";

/** Selling prices 1-5 of the smallest unit. */
export function PricesSection({ form, updateForm }: { form: ProductForm; updateForm: UpdateForm }) {
  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="mb-3 flex items-center gap-2">
        <Tags className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-slate-900">ราคาขาย 1–5 <span className="text-slate-400 font-normal text-sm">(หน่วยย่อยสุด: {form.unit || "—"})</span></h3>
      </div>
      <div className="grid gap-3 grid-cols-5">
        {PRICE_LEVELS.map(n => (
          <div key={n} className="space-y-1.5">
            <label className="text-xs font-medium text-slate-600">ราคา {n}</label>
            <Input type="number" min="0" step="0.01" value={form[priceLevelKey(n)]} onChange={e => updateForm(priceLevelKey(n), e.target.value)} className="h-9 border-slate-300 text-right text-sm" />
          </div>
        ))}
      </div>
    </section>
  );
}

/** Wholesale price steps (from quantity -> unit price), right column of the form. */
export function WholesaleSection({ steps, setForm }: { steps: WholesaleStepForm[]; setForm: SetForm }) {
  const allowDecimalQty = useAllowDecimalQty();
  const updateWholesale = (i: number, key: keyof WholesaleStepForm, val: string) =>
    setForm(prev => ({ ...prev, wholesaleSteps: prev.wholesaleSteps.map((s, j) => j === i ? { ...s, [key]: val } : s) }));

  return (
    <section className="rounded-xl border border-slate-200 bg-slate-50 p-5 sticky top-4">
      <div className="mb-3 flex items-center gap-2">
        <Truck className="h-4 w-4 text-primary" />
        <h3 className="font-semibold text-slate-900">ราคาส่ง 5 Step</h3>
      </div>
      <div className="space-y-3">
        {steps.map((step, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="mb-1.5 text-xs font-semibold text-slate-400 uppercase">Step {idx + 1}</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">จำนวนตั้งแต่</label>
                <Input type="number" min="0" step={qtyStep(allowDecimalQty)} value={step.minQuantity} onChange={e => updateWholesale(idx, "minQuantity", e.target.value)} className="h-8 border-slate-300 text-right text-sm" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">ราคา/ชิ้น</label>
                <Input type="number" min="0" step="0.01" value={step.unitPrice} onChange={e => updateWholesale(idx, "unitPrice", e.target.value)} className="h-8 border-slate-300 text-right text-sm" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
