"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { focusRowNav } from "@/lib/use-row-nav";
import type { ProductFiltersState } from "./useProductFilters";
import type { CategoryOption, StatusFilter, StockFilter, SupplierOption } from "./types";

const STOCK_OPTIONS: ReadonlyArray<{ key: StockFilter; label: string }> = [
  { key: "all", label: "ทั้งหมด" },
  { key: "low", label: "⚠️ ใกล้หมด" },
  { key: "out", label: "🔴 หมดสต็อก" },
];

const STATUS_OPTIONS: ReadonlyArray<{ key: StatusFilter; label: string }> = [
  { key: "active", label: "ใช้งาน" },
  { key: "inactive", label: "ปิดใช้งาน" },
  { key: "all", label: "ทั้งหมด" },
];

const selectClass = "h-10 rounded-lg border border-slate-300 bg-white px-3 text-sm outline-none focus:border-primary";

/** Filter toolbar + "showing N of M" summary line. */
export function ProductFilters({ f, categories, suppliers, totalCount, inactiveCount = 0 }: {
  f: ProductFiltersState;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  totalCount: number;
  /** products that are ปิดใช้งาน (shown on the status button) */
  inactiveCount?: number;
}) {
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3 items-center">
        <div className="relative min-w-[200px] flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <Input placeholder="ค้นหาชื่อ, รหัส, บาร์โค้ด..." className="pl-9 bg-white border-slate-300 h-10" value={f.search} onChange={e => f.setSearch(e.target.value)}
            aria-label="ค้นหาสินค้า (↓ = ไปที่ตาราง)"
            onKeyDown={e => { if (e.key === "ArrowDown") { e.preventDefault(); focusRowNav(document.querySelector("[data-row-nav-root]")); } }} />
          {f.search && <button type="button" aria-label="ล้างคำค้นหา" onClick={() => f.setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>}
        </div>
        <select aria-label="กรองตามหมวดหมู่" value={f.categoryFilter} onChange={e => f.setCategoryFilter(e.target.value)} className={selectClass}>
          <option value="all">📁 ทุกหมวดหมู่</option>
          {categories.map(c => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
        </select>
        <select aria-label="กรองตามผู้จำหน่าย" value={f.supplierFilter} onChange={e => f.setSupplierFilter(e.target.value)} className={selectClass}>
          <option value="all">🏢 ทุกผู้จำหน่าย</option>
          {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <div className="flex flex-wrap gap-btn rounded-lg border border-slate-200 bg-white p-1">
          {STOCK_OPTIONS.map(opt => (
            <button type="button" key={opt.key} aria-pressed={f.stockFilter === opt.key} onClick={() => f.setStockFilter(opt.key)} className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${f.stockFilter === opt.key ? "bg-slate-200 text-slate-900" : "text-slate-500 hover:bg-slate-100"}`}>{opt.label}</button>
          ))}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
        <span>แสดง <b className="text-slate-800">{f.filteredCount.toLocaleString()}</b> รายการ จากทั้งหมด {totalCount.toLocaleString()}</span>
        {f.categoryFilter !== "all" && <span>· <b className="text-sky-600">{categories.find(c => c.id === f.categoryFilter)?.name}</b></span>}
        {f.statusFilter !== "all" && <span>· <b className={f.statusFilter === "inactive" ? "text-slate-700" : "text-emerald-700"}>{f.statusFilter === "inactive" ? "ปิดใช้งาน" : "ใช้งาน"}</b></span>}
        {f.stockFilter !== "all" && <span>· <b className="text-amber-600">{f.stockFilter === "out" ? "หมดสต็อก" : "ใกล้หมด"}</b></span>}
        <div role="group" aria-label="สถานะสินค้า" data-testid="product-status-filter" className="ml-auto flex flex-wrap items-center gap-btn rounded-lg border border-slate-200 bg-white p-0.5">
          <span className="pl-2 text-xs font-semibold text-slate-500" aria-hidden="true">สถานะ</span>
          {STATUS_OPTIONS.map(opt => (
            <button type="button" key={opt.key} aria-pressed={f.statusFilter === opt.key} onClick={() => f.setStatusFilter(opt.key)} className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap ${f.statusFilter === opt.key ? "bg-slate-200 text-slate-900" : "text-slate-500 hover:bg-slate-100"}`}>
              {opt.label}
              {opt.key === "inactive" && inactiveCount > 0 && <span className="ml-1 rounded-full bg-slate-100 px-1.5 text-[10px] font-bold text-slate-600">{inactiveCount.toLocaleString()}</span>}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
