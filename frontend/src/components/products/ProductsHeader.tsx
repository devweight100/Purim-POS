"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import * as XLSX from "xlsx";
import { Download, FileSpreadsheet, Package, Plus, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buildExportWorkbook, buildTemplateWorkbook } from "@/lib/product-import";
import { pickProductCost } from "./product-helpers";
import { ProductExportDialog } from "./ProductExportDialog";
import type { CategoryOption, ProductRecord, SupplierOption } from "./types";

// Export products (rows from POST /exports/products, after the manager PIN) to .xlsx
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
export function ProductsHeader({ categories, suppliers, onImportFile, onAdd }: {
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  onImportFile: (file: File) => void;
  onAdd: () => void;
}) {
  const excelInputRef = useRef<HTMLInputElement>(null);
  // export: filter dialog -> manager PIN -> server rows -> file (Round B)
  const [exportOpen, setExportOpen] = useState(false);

  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h1 className="page-title">
          <Package /> จัดการสินค้า (Products)
        </h1>
        <p className="page-subtitle">จัดการรายการสินค้า ราคาขาย ขนาดบรรจุ บาร์โค้ด และนำเข้าข้อมูลสินค้า</p>
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
          onClick={() => setExportOpen(true)}
          className="border-emerald-300 bg-emerald-50/60 text-emerald-800 hover:bg-emerald-100 hover:border-emerald-400 cursor-pointer"
          title="ส่งออกรายการสินค้าเป็นไฟล์ Excel (.xlsx) เลือกหมวด / สต็อก / สถานะ / ผู้จำหน่ายได้ (ต้องใส่ PIN ผู้จัดการ)"
        >
          <Download className="w-4 h-4 mr-1.5 text-emerald-700" /> ส่งออก Excel (.xlsx)
        </Button>

        {/* Import Excel / CSV Button */}
        <Button
          variant="outline"
          onClick={() => excelInputRef.current?.click()}
          className="border-indigo-300 bg-indigo-50/60 text-indigo-800 hover:bg-indigo-100 hover:border-indigo-400 cursor-pointer"
          title="นำเข้าไฟล์ Excel หรือ CSV เพื่ออัพเดตและเพิ่มสินค้าเป็นชุด"
        >
          <Upload className="w-4 h-4 mr-1.5 text-indigo-700" /> นำเข้า Excel / CSV
        </Button>

        {/* Download Template Excel Button */}
        <Button
          variant="outline"
          onClick={downloadImportTemplate}
          className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50 cursor-pointer"
          title="ดาวน์โหลดไฟล์แม่แบบ Excel สำหรับกรอกข้อมูลสินค้าเพื่อนำเข้า"
        >
          <FileSpreadsheet className="w-4 h-4 mr-1.5 text-sky-600" /> โหลด Template
        </Button>

        <ProductExportDialog open={exportOpen} onOpenChange={setExportOpen} categories={categories} suppliers={suppliers} onRows={exportProductsExcel} />

        <Button className="w-full bg-indigo-600 text-white hover:bg-indigo-700 cursor-pointer sm:w-auto" onClick={onAdd}>
          <Plus className="w-4 h-4 mr-1.5" /> เพิ่มสินค้าใหม่
        </Button>
      </div>
    </div>
  );
}
