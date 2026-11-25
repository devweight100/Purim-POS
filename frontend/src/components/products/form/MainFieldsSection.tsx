"use client";

import { Copy, Package } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatQty, qtyInputMode, qtyStep, useAllowDecimalQty } from "@/lib/qty";
import { useLevelNames } from "@/lib/use-level-names";
import { computeMultipliers } from "../product-helpers";
import { PRICE_LEVELS, priceLevelKey, type ProductForm, type SetForm, type UpdateForm } from "../types";

/** Copy the product code; falls back to a hidden textarea where the Clipboard API is blocked (http on the LAN). */
async function copySku(sku: string) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(sku);
    } else {
      const ta = document.createElement("textarea");
      ta.value = sku;
      ta.setAttribute("readonly", "");
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      if (!ok) throw new Error("copy");
    }
    toast.success(`คัดลอกรหัสสินค้า ${sku} แล้ว`);
  } catch {
    toast.error("คัดลอกไม่สำเร็จ กรุณาเลือกข้อความแล้วกด Ctrl+C");
  }
}

/** "= 2 ลัง 4 ชิ้น": a base-unit quantity in the largest pack that fits (only when the product has packs). */
export function packBreakdown(qty: number, units: ProductForm["packagingUnits"], baseUnit: string): string {
  if (!(qty > 0) || units.length === 0) return "";
  const mult = computeMultipliers(units);
  for (let i = units.length - 1; i >= 0; i--) {
    const m = mult[i];
    if (m > 1 && qty >= m) {
      const whole = Math.floor(qty / m + 1e-9);
      const rest = Math.round((qty - whole * m) * 100) / 100;
      return `= ${whole.toLocaleString()} ${units[i].name || "แพ็ค"}${rest > 0 ? ` ${formatQty(rest, { grouping: true })} ${baseUnit}` : ""}`;
    }
  }
  return "";
}

const label = "block h-5 truncate text-sm font-medium leading-5 text-slate-700";

/**
 * Top of the product form, in the owner's order for fast entry (docs/product-form-bank-logos.md): ชื่อสินค้า,
 * ต้นทุน, ราคาขาย ระดับ 1-5 (the shop's level names), บาร์โค้ด, รหัสสินค้า (blank = generated), จำนวนสต็อก.
 * DOM order = Tab order. The stock is in the smallest unit: on add the opening stock, on edit the current stock
 * (a change becomes a stock adjustment "ปรับจากหน้าแก้ไขสินค้า" when saved).
 */
