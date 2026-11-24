"use client";

import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { approvedExport } from "@/lib/export-approval";
import type { CategoryOption, ProductRecord, SupplierOption } from "./types";

export interface ProductExportFilters {
  categoryIds: string[];
  stock: "all" | "instock" | "low" | "nostock";
  status: "all" | "active" | "inactive";
  supplierId?: string;
}

const STOCK: { value: ProductExportFilters["stock"]; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "instock", label: "มีสต็อก" },
  { value: "low", label: "ใกล้หมด" },
  { value: "nostock", label: "หมด" },
];
const STATUS: { value: ProductExportFilters["status"]; label: string }[] = [
  { value: "all", label: "ทั้งหมด" },
  { value: "active", label: "ใช้งาน" },
  { value: "inactive", label: "ปิดใช้งาน" },
];

/** What the filters mean, for the PIN dialog and the audit trail. */
export function describeProductExport(f: ProductExportFilters, categories: CategoryOption[], suppliers: SupplierOption[]): string {
  const parts: string[] = [];
  parts.push(f.categoryIds.length ? `หมวด ${f.categoryIds.map((id) => (id === "none" ? "ไม่มีหมวด" : categories.find((c) => c.id === id)?.name || "?")).join(", ")}` : "ทุกหมวด");
  parts.push(`สต็อก: ${STOCK.find((s) => s.value === f.stock)?.label}`);
  parts.push(`สถานะ: ${STATUS.find((s) => s.value === f.status)?.label}`);
  if (f.supplierId) parts.push(`ผู้จำหน่าย: ${suppliers.find((s) => s.id === f.supplierId)?.name || "?"}`);
  return parts.join(" · ");
}

/**
 * "ส่งออก Excel" (Round B): filters applied by the server (categories, stock status, active / inactive, supplier),
 * then the manager PIN (every export), then the file. `onRows` builds and saves the workbook.
 */
export function ProductExportDialog({ open, onOpenChange, categories, suppliers, onRows }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  onRows: (rows: ProductRecord[]) => void;
}) {
  const [filters, setFilters] = useState<ProductExportFilters>({ categoryIds: [], stock: "all", status: "all" });
  const [catSearch, setCatSearch] = useState("");
    const firstRef = useRef<HTMLInputElement>(null);
  const shownCats = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    const list = [{ id: "none", name: "ไม่มีหมวดหมู่" }, ...categories];
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }, [categories, catSearch]);

  const toggleCat = (id: string) =>
    setFilters((f) => ({ ...f, categoryIds: f.categoryIds.includes(id) ? f.categoryIds.filter((c) => c !== id) : [...f.categoryIds, id] }));

  const run = async () => {
    const body: ProductExportFilters = { ...filters, categoryIds: [...filters.categoryIds].sort(), ...(filters.supplierId ? {} : { supplierId: undefined }) };
    const clean = JSON.parse(JSON.stringify(body)) as ProductExportFilters;
    // the filter dialog closes first (one modal at a time: the PIN dialog takes the keyboard); the filters stay
    onOpenChange(false);
    try {
      const res = await approvedExport<{ data: ProductRecord[] }>({
        kind: "products", filters: clean, path: "/exports/products", body: { filters: clean },
        what: `สินค้า (Excel): ${describeProductExport(clean, categories, suppliers)}`,
      });
      if (!res) return; // PIN cancelled
      onRows(res.data);
    } catch (e) {
      toast.error(`ส่งออกไม่สำเร็จ: ${e instanceof Error ? e.message : "ติดต่อเซิร์ฟเวอร์ไม่ได้"}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-3" data-testid="product-export-dialog" initialFocus={firstRef}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 pr-8"><Download className="h-5 w-5 text-emerald-700" /> ส่งออกสินค้าเป็น Excel</DialogTitle>
          <DialogDescription>เลือกเงื่อนไข (ไม่เลือกหมวด = ทุกหมวด) แล้วกด ส่งออก ระบบจะขอ PIN ผู้จัดการก่อนสร้างไฟล์</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            void run();
          }}
        >
          <fieldset className="space-y-2">
            <legend className="text-sm font-semibold text-slate-700">หมวดหมู่ {filters.categoryIds.length > 0 && <span className="font-normal text-muted-foreground">(เลือก {filters.categoryIds.length})</span>}</legend>
            <div className="flex gap-btn">
              <Input ref={firstRef} value={catSearch} onChange={(e) => setCatSearch(e.target.value)} placeholder="ค้นหาหมวด" aria-label="ค้นหาหมวดหมู่" className="flex-1" />
              <Button type="button" variant="outline" disabled={filters.categoryIds.length === 0} onClick={() => setFilters((f) => ({ ...f, categoryIds: [] }))}>ทุกหมวด</Button>
            </div>
            <div className="grid max-h-44 [@media(max-height:700px)]:max-h-28 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2" data-testid="export-categories">
              {shownCats.map((c) => (
                <label key={c.id} className="flex min-w-0 items-center gap-2 rounded px-1 py-1 text-sm hover:bg-slate-50">
                  <input type="checkbox" checked={filters.categoryIds.includes(c.id)} onChange={() => toggleCat(c.id)} />
                  <span className="truncate" title={c.name}>{c.name}</span>
                </label>
              ))}
              {shownCats.length === 0 && <p className="text-sm text-muted-foreground">ไม่พบหมวด</p>}
            </div>
          </fieldset>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-1">
              <legend className="text-sm font-semibold text-slate-700">สถานะสต็อก</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {STOCK.map((s) => (
                  <label key={s.value} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name="export-stock" checked={filters.stock === s.value} onChange={() => setFilters((f) => ({ ...f, stock: s.value }))} /> {s.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset className="space-y-1">
              <legend className="text-sm font-semibold text-slate-700">สถานะสินค้า</legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {STATUS.map((s) => (
                  <label key={s.value} className="flex items-center gap-1.5 text-sm">
                    <input type="radio" name="export-status" checked={filters.status === s.value} onChange={() => setFilters((f) => ({ ...f, status: s.value }))} /> {s.label}
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
          <label className="block space-y-1">
            <span className="text-sm font-semibold text-slate-700">ผู้จำหน่าย</span>
            <select
              className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
              value={filters.supplierId || ""}
              onChange={(e) => setFilters((f) => ({ ...f, supplierId: e.target.value || undefined }))}
              aria-label="ผู้จำหน่าย"
            >
              <option value="">ทุกผู้จำหน่าย</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <DialogFooter className="gap-btn">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>ยกเลิก</Button>
            <Button type="submit" className="bg-emerald-700 text-white hover:bg-emerald-800">
              <Download className="h-4 w-4" /> ส่งออก Excel
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
