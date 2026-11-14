"use client";

import { useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, FolderTree, Package, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildExportWorkbook, buildTemplateWorkbook } from "@/lib/product-import";
import { pickProductCost } from "./product-helpers";
import type { ProductRecord } from "./types";

// Export current products to .xlsx
export function exportProductsExcel(products: ProductRecord[]) {
  if (products.length === 0) {
    toast.warning("ไม่มีรายการสินค้าให้ส่งออก");
    return;
  }
  // same per-unit format as the template: edit the file and import it back
  const withCost = products.some((p) => pickProductCost(p) !== undefined);
  const workbook = buildExportWorkbook(XLSX, products, { withCost });
  const todayStr = new Date().toISOString().split("T")[0];
  XLSX.writeFile(workbook, `สินค้า_POSร้านปุริม_${todayStr}.xlsx`);
  toast.success(`📊 ส่งออกข้อมูลสินค้า ${products.length} รายการ (รวมหน่วยบรรจุและบาร์โค้ด) เป็นไฟล์ Excel สำเร็จ`);
}

// Download Sample Excel Template
export function downloadImportTemplate() {
  XLSX.writeFile(buildTemplateWorkbook(XLSX), "แม่แบบนำเข้าสินค้า_หลายหน่วย_POS.xlsx");
  toast.success("ดาวน์โหลดไฟล์แม่แบบแล้ว: 1 แถว = 1 หน่วย (ชิ้น / แพ็ค / ลัง) ดูวิธีกรอกในแผ่นงาน \"วิธีกรอก\"");
}

/** Page title + export / import / template / categories / add buttons. */
export function ProductsHeader({ loadAll, onImportFile, onAdd }: {
  /** every product (the table only holds one page) */
  loadAll: () => Promise<ProductRecord[]>;
  onImportFile: (file: File) => void;
  onAdd: () => void;
}) {
  const excelInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-slate-900 sm:text-2xl flex items-center gap-2">
          <Package className="w-6 h-6 text-sky-500" /> จัดการสินค้า (Products)
        </h1>
        <p className="text-xs text-slate-500 mt-0.5">จัดการรายการสินค้า ราคาขาย ขนาดบรรจุ บาร์โค้ด และนำเข้าข้อมูลสินค้า</p>
      </div>
      <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
        {/* Hidden File Input for Excel / CSV */}
        <input
          type="file"
          ref={excelInputRef}
          accept=".xlsx, .xls, .csv"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onImportFile(file);
            e.target.value = "";
          }}
        />

        {/* Export Excel Button */}
        <Button
          variant="outline"
          onClick={() => {
            void loadAll()
              .then(exportProductsExcel)
              .catch((err: unknown) => toast.error(`ส่งออกไม่สำเร็จ: ${(err as Error | undefined)?.message || "ติดต่อเซิร์ฟเวอร์ไม่ได้"}`));
          }}
          className="h-10 border-emerald-300 bg-emerald-50/60 font-bold text-emerald-800 hover:bg-emerald-100 hover:border-emerald-400 shadow-2xs cursor-pointer"
          title="ส่งออกรายการสินค้าทั้งหมดเป็นไฟล์ Excel (.xlsx) เพื่อแก้ไขราคา บาร์โค้ด ชื่อ หรือสต็อก"
        >
          <Download className="w-4 h-4 mr-1.5 text-emerald-700" /> ส่งออก Excel (.xlsx)
        </Button>

        {/* Import Excel / CSV Button */}
        <Button
          variant="outline"
          onClick={() => excelInputRef.current?.click()}
          className="h-10 border-indigo-300 bg-indigo-50/60 font-bold text-indigo-800 hover:bg-indigo-100 hover:border-indigo-400 shadow-2xs cursor-pointer"
          title="นำเข้าไฟล์ Excel หรือ CSV เพื่ออัพเดตและเพิ่มสินค้าเป็นชุด"
        >
          <Upload className="w-4 h-4 mr-1.5 text-indigo-700" /> นำเข้า Excel / CSV
        </Button>

        {/* Download Template Excel Button */}
        <Button
          variant="outline"
          onClick={downloadImportTemplate}
          className="h-10 border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs cursor-pointer"
          title="ดาวน์โหลดไฟล์แม่แบบ Excel สำหรับกรอกข้อมูลสินค้าเพื่อนำเข้า"
        >
          <FileSpreadsheet className="w-4 h-4 mr-1.5 text-sky-600" /> โหลด Template
        </Button>

        <Link href="/categories" className="w-full sm:w-auto">
          <Button variant="outline" className="h-10 w-full border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 shadow-2xs">
            <FolderTree className="w-4 h-4 mr-1.5 text-slate-700" /> จัดการหมวดหมู่
          </Button>
        </Link>

        <Button className="h-10 w-full bg-indigo-600 px-5 font-bold text-white hover:bg-indigo-700 shadow-2xs cursor-pointer sm:w-auto" onClick={onAdd}>
          <Plus className="w-4 h-4 mr-1.5" /> เพิ่มสินค้าใหม่
        </Button>
      </div>
    </div>
  );
}
