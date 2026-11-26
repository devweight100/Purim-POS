"use client";

import { useMemo, useRef, useState } from "react";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { FileSpreadsheet, Upload } from "lucide-react";
import { apiFetch } from "@/lib/api";
import { ApiError } from "@/lib/api-error";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MEMBER_IMPORT_COLUMNS, memberColumnOf, type MemberImportKey, type MemberImportRow } from "@shared/member-import";

/** POST /customers/import/preview row (backend/src/customers/member-import.ts). */
interface PlanRow {
  rowNo: number;
  action: "create" | "update" | "unchanged" | "error";
  errors: string[];
  name: string;
  phone: string | null;
  code: string | null;
  matchedBy?: "code" | "phone";
  changes: string[];
  pointsBefore?: number;
  pointsAfter?: number;
}
interface Plan {
  rows: PlanRow[];
  counts: Record<PlanRow["action"], number>;
}

const TEXT_KEYS = new Set<MemberImportKey>(["code", "phone", "taxId"]);

/** แม่แบบนำเข้าสมาชิก.xlsx: the columns (code / phone / tax id as text cells, so leading zeros stay) + "วิธีกรอก". */
export function downloadMemberTemplate() {
  const header = MEMBER_IMPORT_COLUMNS.map((c) => c.header);
  const example = MEMBER_IMPORT_COLUMNS.map((c) => c.example);
  const ws = XLSX.utils.aoa_to_sheet([header, example]);
  // code / phone / tax id columns formatted as text (@) for 500 rows: Excel keeps leading zeros typed there
  MEMBER_IMPORT_COLUMNS.forEach((c, i) => {
    if (!TEXT_KEYS.has(c.key)) return;
    for (let r = 1; r <= 500; r++) {
      const ref = XLSX.utils.encode_cell({ r, c: i });
      ws[ref] = { ...(ws[ref] || { v: "" }), t: "s", z: "@" };
    }
  });
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: 500, c: header.length - 1 } });
  ws["!cols"] = MEMBER_IMPORT_COLUMNS.map((c) => ({ wch: Math.max(12, c.header.length + 4) }));
  const help = XLSX.utils.aoa_to_sheet([
    ["คอลัมน์", "วิธีกรอก"],
    ...MEMBER_IMPORT_COLUMNS.map((c) => [c.header, c.hint || "-"]),
    [],
    ["จับคู่สมาชิกเดิม", "ด้วยรหัสสมาชิก ถ้าไม่มีรหัสใช้เบอร์โทร: เจอ = แก้ไขข้อมูลสมาชิกนั้น (ช่องว่าง = ไม่เปลี่ยน) ไม่เจอ = เพิ่มสมาชิกใหม่"],
    ["คะแนนสะสม", "เป็นยอดคงเหลือที่ต้องการ ระบบบันทึกประวัติ \"นำเข้าคะแนน\" (ก่อน / หลัง) ทุกครั้งที่ยอดเปลี่ยน"],
  ]);
  help["!cols"] = [{ wch: 26 }, { wch: 100 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "สมาชิก");
  XLSX.utils.book_append_sheet(wb, help, "วิธีกรอก");
  XLSX.writeFile(wb, "แม่แบบนำเข้าสมาชิก.xlsx");
}

/** Rows of the first sheet (or CSV) as cell texts by column key; unknown headers are reported. */
export function readMemberFile(buffer: ArrayBuffer, fileName: string): { rows: MemberImportRow[]; unknown: string[]; hasName: boolean } {
  const isCsv = /\.csv$/i.test(fileName);
  const book = isCsv
    ? XLSX.read(new TextDecoder("utf-8").decode(buffer).replace(/^﻿/, ""), { type: "string", raw: true })
    : XLSX.read(buffer, { type: "array" });
  const sheet = book.Sheets[book.SheetNames[0]];
  if (!sheet) return { rows: [], unknown: [], hasName: false };
  // formatted text of every cell (raw:false): a phone typed as a number keeps its digits (a lost 0 is put back later)
  const grid = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", blankrows: false });
  const headers = (grid[0] || []).map((h) => String(h ?? ""));
  const keys = headers.map((h) => memberColumnOf(h));
  const unknown = headers.filter((h, i) => h.trim() && !keys[i]);
  const rows: MemberImportRow[] = [];
  for (let r = 1; r < grid.length; r++) {
    const values: Partial<Record<MemberImportKey, string>> = {};
    let any = false;
    keys.forEach((k, i) => {
      const v = String(grid[r]?.[i] ?? "").trim();
      if (k && v) {
        values[k] = v;
        any = true;
      }
    });
    if (any) rows.push({ rowNo: r + 1, values });
  }
  return { rows, unknown, hasName: keys.includes("name") };
}

