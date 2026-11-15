"use client";

import { useEffect, useState } from "react";
import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { useRowNav } from "@/lib/use-row-nav";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadErrorState } from "@/components/common/LoadErrorState";
import { ProductTableRow } from "./ProductTableRow";
import { ITEMS_PER_PAGE, type ProductFiltersState } from "./useProductFilters";
import type { ProductsData } from "./useProducts";
import type { ProductSelection } from "./useProductSelection";
import { priceLevelKey, type ProductRecord, type SortDir, type SortKey } from "./types";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 text-slate-400 inline" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 ml-1 text-sky-500 inline" />
    : <ChevronDown className="w-3 h-3 ml-1 text-sky-500 inline" />;
}

function SortButton({ col, label, f, align = "left" }: { col: SortKey; label: string; f: ProductFiltersState; align?: "left" | "right" }) {
  return (
    <button
      type="button"
      onClick={() => f.handleSort(col)}
      className={`inline-flex items-center rounded font-bold text-slate-500 hover:text-sky-600 select-none outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${align === "right" ? "justify-end w-full" : ""}`}
    >
      {label} <SortIcon col={col} sortKey={f.sortKey} sortDir={f.sortDir} />
    </button>
  );
}

const PRICES_KEY = "purim_products_show_prices";
const readShowPrices = () => { try { return localStorage.getItem(PRICES_KEY) === "1"; } catch { return false; } };

/**
 * Column widths: the table is `table-fixed` so it always fits its container (no horizontal scroll at
 * 1093 px = 1366x768 at Windows 125 %); the name column takes the rest and wraps. Price levels 2-5 are
 * hidden by default ("แสดงราคา 2–5" shows them stacked in one column).
 */

/** Product table (sortable headers, row selection, expandable pack units) with pagination. */
export function ProductTable({ data, f, sel, onEdit }: {
  data: ProductsData;
  f: ProductFiltersState;
  sel: ProductSelection;
  onEdit: (p: ProductRecord) => void;
}) {
  const { categories, loading, loadError, allPackaging, allImages, loadData } = data;
  const { filteredCount, paginatedList, currentPage, setCurrentPage, totalPages } = f;
  const [showPrices, setShowPrices] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- per-viewer preference, read after hydration
  useEffect(() => { setShowPrices(readShowPrices()); }, []);
  const changeShowPrices = (on: boolean) => {
    setShowPrices(on);
    try { localStorage.setItem(PRICES_KEY, on ? "1" : "0"); } catch { /* private window: not remembered */ }
  };
  const nav = useRowNav(paginatedList.length, (i) => onEdit(paginatedList[i]));
  const cols = showPrices ? 11 : 10;

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
        <span>คลิกแถว หรือเลือกด้วยปุ่ม ↑/↓ แล้วกด Enter เพื่อแก้ไขสินค้า</span>
        <div className="inline-flex items-center gap-2 font-semibold text-slate-600">
          <Checkbox id="products-show-prices" checked={showPrices} onCheckedChange={changeShowPrices} />
          <label htmlFor="products-show-prices" className="cursor-pointer">แสดงราคา 2–5</label>
        </div>
      </div>
      <div>
        <Table className="table-fixed">
          <TableHeader className="bg-slate-50">
            <TableRow className="border-slate-200 hover:bg-transparent">
              <TableHead className="w-10 px-2 text-center">
                <div className="flex justify-center">
                  <Checkbox
                    checked={sel.isCurrentPageSelected}
                    onCheckedChange={sel.toggleSelectCurrentPage}
                    aria-label="เลือกสินค้าทั้งหมดในหน้านี้"
                  />
                </div>
              </TableHead>
              <TableHead className="w-9 px-1"><span className="sr-only">ขนาดบรรจุ</span></TableHead>
              <TableHead className="px-3"><SortButton col="name" label="ชื่อสินค้า / รหัส / บาร์โค้ด" f={f} /></TableHead>
              <TableHead className="hidden xl:table-cell w-40 text-slate-500 px-3">หมวดหมู่</TableHead>
              <TableHead className="w-20 text-right px-3"><SortButton col="stock" label="จำนวน" f={f} align="right" /></TableHead>
              <TableHead className="w-16 text-slate-500 text-center px-2">หน่วย</TableHead>
              <TableHead className="w-24 text-right px-3"><SortButton col="cost" label="ต้นทุน" f={f} align="right" /></TableHead>
              <TableHead className="w-24 text-right px-3"><SortButton col={priceLevelKey(1)} label="ราคา 1" f={f} align="right" /></TableHead>
              {showPrices && <TableHead className="w-28 text-right text-slate-500 px-3">ราคา 2–5</TableHead>}
              <TableHead className="w-14 text-slate-500 text-center px-1">แก้ไข</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody {...nav.bodyProps}>
            {loading ? (
              <TableRow><TableCell colSpan={cols} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell></TableRow>
            ) : loadError ? (
              <TableRow><TableCell colSpan={cols}><LoadErrorState message={loadError} onRetry={() => loadData()} /></TableCell></TableRow>
            ) : filteredCount === 0 ? (
              <TableRow><TableCell colSpan={cols} className="text-center h-40 text-slate-400">ไม่พบสินค้าที่ตรงกับเงื่อนไข</TableCell></TableRow>
            ) : paginatedList.map((p, i) => (
              <ProductTableRow
                key={p.id}
                p={p}
                categories={categories}
                pkgUnits={allPackaging[p.id] || []}
                prodImages={allImages[p.id] || []}
                isExpanded={sel.expandedRows.has(p.id)}
                isSelected={sel.selectedProductIds.has(p.id)}
                onToggleExpand={() => sel.toggleExpand(p.id)}
                onToggleSelect={() => sel.toggleSelectProduct(p.id)}
                onEdit={() => onEdit(p)}
                showPrices={showPrices}
                rowNav={nav.rowProps(i)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Navigation */}
      {filteredCount > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">
          <div className="text-xs text-slate-500 font-medium">
            แสดง <b className="text-slate-800">{Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filteredCount)}</b> - <b className="text-slate-800">{Math.min(currentPage * ITEMS_PER_PAGE, filteredCount)}</b> จากทั้งหมด <b className="text-slate-800">{filteredCount}</b> รายการ
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage <= 1}
              onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
              className="h-8 px-3 text-xs font-semibold border-slate-300"
            >
              ‹ ก่อนหน้า
            </Button>
            <div className="flex items-center gap-1 px-2">
              <span className="text-xs font-bold text-slate-700">หน้า {currentPage}</span>
              <span className="text-xs text-slate-400">/ {totalPages}</span>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage >= totalPages}
              onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
              className="h-8 px-3 text-xs font-semibold border-slate-300"
            >
              ถัดไป ›
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
