"use client";

import { SearchMatchHint } from '@/components/common/SearchMatchHint';
import { Fragment, type HTMLAttributes } from "react";
import { ROW_NAV_CLASS } from "@/lib/use-row-nav";
import { ChevronRight, ClipboardList, Copy, Pencil, Power, PowerOff, SlidersHorizontal, Trash2 } from "lucide-react";
import { RowActionsMenu } from "@/components/common/RowActionsMenu";
import type { ProductActions } from "./useProductActions";
import { TableCell, TableRow } from "@/components/ui/table";
import { StatusChip } from "@/components/ui/status-chip";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/utils";
import { displayUnitCost, stockOnHandCost } from "@/lib/product-cost";
import { computeMultipliers, lowStockThreshold } from "./product-helpers";
import type { ProductColumns } from "./product-columns";
import { priceLevelKey, type CategoryOption, type PackagingUnitForm, type ProductRecord } from "./types";

/**
 * Quantity + unit in one line: the number right-aligned in its slot, the unit left-aligned in a fixed slot after it,
 * so numbers and units each form a straight column whatever the table width (sidebar open or collapsed).
 */
function StockQty({ value, unit, tone, unitClass = "text-muted-foreground" }: { value: string; unit: string; tone: string; unitClass?: string }) {
  // plain number + unit (style pass 2026-11-22: no box around a quantity); colour only when it means something
  // (red = out / negative, amber = low). Number right-aligned in its slot, unit in a fixed slot -> straight columns.
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_2.75rem] items-baseline gap-1.5 whitespace-nowrap">
      <span className={`text-right tabular-nums ${tone}`} data-testid="product-qty">{value}</span>
      <span className={`truncate text-left text-sub ${unitClass}`} title={unit} data-testid="product-unit">{unit}</span>
    </div>
  );
}

