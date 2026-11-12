"use client";

import { ChevronDown, ChevronUp, ChevronsUpDown } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadErrorState } from "@/components/common/LoadErrorState";
import { ProductTableRow } from "./ProductTableRow";
import { ITEMS_PER_PAGE, type ProductFiltersState } from "./useProductFilters";
import type { ProductsData } from "./useProducts";
import type { ProductSelection } from "./useProductSelection";
import { PRICE_LEVELS, priceLevelKey, type ProductRecord, type SortDir, type SortKey } from "./types";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 text-slate-400 inline" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 ml-1 text-sky-500 inline" />
    : <ChevronDown className="w-3 h-3 ml-1 text-sky-500 inline" />;
}

const sortableHead = "text-slate-500 whitespace-nowrap cursor-pointer hover:text-sky-600 select-none";

/** Product table (sortable headers, row selection, expandable pack units) with pagination. */
export function ProductTable({ data, f, sel, onEdit }: {
  data: ProductsData;
  f: ProductFiltersState;
  sel: ProductSelection;
  onEdit: (p: ProductRecord) => void;
}) {
  const { categories, loading, loadError, allPackaging, allImages, loadData } = data;
  const { filtered, paginatedList, currentPage, setCurrentPage, totalPages, sortKey, sortDir, handleSort } = f;

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader className="bg-slate-50">
            <TableRow className="border-slate-200 hover:bg-transparent">
              <TableHead className="w-10 text-center">
                <div className="flex justify-center">
                  <Checkbox
                    checked={sel.isCurrentPageSelected}
                    onCheckedChange={sel.toggleSelectCurrentPage}
                    aria-label="เลือกสินค้าทั้งหมดในหน้านี้"
                  />
                </div>
              </TableHead>
              <TableHead className="w-8"></TableHead>
              <TableHead className="text-slate-500 text-center whitespace-nowrap">บาร์โค้ด</TableHead>
              <TableHead className="text-slate-500 whitespace-nowrap">รหัสสินค้า</TableHead>
              <TableHead className={sortableHead} onClick={() => handleSort("name")}>ชื่อสินค้า <SortIcon col="name" sortKey={sortKey} sortDir={sortDir} /></TableHead>
              <TableHead className="text-slate-500 whitespace-nowrap">หมวดหมู่</TableHead>
              <TableHead className={`${sortableHead} text-right`} onClick={() => handleSort("stock")}>จำนวน <SortIcon col="stock" sortKey={sortKey} sortDir={sortDir} /></TableHead>
              <TableHead className="text-slate-500 text-center whitespace-nowrap">หน่วย</TableHead>
              <TableHead className={`${sortableHead} text-right`} onClick={() => handleSort("basePrice")}>ต้นทุน <SortIcon col="basePrice" sortKey={sortKey} sortDir={sortDir} /></TableHead>
              {PRICE_LEVELS.map(n => (
                <TableHead key={n} className={`${sortableHead} text-right`} onClick={() => handleSort(priceLevelKey(n))}>
                  ราคา {n} <SortIcon col={priceLevelKey(n)} sortKey={sortKey} sortDir={sortDir} />
                </TableHead>
              ))}
              <TableHead className="text-slate-500 text-center whitespace-nowrap">แก้ไข</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={15} className="text-center h-32 text-slate-500">กำลังโหลด...</TableCell></TableRow>
            ) : loadError ? (
              <TableRow><TableCell colSpan={15}><LoadErrorState message={loadError} onRetry={() => loadData()} /></TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={15} className="text-center h-40 text-slate-400">ไม่พบสินค้าที่ตรงกับเงื่อนไข</TableCell></TableRow>
            ) : paginatedList.map((p) => (
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
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Navigation */}
      {filtered.length > 0 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">
          <div className="text-xs text-slate-500 font-medium">
            แสดง <b className="text-slate-800">{Math.min((currentPage - 1) * ITEMS_PER_PAGE + 1, filtered.length)}</b> - <b className="text-slate-800">{Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)}</b> จากทั้งหมด <b className="text-slate-800">{filtered.length}</b> รายการ
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
