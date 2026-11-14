"use client";

import { Fragment } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { formatCurrency } from "@/lib/utils";
import { computeMultipliers, getProductBarcodes, lowStockThreshold } from "./product-helpers";
import { priceLevelKey, type CategoryOption, type PackagingUnitForm, type ProductImageItem, type ProductRecord } from "./types";

/** One product row, plus one sub-row per pack unit when expanded. */
export function ProductTableRow({
  p, categories, pkgUnits, prodImages, isExpanded, isSelected, onToggleExpand, onToggleSelect, onEdit,
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
}) {
  const stock = p.stock ?? 0;
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

  return (
    <Fragment>
      <TableRow className={`border-slate-100 hover:bg-slate-50 ${isExpanded ? "bg-sky-50/20" : ""}`}>
        <TableCell className="text-center align-middle">
          <div className="flex justify-center" onClick={(e) => e.stopPropagation()}>
            <Checkbox
              checked={isSelected}
              onCheckedChange={onToggleSelect}
              aria-label={`เลือกสินค้า ${p.name}`}
            />
          </div>
        </TableCell>
        <TableCell className="text-center p-0 pl-2">
          {pkgUnits.length > 0 ? (
            <button onClick={onToggleExpand} className="w-7 h-7 rounded flex items-center justify-center text-sky-500 hover:bg-sky-100 transition-colors">
              <ChevronRight className={`w-4 h-4 transition-transform duration-150 ${isExpanded ? "rotate-90" : ""}`} />
            </button>
          ) : <div className="w-7 h-7" />}
        </TableCell>
        <TableCell className="text-center">
          <div className="flex flex-col gap-1 items-center">
            {displayBarcodes.slice(0, 3).map((barcode, bi) => (
              <div key={bi} className="inline-flex items-center font-mono text-xs text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                <span>{barcode}</span>
              </div>
            ))}
            {displayBarcodes.length > 3 && <span className="text-xs text-slate-400">+{displayBarcodes.length - 3} อื่นๆ</span>}
            {displayBarcodes.length === 0 && <span className="text-slate-300 text-xs">—</span>}
          </div>
        </TableCell>
        <TableCell className="font-mono text-xs font-semibold text-slate-600 whitespace-nowrap">{p.sku}</TableCell>
        <TableCell className="font-semibold text-slate-900 min-w-[200px]">
          <div className="flex items-center gap-2.5">
            {coverImg ? (
              // eslint-disable-next-line @next/next/no-img-element -- base64 data URL from the database, next/image cannot optimise it
              <img src={coverImg} alt={p.name} className="w-9 h-9 rounded-lg object-cover border border-slate-200 shrink-0 shadow-sm" />
            ) : (
              <div className="w-9 h-9 rounded-lg bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-500 shrink-0 text-base">
                {category?.icon || "📦"}
              </div>
            )}
            <div>
              <div className="flex items-center gap-1.5">
                <span>{p.name}</span>
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
              {pkgUnits.length > 0 && <span className="text-xs text-sky-500 font-normal">{pkgUnits.length} ขนาดบรรจุ</span>}
            </div>
          </div>
        </TableCell>
        <TableCell className="whitespace-nowrap"><Badge variant="outline" className="bg-sky-50 text-sky-700 border-sky-200 font-normal">{category?.name || "-"}</Badge></TableCell>
        <TableCell className="text-right whitespace-nowrap">
          <Badge variant="outline" className={stockClass}>
            {isNegativeStock && <span className="mr-1 text-xs">🔻</span>}
            {isLowStock && <span className="mr-1 text-xs">⚠️</span>}
            {isNegativeStock ? stock : stock === 0 ? "หมด" : stock}
          </Badge>
        </TableCell>
        <TableCell className="text-center text-slate-500 text-sm whitespace-nowrap">{p.unit || "-"}</TableCell>
        <TableCell className="text-right text-slate-600 text-sm whitespace-nowrap">{p.basePrice != null ? formatCurrency(p.basePrice) : "-"}</TableCell>
        <TableCell className="text-right font-semibold text-emerald-600 whitespace-nowrap">{p.priceLevel1 != null ? formatCurrency(p.priceLevel1) : p.basePrice != null ? formatCurrency(p.basePrice) : "-"}</TableCell>
        {[2,3,4,5].map(n => { const v = p[priceLevelKey(n)]; return <TableCell key={n} className="text-right text-slate-600 whitespace-nowrap">{v != null ? formatCurrency(v) : "-"}</TableCell>; })}
        <TableCell className="text-center">
          <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-400 hover:text-sky-600 hover:bg-sky-50" onClick={onEdit}>
            <Pencil className="w-4 h-4" />
          </Button>
        </TableCell>
      </TableRow>
      {isExpanded && pkgUnits.map((unit, ui) => {
        const mult = pkgMults[ui];
        const unitStock = Math.floor(stock / mult);
        const unitCost = p.basePrice != null ? Number(p.basePrice) * mult : null;
        return (
          <TableRow key={`${p.id}-pkg-${ui}`} className="bg-sky-50/40 border-sky-100 hover:bg-sky-50/60">
            <TableCell className="py-2" />
            <TableCell className="p-0 pl-2"><div className="w-7 h-7 flex items-center justify-center"><div className="w-px h-5 bg-sky-200 ml-3.5" /></div></TableCell>
            <TableCell className="text-center py-2"><span className="font-mono text-xs text-sky-700 bg-sky-100 px-1.5 py-0.5 rounded">{unit.barcode || "-"}</span></TableCell>
            <TableCell className="py-2"><span className="text-xs text-slate-300">—</span></TableCell>
            <TableCell className="py-2">
              <div className="flex items-center gap-2">
                <div className="w-1 h-4 rounded-full bg-sky-300 shrink-0" />
                <span className="text-sm font-semibold text-sky-800">{unit.name}</span>
                <span className="text-xs text-sky-500 bg-sky-100 px-1.5 py-0.5 rounded-full">× {mult.toLocaleString()} {p.unit || "ชิ้น"}</span>
              </div>
            </TableCell>
            <TableCell className="py-2"><span className="text-xs text-slate-300">—</span></TableCell>
            <TableCell className="text-right py-2">
              <Badge variant="outline" className={unitStock === 0 ? "bg-rose-50 text-rose-500 border-rose-200" : "bg-sky-50 text-sky-700 border-sky-200"}>{unitStock}</Badge>
            </TableCell>
            <TableCell className="text-center text-sky-700 text-sm py-2 font-medium">{unit.name}</TableCell>
            <TableCell className="text-right text-slate-400 text-xs py-2">{unitCost != null ? formatCurrency(unitCost) : "-"}</TableCell>
            <TableCell className="text-right py-2">{unit.priceLevel1 ? <span className="font-semibold text-emerald-600">{formatCurrency(parseFloat(unit.priceLevel1))}</span> : <span className="text-slate-300 text-xs">—</span>}</TableCell>
            {[2,3,4,5].map(n => { const v = unit[priceLevelKey(n)]; return <TableCell key={n} className="text-right py-2">{v ? <span className="text-slate-600 text-sm">{formatCurrency(parseFloat(v))}</span> : <span className="text-slate-300 text-xs">—</span>}</TableCell>; })}
            <TableCell className="py-2 text-center"><span className="text-slate-300 text-xs">—</span></TableCell>
          </TableRow>
        );
      })}
    </Fragment>
  );
}
