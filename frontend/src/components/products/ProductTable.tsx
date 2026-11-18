"use client";

import { useEffect, useRef, useState } from "react";
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
import { COL, productColumns } from "./product-columns";
import { useAuthStore } from "@/lib/store/auth-store";
import { hasPermission } from "@/lib/permissions";
import { levelSubtitle, useLevelNames } from "@/lib/use-level-names";

function SortIcon({ col, sortKey, sortDir }: { col: SortKey; sortKey: SortKey | null; sortDir: SortDir }) {
  if (sortKey !== col) return <ChevronsUpDown className="w-3 h-3 ml-1 text-slate-400 inline shrink-0" />;
  return sortDir === "asc"
    ? <ChevronUp className="w-3 h-3 ml-1 text-sky-500 inline shrink-0" />
    : <ChevronDown className="w-3 h-3 ml-1 text-sky-500 inline shrink-0" />;
}

function SortButton({ col, label, sub, f, align = "left" }: { col: SortKey; label: string; sub?: string; f: ProductFiltersState; align?: "left" | "right" }) {
  return (
    <button
      type="button"
      onClick={() => f.handleSort(col)}
      aria-label={sub ? `${label} (${sub})` : undefined}
      className={`flex w-full items-center rounded font-bold text-slate-500 hover:text-sky-600 select-none outline-none focus-visible:ring-2 focus-visible:ring-sky-400 whitespace-nowrap ${align === "right" ? "justify-end text-right" : "justify-start"}`}
    >
      <span className="min-w-0">
        <span className="block">{label}</span>
        {sub && <span className="block truncate text-[10px] font-medium leading-tight text-slate-400" title={sub}>{sub}</span>}
      </span>
      <SortIcon col={col} sortKey={f.sortKey} sortDir={f.sortDir} />
    </button>
  );
}

const FORCE45_KEY = "purim_products_show_prices_45";
const readForce45 = () => { try { return localStorage.getItem(FORCE45_KEY) === "1"; } catch { return false; } };

/**
 * Columns follow the table's own width (product-columns.ts): price levels are their own columns ("ราคา 1".."ราคา 5"
 * with the shop's level names as a subtitle), at least 1-3; "แสดงราคา 4–5" only when 4-5 do not fit by themselves.
 * The table is `table-fixed`, so it always fits its container (no horizontal scroll).
 */
/** Product table (sortable headers, row selection, expandable pack units) with pagination. */
export function ProductTable({ data, f, sel, onEdit }: {
  data: ProductsData;
  f: ProductFiltersState;
  sel: ProductSelection;
  onEdit: (p: ProductRecord) => void;
}) {
  const { categories, loading, loadError, allPackaging, loadData } = data;
  const { filteredCount, paginatedList, currentPage, setCurrentPage, totalPages } = f;
  const user = useAuthStore((s) => s.user);
  const showCost = hasPermission(user, "VIEW_COST");
  const levelNames = useLevelNames();
  const [force45, setForce45] = useState(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- per-viewer preference, read after hydration
  useEffect(() => { setForce45(readForce45()); }, []);
  const changeForce45 = (on: boolean) => {
    setForce45(on);
    try { localStorage.setItem(FORCE45_KEY, on ? "1" : "0"); } catch { /* private window: not remembered */ }
  };
  const boxRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(0);
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setTableWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const layout = productColumns(tableWidth, { showCost, force45 });
  const nav = useRowNav(paginatedList.length, (i) => onEdit(paginatedList[i]));
  const cols = 5 + (layout.showCategory ? 1 : 0) + (showCost ? 1 : 0) + layout.levels.length;

  return (
    <div className="bg-white border border-slate-200 shadow-sm rounded-xl overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-2 text-xs text-slate-500">
        <span>คลิกแถว หรือเลือกด้วยปุ่ม ↑/↓ แล้วกด Enter เพื่อแก้ไขสินค้า</span>
        {layout.canForce && (
          <div className="inline-flex items-center gap-2 font-semibold text-slate-600">
            <Checkbox id="products-show-prices-45" checked={force45} onCheckedChange={changeForce45} />
            <label htmlFor="products-show-prices-45" className="cursor-pointer">แสดงราคา 4–5</label>
          </div>
        )}
      </div>
      <div ref={boxRef}>
        <Table className="table-fixed">
          <TableHeader className="bg-slate-50">
            <TableRow className="border-slate-200 hover:bg-transparent">
              <TableHead style={{ width: COL.select }} className="px-1.5 text-center">
                <div className="flex justify-center">
                  <Checkbox
                    checked={sel.isCurrentPageSelected}
                    onCheckedChange={sel.toggleSelectCurrentPage}
                    aria-label="เลือกสินค้าทั้งหมดในหน้านี้"
                  />
                </div>
              </TableHead>
              <TableHead style={{ width: COL.expand }} className="px-0"><span className="sr-only">ขนาดบรรจุ</span></TableHead>
              <TableHead className="px-2"><SortButton col="name" label="ชื่อสินค้า" f={f} /></TableHead>
              {layout.showCategory && <TableHead style={{ width: layout.categoryWidth }} className="px-2 text-slate-500">หมวดหมู่</TableHead>}
              <TableHead style={{ width: COL.stock }} className="px-2">
                {/* over the number slot of StockQty (unit slot 2.75rem + gap) */}
                <div className="pr-[3.125rem]"><SortButton col="stock" label="จำนวน" f={f} align="right" /></div>
              </TableHead>
              {showCost && <TableHead style={{ width: COL.cost }} className="px-2 text-right"><SortButton col="cost" label="ต้นทุน" f={f} align="right" /></TableHead>}
              {layout.levels.map((n) => (
                <TableHead key={n} style={{ width: layout.priceWidth }} className="px-2 text-right" data-testid={`price-head-${n}`}>
                  <SortButton col={priceLevelKey(n)} label={`ราคา ${n}`} sub={levelSubtitle(levelNames[n as 1 | 2 | 3 | 4 | 5], n)} f={f} align="right" />
                </TableHead>
              ))}
              <TableHead style={{ width: COL.edit }} className="px-0 text-center"><span className="sr-only">แก้ไข</span></TableHead>
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
                searchText={f.query.search}
                categories={categories}
                pkgUnits={allPackaging[p.id] || []}
                isExpanded={sel.expandedRows.has(p.id)}
                isSelected={sel.selectedProductIds.has(p.id)}
                onToggleExpand={() => sel.toggleExpand(p.id)}
                onToggleSelect={() => sel.toggleSelectProduct(p.id)}
                onEdit={() => onEdit(p)}
                layout={layout}
                showCost={showCost}
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
