"use client";

import { useEffect, useRef, useState } from "react";
import { Gift, Trash2 } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ProductSearchPicker, type PickedProduct } from "../ProductSearchPicker";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatCurrency } from "@/lib/utils";
import { qtyInputMode, qtyStep, useAllowDecimalQty } from "@/lib/qty";
import type { BundleItemForm, ProductForm, ProductRecord, SetForm } from "../types";

function BundleSummary({ bundleItems, products }: { bundleItems: BundleItemForm[]; products: Pick<ProductRecord, "id" | "priceLevel1" | "basePrice" | "costPrice" | "stock">[] }) {
  const totalComponentPrice = bundleItems.reduce((sum, bi) => {
    const child = products.find((p) => p.id === bi.childProductId);
    const pPrice = child ? Number(child.priceLevel1 ?? child.basePrice ?? 0) : 0;
    return sum + pPrice * (Number(bi.quantity) || 1);
  }, 0);

  const totalComponentCost = bundleItems.reduce((sum, bi) => {
    const child = products.find((p) => p.id === bi.childProductId);
    const pCost = child ? Number(child.costPrice ?? 0) : 0;
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
        <span className={`text-sm font-semibold ${maxPossibleSets > 0 ? 'text-emerald-700' : 'text-rose-600'}`}>
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
  // name / price / stock of the products in the bundle: the page's list when it has them, else the picker's row,
  // else GET /products/:id (the back office does not keep thousands of products in memory)
  const [picked, setPicked] = useState<Record<string, PickedProduct>>({});
  const known = (id: string): PickedProduct | ProductRecord | undefined => picked[id] || products.find((p) => p.id === id);
  const missing = form.bundleItems.map((bi) => bi.childProductId).filter((id) => id && !picked[id] && !products.some((p) => p.id === id));
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    let cancelled = false;
    for (const id of missingKey.split(",")) {
      apiFetch<PickedProduct>(`/products/${id}`)
        .then((p) => { if (!cancelled && p?.id) setPicked((m) => ({ ...m, [p.id]: p })); })
        .catch(() => undefined);
    }
    return () => { cancelled = true; };
  }, [missingKey]);

  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [, setFocusTick] = useState(0);
  // after a pick: focus that product's quantity once its row is on screen
  const focusId = useRef<string | null>(null);
  useEffect(() => {
    const id = focusId.current;
    if (!id) return;
    const el = qtyRefs.current[id];
    if (el) {
      focusId.current = null;
      el.focus();
      el.select();
    }
  });

  const inBundle = new Set(form.bundleItems.map((bi) => bi.childProductId));
  /** why a product cannot go into this bundle (shown on its row in the search list) */
  const blocked = (p: PickedProduct): string | null => {
    if (p.id === editingProductId) return "สินค้าชุดนี้เอง";
    if (p.isBundle) return "เป็นสินค้าชุด (ใส่ชุดซ้อนชุดไม่ได้)";
    if (p.isActive === false) return "ปิดใช้งานอยู่";
    return null;
  };

  const addProduct = (p: PickedProduct) => {
    setPicked((m) => ({ ...m, [p.id]: p }));
    // already in the bundle: go to its quantity instead of a second row
    if (!inBundle.has(p.id)) {
      setForm((f) => ({ ...f, bundleItems: [...f.bundleItems, { childProductId: p.id, quantity: 1 }] }));
    }
    focusId.current = p.id;
    setFocusTick((n) => n + 1);
  };

  const removeBundleItem = (idx: number) => {
    setForm((f) => ({
      ...f,
      bundleItems: f.bundleItems.filter((_, i) => i !== idx),
    }));
  };

  const updateQty = (idx: number, val: BundleItemForm["quantity"]) => {
    setForm((f) => ({
      ...f,
      bundleItems: f.bundleItems.map((item, i) => (i === idx ? { ...item, quantity: val } : item)),
    }));
  };

  const summaryRows = form.bundleItems
    .map((bi) => known(bi.childProductId))
    .filter(Boolean)
    .map((p) => ({ id: p!.id, priceLevel1: p!.priceLevel1 ?? undefined, basePrice: p!.basePrice ?? undefined, costPrice: p!.costPrice ?? undefined, stock: Number(p!.stock ?? 0) }));

  return (
    <section className="rounded-xl border-2 border-purple-200 bg-purple-50/20 p-5 space-y-4" data-testid="bundle-items">
      <div className="flex items-center gap-2 pb-3 border-b border-purple-100">
        <Gift className="h-5 w-5 text-purple-600 shrink-0" />
        <div>
          <h3 className="font-bold text-slate-900 text-base">รายการสินค้าในชุด (Bundle Items)</h3>
          <p className="text-xs text-slate-500">เลือกสินค้าและจำนวนที่จะรวมอยู่ในชุดนี้ เมื่อขายจะตัดสต็อกและเคลมแยกชิ้นตามรายการนี้</p>
        </div>
      </div>

      <div className="space-y-1">
        <label className="text-xs font-semibold text-slate-600">เพิ่มสินค้าเข้าชุด</label>
        <ProductSearchPicker
          onPick={addProduct}
          blocked={blocked}
          label="ค้นหาสินค้าเพื่อเพิ่มเข้าชุด"
          placeholder="พิมพ์ชื่อ / รหัส / บาร์โค้ด แล้วกด ↑↓ เลือก, Enter เพิ่ม"
          testId="bundle-item-picker"
        />
      </div>

      {form.bundleItems.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-purple-200 bg-white/70 py-6 text-center text-sm text-slate-400">
          <Gift className="w-8 h-8 mx-auto text-purple-300 mb-2" />
          <p className="font-medium text-slate-600">ยังไม่มีรายการสินค้าในชุด</p>
          <p className="text-xs text-slate-400 mt-0.5">พิมพ์ค้นหาสินค้าในช่องด้านบน แล้วกด Enter เพื่อเพิ่มเข้าชุด</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {form.bundleItems.map((bi, idx) => {
            const child = known(bi.childProductId);
            const childPrice = child ? Number(child.priceLevel1 ?? child.basePrice ?? 0) : 0;
            const childStock = child ? Number(child.stock ?? 0) : 0;
            const itemLineTotal = childPrice * (Number(bi.quantity) || 1);
            const inactive = child?.isActive === false;

            return (
              <div
                key={bi.childProductId || idx}
                data-testid="bundle-item-row"
                className="bg-white p-3 rounded-xl border border-purple-200/80 shadow-2xs flex flex-col sm:flex-row sm:items-center gap-3"
              >
                <div className="flex-1 min-w-0 space-y-0.5">
                  <div className="text-xs font-semibold text-slate-600">สินค้าส่วนประกอบ #{idx + 1}</div>
                  <div className="font-semibold text-slate-900 break-words">{child?.name || "กำลังโหลด..."}</div>
                  <div className="text-xs text-slate-500">
                    {child?.sku}
                    {inactive && <span className="ml-2 rounded bg-slate-200 px-1.5 font-bold text-slate-600">ปิดใช้งาน</span>}
                  </div>
                </div>

                <div className="w-32 space-y-1 shrink-0">
                  <label className="text-xs font-semibold text-slate-600" htmlFor={`bundle-qty-${bi.childProductId}`}>จำนวนใน 1 ชุด</label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id={`bundle-qty-${bi.childProductId}`}
                      ref={(el) => { qtyRefs.current[bi.childProductId] = el; }}
                      type="number"
                      min={qtyStep(allowDecimalQty)}
                      step={qtyStep(allowDecimalQty)}
                      inputMode={qtyInputMode(allowDecimalQty)}
                      value={bi.quantity}
                      aria-label={`จำนวน ${child?.name || ""} ใน 1 ชุด`}
                      onChange={(e) => updateQty(idx, e.target.value)}
                      className="border-slate-300 text-center"
                    />
                    <span className="text-xs text-slate-500 shrink-0">{child?.unit || "ชิ้น"}</span>
                  </div>
                </div>

                <div className="text-right sm:w-36 space-y-0.5 shrink-0">
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
                  aria-label={`เอา ${child?.name || "สินค้า"} ออกจากชุด`}
                  className="h-8 w-8 text-rose-500 hover:bg-rose-50 self-end sm:self-center cursor-pointer"
                  onClick={() => removeBundleItem(idx)}
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            );
          })}

          {/* Summary card for Bundle */}
          <BundleSummary bundleItems={form.bundleItems} products={summaryRows} />
        </div>
      )}
    </section>
  );
}
