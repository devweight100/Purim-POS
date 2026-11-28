"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { AlertTriangle, Building2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { apiFetch, ApiError } from "@/lib/api";
import { approvedExport } from "@/lib/export-approval";
import { formatCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  buildSupplierExportWorkbook,
  buildSupplierTemplateWorkbook,
  readSupplierImportFile,
} from "@/lib/product-supplier-excel";
import { pickProductCost } from "./product-helpers";
import type { CategoryOption, ProductRecord, SupplierOption } from "./types";
import type { SupplierImportCostMode, SupplierImportRawRow } from "@shared/product-supplier-import";

type PlanAction = "create" | "update" | "delete" | "unchanged" | "error";

interface PlanRow {
  rowNo: number;
  action: PlanAction;
  errors: string[];
  productId?: string;
  sku: string;
  productName: string;
  matchedBy?: "systemId" | "sku" | "barcode";
  supplierId?: string;
  supplierName: string;
  isNewSupplier: boolean;
  barcodes: string[];
  unitCost: number | null;
  costBefore: number | null;
  changes: string[];
}

interface SupplierImportPlan {
  rows: PlanRow[];
  counts: Record<PlanAction, number>;
  newSuppliers: string[];
  costMode: SupplierImportCostMode;
}

interface SupplierExportFilters {
  categoryIds: string[];
  stock: "all" | "instock" | "low" | "nostock";
  status: "all" | "active" | "inactive";
  supplierId?: string;
  includeUnlinked: boolean;
}

const ACTION_LABEL: Record<PlanAction, string> = {
  create: "เพิ่มใหม่",
  update: "แก้ไข",
  delete: "ลบ",
  unchanged: "ไม่เปลี่ยน",
  error: "ต้องแก้",
};

const ACTION_BADGE: Record<PlanAction, string> = {
  create: "bg-emerald-100 text-emerald-800",
  update: "bg-sky-100 text-sky-800",
  delete: "bg-amber-100 text-amber-800",
  unchanged: "bg-slate-100 text-slate-600",
  error: "bg-rose-100 text-rose-800",
};

const MATCH_LABEL: Record<NonNullable<PlanRow["matchedBy"]>, string> = {
  systemId: "รหัสระบบ",
  sku: "SKU",
  barcode: "บาร์โค้ด",
};

const COST_MODE_OPTIONS: { value: SupplierImportCostMode; label: string }[] = [
  {
    value: "zero_only",
    label: "อัปเดตช่องต้นทุนหลักเฉพาะสินค้าที่ยังไม่มีต้นทุน (0 บาท) — แนะนำ",
  },
  {
    value: "average",
    label: "คำนวณต้นทุนเฉลี่ยจากทุกผู้จำหน่ายทับช่องต้นทุนหลักของสินค้า",
  },
  {
    value: "none",
    label: "ไม่อัปเดตช่องต้นทุนหลักของสินค้า (แก้เฉพาะต้นทุนรายผู้จำหน่าย)",
  },
];

const SHOW_LIMIT = 300;