/** One product row, plus one sub-row per pack unit when expanded. */
export function ProductTableRow({
  p, searchText, categories, pkgUnits, isExpanded, isSelected, onToggleExpand, onToggleSelect, onEdit, actions, layout, showCost, rowNav,
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
  /** the "⋯" menu actions (useProductActions) */
  actions: ProductActions;
  /** columns for the table's width (product-columns.ts) */
  layout: ProductColumns;
  /** VIEW_COST: the cost column is shown */
  showCost: boolean;
  /** keyboard / click handlers of the shared row pattern (useRowNav) */
  rowNav: HTMLAttributes<HTMLTableRowElement>;
}) {
  const stock = p.stock ?? 0;
  // the cost typed in the product form, else the cost of the stock on hand - never the selling price (BUG-05)
  const unitCostOf = displayUnitCost(p);
  const stockCostOf = stockOnHandCost(p);
  const lowThreshold = lowStockThreshold(p);
  const isNegativeStock = stock < 0;
  const isLowStock = stock > 0 && stock <= lowThreshold;
  const stockTone = isNegativeStock || stock === 0 ? "text-danger font-medium" : isLowStock ? "text-warn font-medium" : "text-fg";
  const pkgMults = computeMultipliers(pkgUnits);
  const category = categories.find(c => c.id === p.categoryId);
  // forced levels 4-5 in a narrow table: smaller numbers; otherwise the body size
  const numCls = layout.tight ? "text-sub" : "";
  const inactive = p.isActive === false;

  return (
    <Fragment>
      <TableRow
        {...rowNav}
        aria-label={`${p.name}${inactive ? " (ปิดใช้งาน)" : ""} (Enter = แก้ไข)`}
        data-inactive={inactive ? "true" : undefined}
        data-testid="product-row"
        className={`border-slate-100 hover:bg-slate-50 ${ROW_NAV_CLASS} ${isExpanded ? "bg-sky-50/20" : ""} ${inactive ? "bg-slate-50/80 text-slate-500 [&>td:not(:last-child)]:opacity-60" : ""}`}
      >
        <TableCell className="cell-tight text-center align-middle">
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              aria-label={`เลือกสินค้า ${p.name}`}
            />
          </div>
        </TableCell>
        <TableCell className="cell-tight text-center">
          {pkgUnits.length > 0 ? (
            <button type="button" onClick={onToggleExpand} aria-label={`${isExpanded ? "ซ่อน" : "แสดง"}ขนาดบรรจุ ${p.name}`} aria-expanded={isExpanded} className="mx-auto w-6 h-7 rounded flex items-center justify-center text-sky-500 hover:bg-sky-100 transition-colors">
              <ChevronRight className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />
            </button>
          ) : null}
        </TableCell>
        <TableCell className="font-medium text-fg whitespace-normal">
          {/* round 4 (owner): the name only - no photo / icon, no barcodes (search by barcode / SKU still works) */}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 leading-snug">
              <span className="line-clamp-2 break-words" title={p.name} data-testid="product-name">{p.name}</span>
              {inactive && (
                <StatusChip tone="neutral" data-testid="product-inactive-chip">ปิดใช้งาน</StatusChip>
              )}
              {p.isBundle && (
                <span className="shrink-0 text-sub font-normal text-muted-foreground">
                  · ชุด {p.bundleItems?.length || 0} ชิ้น
                </span>
              )}
            </div>
            <SearchMatchHint product={p} query={searchText} />
            {(pkgUnits.length > 0 || (!layout.showCategory && category?.name)) && (
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sub font-normal text-muted-foreground">
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
                  <span data-testid="product-category-chip" className="max-w-[10rem] truncate" title={category.name}>{category.name}</span>
                )}
              </div>
            )}
          </div>
        </TableCell>
        {layout.showCategory && (
          <TableCell >
            {category?.name ? (
              <span data-testid="product-category" className="block max-w-full truncate text-muted-foreground" title={category.name}>{category.name}</span>
            ) : <span className="text-subtle">-</span>}
          </TableCell>
        )}
        <TableCell  data-testid="product-stock">
          <StockQty
            value={isNegativeStock ? String(stock) : stock === 0 ? "หมด" : stock.toLocaleString()}
            unit={p.unit || "-"}
            tone={stockTone}
          />
        </TableCell>
        {showCost && (
          <TableCell className={`cell-tight text-right text-muted-foreground whitespace-nowrap tabular-nums ${numCls}`} data-testid="product-cost">
            <span className="block">{unitCostOf !== undefined ? formatCurrency(unitCostOf) : "-"}</span>
            {stockCostOf !== undefined && (
              <span className="block whitespace-normal text-xs text-subtle" title="ต้นทุนเฉลี่ยของสต็อกที่มีอยู่ (ใช้คิดกำไรตอนขาย)" data-testid="product-stock-cost">สต็อก {formatCurrency(stockCostOf)}</span>
            )}
          </TableCell>
        )}
        {layout.levels.map((n) => {
          const v = n === 1 ? (p.priceLevel1 ?? p.basePrice) : p[priceLevelKey(n)];
          return (
            <TableCell key={n} className={`cell-tight text-right whitespace-nowrap tabular-nums ${numCls} ${n === 1 ? "font-medium text-fg" : "text-fg"}`} data-testid={`product-price-${n}`}>
              {v != null && v !== "" ? formatCurrency(v) : <span className="text-subtle">-</span>}
            </TableCell>
          );
        })}
        <TableCell className="cell-tight text-center" onClick={(e) => e.stopPropagation()}>
          <div className="flex justify-center">
            <RowActionsMenu
              label={`จัดการสินค้า ${p.name}`}
              testId="product-actions"
              actions={[
                { label: "แก้ไข", icon: Pencil, onSelect: onEdit, testId: "product-action-edit" },
                { label: "สต็อกการ์ด / ประวัติความเคลื่อนไหว", icon: ClipboardList, onSelect: () => actions.stockCard(p), hidden: p.isBundle, testId: "product-action-card" },
                { label: "ปรับสต็อก", icon: SlidersHorizontal, onSelect: () => actions.adjustStock(p), hidden: p.isBundle, testId: "product-action-adjust" },
                { label: "สร้างสินค้าคล้ายกัน", icon: Copy, onSelect: () => actions.duplicate(p), testId: "product-action-duplicate" },
                inactive
                  ? { label: "เปิดใช้งาน", icon: Power, onSelect: () => void actions.toggleActive(p), testId: "product-action-enable" }
                  : { label: "ปิดการใช้งาน", icon: PowerOff, onSelect: () => void actions.toggleActive(p), testId: "product-action-disable" },
                { label: "ลบสินค้า", icon: Trash2, onSelect: () => void actions.remove(p), danger: true, testId: "product-action-delete" },
              ]}
            />
          </div>
        </TableCell>
      </TableRow>
      {isExpanded && pkgUnits.map((unit, ui) => {
        const mult = pkgMults[ui];
        const unitStock = Math.floor(stock / mult);
        const unitCost = unitCostOf !== undefined ? unitCostOf * mult : null;
        return (
          <TableRow key={`${p.id}-pkg-${ui}`} className="bg-sky-50/40 border-sky-100 hover:bg-sky-50/60">
            <TableCell className="cell-tight" />
            <TableCell className="cell-tight"><div className="mx-auto w-px h-5 bg-sky-200" /></TableCell>
            <TableCell className="whitespace-normal">
              <div className="flex flex-wrap items-center gap-1.5">
                <div className="w-1 h-4 rounded-full bg-sky-300 shrink-0" />
                <span className="font-medium text-fg">{unit.name}</span>
                <span className="text-sub text-muted-foreground">× {mult.toLocaleString()} {p.unit || "ชิ้น"}</span>
              </div>
            </TableCell>
            {layout.showCategory && <TableCell ><span className="text-sub text-subtle">—</span></TableCell>}
            <TableCell >
              <StockQty
                value={String(unitStock)}
                unit={unit.name}
                tone={unitStock === 0 ? "text-danger" : "text-fg"}
              />
            </TableCell>
            {showCost && <TableCell className={`cell-tight text-right text-subtle whitespace-nowrap tabular-nums ${numCls}`}>{unitCost != null ? formatCurrency(unitCost) : "-"}</TableCell>}
            {layout.levels.map((n) => {
              const v = unit[priceLevelKey(n)];
              return (
                <TableCell key={n} className={`cell-tight text-right whitespace-nowrap tabular-nums ${numCls} text-muted-foreground`}>
                  {v ? formatCurrency(parseFloat(v)) : <span className="text-subtle">—</span>}
                </TableCell>
              );
            })}
            <TableCell className="cell-tight text-center"><span className="text-subtle text-sub">—</span></TableCell>
          </TableRow>
        );
      })}
    </Fragment>
  );
}
