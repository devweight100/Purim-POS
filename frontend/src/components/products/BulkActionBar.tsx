"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Power, PowerOff, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProductStore } from "@/lib/store/product-store";
import { DISABLE_EXPLAINED, stockWarning } from "@shared/product-delete";
import { productActionsApi, type DeleteCheck } from "./useProductActions";
import { errorMessage } from "./product-helpers";
import type { ProductsData } from "./useProducts";
import type { ProductSelection } from "./useProductSelection";
import { askConfirm } from '@/lib/ask-dialog';

const withoutKeys = <T,>(prev: Record<string, T>, ids: string[]) => {
  const next = { ...prev };
  ids.forEach((id) => delete next[id]);
  return next;
};

/**
 * "N selected" bar: clear, ปิดการใช้งาน / เปิดใช้งาน, and delete-selected. Delete asks the server first which
 * products may be deleted (no document names them) and how much stock they hold, deletes those after one
 * confirmation, then lists the others per product with what blocks them and offers to disable them all.
 */
export function BulkActionBar({ data, sel }: { data: ProductsData; sel: ProductSelection }) {
  const [busy, setBusy] = useState<null | "delete" | "active">(null);
  const { selectedProductIds, clearSelection } = sel;

  const refresh = async () => {
    await data.refreshProducts();
    void useProductStore.getState().refreshIfLoaded();
  };

  const setActive = async (ids: string[], isActive: boolean) => {
    setBusy("active");
    try {
      const r = await productActionsApi.setActive(ids, isActive);
      toast.success(`${isActive ? "เปิดใช้งาน" : "ปิดการใช้งาน"}แล้ว ${r.updated.toLocaleString()} รายการ${r.unchanged ? ` (${r.unchanged.toLocaleString()} รายการเป็นเช่นนั้นอยู่แล้ว)` : ""}`);
      await refresh();
      clearSelection();
    } catch (err) {
      toast.error(`${isActive ? "เปิดใช้งาน" : "ปิดการใช้งาน"}ไม่สำเร็จ: ${errorMessage(err) || "เกิดข้อผิดพลาด"}`);
    } finally {
      setBusy(null);
    }
  };

  const handleBulkDisable = async () => {
    const ids = Array.from(selectedProductIds);
    const ok = await askConfirm({ title: `ปิดการใช้งานสินค้า ${ids.length.toLocaleString()} รายการ?`, description: DISABLE_EXPLAINED, confirmLabel: "ปิดการใช้งาน" });
    if (ok) await setActive(ids, false);
  };

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedProductIds);
    if (ids.length === 0) {
      toast.info("กรุณาเลือกสินค้าที่ต้องการลบ");
      return;
    }
    setBusy("delete");
    try {
      let checks: DeleteCheck[];
      try {
        checks = await productActionsApi.checkMany(ids);
      } catch (err) {
        toast.error(`ตรวจสอบก่อนลบไม่สำเร็จ: ${errorMessage(err) || "เกิดข้อผิดพลาด"}`);
        return;
      }
      const deletable = checks.filter((c) => c.canDelete);
      const blocked = checks.filter((c) => !c.canDelete);
      const withStock = deletable.filter((c) => c.stock !== 0);
      const list = (rows: DeleteCheck[], line: (c: DeleteCheck) => string) =>
        rows.slice(0, 8).map(line).join("\n") + (rows.length > 8 ? `\n… และอีก ${(rows.length - 8).toLocaleString()} รายการ` : "");

      let deleted: { id: string }[] = [];
      if (deletable.length) {
        const parts = [
          `ลบได้ ${deletable.length.toLocaleString()} รายการ (ยังไม่มีในเอกสารใด): ข้อมูลของสินค้า (สต็อก บาร์โค้ด ขนาดบรรจุ รูป ผู้จำหน่าย ราคาส่ง) จะถูกลบด้วย ลบแล้วกู้คืนไม่ได้`,
        ];
        if (withStock.length) parts.push(`สินค้าที่ยังมีสต็อก:\n${list(withStock, (c) => `• ${c.name}: ${stockWarning(c.stock, c.unit, c.stockValue)}`)}`);
        if (blocked.length) parts.push(`ลบไม่ได้ ${blocked.length.toLocaleString()} รายการ เพราะมีเอกสารอ้างถึง (จะให้เลือกปิดการใช้งานต่อจากนี้)`);
        const ok = await askConfirm({
          title: `ลบสินค้า ${deletable.length.toLocaleString()} รายการ?`,
          description: parts.join("\n\n"),
          confirmLabel: "ลบสินค้า",
          danger: true,
        });
        if (!ok) return;
        try {
          const r = await productActionsApi.bulkRemove(deletable.map((c) => c.id), true);
          deleted = r.deleted;
          // a document saved meanwhile: refused now, offered for disabling below
          for (const b of r.blocked) blocked.push({ ...b, sku: "", unit: "", stock: 0, canDelete: false });
        } catch (err) {
          toast.error(`ลบสินค้าไม่สำเร็จ: ${errorMessage(err) || "เกิดข้อผิดพลาด"}`);
          return;
        }
        sel.forget(deleted.map((d) => d.id));
        data.setAllPackaging((prev) => withoutKeys(prev, deleted.map((d) => d.id)));
        data.setAllImages((prev) => withoutKeys(prev, deleted.map((d) => d.id)));
        await refresh();
        toast.success(`ลบสินค้าแล้ว ${deleted.length.toLocaleString()} รายการ`);
      }

      if (blocked.length) {
        const active = blocked.filter((b) => b.isActive);
        const detail = list(blocked, (b) => `• ${b.name}: ${b.blockers.map((x) => x.text).join(", ") || "มีเอกสารอ้างถึง"}${b.isActive ? "" : " (ปิดใช้งานอยู่แล้ว)"}`);
        if (active.length) {
          const ok = await askConfirm({
            title: `ลบไม่ได้ ${blocked.length.toLocaleString()} รายการ`,
            description: `${detail}\n\nเอกสารเหล่านี้ต้องเก็บไว้ จึงลบสินค้าไม่ได้ ให้ปิดการใช้งานแทน\n${DISABLE_EXPLAINED}`,
            confirmLabel: `ปิดการใช้งาน ${active.length.toLocaleString()} รายการ`,
          });
          if (ok) {
            setBusy(null);
            await setActive(active.map((b) => b.id), false);
            return;
          }
        } else {
          await askConfirm({ title: `ลบไม่ได้ ${blocked.length.toLocaleString()} รายการ`, description: `${detail}\n\nสินค้าเหล่านี้ปิดการใช้งานอยู่แล้ว`, confirmLabel: "ตกลง", cancelLabel: "ปิด" });
        }
      }
      if (!blocked.length) clearSelection();
    } finally {
      setBusy(null);
    }
  };

  if (selectedProductIds.size === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm font-bold text-rose-900">
        เลือกสินค้าแล้ว {selectedProductIds.size.toLocaleString()} รายการ
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onClick={clearSelection}>
          ยกเลิกเลือก
        </Button>
        <Button type="button" variant="outline" className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onClick={() => void setActive(Array.from(selectedProductIds), true)} disabled={busy !== null}>
          <Power className="mr-1.5 h-4 w-4" />
          เปิดใช้งาน
        </Button>
        <Button type="button" variant="outline" className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-50" onClick={() => void handleBulkDisable()} disabled={busy !== null}>
          <PowerOff className="mr-1.5 h-4 w-4" />
          ปิดการใช้งาน
        </Button>
        <Button type="button" className="h-9 bg-rose-600 text-white hover:bg-rose-700" onClick={() => void handleBulkDelete()} disabled={busy !== null}>
          <Trash2 className="mr-1.5 h-4 w-4" />
          {busy === "delete" ? "กำลังลบ..." : "ลบรายการที่เลือก"}
        </Button>
      </div>
    </div>
  );
}
