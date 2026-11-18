"use client";

import { SearchMatchHint } from '@/components/common/SearchMatchHint';
import { Fragment, type HTMLAttributes } from "react";
import { ROW_NAV_CLASS } from "@/lib/use-row-nav";
import { ChevronRight, Pencil } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/utils";
import { displayUnitCost } from "@/lib/product-cost";
import { computeMultipliers, lowStockThreshold } from "./product-helpers";
import type { ProductColumns } from "./product-columns";
import { priceLevelKey, type CategoryOption, type PackagingUnitForm, type ProductRecord } from "./types";

/**
 * Quantity + unit in one line: the number right-aligned in its slot, the unit left-aligned in a fixed slot after it,
 * so numbers and units each form a straight column whatever the table width (sidebar open or collapsed).
 */
function StockQty({ value, unit, badgeClass, prefix, unitClass = "text-slate-500" }: { value: string; unit: string; badgeClass: string; prefix?: string | null; unitClass?: string }) {
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-center gap-1.5 whitespace-nowrap">
      <span className="flex justify-end">
        <Badge variant="outline" className={`${badgeClass} px-1.5 tabular-nums`}>
          {prefix && <span className="mr-0.5 text-[10px]">{prefix}</span>}
          {value}
        </Badge>
      </span>
      <span className={`truncate text-left text-[11px] ${unitClass}`} title={unit} data-testid="product-unit">{unit}</span>
    </div>
  );
}