const ACTION_LABEL: Record<PlanRow["action"], string> = { create: "เพิ่มใหม่", update: "แก้ไข", unchanged: "ไม่เปลี่ยน", error: "ต้องแก้" };
const ACTION_CLASS: Record<PlanRow["action"], string> = {
  create: "bg-emerald-100 text-emerald-800",
  update: "bg-sky-100 text-sky-800",
  unchanged: "bg-slate-100 text-slate-600",
  error: "bg-rose-100 text-rose-800",
};
const SHOW = 300;

/** "นำเข้า Excel" button + the preview / confirm dialog (customers page). */
export function MemberImport({ onImported }: { onImported: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState<MemberImportRow[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [filter, setFilter] = useState<"all" | PlanRow["action"]>("all");
  const [busy, setBusy] = useState(false);
  const confirmRef = useRef<HTMLButtonElement>(null);

  const pick = async (file: File) => {
    try {
      const parsed = readMemberFile(await file.arrayBuffer(), file.name);
      if (!parsed.hasName) {
        toast.error('ไม่พบคอลัมน์ "ชื่อ" ในไฟล์ กรุณาใช้ไฟล์แม่แบบนำเข้าสมาชิก');
        return;
      }
      if (!parsed.rows.length) {
        toast.error("ไม่พบแถวข้อมูลสมาชิกในไฟล์");
        return;
      }
      if (parsed.unknown.length) toast.info(`ไม่ใช้คอลัมน์: ${parsed.unknown.join(", ")}`);
      setBusy(true);
      const p = await apiFetch<Plan>("/customers/import/preview", { method: "POST", body: JSON.stringify({ rows: parsed.rows }) });
      setFileName(file.name);
      setRows(parsed.rows);
      setPlan(p);
      setFilter(p.counts.error ? "error" : "all");
    } catch (err) {
      toast.error(`อ่านไฟล์ไม่สำเร็จ: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const close = () => {
    if (busy) return;
    setPlan(null);
    setRows([]);
  };

  const confirm = async () => {
    if (!plan || plan.counts.error > 0 || busy) return;
    if (plan.counts.create + plan.counts.update === 0) {
      toast.info("ข้อมูลในไฟล์ตรงกับระบบทั้งหมด ไม่มีอะไรต้องนำเข้า");
      close();
      return;
    }
    setBusy(true);
    try {
      const r = await apiFetch<{ created: number; updated: number; unchanged: number; pointsAdjusted: number }>("/customers/import", {
        method: "POST",
        body: JSON.stringify({ rows, fileName }),
      });
      toast.success(`นำเข้าสมาชิกแล้ว: เพิ่มใหม่ ${r.created} · แก้ไข ${r.updated} · ปรับคะแนน ${r.pointsAdjusted} คน (บันทึกประวัติ "นำเข้าคะแนน")`);
      setPlan(null);
      setRows([]);
      onImported();
    } catch (err) {
      const body = err instanceof ApiError ? (err.data as { message?: string } | null) : null;
      toast.error(`นำเข้าไม่สำเร็จ: ${body?.message || (err instanceof Error ? err.message : String(err))} (ยังไม่ได้บันทึกแถวใด)`);
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => (plan ? plan.rows.filter((r) => filter === "all" || r.action === filter) : []), [plan, filter]);

  return (
    <>
      <Button variant="outline" onClick={downloadMemberTemplate} className="border-slate-300 text-slate-700 hover:bg-slate-50" data-testid="member-template">
        <FileSpreadsheet className="w-3.5 h-3.5 mr-1.5 text-sky-600" /> โหลด Template สมาชิก
      </Button>
      <Button variant="outline" onClick={() => fileRef.current?.click()} disabled={busy} className="border-slate-300 text-slate-700 hover:bg-slate-50">
        <Upload className="w-3.5 h-3.5 mr-1.5 text-emerald-600" /> นำเข้าสมาชิก Excel
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        className="hidden"
        data-testid="member-import-file"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void pick(f);
        }}
      />

      <Dialog open={!!plan} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent
          data-testid="member-import-dialog"
          className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden bg-white p-0 sm:max-w-4xl"
          // keyboard: the import button has the focus (Enter = import); with rows to fix, the "ต้องแก้" filter
          initialFocus={() => (confirmRef.current && !confirmRef.current.disabled ? confirmRef.current : true)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement) && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void confirm();
            }
          }}
        >
          <DialogHeader className="border-b border-slate-200 px-6 pb-4 pt-6 pr-14">
            <DialogTitle className="text-lg font-bold">ตรวจสอบก่อนนำเข้าสมาชิก</DialogTitle>
            <DialogDescription className="break-words">
              {fileName} · {plan?.rows.length.toLocaleString()} แถว · จับคู่ด้วยรหัสสมาชิก ถ้าไม่มีใช้เบอร์โทร
            </DialogDescription>
          </DialogHeader>
          {plan && (
            <div className="flex flex-1 flex-col gap-3 overflow-hidden px-6 py-4">
              <div className="flex flex-wrap gap-btn" role="group" aria-label="กรองแถว" data-testid="member-import-counts">
                {(["all", "create", "update", "unchanged", "error"] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={filter === k}
                    onClick={() => setFilter(k)}
                    className={`h-9 rounded-lg px-3 text-sm font-bold ${filter === k ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}
                  >
                    {k === "all" ? `ทั้งหมด ${plan.rows.length.toLocaleString()}` : `${ACTION_LABEL[k]} ${plan.counts[k].toLocaleString()}`}
                  </button>
                ))}
              </div>
              {plan.counts.error > 0 && (
                <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-800">
                  มี {plan.counts.error.toLocaleString()} แถวที่ต้องแก้ แก้ไฟล์แล้วนำเข้าใหม่ (นำเข้าเฉพาะเมื่อไม่มีแถวผิด เพื่อไม่ให้ข้อมูลครึ่ง ๆ กลาง ๆ)
                </p>
              )}
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-slate-200">
                <table className="w-full table-fixed text-sm">
                  <thead className="sticky top-0 bg-slate-50 text-left text-xs text-slate-600">
                    <tr>
                      <th className="w-14 px-2 py-2">แถว</th>
                      <th className="w-24 px-2 py-2">ผล</th>
                      <th className="px-2 py-2">สมาชิก</th>
                      <th className="w-32 px-2 py-2 text-right">คะแนน</th>
                      <th className="w-[34%] px-2 py-2">รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {shown.slice(0, SHOW).map((r) => (
                      <tr key={r.rowNo} className="border-t border-slate-100 align-top" data-testid="member-import-row">
                        <td className="px-2 py-1.5 tabular-nums text-slate-500">{r.rowNo}</td>
                        <td className="px-2 py-1.5"><span className={`rounded px-1.5 py-0.5 text-xs font-bold ${ACTION_CLASS[r.action]}`}>{ACTION_LABEL[r.action]}</span></td>
                        <td className="px-2 py-1.5">
                          <div className="break-words font-semibold">{r.name || "-"}</div>
                          <div className="text-xs text-slate-500">{[r.code, r.phone].filter(Boolean).join(" · ")}{r.matchedBy ? ` · จับคู่ด้วย${r.matchedBy === "code" ? "รหัส" : "เบอร์"}` : ""}</div>
                        </td>
                        <td className="px-2 py-1.5 text-right tabular-nums">
                          {r.action === "create" ? (r.pointsAfter ?? 0).toLocaleString() : r.pointsBefore !== r.pointsAfter ? `${(r.pointsBefore ?? 0).toLocaleString()} → ${(r.pointsAfter ?? 0).toLocaleString()}` : (r.pointsAfter ?? 0).toLocaleString()}
                        </td>
                        <td className="break-words px-2 py-1.5 text-xs">
                          {r.errors.length ? <span className="text-rose-700">{r.errors.join(" · ")}</span> : r.changes.length ? `เปลี่ยน: ${r.changes.join(", ")}` : r.action === "create" ? "สมาชิกใหม่" : "-"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {shown.length > SHOW && <p className="px-3 py-2 text-xs text-slate-500">แสดง {SHOW.toLocaleString()} จาก {shown.length.toLocaleString()} แถว</p>}
              </div>
            </div>
          )}
          <DialogFooter className="flex flex-wrap justify-end gap-btn border-t border-slate-200 bg-slate-50 px-6 py-4">
            <Button type="button" variant="outline" onClick={close} disabled={busy}>ยกเลิก</Button>
            <Button
              ref={confirmRef}
              type="button"
              data-testid="member-import-confirm"
              onClick={() => void confirm()}
              disabled={!plan || plan.counts.error > 0 || busy}
              className="bg-emerald-600 font-bold text-white hover:bg-emerald-700"
            >
              {busy ? "กำลังนำเข้า..." : `นำเข้า (เพิ่มใหม่ ${plan?.counts.create ?? 0} · แก้ไข ${plan?.counts.update ?? 0})`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
