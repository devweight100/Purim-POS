"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, Boxes, PackageX, Replace, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ProductSearchPicker, type PickedProduct } from "./ProductSearchPicker";
import { errorMessage } from "./product-helpers";
import type { DeleteCheck } from "./useProductActions";

/** GET /products/:id/replace-check (backend/src/products/product-replace.ts). */
export interface ReplaceCheck {
  product: { id: string; name: string; sku: string; unit: string; stock: number; isBundle: boolean };
  replacement: { id: string; name: string; sku: string; unit: string; isBundle: boolean; isActive: boolean } | null;
  counts: Record<string, number>;
  texts: string[];
  barcodes: string[];
  problems: { code: string; message: string }[];
  canReplace: boolean;
}

const check = (id: string, replacementId?: string) =>
  apiFetch<ReplaceCheck>(`/products/${encodeURIComponent(id)}/replace-check${replacementId ? `?replacementId=${encodeURIComponent(replacementId)}` : ""}`);

/**
 * Delete a product that documents already name, with a REPLACEMENT (docs/round-shift-today-bundle-replace.md):
 * pick the replacement (type-to-search), see what moves (bills, documents, stock movements), choose whether its
 * barcodes move too, then "ลบและย้ายไปสินค้าทดแทน". Stock still on hand is refused with a button to the stock
 * adjustment. "ปิดการใช้งานแทน" stays available.
 */
