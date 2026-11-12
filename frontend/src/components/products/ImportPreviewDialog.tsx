"use client";

import { FileSpreadsheet, Info, RefreshCw, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { packChainText } from "@/lib/product-import";
import { formatCurrency } from "@/lib/utils";
import type { ProductImportState } from "./useProductImport";
import type { ImportFilterTab, ImportPreviewRow } from "./types";

function ChangeBadge({ changeType }: { changeType: ImportPreviewRow["changeType"] }) {
  if (changeType === "CHANGED") {
    return <Badge className="bg-sky-50 text-sky-700 border-sky-200 text-[10.5px] font-bold">🔵 แก้ไข</Badge>;
  }
  if (changeType === "NEW") {
    return <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10.5px] font-bold">🟢 เพิ่มใหม่</Badge>;
  }
  return <Badge className="bg-slate-100 text-slate-500 border-slate-200 text-[10.5px] font-medium">⚪ ไม่เปลี่ยน</Badge>;
}

function PreviewRow({ row, idx }: { row: ImportPreviewRow; idx: number }) {
  return (
    <TableRow className="hover:bg-slate-50/80">
      <TableCell className="text-center font-mono text-slate-500">{idx + 1}</TableCell>
      <TableCell><ChangeBadge changeType={row.changeType} /></TableCell>
      <TableCell className="font-mono text-slate-700 font-bold">{row.sku || "-"}</TableCell>
      <TableCell className="font-bold text-slate-900 truncate max-w-[200px]">
        {row.name}
        {row.barcode && <span className="text-[10.5px] text-slate-400 block font-mono font-normal">บาร์โค้ด: {[row.barcode, ...(row.barcodes || [])].join(", ")}</span>}
        {Array.isArray(row.packagingUnits) && row.packagingUnits.length > 0 && (
          <span className="text-[10.5px] text-violet-600 block font-normal">
            {/* unit may be undefined: packChainText falls back to "ชิ้น" */}
            หน่วย: {packChainText(row.unit as string, row.packagingUnits)}
          </span>
        )}
      </TableCell>
      <TableCell className="text-right font-mono text-slate-600">{row.costPrice === undefined ? "-" : formatCurrency(row.costPrice)}</TableCell>
      <TableCell className="text-right font-mono text-emerald-700 font-bold">{row.priceLevel1 === undefined ? "-" : formatCurrency(row.priceLevel1)}</TableCell>
      <TableCell className="text-center font-mono text-slate-800">
        {row.stock ?? "-"} {row.unit ?? ""}
        {row.stockNote && <span className="block text-[10px] text-slate-400 font-sans">{row.stockNote}</span>}
      </TableCell>
      <TableCell className="text-[11px] text-indigo-700 font-medium">
        {row.diffs?.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {row.diffs.map((d, di) => (
              <span key={di} className="bg-indigo-50 text-indigo-700 border border-indigo-100 px-1.5 py-0.5 rounded text-[10.5px]">
                {d}
              </span>
            ))}
          </div>
        ) : (
          <span className="text-slate-400">-</span>
        )}
      </TableCell>
    </TableRow>
  );
}

