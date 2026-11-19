"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { askConfirm } from "@/lib/ask-dialog";
import { useProductStore } from "@/lib/store/product-store";
import { DISABLE_EXPLAINED, stockWarning } from "@shared/product-delete";
import { errorMessage } from "./product-helpers";
import type { ProductRecord } from "./types";
import type { ProductsData } from "./useProducts";

/** GET /products/:id/delete-check, POST /products/delete-check rows (docs/product-delete.md). */
export interface DeleteCheck {
  id: string;
  name: string;
  sku: string;
  unit: string;
  isActive: boolean;
  stock: number;
  /** only for users who may see costs */
  stockValue?: number;
  blockers: { code: string; text: string; count: number }[];
  canDelete: boolean;
}

export interface BulkDeleteResult {
  deleted: { id: string; name: string }[];
  blocked: { id: string; name: string; isActive: boolean; blockers: DeleteCheck["blockers"]; message: string }[];
  needsStockConfirm: { id: string; name: string; stock: number; unit: string }[];
  notFound: string[];
}

export const productActionsApi = {
  check: (id: string) => apiFetch<DeleteCheck>(`/products/${encodeURIComponent(id)}/delete-check`),
  checkMany: (ids: string[]) => apiFetch<DeleteCheck[]>("/products/delete-check", { method: "POST", body: JSON.stringify({ ids }) }),
  remove: (id: string, confirmStock: boolean) =>
    apiFetch<{ deleted: true; id: string; name: string }>(`/products/${encodeURIComponent(id)}${confirmStock ? "?confirmStock=1" : ""}`, { method: "DELETE" }),
  bulkRemove: (ids: string[], confirmStock: boolean) =>
    apiFetch<BulkDeleteResult>("/products/bulk-delete", { method: "POST", body: JSON.stringify({ ids, confirmStock }) }),
  setActive: (ids: string[], isActive: boolean) =>
    apiFetch<{ updated: number; unchanged: number; notFound: string[] }>("/products/set-active", { method: "POST", body: JSON.stringify({ ids, isActive }) }),
};

/** "• บิลขาย 3 ใบ" lines of the documents that keep a product from being deleted. */
export function blockerLines(blockers: DeleteCheck["blockers"]): string {
  return blockers.map((b) => `• ${b.text}`).join("\n");
}

/** Refusal dialog of one product: names the documents and offers "ปิดการใช้งาน" right there. true = disable it. */
export async function askDisableInstead(c: Pick<DeleteCheck, "name" | "blockers" | "isActive">): Promise<boolean> {
  const docs = c.blockers.length ? `มีเอกสารที่อ้างถึงสินค้านี้:\n${blockerLines(c.blockers)}\n\n` : "สินค้านี้ถูกใช้ในเอกสารแล้ว\n\n";
  if (!c.isActive) {
    await askConfirm({
      title: `ลบ "${c.name}" ไม่ได้`,
      description: `${docs}เอกสารเหล่านี้ต้องเก็บไว้ จึงลบสินค้าไม่ได้ สินค้านี้ปิดการใช้งานอยู่แล้ว (ไม่แสดงในหน้าขายและการค้นหาเลือกสินค้า)`,
      confirmLabel: "ตกลง",
      cancelLabel: "ปิด",
    });
    return false;
  }
  return askConfirm({
    title: `ลบ "${c.name}" ไม่ได้`,
    description: `${docs}เอกสารเหล่านี้ต้องเก็บไว้ จึงลบสินค้าไม่ได้ ให้ปิดการใช้งานแทน\n\n${DISABLE_EXPLAINED}`,
    confirmLabel: "ปิดการใช้งาน",
    cancelLabel: "ยกเลิก",
  });
}

/** After a change: the table page from the server and the product store (POS / pickers) catch up. */
async function refreshAll(data: ProductsData) {
  await data.refreshProducts();
  void useProductStore.getState().fetchProducts();
}

