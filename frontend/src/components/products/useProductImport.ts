"use client";

import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { CsvImportError } from "@/lib/csv-parser";
import { ImportFileError } from "@/lib/product-import";
import { buildImportPreview, readImportRows } from "./import-parser";
import { errorMessage } from "./product-helpers";
import type { ImportFilterTab, ImportPreviewRow, ProductRecord } from "./types";

/** Excel / CSV import: read the file into a preview with a diff against the catalog, then upsert only changed + new rows. */
export function useProductImport(products: ProductRecord[], reload: () => void) {
  const [importPreviewData, setImportPreviewData] = useState<ImportPreviewRow[]>([]);
  const [isImportPreviewOpen, setIsImportPreviewOpen] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFilterTab, setImportFilterTab] = useState<ImportFilterTab>("all");
  const [importProgress, setImportProgress] = useState<number>(0);

  // Import from Excel or CSV with intelligent diff comparison
  const handleFileSelectForImport = async (file: File) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const buffer = e.target?.result as ArrayBuffer;
        if (!buffer) return;
        const rawJson = readImportRows(buffer, file.name);
        if (!rawJson) {
          toast.error("ไม่พบข้อมูลในไฟล์ Excel");
          return;
        }

        if (rawJson.length === 0) {
          toast.error("ไม่พบแถวข้อมูลสินค้าในไฟล์ที่อัพโหลด");
          return;
        }

        const parsedItems = buildImportPreview(rawJson, products);

        if (parsedItems.length === 0) {
          toast.error("ไม่พบข้อมูลสินค้าที่ถูกต้องในไฟล์");
          return;
        }

        setImportPreviewData(parsedItems);
        setImportFilterTab("all");
        setImportProgress(0);
        setIsImportPreviewOpen(true);
      } catch (err) {
        console.error("Failed to parse Excel:", err);
        toast.error(err instanceof CsvImportError || err instanceof ImportFileError ? err.message : "เกิดข้อผิดพลาดในการอ่านไฟล์ Excel กรุณาตรวจสอบรูปแบบไฟล์", { duration: 10000 });
      }
    };
    reader.readAsArrayBuffer(file);
  };

  const handleConfirmImport = async () => {
    // Only upload changed and new items!
    const itemsToUpsert = importPreviewData.filter((i) => i.changeType !== "UNCHANGED");

    if (itemsToUpsert.length === 0) {
      toast.info("ข้อมูลสินค้าในไฟล์ตรงกับระบบทั้งหมด ไม่มีรายการที่ต้องอัพเดต");
      setIsImportPreviewOpen(false);
      return;
    }

    setIsImporting(true);
    setImportProgress(0);

    try {
      // Each request is one server transaction (a bad row rejects that batch, nothing half-saved in it).
      // Batches stay small enough to finish within the request timeout; re-importing is safe (upsert).
      const chunkSize = 300;
      let totalCreated = 0;
      let totalUpdated = 0;

      for (let i = 0; i < itemsToUpsert.length; i += chunkSize) {
        const chunk = itemsToUpsert.slice(i, i + chunkSize);
        const res: { created?: number; updated?: number } | null = await api.products.bulkUpsert(chunk);
        totalCreated += (res?.created || 0);
        totalUpdated += (res?.updated || 0);
        const currentProgress = Math.min(100, Math.round(((i + chunk.length) / itemsToUpsert.length) * 100));
        setImportProgress(currentProgress);
      }

      const unchangedCount = importPreviewData.length - itemsToUpsert.length;
      toast.success(
        `✅ นำเข้าสำเร็จ: แก้ไข ${totalUpdated} รายการ, เพิ่มใหม่ ${totalCreated} รายการ (ข้ามที่ไม่เปลี่ยน ${unchangedCount} รายการ)`
      );
      setIsImportPreviewOpen(false);
      setImportPreviewData([]);
      reload();
    } catch (err) {
      console.error("Import failed:", err);
      toast.error(`นำเข้าไม่สำเร็จ: ${errorMessage(err) || "ไม่สามารถนำเข้าข้อมูลสินค้าได้"} (แถวก่อนหน้านี้ที่บันทึกแล้วยังคงอยู่ แก้ไขไฟล์แล้วนำเข้าซ้ำได้)`);
      reload();
    } finally {
      setIsImporting(false);
      setImportProgress(0);
    }
  };

  return {
    importPreviewData, isImportPreviewOpen, setIsImportPreviewOpen, isImporting,
    importFilterTab, setImportFilterTab, importProgress,
    handleFileSelectForImport, handleConfirmImport,
  };
}

export type ProductImportState = ReturnType<typeof useProductImport>;
