import { getLowStockThreshold } from '@/lib/store-settings-storage';
import { parseProductCSV } from '@/lib/csv-parser';
import { isUnitsFormat, packChainText, parseUnitsRows, UNITS_SHEET, type ImportPackUnit } from '@/lib/product-import';
import * as XLSX from 'xlsx';
import { optionalNumberCell } from './product-helpers';
import type { ImportChangeType, ImportPreviewRow, ProductRecord } from './types';

/** One spreadsheet row keyed by header text; `__*` fields come from the per-unit format. */
export type RawImportRow = Record<string, unknown> & {
  __rowNo?: number;
  __barcodes?: string[];
  __packagingUnits?: ImportPackUnit[];
  __stockNote?: string;
};

type PackChain = Parameters<typeof packChainText>[1];

/**
 * File bytes -> raw rows. Per-unit format (template / export, .xlsx or .csv) is grouped by SKU;
 * other CSV goes through lib/csv-parser; other Excel = first sheet as is.
 * Returns null when the workbook has no sheet. Throws CsvImportError / ImportFileError with a user message.
 */
export function readImportRows(buffer: ArrayBuffer, fileName: string): RawImportRow[] | null {
  const isCsv = /\.csv$/i.test(fileName);
  const csvText = isCsv ? new TextDecoder("utf-8").decode(buffer) : "";
  // per-unit format (template / export): one row per unit, grouped by SKU
  const unitsBook = !isCsv
    ? XLSX.read(buffer, { type: "array" })
    : isUnitsFormat([csvText.split(/\r?\n/, 1)[0] || ""])
      ? XLSX.read(csvText.replace(/^﻿/, ""), { type: "string" })
      : null;
  const unitsSheet = unitsBook ? unitsBook.Sheets[UNITS_SHEET] || unitsBook.Sheets[unitsBook.SheetNames[0]] : null;
  const unitsHeaders: string[] = unitsSheet ? ((XLSX.utils.sheet_to_json<unknown[]>(unitsSheet, { header: 1 })[0]) || []).map(String) : [];
  if (unitsSheet && isUnitsFormat(unitsHeaders)) {
    const grouped = parseUnitsRows(XLSX.utils.sheet_to_json<Record<string, unknown>>(unitsSheet, { defval: "" }), unitsHeaders);
    return grouped.map((g) => ({
      "รหัสระบบ (System ID - ห้ามแก้ไข)": g.id,
      "รหัสสินค้า (SKU)": g.sku,
      "ชื่อสินค้า (Product Name)": g.name,
      "บาร์โค้ด (Barcode)": g.barcode,
      "หมวดหมู่ (Category)": g.categoryName,
      "หน่วยนับ (Unit)": g.unit,
      "ราคาทุน (Cost Price)": g.costPrice,
      "ราคาขาย 1 / ขายปลีก (Price 1)": g.priceLevel1,
      "ราคาขาย 2 (Price Level 2)": g.priceLevel2,
      "ราคาขาย 3 (Price Level 3)": g.priceLevel3,
      "ราคาขาย 4 (Price Level 4)": g.priceLevel4,
      "ราคาขาย 5 (Price Level 5)": g.priceLevel5,
      "จำนวนสต็อก (Stock)": g.stock,
      "รายละเอียดสินค้า (Description)": g.description,
      __rowNo: g.rowNo,
      __barcodes: g.barcodes,
      __packagingUnits: g.packagingUnits,
      __stockNote: g.stockNote,
    }));
  }
  if (isCsv) {
    // CSV: exact header matching, ',' or ';' delimiter, negative numbers rejected (lib/csv-parser)
    const csvRows = parseProductCSV(csvText);
    return csvRows.map((r) => ({
      "รหัสสินค้า": r.productCode || undefined,
      "ชื่อสินค้า": r.productName || undefined,
      "บาร์โค้ด": r.customBarcodeId || undefined,
      "หมวดหมู่": r.category || undefined,
      "หน่วยนับ": r.unit || undefined,
      "ราคาทุน": r.cost,
      "ราคา 1": r.priceLevel1,
      "ราคา 2": r.priceLevel2,
      "ราคา 3": r.priceLevel3,
      "ราคา 4": r.priceLevel4,
      "ราคา 5": r.priceLevel5,
      "จำนวนสต็อก": r.stock,
    }));
  }
  const workbook = unitsBook || XLSX.read(buffer, { type: "array" });
  const firstSheetName = workbook.SheetNames[0];
  if (!firstSheetName) return null;
  const worksheet = workbook.Sheets[firstSheetName];
  return XLSX.utils.sheet_to_json<RawImportRow>(worksheet);
}