export function SupplierExcelDialog({
  open,
  onOpenChange,
  categories,
  suppliers,
  onImported,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: CategoryOption[];
  suppliers: SupplierOption[];
  onImported: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const focusedPlanRef = useRef<SupplierImportPlan | null>(null);

  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [rawRows, setRawRows] = useState<SupplierImportRawRow[]>([]);
  const [plan, setPlan] = useState<SupplierImportPlan | null>(null);
  const [filter, setFilter] = useState<"all" | PlanAction>("all");
  const [costMode, setCostMode] = useState<SupplierImportCostMode>("zero_only");

  useEffect(() => {
    if (!plan) {
      focusedPlanRef.current = null;
      return;
    }
    if (busy || plan.counts.error > 0 || focusedPlanRef.current === plan) return;
    const id = requestAnimationFrame(() => {
      if (confirmRef.current && !confirmRef.current.disabled) {
        confirmRef.current.focus();
        focusedPlanRef.current = plan;
      }
    });
    return () => cancelAnimationFrame(id);
  }, [plan, busy]);

  // Export filter state
  const [exportFilters, setExportFilters] = useState<SupplierExportFilters>({
    categoryIds: [],
    stock: "all",
    status: "active",
    includeUnlinked: true,
  });
  const [catSearch, setCatSearch] = useState("");

  const shownCats = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    const list = [{ id: "none", name: "ไม่มีหมวดหมู่" }, ...categories];
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }, [categories, catSearch]);

  const toggleCat = (id: string) =>
    setExportFilters((f) => ({
      ...f,
      categoryIds: f.categoryIds.includes(id)
        ? f.categoryIds.filter((c) => c !== id)
        : [...f.categoryIds, id],
    }));

  const resetPreview = () => {
    setPlan(null);
    setRawRows([]);
    setFileName("");
    setFilter("all");
  };

  const handleClose = () => {
    if (busy) return;
    resetPreview();
    onOpenChange(false);
  };

  const handleDownloadTemplate = () => {
    const wb = buildSupplierTemplateWorkbook(XLSX, suppliers);
    XLSX.writeFile(wb, "แม่แบบผู้จำหน่ายและต้นทุน_POS.xlsx");
    toast.success("ดาวน์โหลดไฟล์แม่แบบผู้จำหน่ายแล้ว (ดูคำอธิบายในแผ่นงาน \"วิธีกรอก\")");
  };

  const handleExport = async () => {
    const body = {
      ...exportFilters,
      categoryIds: [...exportFilters.categoryIds].sort(),
      ...(exportFilters.supplierId ? {} : { supplierId: undefined }),
    };
    const clean = JSON.parse(JSON.stringify(body)) as SupplierExportFilters;
    // Close this dialog before asking for the manager PIN so the PIN dialog owns keyboard focus cleanly
    onOpenChange(false);
    try {
      const res = await approvedExport<{ data: ProductRecord[]; suppliers?: SupplierOption[] }>({
        kind: "product-suppliers",
        filters: clean,
        path: "/exports/product-suppliers",
        body: { filters: clean },
        what: `ผู้จำหน่ายและต้นทุนสินค้า (${clean.includeUnlinked ? "รวมสินค้าที่ยังไม่มีผู้จำหน่าย" : "เฉพาะสินค้าที่มีผู้จำหน่าย"})`,
      });
      if (!res) return;
      if (res.data.length === 0) {
        toast.warning("ไม่มีรายการสินค้าตรงตามเงื่อนไขที่เลือก");
        return;
      }
      const withCost = res.data.some(
        (p) =>
          pickProductCost(p) !== undefined ||
          (Array.isArray(p.supplierEntries) && p.supplierEntries.some((e) => e.unitCost !== undefined)),
      );
      const wb = buildSupplierExportWorkbook(XLSX, res.data, res.suppliers || suppliers, {
        withCost,
        includeUnlinked: clean.includeUnlinked,
      });
      const todayStr = new Date().toISOString().split("T")[0];
      XLSX.writeFile(wb, `ผู้จำหน่ายและต้นทุน_POSร้านปุริม_${todayStr}.xlsx`);
      toast.success(`ส่งออกข้อมูลผู้จำหน่ายและต้นทุน (${res.data.length} สินค้า พร้อมรหัสระบบ) เป็นไฟล์ Excel สำเร็จ`);
    } catch (e) {
      toast.error(`ส่งออกไม่สำเร็จ: ${e instanceof Error ? e.message : "ติดต่อเซิร์ฟเวอร์ไม่ได้"}`);
    }
  };

  const handleFilePick = async (file: File) => {
    try {
      const parsed = readSupplierImportFile(XLSX, await file.arrayBuffer(), file.name);
      if (!parsed.hasProductKeyColumn || !parsed.hasSupplierColumn) {
        toast.error(
          "ไม่พบคอลัมน์สำคัญในไฟล์ (ต้องมี รหัสระบบ หรือ รหัสสินค้า (SKU) และ ชื่อผู้จำหน่าย) กรุณาใช้ไฟล์แม่แบบหรือไฟล์ที่ส่งออกจากปุ่มนี้",
        );
        return;
      }
      if (parsed.rows.length === 0) {
        toast.error("ไม่พบแถวข้อมูลผู้จำหน่ายในไฟล์ที่เลือก");
        return;
      }
      if (parsed.unknownHeaders.length > 0) {
        toast.info(`ข้ามคอลัมน์ที่ไม่ได้ใช้: ${parsed.unknownHeaders.join(", ")}`);
      }
      setBusy(true);
      const p = await apiFetch<SupplierImportPlan>("/products/supplier-import/preview", {
        method: "POST",
        body: JSON.stringify({ rows: parsed.rows, costMode }),
      });
      setFileName(file.name);
      setRawRows(parsed.rows);
      setPlan(p);
      setFilter(p.counts.error > 0 ? "error" : "all");
    } catch (err) {
      toast.error(`อ่านไฟล์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const actionableCount = plan ? plan.counts.create + plan.counts.update + plan.counts.delete : 0;

  const handleConfirmImport = async () => {
    if (!plan || plan.counts.error > 0 || busy) return;
    if (actionableCount === 0) {
      toast.info("ข้อมูลผู้จำหน่ายในไฟล์ตรงกับระบบทั้งหมด (หรือเว้นว่างไว้) ไม่มีรายการที่ต้องบันทึก");
      handleClose();
      return;
    }
    setBusy(true);
    try {
      const r = await apiFetch<{
        created: number;
        updated: number;
        deleted: number;
        unchanged: number;
        suppliersCreated: number;
        productsCostUpdated: number;
      }>("/products/supplier-import", {
        method: "POST",
        body: JSON.stringify({ rows: rawRows, costMode, fileName }),
      });
      const extraParts: string[] = [];
      if (r.deleted > 0) extraParts.push(`ถอดออก ${r.deleted}`);
      if (r.suppliersCreated > 0) extraParts.push(`สร้างบริษัทผู้จำหน่ายใหม่ ${r.suppliersCreated} ราย`);
      if (r.productsCostUpdated > 0) extraParts.push(`อัปเดตต้นทุนหลัก ${r.productsCostUpdated} สินค้า`);
      toast.success(
        `นำเข้าผู้จำหน่ายสำเร็จ: เพิ่มใหม่ ${r.created} · แก้ไข ${r.updated}${extraParts.length ? " · " + extraParts.join(" · ") : ""}`,
      );
      resetPreview();
      onOpenChange(false);
      onImported();
    } catch (err) {
      const body = err instanceof ApiError ? (err.data as { message?: string } | null) : null;
      toast.error(
        `นำเข้าไม่สำเร็จ: ${body?.message || (err instanceof Error ? err.message : String(err))} (ยังไม่ได้บันทึกแถวใด)`,
      );
    } finally {
      setBusy(false);
    }
  };

  const shownRows = useMemo(
    () => (plan ? plan.rows.filter((r) => filter === "all" || r.action === filter) : []),
    [plan, filter],
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent
        data-testid="supplier-excel-dialog"
        className={`flex max-h-[90dvh] flex-col gap-0 overflow-hidden bg-white p-0 text-slate-900 ${
          plan ? "sm:max-w-5xl" : "sm:max-w-2xl"
        }`}
        initialFocus={() => (plan && confirmRef.current && !confirmRef.current.disabled ? confirmRef.current : true)}
        onKeyDown={(e) => {
          if (
            plan &&
            e.key === "Enter" &&
            !(e.target instanceof HTMLButtonElement) &&
            !(e.target instanceof HTMLInputElement && e.target.type === "radio") &&
            !e.nativeEvent.isComposing
          ) {
            e.preventDefault();
            void handleConfirmImport();
          }
        }}
      >
        <DialogHeader className="border-b border-slate-200 px-6 py-4 pr-14 shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Building2 className="h-5 w-5 text-emerald-700 shrink-0" />
            {plan ? "ตรวจสอบก่อนนำเข้าผู้จำหน่าย ต้นทุน และบาร์โค้ด" : "จัดการผู้จำหน่าย ต้นทุน และบาร์โค้ด (Excel)"}
          </DialogTitle>
          <DialogDescription className="break-words">
            {plan
              ? `${fileName} · ${plan.rows.length.toLocaleString()} แถว · จับคู่สินค้าด้วยรหัสระบบ (ห้ามแก้ไข) ก่อนเสมอ`
              : "ส่งออกรายการสินค้าพร้อมรหัสระบบไปกรอกผู้จำหน่าย ต้นทุน และบาร์โค้ดใน Excel แล้วนำเข้ากลับมาอัปเดตได้ทันที"}
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          data-testid="supplier-excel-file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFilePick(f);
          }}
        />

        {!plan ? (
          <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
            {/* Step 1: Import or Template */}
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/40 p-4 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800">นำเข้าไฟล์ผู้จำหน่าย / โหลดไฟล์แม่แบบ</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  รองรับไฟล์ .xlsx, .xls, .csv (แสดงตารางตรวจสอบก่อนบันทึกจริงทุกครั้ง ไม่กระทบผู้จำหน่ายเจ้าอื่นที่ไม่ได้อยู่ในไฟล์)
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-btn">
                <Button
                  type="button"
                  onClick={() => fileRef.current?.click()}
                  disabled={busy}
                  data-testid="supplier-import-trigger"
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <Upload className="h-4 w-4 mr-1.5" /> เลือกไฟล์ Excel / CSV เพื่อนำเข้า
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDownloadTemplate}
                  data-testid="supplier-template-btn"
                  className="border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                >
                  <FileSpreadsheet className="h-4 w-4 mr-1.5 text-sky-600" /> โหลด Template ตัวอย่าง (.xlsx)
                </Button>
              </div>
            </div>

            {/* Step 2: Export existing products with systemId to fill in Excel */}
            <form
              className="rounded-xl border border-slate-200 bg-white p-4 space-y-3"
              onSubmit={(e) => {
                e.preventDefault();
                void handleExport();
              }}
            >
              <div>
                <h3 className="text-sm font-bold text-slate-800">ส่งออกข้อมูลสินค้าและผู้จำหน่ายปัจจุบัน (.xlsx)</h3>
                <p className="text-xs text-slate-600 mt-0.5">
                  ไฟล์ที่ส่งออกจะมีคอลัมน์ <b>รหัสระบบ (ห้ามแก้ไข)</b> ติดไปด้วย นำไปกรอกผู้จำหน่าย ต้นทุน และบาร์โค้ดเพิ่มใน Excel แล้วนำเข้ากลับได้แม่นยำ 100% (ต้องใส่ PIN ผู้จัดการ)
                </p>
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-xs font-semibold text-slate-700">รูปแบบรายการที่ส่งออก</legend>
                <div className="flex flex-col gap-1.5 text-sm">
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="sup-export-unlinked"
                      checked={exportFilters.includeUnlinked}
                      onChange={() => setExportFilters((f) => ({ ...f, includeUnlinked: true }))}
                    />
                    <span>รวมสินค้าที่ยังไม่มีผู้จำหน่ายด้วย (เหมาะสำหรับนำไปไล่กรอกผู้จำหน่ายและต้นทุนเพิ่ม)</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="sup-export-unlinked"
                      checked={!exportFilters.includeUnlinked}
                      onChange={() => setExportFilters((f) => ({ ...f, includeUnlinked: false }))}
                    />
                    <span>เฉพาะสินค้าที่ผูกผู้จำหน่ายไว้แล้ว</span>
                  </label>
                </div>
              </fieldset>

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">กรองผู้จำหน่าย</span>
                  <select
                    aria-label="กรองผู้จำหน่ายส่งออก"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    value={exportFilters.supplierId || ""}
                    onChange={(e) => setExportFilters((f) => ({ ...f, supplierId: e.target.value || undefined }))}
                  >
                    <option value="">ทุกผู้จำหน่าย</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </label>

                <label className="block space-y-1">
                  <span className="text-xs font-semibold text-slate-700">สถานะสินค้า</span>
                  <select
                    aria-label="สถานะสินค้าส่งออก"
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                    value={exportFilters.status}
                    onChange={(e) =>
                      setExportFilters((f) => ({ ...f, status: e.target.value as SupplierExportFilters["status"] }))
                    }
                  >
                    <option value="active">เฉพาะที่ใช้งานอยู่</option>
                    <option value="all">ทั้งหมด (รวมปิดใช้งาน)</option>
                    <option value="inactive">เฉพาะที่ปิดใช้งาน</option>
                  </select>
                </label>
              </div>

              <fieldset className="space-y-1.5">
                <legend className="text-xs font-semibold text-slate-700">
                  หมวดหมู่ {exportFilters.categoryIds.length > 0 && <span className="font-normal text-muted-foreground">(เลือก {exportFilters.categoryIds.length})</span>}
                </legend>
                <div className="flex gap-btn">
                  <Input
                    value={catSearch}
                    onChange={(e) => setCatSearch(e.target.value)}
                    placeholder="ค้นหาหมวดหมู่ (ไม่ติ๊ก = ทุกหมวด)"
                    aria-label="ค้นหาหมวดหมู่ส่งออกผู้จำหน่าย"
                    className="h-9 flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={exportFilters.categoryIds.length === 0}
                    onClick={() => setExportFilters((f) => ({ ...f, categoryIds: [] }))}
                  >
                    ทุกหมวด
                  </Button>
                </div>
                <div className="grid max-h-28 grid-cols-1 gap-x-4 gap-y-1 overflow-y-auto rounded-lg border border-slate-200 p-2 sm:grid-cols-2">
                  {shownCats.map((c) => (
                    <label key={c.id} className="flex min-w-0 items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-slate-50">
                      <input
                        type="checkbox"
                        checked={exportFilters.categoryIds.includes(c.id)}
                        onChange={() => toggleCat(c.id)}
                      />
                      <span className="truncate" title={c.name}>{c.name}</span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="flex justify-end pt-1">
                <Button type="submit" data-testid="supplier-export-submit" className="bg-emerald-700 text-white hover:bg-emerald-800">
                  <Download className="h-4 w-4 mr-1.5" /> ส่งออกข้อมูลผู้จำหน่าย (.xlsx)
                </Button>
              </div>
            </form>
          </div>
        ) : (
          <div className="flex flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
            {/* Filter tabs */}
            <div className="flex flex-wrap gap-btn" role="group" aria-label="กรองแถวนำเข้าผู้จำหน่าย" data-testid="supplier-import-counts">
              {(["all", "create", "update", "delete", "unchanged", "error"] as const).map((k) => {
                if (k === "delete" && plan.counts.delete === 0) return null;
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                    className={`h-9 rounded-lg px-3 text-sm font-bold ${
                      filter === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"
                    }`}
                  >
                    {k === "all"
                      ? `ทั้งหมด ${plan.rows.length.toLocaleString()}`
                      : `${ACTION_LABEL[k]} ${plan.counts[k].toLocaleString()}`}
                  </button>
                );
              })}
            </div>

            {plan.counts.error > 0 && (
              <p role="alert" data-testid="supplier-import-error-alert" className="rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-sm font-semibold text-rose-800">
                มี {plan.counts.error.toLocaleString()} แถวที่ต้องแก้ กรุณาแก้ไขไฟล์แล้วนำเข้าใหม่ (ระบบจะไม่บันทึกครึ่ง ๆ กลาง ๆ)
              </p>
            )}

            {plan.counts.error === 0 && plan.newSuppliers.length > 0 && (
              <div data-testid="supplier-import-new-suppliers" className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
                <div>
                  <span className="font-bold">ผู้จำหน่ายใหม่ที่จะสร้างเพิ่มอัตโนมัติ ({plan.newSuppliers.length} ราย): </span>
                  <span>{plan.newSuppliers.join(" · ")}</span>
                  <span className="block text-amber-700 mt-0.5">กรุณาตรวจตัวสะกดชื่อบริษัทให้ถูกต้องก่อนกดยืนยันนำเข้า</span>
                </div>
              </div>
            )}

            {/* Cost update rule choice */}
            <fieldset className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 space-y-1" data-testid="supplier-import-cost-mode">
              <legend className="px-1 text-xs font-semibold text-slate-700">การอัปเดตช่อง &quot;ต้นทุน&quot; หลักของสินค้า</legend>
              <div className="flex flex-col gap-1 text-xs text-slate-700">
                {COST_MODE_OPTIONS.map((opt) => (
                  <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="supplier-import-cost-mode"
                      value={opt.value}
                      checked={costMode === opt.value}
                      onChange={() => setCostMode(opt.value)}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Preview table */}
            <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200">
              <table className="w-full table-fixed text-sm">
                <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600 border-b border-slate-200">
                  <tr>
                    <th className="w-12 px-2 py-2">แถว</th>
                    <th className="w-20 px-2 py-2">ผล</th>
                    <th className="w-[26%] px-2 py-2">สินค้า</th>
                    <th className="w-[20%] px-2 py-2">ผู้จำหน่าย</th>
                    <th className="w-[16%] px-2 py-2">บาร์โค้ด</th>
                    <th className="w-20 px-2 py-2 text-right">ต้นทุน</th>
                    <th className="px-2 py-2">รายละเอียด</th>
                  </tr>
                </thead>
                <tbody>
                  {shownRows.slice(0, SHOW_LIMIT).map((r) => (
                    <tr key={r.rowNo} className="border-t border-slate-100 align-top" data-testid="supplier-import-row">
                      <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.rowNo}</td>
                      <td className="px-2 py-1.5">
                        <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-bold ${ACTION_BADGE[r.action]}`}>
                          {ACTION_LABEL[r.action]}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 min-w-0">
                        <div className="break-words font-semibold text-slate-900">{r.productName || "-"}</div>
                        <div className="text-xs text-slate-500 break-all">
                          {r.sku || "-"}
                          {r.matchedBy ? ` · จับคู่ด้วย${MATCH_LABEL[r.matchedBy]}` : ""}
                        </div>
                      </td>
                      <td className="px-2 py-1.5 min-w-0">
                        <div className="break-words font-medium text-slate-800">{r.supplierName || "-"}</div>
                        {r.isNewSupplier && (
                          <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800">
                            ผู้จำหน่ายใหม่
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1.5 text-xs tabular-nums text-slate-700 break-all">
                        {r.barcodes.length > 0 ? r.barcodes.join(", ") : "-"}
                      </td>
                      <td className="px-2 py-1.5 text-right tabular-nums text-xs text-slate-800">
                        {r.unitCost !== null ? formatCurrency(r.unitCost) : "-"}
                      </td>
                      <td className="px-2 py-1.5 text-xs break-words">
                        {r.errors.length > 0 ? (
                          <span className="font-semibold text-rose-700">{r.errors.join(" · ")}</span>
                        ) : r.changes.length > 0 ? (
                          <span className="text-slate-700">{r.changes.join(" · ")}</span>
                        ) : (
                          <span className="text-slate-400">ข้อมูลตรงกับในระบบ</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {shownRows.length > SHOW_LIMIT && (
                <p className="border-t border-slate-100 px-3 py-2 text-xs text-slate-500">
                  แสดง {SHOW_LIMIT.toLocaleString()} แถวแรกจาก {shownRows.length.toLocaleString()} แถว (บันทึกครบทุกแถวเมื่อกดยืนยัน)
                </p>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="mx-0 mb-0 shrink-0 flex-row items-center justify-end gap-btn border-t border-slate-200 bg-slate-50 px-6 py-4">
          {plan ? (
            <>
              <Button type="button" variant="outline" onClick={resetPreview} disabled={busy} className="mr-auto">
                เลือกไฟล์อื่น
              </Button>
              <Button type="button" variant="outline" onClick={handleClose} disabled={busy}>
                ยกเลิก
              </Button>
              <Button
                ref={confirmRef}
                type="button"
                data-testid="supplier-import-confirm"
                disabled={busy || plan.counts.error > 0 || actionableCount === 0}
                onClick={() => void handleConfirmImport()}
                className="bg-indigo-600 text-white hover:bg-indigo-700"
              >
                {busy ? "กำลังนำเข้า..." : `ยืนยันนำเข้า (${actionableCount.toLocaleString()} รายการ)`}
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" onClick={handleClose}>
              ปิดหน้าต่าง
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