/** Preview of an Excel / CSV import (smart selective diff): counts, filter tabs, first 30 rows, confirm with progress. */
export function ImportPreviewDialog({ state }: { state: ProductImportState }) {
  const {
    importPreviewData, isImportPreviewOpen, setIsImportPreviewOpen, isImporting,
    importFilterTab, setImportFilterTab, importProgress, handleConfirmImport,
  } = state;
  const changedCount = importPreviewData.filter((i) => i.changeType === "CHANGED").length;
  const newCount = importPreviewData.filter((i) => i.changeType === "NEW").length;
  const unchangedCount = importPreviewData.filter((i) => i.changeType === "UNCHANGED").length;
  const toUpsertCount = importPreviewData.filter((i) => i.changeType !== "UNCHANGED").length;

  const tabs: Array<{ id: ImportFilterTab; label: string }> = [
    { id: "all", label: `ทั้งหมด (${importPreviewData.length})` },
    { id: "changed", label: `🔵 มีการแก้ไข (${changedCount})` },
    { id: "new", label: `🟢 เพิ่มใหม่ (${newCount})` },
    { id: "unchanged", label: `⚪ ไม่เปลี่ยน (${unchangedCount})` },
  ];

  return (
    <Dialog open={isImportPreviewOpen} onOpenChange={setIsImportPreviewOpen}>
      <DialogContent className="flex flex-col bg-white p-0 text-slate-900 sm:max-w-5xl max-h-[88vh] overflow-hidden gap-0 rounded-2xl shadow-2xl">
        <DialogHeader className="border-b border-slate-200 px-6 py-4 pr-14 shrink-0 bg-slate-50/80">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <DialogTitle className="flex items-center gap-2 text-lg font-black text-slate-900">
              <FileSpreadsheet className="h-5 w-5 text-indigo-600" />
              <span>ตรวจสอบข้อมูลก่อนนำเข้า (Smart Selective Import & Diff)</span>
            </DialogTitle>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <Badge className="bg-sky-100 text-sky-800 border-sky-300 font-bold">
                🔵 แก้ไข {changedCount} รายการ
              </Badge>
              <Badge className="bg-emerald-100 text-emerald-800 border-emerald-300 font-bold">
                🟢 เพิ่มใหม่ {newCount} รายการ
              </Badge>
              <Badge className="bg-slate-100 text-slate-700 border-slate-300 font-bold">
                ⚪ ไม่เปลี่ยน {unchangedCount} รายการ (ข้าม)
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {/* Selective diff summary banner */}
          <div className="bg-indigo-50/70 p-3.5 rounded-xl border border-indigo-200/90 text-xs text-indigo-950 flex items-start justify-between gap-3">
            <div className="flex items-start gap-2.5">
              <Info className="w-4 h-4 text-indigo-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-sm text-indigo-950">
                  ตรวจพบรายการที่มีการเปลี่ยนแปลง/เพิ่มใหม่:{" "}
                  <span className="text-indigo-700 font-black">
                    {toUpsertCount}
                  </span>{" "}
                  จากทั้งหมด {importPreviewData.length} รายการ
                </p>
                <p className="text-slate-600 mt-0.5">
                  💡 ระบบจะส่งเฉพาะรายการที่มีการแก้ไขหรือเพิ่มใหม่เท่านั้นไปยังฐานข้อมูล (ข้าม {unchangedCount} รายการที่ตรงกับของเดิม) เพื่อประหยัดทรัพยากรและทำงานได้รวดเร็วสูงสุด
                </p>
              </div>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-1.5 p-1 bg-slate-100 rounded-xl border border-slate-200 w-fit text-xs font-bold">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setImportFilterTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg transition-all cursor-pointer ${
                  importFilterTab === tab.id
                    ? "bg-white text-indigo-700 shadow-2xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Table Preview */}
          <div className="border border-slate-200 rounded-xl overflow-hidden shadow-2xs">
            <Table>
              <TableHeader className="bg-slate-100">
                <TableRow className="text-xs">
                  <TableHead className="w-12 text-center font-bold">ลำดับ</TableHead>
                  <TableHead className="w-28 font-bold">สถานะ</TableHead>
                  <TableHead className="w-32 font-bold">รหัส (SKU)</TableHead>
                  <TableHead className="font-bold">ชื่อสินค้า</TableHead>
                  <TableHead className="w-24 font-bold text-right text-slate-700">ราคาทุน</TableHead>
                  <TableHead className="w-24 font-bold text-right text-emerald-700">ราคาขาย 1</TableHead>
                  <TableHead className="w-20 font-bold text-center">สต็อก</TableHead>
                  <TableHead className="font-bold">รายการที่เปลี่ยนแปลง</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody className="text-xs font-medium">
                {importPreviewData
                  .filter((row) => {
                    if (importFilterTab === "changed") return row.changeType === "CHANGED";
                    if (importFilterTab === "new") return row.changeType === "NEW";
                    if (importFilterTab === "unchanged") return row.changeType === "UNCHANGED";
                    return true;
                  })
                  .slice(0, 30)
                  .map((row, idx) => <PreviewRow key={idx} row={row} idx={idx} />)}
              </TableBody>
            </Table>
          </div>
        </div>

        <DialogFooter className="border-t border-slate-200 bg-slate-50 px-6 pt-4 pb-7 shrink-0 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="text-xs text-slate-500 font-medium w-full sm:w-auto">
            {isImporting && importProgress > 0 && (
              <div className="flex items-center gap-2">
                <div className="w-32 bg-slate-200 rounded-full h-2 overflow-hidden">
                  <div className="bg-indigo-600 h-full transition-all duration-300" style={{ width: `${importProgress}%` }} />
                </div>
                <span className="font-bold text-indigo-700 font-mono">{importProgress}%</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-3 w-full sm:w-auto justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsImportPreviewOpen(false)}
              disabled={isImporting}
              className="text-xs font-bold rounded-xl h-10 px-5 cursor-pointer border-slate-300 text-slate-700 hover:bg-slate-100"
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              onClick={handleConfirmImport}
              disabled={isImporting || toUpsertCount === 0}
              className="bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl h-10 px-6 gap-1.5 cursor-pointer shadow-xs disabled:opacity-50"
            >
              {isImporting ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  <span>กำลังอัพเดต ({importProgress}%)...</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>
                    ยืนยันอัพเดตเฉพาะรายการที่เปลี่ยน ({toUpsertCount} รายการ)
                  </span>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