/** One product row, plus one sub-row per pack unit when expanded. */
export function ProductTableRow({
  p, searchText, categories, pkgUnits, isExpanded, isSelected, onToggleExpand, onToggleSelect, onEdit, layout, showCost, rowNav,
}: {
  p: ProductRecord;
  /** the search the page shows: a match from another name gets a small hint under the name */
  searchText?: string;
  categories: CategoryOption[];
  pkgUnits: PackagingUnitForm[];
  isExpanded: boolean;
  isSelected: boolean;
  onToggleExpand: () => void;
  onToggleSelect: () => void;
  onEdit: () => void;
  /** columns for the table's width (product-columns.ts) */
  layout: ProductColumns;
  /** VIEW_COST: the cost column is shown */
  showCost: boolean;
  /** keyboard / click handlers of the shared row pattern (useRowNav) */
  rowNav: HTMLAttributes<HTMLTableRowElement>;
}) {
  const stock = p.stock ?? 0;
  // cost of the stock on hand, else the reference cost - never the selling price (BUG-05)
  const unitCostOf = displayUnitCost(p);
  const lowThreshold = lowStockThreshold(p);
  const isNegativeStock = stock < 0;
  const isLowStock = stock > 0 && stock <= lowThreshold;
  const stockClass = isNegativeStock
    ? "bg-rose-600 text-white border-rose-700 font-extrabold shadow-2xs"
    : stock === 0
    ? "bg-rose-50 text-rose-600 border-rose-200 font-bold"
    : isLowStock
    ? "bg-amber-100 text-amber-800 border-amber-300 font-bold"
    : "bg-emerald-50 text-emerald-700 border-emerald-200";
  const pkgMults = computeMultipliers(pkgUnits);
  const category = categories.find(c => c.id === p.categoryId);
  const numCls = layout.tight ? "text-xs" : "text-[13px]";

  return (
    <Fragment>
      <TableRow {...rowNav} aria-label={`${p.name} (Enter = แก้ไข)`} className={`border-slate-100 hover:bg-slate-50 ${ROW_NAV_CLASS} ${isExpanded ? "bg-sky-50/20" : ""}`}>
        <TableCell className="text-center align-middle px-1.5">
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              aria-label={`เลือกสินค้า ${p.name}`}
            />
          </div>
        </TableCell>
        <TableCell className="text-center p-0">
          {pkgUnits.length > 0 ? (
            <button type="button" onClick={onToggleExpand} aria-label={`${isExpanded ? "ซ่อน" : "แสดง"}ขนาดบรรจุ ${p.name}`} aria-expanded={isExpanded} className="mx-auto w-6 h-7 rounded flex items-center justify-center text-sky-500 hover:bg-sky-100 transition-colors">
              <ChevronRight className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />
            </button>
          ) : null}
        </TableCell>
        <TableCell className="font-semibold text-slate-900 whitespace-normal px-2 py-2">
          {/* round 4 (owner): the name only - no photo / icon, no barcodes (search by barcode / SKU still works) */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug">
              <span className="line-clamp-2 break-words" title={p.name} data-testid="product-name">{p.name}</span>
              {p.isBundle && (
                <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded font-bold shrink-0">
                  🎁 ชุด ({p.bundleItems?.length || 0} ชิ้น)
                </span>
              )}
            </div>
            <SearchMatchHint product={p} query={searchText} />
            {(pkgUnits.length > 0 || (!layout.showCategory && category?.name)) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] font-normal text-slate-500">
                {pkgUnits.length > 0 && (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => { e.stopPropagation(); onToggleExpand(); }}
                    className="whitespace-nowrap text-sky-600 hover:underline"
                    data-testid="product-pack-link"
                  >
                    {pkgUnits.length} ขนาดบรรจุ
                  </button>
                )}
                {!layout.showCategory && category?.name && (
                  <span data-testid="product-category-chip" className="max-w-[10rem] truncate rounded-full border border-sky-200 bg-sky-50 px-1.5 text-sky-700" title={category.name}>{category.name}</span>
                )}
              </div>
            )}
          </div>
        </TableCell>
        {layout.showCategory && (
          <TableCell className="px-2">
            {category?.name ? (
              <span data-testid="product-category" className="block max-w-full truncate rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] text-sky-700" title={category.name}>{category.name}</span>
            ) : <span className="text-xs text-slate-300">-</span>}
          </TableCell>
        )}
        <TableCell className="px-2" data-testid="product-stock">
          <StockQty
            value={isNegativeStock ? String(stock) : stock === 0 ? "หมด" : stock.toLocaleString()}
            unit={p.unit || "-"}
            badgeClass={stockClass}
            prefix={isNegativeStock ? "🔻" : isLowStock ? "⚠️" : null}
          />
        </TableCell>
        {showCost && (
          <TableCell className={`text-right text-slate-600 whitespace-nowrap tabular-nums px-2 ${numCls}`} data-testid="product-cost">{unitCostOf !== undefined ? formatCurrency(unitCostOf) : "-"}</TableCell>
        )}
        {layout.levels.map((n) => {
          const v = n === 1 ? (p.priceLevel1 ?? p.basePrice) : p[priceLevelKey(n)];
          return (
            <TableCell key={n} className={`text-right whitespace-nowrap tabular-nums px-2 ${numCls} ${n === 1 ? "font-semibold text-emerald-600" : "text-slate-700"}`} data-testid={`product-price-${n}`}>
              {v != null && v !== "" ? formatCurrency(v) : <span className="text-slate-300">-</span>}
            </TableCell>
          );
        })}
        <TableCell className="text-center px-0">
          <Button variant="ghost" size="icon" tabIndex={-1} aria-label={`แก้ไข ${p.name}`} className="h-8 w-8 text-slate-400 hover:text-sky-600 hover:bg-sky-50" onClick={onEdit}>
            <Pencil className="w-4 h-4" />
          </Button>
        </TableCell>
      </TableRow>
      {isExpanded && pkgUnits.map((unit, ui) => {
        const mult = pkgMults[ui];
        const unitStock = Math.floor(stock / mult);
        const unitCost = unitCostOf !== undefined ? unitCostOf * mult : null;
        return (
          <TableRow key={`${p.id}-pkg-${ui}`} className="bg-sky-50/40 border-sky-100 hover:bg-sky-50/60">
            <TableCell className="py-1.5" />
            <TableCell className="p-0"><div className="mx-auto w-px h-5 bg-sky-200" /></TableCell>
            <TableCell className="py-1.5 whitespace-normal px-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="w-1 h-4 rounded-full bg-sky-300 shrink-0" />
                <span className="text-[13px] font-semibold text-sky-800">{unit.name}</span>
                <span className="text-[11px] text-sky-600 bg-sky-100 px-1.5 py-0.5 rounded-full">× {mult.toLocaleString()} {p.unit || "ชิ้น"}</span>
              </div>
            </TableCell>
            {layout.showCategory && <TableCell className="py-1.5"><span className="text-xs text-slate-300">—</span></TableCell>}
            <TableCell className="py-1.5 px-2">
              <StockQty
                value={String(unitStock)}
                unit={unit.name}
                badgeClass={unitStock === 0 ? "bg-rose-50 text-rose-500 border-rose-200" : "bg-sky-50 text-sky-700 border-sky-200"}
                unitClass="font-medium text-sky-700"
              />
            </TableCell>
            {showCost && <TableCell className={`text-right text-slate-400 py-1.5 px-2 whitespace-nowrap tabular-nums ${numCls}`}>{unitCost != null ? formatCurrency(unitCost) : "-"}</TableCell>}
            {layout.levels.map((n) => {
              const v = unit[priceLevelKey(n)];
              return (
                <TableCell key={n} className={`text-right py-1.5 px-2 whitespace-nowrap tabular-nums ${numCls} ${n === 1 ? "font-semibold text-emerald-600" : "text-slate-600"}`}>
                  {v ? formatCurrency(parseFloat(v)) : <span className="text-slate-300">—</span>}
                </TableCell>
              );
            })}
            <TableCell className="py-1.5 text-center"><span className="text-slate-300 text-xs">—</span></TableCell>
          </TableRow>
        );
      })}
    </Fragment>
  );
}