export function MainFieldsSection({ form, updateForm, setForm, editing, stockSeen, canEditStock }: {
  form: ProductForm;
  updateForm: UpdateForm;
  setForm: SetForm;
  editing: boolean;
  /** edit: stock when the form opened */
  stockSeen: number | null;
  /** may change stock (MANAGE_INVENTORY, same as the stock adjustment) */
  canEditStock: boolean;
}) {
  const levelNames = useLevelNames();
  const allowDecimal = useAllowDecimalQty();
  const unit = form.unit.trim() || "ชิ้น";
  const firstBarcode = form.barcodes[0]?.barcode ?? "";
  const setFirstBarcode = (v: string) =>
    setForm((prev) => {
      const barcodes = prev.barcodes.length ? [...prev.barcodes] : [{ barcode: "", supplierId: "", label: "" }];
      barcodes[0] = { ...barcodes[0], barcode: v };
      return { ...prev, barcodes };
    });
  const stockNum = Number(form.stock.trim().replace(/,/g, "") || 0);
  const stockDiff = editing && stockSeen !== null && Number.isFinite(stockNum) ? Math.round((stockNum - stockSeen) * 100) / 100 : 0;
  const stockLocked = form.isBundle || !canEditStock;
  const packs = Number.isFinite(stockNum) ? packBreakdown(stockNum, form.packagingUnits, unit) : "";

  return (
    <section data-testid="product-main-fields" className="rounded-xl border border-slate-200 bg-white p-5">
      <div className="grid gap-3">
        <div className="space-y-1.5">
          <label htmlFor="product-form-name" className={label}>ชื่อสินค้า *</label>
          <Input
            id="product-form-name"
            aria-label="ชื่อสินค้า *"
            data-autofocus
            value={form.name}
            onChange={(e) => updateForm("name", e.target.value)}
            className="border-slate-300"
          />
        </div>

        <div className="grid grid-cols-3 gap-3 md:grid-cols-6">
          <div className="space-y-1.5">
            <label htmlFor="product-form-cost" className={label}>ต้นทุน</label>
            <Input
              id="product-form-cost"
              type="number"
              min="0"
              step="0.01"
              value={form.basePrice}
              onChange={(e) => updateForm("basePrice", e.target.value)}
              className="border-slate-300 text-right tabular-nums"
            />
          </div>
          {PRICE_LEVELS.map((n) => (
            <div key={n} className="min-w-0 space-y-1.5">
              <label htmlFor={`product-form-price-${n}`} className={label} title={levelNames[n as 1]}>
                {n}. {levelNames[n as 1] || `ราคา ${n}`}
              </label>
              <Input
                id={`product-form-price-${n}`}
                aria-label={`ราคา ${n}`}
                type="number"
                min="0"
                step="0.01"
                value={form[priceLevelKey(n)]}
                onChange={(e) => updateForm(priceLevelKey(n), e.target.value)}
                className="border-slate-300 text-right tabular-nums"
              />
            </div>
          ))}
        </div>
        <p className="-mt-1 text-sub text-muted-foreground">ราคาต่อ {unit} (หน่วยย่อยสุด) · ราคาของหน่วยบรรจุอยู่ใน &quot;หน่วยบรรจุ&quot; ด้านล่าง</p>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1.5">
            <label htmlFor="product-form-barcode" className={label}>บาร์โค้ด</label>
            <Input
              id="product-form-barcode"
              value={firstBarcode}
              onChange={(e) => setFirstBarcode(e.target.value)}
              // a scanner ends the code with Enter: that moves on to the next field instead of saving the form
              data-own-enter
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
                e.preventDefault();
                document.getElementById("product-sku")?.focus();
              }}
              autoComplete="off"
              className="border-slate-300 tabular-nums"
            />
            <p className="text-sub text-muted-foreground">สแกนได้เลย · บาร์โค้ดเพิ่มเติมอยู่ด้านล่าง</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="product-sku" className={label}>รหัสสินค้า</label>
            <div className="flex gap-2">
              {/* typed by the user (create + edit); blank = the server generates one on save (Round B) */}
              <Input
                id="product-sku"
                data-testid="product-sku"
                value={form.sku}
                onChange={(e) => updateForm("sku", e.target.value)}
                maxLength={64}
                autoComplete="off"
                placeholder={editing ? "เว้นว่าง = ใช้รหัสเดิม" : "เว้นว่างให้ระบบสร้าง"}
                className="min-w-0 flex-1 border-slate-300 tabular-nums"
              />
              {editing && form.sku.trim() && (
                <Button type="button" variant="outline" size="icon" className="h-10 w-10 shrink-0" title="คัดลอกรหัสสินค้า" aria-label="คัดลอกรหัสสินค้า" onClick={() => void copySku(form.sku.trim())}>
                  <Copy className="h-4 w-4" />
                </Button>
              )}
            </div>
            <p className="text-sub text-muted-foreground">เว้นว่างให้ระบบสร้าง · ห้ามซ้ำกับรหัสหรือบาร์โค้ดอื่น</p>
          </div>
          <div className="space-y-1.5">
            <label htmlFor="product-form-stock" className={`${label} !flex items-center gap-1.5`}>
              <Package className="h-4 w-4 shrink-0 text-muted-foreground" />
              {editing ? "จำนวนสต็อก" : "จำนวนสต็อกเริ่มต้น"} ({unit})
            </label>
            <Input
              id="product-form-stock"
              data-testid="product-stock-input"
              type="number"
              min="0"
              step={qtyStep(allowDecimal)}
              inputMode={qtyInputMode(allowDecimal)}
              placeholder="0"
              value={form.isBundle ? "" : form.stock}
              disabled={stockLocked}
              onChange={(e) => updateForm("stock", e.target.value)}
              className="border-slate-300 text-right tabular-nums"
            />
            <p className="text-sub text-muted-foreground" data-testid="product-stock-hint">
              {form.isBundle
                ? "สินค้าจัดเซ็ต: สต็อกคิดจากสินค้าในชุด"
                : !canEditStock
                ? "ไม่มีสิทธิ์ปรับสต็อก (ต้องมีสิทธิ์จัดการคลังสินค้า)"
                : editing
                ? stockDiff !== 0
                  ? `ปัจจุบัน ${formatQty(stockSeen ?? 0, { grouping: true })} · บันทึกแล้วปรับ ${stockDiff > 0 ? "+" : ""}${formatQty(stockDiff, { grouping: true })} ${unit} (ลงสต็อกการ์ด)`
                  : "แก้ตัวเลข = บันทึกการปรับสต็อกในสต็อกการ์ด"
                : "หน่วยย่อยสุด · ลงสต็อกการ์ดเป็นยอดยกมา"}
              {packs && !form.isBundle ? ` ${packs}` : ""}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
