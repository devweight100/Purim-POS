"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import type { ProductFiltersState } from "./useProductFilters";
import type { CategoryOption, StockFilter, SupplierOption } from "./types";

const STOCK_OPTIONS: ReadonlyArray<{ key: StockFilter; label: string }> = [
  { key: "all", label: "ทั้งหมด" },
  { key: "low", label: "⚠️ ใกล้หมด" },
  { key: "out", label: "🔴 หมดสต็อก" },
];

const selectClass = "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary";

/** Filter toolbar + "showing N of M" summary line. */
export function ProductFilters({ f, categories, suppliers, totalCount }: {
  f: ProductFiltersState;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  totalCount: number;
}) {
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="ค้นหาชื่อ, รหัส, บาร์โค้ด..." className="pl-9 bg-white border-slate-300 h-10" value={f.search} onChange={e => f.setSearch(e.target.value)} />
          {f.search && <button onClick={() => f.setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
        </div>
        <select value={f.categoryFilter} onChange={e => f.setCategoryFilter(e.target.value)} className={selectClass}>
          <option value="all">📁 ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <select value={f.supplierFilter} onChange={e => f.setSupplierFilter(e.target.value)} className={selectClass}>
          <option value="all">🏢 ทุกผู้จำหน่าย</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        {f.sizeOptions.length > 0 && (
          <select value={f.sizeFilter} onChange={e => f.setSizeFilter(e.target.value)} className={selectClass}>
            <option value="all">📏 ทุกขนาด</option>
            {f.sizeOptions.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        {f.colorOptions.length > 0 && (
          <select value={f.colorFilter} onChange={e => f.setColorFilter(e.target.value)} className={selectClass}>
            <option value="all">🎨 ทุกสี</option>
            {f.colorOptions.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-1">
          {STOCK_OPTIONS.map(opt => (
            <button key={opt.key} onClick={() => f.setStockFilter(opt.key)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${f.stockFilter === opt.key ? "bg-slate-200 text-slate-900" : "text-slate-500 hover:bg-slate-100"}`}>{opt.label}</button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex gap-2 flex-wrap text-sm text-slate-500">
        <span>แสดง <b className="text-slate-800">{f.filtered.length}</b> รายการ จากทั้งหมด {totalCount}</span>
        {f.categoryFilter !== "all" && <span>· <b className="text-sky-600">{categories.find(c => c.id === f.categoryFilter)?.name}</b></span>}
        {f.sizeFilter !== "all" && <span>· ขนาด <b className="text-sky-600">{f.sizeFilter}</b></span>}
        {f.colorFilter !== "all" && <span>· สี <b className="text-sky-600">{f.colorFilter}</b></span>}
        {f.stockFilter !== "all" && <span>· <b className="text-amber-600">{f.stockFilter === "out" ? "หมดสต็อก" : "ใกล้หมด"}</b></span>}
      </div>
    </>
  );
}
