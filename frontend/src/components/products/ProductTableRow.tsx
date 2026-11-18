"use client";

import { Fragment, type HTMLAttributes } from "react";
import { ROW_NAV_CLASS } from "@/lib/use-row-nav";
import { ChevronRight, Pencil } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/utils";
import { displayUnitCost } from "@/lib/product-cost";
import { computeMultipliers, getProductBarcodes, lowStockThreshold } from "./product-helpers";
import type { ProductColumns } from "./product-columns";
import { priceLevelKey, type CategoryOption, type PackagingUnitForm, type ProductImageItem, type ProductRecord } from "./types";

/** Barcodes shown in the name cell; the rest are "+N" with all of them in the tooltip. */
const MAX_BARCODES = 3;

/** One product row, plus one sub-row per pack unit when expanded. */
export function ProductTableRow({
  p, categories, pkgUnits, prodImages, isExpanded, isSelected, onToggleExpand, onToggleSelect, onEdit, layout, showCost, rowNav,
}: {
  p: ProductRecord;
  categories: CategoryOption[];
  pkgUnits: PackagingUnitForm[];
  prodImages: ProductImageItem[];
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
  const coverItem = prodImages.find(img => img.isCover) || prodImages[0];
  // small copy from the server (GET /api/product-images/:id?size=thumb), or a just-uploaded photo's data
  const coverImg = coverItem?.thumbDataUrl || coverItem?.dataUrl || coverItem?.thumbUrl || coverItem?.url || p.imageUrl || null;
  const displayBarcodes = getProductBarcodes(p);
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
          <div className="flex items-center gap-2 min-w-0">
            {!layout.tight && (coverImg ? (
              // eslint-disable-next-line @next/next/no-img-element -- base64 data URL from the database, next/image cannot optimise it
              <img src={coverImg} alt={p.name} className="w-8 h-8 rounded-md object-cover border border-slate-200 shrink-0" />
            ) : (
              <div className="w-8 h-8 rounded-md bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0 text-sm">
                {category?.icon || "📦"}
              </div>
            ))}
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug">
                <span className="line-clamp-2 break-words" title={p.name}>{p.name}</span>
                {p.isBundle && (
                  <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 px-1.5 py-0.5 rounded font-bold shrink-0">
                    🎁 ชุด ({p.bundleItems?.length || 0} ชิ้น)
                  </span>
                )}
                {prodImages.length > 0 && (
                  <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 px-1 py-0.2 rounded font-medium">
                    📷 {prodImages.length}
                  </span>
                )}
              </div>
              {/* name + barcodes only (owner 2026-11-18: the product code is not shown here; search still finds it) */}
              <div className="mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 text-[11px] font-normal text-slate-500" data-testid="product-barcodes">
                {displayBarcodes.slice(0, MAX_BARCODES).map((barcode, bi) => (
                  <span key={bi} title={barcode} className="font-mono text-slate-500 bg-slate-100 px-1 rounded border border-slate-200 truncate max-w-full">{barcode}</span>
                ))}
                {displayBarcodes.length > MAX_BARCODES && (
                  <span className="text-slate-400 cursor-help" title={displayBarcodes.join("\n")}>+{displayBarcodes.length - MAX_BARCODES}</span>
                )}
                {pkgUnits.length > 0 && <span className="text-sky-600 whitespace-nowrap">{pkgUnits.length} ขนาดบรรจุ</span>}
                {!layout.showCategory && category?.name && (
                  <span data-testid="product-category-chip" className="max-w-full truncate rounded-full border border-sky-200 bg-sky-50 px-1.5 text-sky-700" title={category.name}>{category.name}</span>
                )}
              </div>
            </div>
          </div>
        </TableCell>
        {layout.showCategory && (
          <TableCell className="px-2"><Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 font-normal max-w-full truncate block" title={category?.name}>{category?.name || "-"}</Badge></TableCell>
        )}
        <TableCell className="text-right whitespace-nowrap px-2" data-testid="product-stock">
          <Badge variant="outline" className={`${stockClass} px-1.5 tabular-nums`}>
            {isNegativeStock && <span className="mr-0.5 text-[10px]">🔻</span>}
            {isLowStock && <span className="mr-0.5 text-[10px]">⚠️</span>}
            {isNegativeStock ? stock : stock === 0 ? "หมด" : stock.toLocaleString()}
          </Badge>
          <div className="mt-0.5 truncate text-[11px] text-slate-500" title={p.unit}>{p.unit || "-"}</div>
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
                {unit.barcode && <span className="font-mono text-[11px] text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{unit.barcode}</span>}
              </div>
            </TableCell>
            {layout.showCategory && <TableCell className="py-1.5"><span className="text-xs text-slate-300">—</span></TableCell>}
            <TableCell className="text-right py-1.5 px-2 whitespace-nowrap">
              <Badge variant="outline" className={`px-1.5 tabular-nums ${unitStock === 0 ? "bg-rose-50 text-rose-500 border-rose-200" : "bg-sky-50 text-sky-700 border-sky-200"}`}>{unitStock}</Badge>
              <div className="mt-0.5 truncate text-[11px] font-medium text-sky-700">{unit.name}</div>
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