/**
 * Row actions of the products table ("⋯" menu): enable / disable, delete (with the server's delete check:
 * stock on hand to confirm, or the documents that block it with "ปิดการใช้งาน" offered instead), stock card and
 * stock adjustment (inventory page), duplicate (opens the add form prefilled).
 */
export function useProductActions(data: ProductsData, opts: { onDuplicate: (p: ProductRecord) => void; onDeleted?: (id: string) => void }) {
  const router = useRouter();

  const setActive = async (p: Pick<ProductRecord, "id" | "name">, isActive: boolean) => {
    try {
      await productActionsApi.setActive([p.id], isActive);
      toast.success(isActive ? `เปิดใช้งาน "${p.name}" แล้ว` : `ปิดการใช้งาน "${p.name}" แล้ว: ไม่แสดงในหน้าขายและการค้นหาเลือกสินค้าอีก`);
      await refreshAll(data);
    } catch (err) {
      toast.error(`${isActive ? "เปิดใช้งาน" : "ปิดการใช้งาน"}ไม่สำเร็จ: ${errorMessage(err) || "เกิดข้อผิดพลาด"}`);
    }
  };

  const toggleActive = async (p: ProductRecord) => {
    if (p.isActive === false) return setActive(p, true);
    const ok = await askConfirm({
      title: `ปิดการใช้งาน "${p.name}"?`,
      description: DISABLE_EXPLAINED,
      confirmLabel: "ปิดการใช้งาน",
    });
    if (ok) await setActive(p, false);
  };

  const remove = async (p: ProductRecord) => {
    let c: DeleteCheck;
    try {
      c = await productActionsApi.check(p.id);
    } catch (err) {
      toast.error(`ตรวจสอบก่อนลบไม่สำเร็จ: ${errorMessage(err) || "เกิดข้อผิดพลาด"}`);
      return;
    }
    if (!c.canDelete) {
      if (await askDisableInstead(c)) await setActive(p, false);
      return;
    }
    const stockLine = c.stock !== 0 ? `${stockWarning(c.stock, c.unit, c.stockValue)}\n\n` : "";
    const ok = await askConfirm({
      title: `ลบสินค้า "${c.name}"?`,
      description:
        `${stockLine}สินค้านี้ยังไม่มีในเอกสารใด (บิลขาย ใบสั่งซื้อ เคลม ฯลฯ) จึงลบได้ ` +
        "ข้อมูลของสินค้า (สต็อก บาร์โค้ด ขนาดบรรจุ รูป ผู้จำหน่าย ราคาส่ง) จะถูกลบไปด้วย ลบแล้วกู้คืนไม่ได้",
      confirmLabel: "ลบสินค้า",
      danger: true,
    });
    if (!ok) return;
    try {
      await productActionsApi.remove(p.id, c.stock !== 0);
      toast.success(`ลบสินค้า "${c.name}" แล้ว`);
      opts.onDeleted?.(p.id);
      await refreshAll(data);
    } catch (err) {
      const body = err instanceof ApiError ? err.data : null;
      if (body?.code === "PRODUCT_IN_USE") {
        // a document was saved meanwhile
        if (await askDisableInstead({ name: c.name, blockers: body.blockers || [], isActive: body.isActive !== false })) await setActive(p, false);
      } else {
        toast.error(`ลบสินค้าไม่สำเร็จ: ${errorMessage(err) || "เกิดข้อผิดพลาด"}`);
      }
    }
  };

  return {
    toggleActive,
    remove,
    duplicate: opts.onDuplicate,
    stockCard: (p: ProductRecord) => router.push(`/inventory?product=${encodeURIComponent(p.id)}&open=card`),
    adjustStock: (p: ProductRecord) => router.push(`/inventory?product=${encodeURIComponent(p.id)}&open=adjust`),
  };
}

export type ProductActions = ReturnType<typeof useProductActions>;
