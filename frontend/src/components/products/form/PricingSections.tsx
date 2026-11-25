"use client";

import { Truck } from "lucide-react";
import { Input } from "@/components/ui/input";
import { qtyStep, useAllowDecimalQty } from "@/lib/qty";
import type { SetForm, WholesaleStepForm } from "../types";
import { FormSection } from "./FormSection";

/** Wholesale price steps (from quantity -> unit price), 5 steps side by side. */
export function WholesaleSection({ steps, setForm }: { steps: WholesaleStepForm[]; setForm: SetForm }) {
  const allowDecimalQty = useAllowDecimalQty();
  const updateWholesale = (i: number, key: keyof WholesaleStepForm, val: string) =>
    setForm(prev => ({ ...prev, wholesaleSteps: prev.wholesaleSteps.map((s, j) => j === i ? { ...s, [key]: val } : s) }));

  return (
    <FormSection
      id="wholesale"
      icon={<Truck />}
      title="ราคาส่งตามจำนวน (5 ขั้น)"
      note={steps.some((st) => st.minQuantity && st.unitPrice) ? `${steps.filter((st) => st.minQuantity && st.unitPrice).length} ขั้น` : "ไม่บังคับ"}
    >
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {steps.map((step, idx) => (
          <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="mb-1.5 text-xs font-semibold text-slate-500">ขั้น {idx + 1}</div>
            <div className="grid gap-2">
              <div className="space-y-1">
                <label className="text-xs text-slate-500">จำนวนตั้งแต่</label>
                <Input aria-label={`ราคาส่งขั้น ${idx + 1} จำนวนตั้งแต่`} type="number" min="0" step={qtyStep(allowDecimalQty)} value={step.minQuantity} onChange={e => updateWholesale(idx, "minQuantity", e.target.value)} className="border-slate-300 bg-white text-right" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-500">ราคา/หน่วย</label>
                <Input aria-label={`ราคาส่งขั้น ${idx + 1} ราคา`} type="number" min="0" step="0.01" value={step.unitPrice} onChange={e => updateWholesale(idx, "unitPrice", e.target.value)} className="border-slate-300 bg-white text-right" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </FormSection>
  );
}