const text = (v: unknown) => String(v || "").trim();

function existingCategoryName(category: ProductRecord['category']): unknown {
  const named = category && typeof category === 'object' ? category.name : undefined;
  return named || category || "ทั่วไป";
}

/** Raw rows -> preview rows, each compared with the existing catalog (NEW / CHANGED + diffs / UNCHANGED). */
export function buildImportPreview(rawJson: RawImportRow[], products: ProductRecord[]): ImportPreviewRow[] {
  return rawJson
    .map((row, rowIndex): ImportPreviewRow => {
      const id = (row["รหัสระบบ (System ID - ห้ามแก้ไข)"] || row["System ID"] || row["ID"] || row["id"] || undefined) as string | undefined;
      const sku = text(row["รหัสสินค้า (SKU)"] || row["รหัสสินค้า"] || row["SKU"] || row["sku"] || row["code"]);
      const name = text(row["ชื่อสินค้า (Product Name)"] || row["ชื่อสินค้า"] || row["Name"] || row["name"] || row["product_name"]);
      const barcode = text(row["บาร์โค้ด (Barcode)"] || row["บาร์โค้ด"] || row["Barcode"] || row["barcode"]);
      const categoryName = text(row["หมวดหมู่ (Category)"] || row["หมวดหมู่"] || row["Category"] || row["category"]);
      const unit = text(row["หน่วยนับ (Unit)"] || row["หน่วยนับ"] || row["Unit"] || row["unit"]);

      const costPrice = optionalNumberCell(
        row["ราคาทุน (Cost Price)"] ??
        row["ราคาทุน"] ??
        row["Cost Price"] ??
        row["Cost"] ??
        row["costPrice"] ??
        row["cost"]
      );

      const priceLevel1 = optionalNumberCell(
        row["ราคาขาย 1 / ขายปลีก (Price 1)"] ??
        row["ราคาขาย 1 / ขายปลีก (Price Level 1)"] ??
        row["ราคาขายปลีก / ราคาฐาน (Retail Price)"] ??
        row["ระดับราคา 1 (Price Level 1)"] ??
        row["ระดับราคา 1"] ??
        row["ราคาขาย 1"] ??
        row["ราคา 1"] ??
        row["ราคาขายปลีก"] ??
        row["ราคาขาย"] ??
        row["Retail Price"] ??
        row["Price 1"] ??
        row["priceLevel1"] ??
        row["price"]
      );

      const priceLevel2 = optionalNumberCell(row["ราคาขาย 2 (Price Level 2)"] ?? row["ราคาขาย 2 (Price 2)"] ?? row["ระดับราคา 2 (Price Level 2)"] ?? row["ระดับราคา 2"] ?? row["ราคาขาย 2"] ?? row["ราคา 2"] ?? row["priceLevel2"]);
      const priceLevel3 = optionalNumberCell(row["ราคาขาย 3 (Price Level 3)"] ?? row["ราคาขาย 3 (Price 3)"] ?? row["ระดับราคา 3 (Price Level 3)"] ?? row["ระดับราคา 3"] ?? row["ราคาขาย 3"] ?? row["ราคา 3"] ?? row["priceLevel3"]);
      const priceLevel4 = optionalNumberCell(row["ราคาขาย 4 (Price Level 4)"] ?? row["ราคาขาย 4 (Price 4)"] ?? row["ระดับราคา 4 (Price Level 4)"] ?? row["ระดับราคา 4"] ?? row["ราคาขาย 4"] ?? row["ราคา 4"] ?? row["priceLevel4"]);
      const priceLevel5 = optionalNumberCell(row["ราคาขาย 5 (Price Level 5)"] ?? row["ราคาขาย 5 (Price 5)"] ?? row["ระดับราคา 5 (Price Level 5)"] ?? row["ระดับราคา 5"] ?? row["ราคาขาย 5"] ?? row["ราคา 5"] ?? row["priceLevel5"]);
      const stock = optionalNumberCell(row["จำนวนสต็อก (Stock)"] ?? row["จำนวนสต็อก"] ?? row["สต็อก"] ?? row["Stock"] ?? row["stock"]);
      const minStockAlert = Number(row["จุดแจ้งเตือนสต็อกต่ำ (Min Stock)"] ?? row["จุดแจ้งเตือน"] ?? row["minStockAlert"] ?? getLowStockThreshold());
      const description = String(row["รายละเอียดสินค้า (Description)"] ?? row["รายละเอียด"] ?? row["Description"] ?? row["description"] ?? "").trim();
      const packs = Array.isArray(row.__packagingUnits) && row.__packagingUnits.length > 0 ? row.__packagingUnits : null;

      // Find matching product in existing catalog
      const existing = products.find(
        (p) => (id && p.id === id) || (sku && p.sku?.toLowerCase() === sku.toLowerCase()) || (barcode && p.barcode === barcode)
      );

      let changeType: ImportChangeType = "NEW";
      const diffs: string[] = [];

      if (existing) {
        const existingCost = Number(existing.costPrice !== undefined && existing.costPrice !== null ? existing.costPrice : (existing.cost ?? existing.basePrice ?? 0));
        const existingPrice1 = Number(existing.priceLevel1 !== undefined && existing.priceLevel1 !== null ? existing.priceLevel1 : (existing.price ?? existing.basePrice ?? 0));
        const existingPrices = [existingPrice1, Number(existing.priceLevel2 || 0), Number(existing.priceLevel3 || 0), Number(existing.priceLevel4 || 0), Number(existing.priceLevel5 || 0)];
        const existingStock = Number(existing.stock ?? existing.computedStock ?? 0);

        if (name && name !== existing.name) {
          diffs.push(`ชื่อ: "${existing.name}" ➔ "${name}"`);
        }
        if (sku && sku !== existing.sku) {
          diffs.push(`SKU: ${existing.sku} ➔ ${sku}`);
        }
        if (costPrice !== undefined && costPrice !== existingCost) {
          diffs.push(`ทุน: ${existingCost} ➔ ${costPrice}`);
        }
        [priceLevel1, priceLevel2, priceLevel3, priceLevel4, priceLevel5].forEach((price, i) => {
          if (price !== undefined && price !== existingPrices[i]) {
            diffs.push(`ราคา ${i + 1}: ${existingPrices[i]} ➔ ${price}`);
          }
        });
        if (stock !== undefined && stock !== existingStock) {
          diffs.push(`สต็อก: ${existingStock} ➔ ${stock}`);
        }
        const existingUnit = String(existing.unit || "ชิ้น").trim();
        const newUnit = String(unit || existingUnit).trim();
        if (existingUnit !== newUnit) {
          diffs.push(`หน่วย: ${existingUnit} ➔ ${newUnit}`);
        }

        if (packs) {
          // unit may be undefined: packChainText falls back to "ชิ้น" either way
          const before = packChainText(existing.unit as string, existing.packagingUnits as PackChain);
          const after = packChainText(unit || (existing.unit as string), packs);
          if (before !== after) diffs.push(`หน่วยบรรจุ: ${before} ➔ ${after}`);
          const oldCodes = new Set((existing.packagingUnits || []).map((u) => u.barcode).filter(Boolean));
          if (packs.some((u) => u.barcode && !oldCodes.has(u.barcode))) diffs.push("บาร์โค้ดหน่วยบรรจุ");
        }
        const existingCat = String(existingCategoryName(existing.category)).trim();
        const newCat = String(categoryName || existingCat).trim();
        if (existingCat !== newCat) {
          diffs.push(`หมวด: "${existingCat}" ➔ "${newCat}"`);
        }

        changeType = diffs.length > 0 ? "CHANGED" : "UNCHANGED";
      } else {
        changeType = "NEW";
        diffs.push("สินค้าใหม่");
        if (packs) {
          diffs.push(`หน่วย: ${packChainText(unit, packs)}`);
        }
      }

      return {
        rowNo: row.__rowNo ?? rowIndex + 2, // spreadsheet row (row 1 = header) for server error messages
        ...(packs ? { packagingUnits: packs } : {}),
        ...(Array.isArray(row.__barcodes) && row.__barcodes.length > 0 ? { barcodes: row.__barcodes } : {}),
        stockNote: row.__stockNote,
        id: existing?.id || id,
        sku,
        name,
        barcode,
        // blank cells: keep what the product has (new products get the defaults)
        categoryName: categoryName || (existing ? undefined : "ทั่วไป"),
        unit: unit || (existing ? undefined : "ชิ้น"),
        costPrice,
        retailPrice: priceLevel1,
        priceLevel1,
        priceLevel2,
        priceLevel3,
        priceLevel4,
        priceLevel5,
        stock,
        minStockAlert,
        description,
        isExisting: !!existing,
        changeType,
        diffs,
      };
    })
    .filter((item) => item.name || item.sku);
}