export function ReplaceProductDialog({
  target,
  onClose,
  onDone,
  onDisable,
  onAdjustStock,
}: {
  target: DeleteCheck | null;
  onClose: () => void;
  onDone: (oldId: string) => void;
  onDisable: (target: DeleteCheck) => void;
  onAdjustStock: (id: string) => void;
}) {
  const [info, setInfo] = useState<ReplaceCheck | null>(null);
  const [picked, setPicked] = useState<PickedProduct | null>(null);
  const [moveBarcodes, setMoveBarcodes] = useState(true);
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // a new product to delete: start over (adjusted while rendering)
  const key = target?.id ?? null;
  if (seen !== key) {
    setSeen(key);
    setInfo(null);
    setPicked(null);
    setMoveBarcodes(true);
  }

  useEffect(() => {
    if (!target) return;
    let cancelled = false;
    check(target.id, picked?.id)
      .then((r) => { if (!cancelled) setInfo(r); })
      .catch((err) => { if (!cancelled) toast.error(`ตรวจสอบไม่สำเร็จ: ${errorMessage(err) || "เกิดข้อผิดพลาด"}`); });
    return () => { cancelled = true; };
  }, [target, picked?.id]);

  // the answer for the product picked now (not the previous pick's)
  const ready = !!picked && info?.replacement?.id === picked.id && info.canReplace;
  useEffect(() => {
    if (ready) confirmRef.current?.focus();
  }, [ready]);

  if (!target) return null;
  const stockProblem = info?.problems.find((p) => p.code === "STOCK_NOT_ZERO") ?? (target.stock !== 0 ? { code: "STOCK_NOT_ZERO", message: "" } : null);
  const otherProblems = (info?.problems || []).filter((p) => p.code !== "STOCK_NOT_ZERO" && p.code !== "REPLACEMENT_REQUIRED");
  const isBundle = info?.product.isBundle ?? false;
  const blocked = (p: PickedProduct): string | null => {
    if (p.id === target.id) return "สินค้าที่จะลบเอง";
    if (!!p.isBundle !== isBundle) return isBundle ? "ต้องเป็นสินค้าชุด" : "เป็นสินค้าชุด";
    if (p.isActive === false) return "ปิดใช้งานอยู่";
    return null;
  };

  const submit = async () => {
    if (!picked || !ready || busy) return;
    setBusy(true);
    try {
      await apiFetch(`/products/${encodeURIComponent(target.id)}/replace`, {
        method: "POST",
        body: JSON.stringify({ replacementId: picked.id, moveBarcodes }),
      });
      toast.success(`ลบ "${target.name}" แล้ว ประวัติย้ายไปที่ "${picked.name}"`);
      onDone(target.id);
    } catch (err) {
      toast.error(`ลบและย้ายไม่สำเร็จ: ${errorMessage(err) || "เกิดข้อผิดพลาด"}`);
      // the server's reason (e.g. stock changed meanwhile) shows on the next check
      check(target.id, picked.id).then(setInfo).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent data-testid="replace-product-dialog" className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-2xl">
        <div className="border-b border-slate-200 px-6 pb-4 pt-6 pr-14">
          <DialogTitle className="flex items-start gap-2 text-lg font-bold text-slate-900">
            <PackageX className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
            <span className="break-words">ลบ &quot;{target.name}&quot;</span>
          </DialogTitle>
          <DialogDescription className="mt-1 text-sm text-slate-600">
            สินค้านี้มีในเอกสารแล้ว ({target.blockers.map((b) => b.text).join(", ") || "ถูกใช้แล้ว"}) ลบได้โดยเลือก<b>สินค้าทดแทน</b>
          </DialogDescription>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4 text-sm">
          {stockProblem && (
            <div role="alert" data-testid="replace-stock-problem" className="space-y-2 rounded-xl border border-rose-300 bg-rose-50 p-3 text-rose-950">
              <p className="flex items-start gap-2 font-bold">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                {stockProblem.message || `สินค้านี้ยังมีสต็อก ${target.stock.toLocaleString()} ${target.unit || "ชิ้น"} ต้องปรับสต็อกให้เป็น 0 ก่อน`}
              </p>
              <div className="flex justify-end">
                <Button type="button" size="sm" variant="outline" className="border-rose-300 bg-white font-bold text-rose-700 hover:bg-rose-100" onClick={() => onAdjustStock(target.id)}>
                  <Boxes className="mr-1.5 h-4 w-4" /> ไปปรับสต็อกเป็น 0
                </Button>
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-semibold text-slate-600">สินค้าทดแทน (ประวัติการขาย / เอกสาร / สต็อกการ์ด จะย้ายไปที่สินค้านี้)</label>
            <ProductSearchPicker
              onPick={setPicked}
              blocked={blocked}
              label="ค้นหาสินค้าทดแทน"
              placeholder="พิมพ์ชื่อ / รหัส / บาร์โค้ด ของสินค้าทดแทน"
              testId="replace-picker"
              autoFocus={!stockProblem}
            />
          </div>

          {picked && (
            <div data-testid="replace-summary" className="space-y-3 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3">
              <div className="flex flex-wrap items-center gap-2 font-semibold text-slate-900">
                <span className="min-w-0 break-words line-through decoration-rose-500">{target.name}</span>
                <ArrowRight className="h-4 w-4 shrink-0 text-indigo-600" />
                <span className="min-w-0 break-words">{picked.name}</span>
                <span className="text-xs font-normal text-slate-500">{picked.sku}</span>
              </div>
              {info && info.texts.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-600">จะย้ายไปที่สินค้าทดแทน:</p>
                  <ul className="mt-1 grid grid-cols-1 gap-x-4 sm:grid-cols-2" data-testid="replace-counts">
                    {info.texts.map((t) => <li key={t}>• {t}</li>)}
                  </ul>
                </div>
              )}
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
                <li>บิลและเอกสารเดิมยังแสดง<b>ชื่อ รหัส และราคาเดิม</b>ของ &quot;{target.name}&quot; ตามที่ขายจริง ยอดเงินไม่เปลี่ยน</li>
                <li>รายงานยอดขายตามสินค้าและสต็อกการ์ด นับรวมไว้ที่ &quot;{picked.name}&quot;</li>
                <li>บิลพัก / บิลที่ยังไม่ได้ส่งจากเครื่องขาย ที่มีสินค้านี้ จะขายเป็นสินค้าทดแทนโดยอัตโนมัติ</li>
                <li>ลบแล้วกู้คืนไม่ได้</li>
              </ul>
              {(info?.barcodes.length ?? 0) > 0 && (
                <label className="flex items-start gap-2 text-sm">
                  <input type="checkbox" className="mt-1 h-4 w-4" checked={moveBarcodes} onChange={(e) => setMoveBarcodes(e.target.checked)} data-testid="replace-move-barcodes" />
                  <span>
                    ย้ายบาร์โค้ดไปสินค้าทดแทน <span className="text-xs text-slate-500">({info!.barcodes.join(", ")}) ไม่เลือก = บาร์โค้ดถูกปล่อยว่าง</span>
                  </span>
                </label>
              )}
              {otherProblems.map((p) => (
                <p key={p.code} role="alert" className="font-semibold text-rose-700">{p.message}</p>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-btn border-t border-slate-200 bg-slate-50 px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>ยกเลิก</Button>
          {target.isActive && (
            <Button type="button" variant="outline" onClick={() => onDisable(target)} disabled={busy}>ปิดการใช้งานแทน</Button>
          )}
          <Button
            ref={confirmRef}
            type="button"
            data-testid="replace-confirm"
            onClick={() => void submit()}
            disabled={!ready || busy}
            className="bg-rose-600 font-bold text-white hover:bg-rose-700"
          >
            <Replace className="mr-1.5 h-4 w-4" />
            {busy ? "กำลังลบและย้าย..." : "ลบและย้ายไปสินค้าทดแทน"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
