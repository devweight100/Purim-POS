"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import { errorMessage } from "./product-helpers";
import type { ProductsData } from "./useProducts";
import type { ProductSelection } from "./useProductSelection";

const withoutKeys = <T,>(prev: Record<string, T>, ids: string[]) => {
  const next = { ...prev };
  ids.forEach((id) => delete next[id]);
  return next;
};

/** "N selected" bar with clear + delete-selected (deletes on the server one by one, then reloads the list). */
export function BulkActionBar({ data, sel }: { data: ProductsData; sel: ProductSelection }) {
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const { selectedProductIds, clearSelection } = sel;

  const handleBulkDelete = async () => {
    const ids = Array.from(selectedProductIds);
    if (ids.length === 0) {
      toast.info("กรุณาเลือกสินค้าที่ต้องการลบ");
      return;
    }
    const ok = window.confirm(`ยืนยันลบสินค้า ${ids.length} รายการ? การลบนี้จะลบสินค้าออกจากฐานข้อมูล`);
    if (!ok) return;

    setIsBulkDeleting(true);
    let apiFailed = 0;
    let lastError = '';
    for (const id of ids) {
      try {
        await api.products.delete(id);
      } catch (err) {
        apiFailed++;
        lastError = errorMessage(err) || lastError;
      }
    }

    // show what the server now has (products it refused to delete stay in the list)
    await data.refreshProducts();
    data.setAllPackaging((prev) => withoutKeys(prev, ids));
    data.setAllImages((prev) => withoutKeys(prev, ids));
    sel.setExpandedRows((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
    clearSelection();
    setIsBulkDeleting(false);

    if (apiFailed > 0) {
      toast.error(`ลบสินค้าได้ ${ids.length - apiFailed} รายการ ลบไม่สำเร็จ ${apiFailed} รายการ${lastError ? `: ${lastError}` : ''}`);
    } else {
      toast.success(`ลบสินค้าเรียบร้อย ${ids.length} รายการ`);
    }
  };

  if (selectedProductIds.size === 0) return null;

  return (
    <div className="mb-3 flex flex-col gap-2 rounded-xl border border-rose-200 bg-rose-50/80 px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="text-sm font-bold text-rose-900">
        เลือกสินค้าแล้ว {selectedProductIds.size.toLocaleString()} รายการ
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          className="h-9 border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
          onClick={clearSelection}
        >
          ยกเลิกเลือก
        </Button>
        <Button
          type="button"
          className="h-9 bg-rose-600 text-white hover:bg-rose-700"
          onClick={handleBulkDelete}
          disabled={isBulkDeleting}
        >
          <Trash2 className="mr-1.5 h-4 w-4" />
          {isBulkDeleting ? "กำลังลบ..." : "ลบรายการที่เลือก"}
        </Button>
      </div>
    </div>
  );
}
