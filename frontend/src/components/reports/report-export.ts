import { round2 } from '@shared/money';
/**
 * Report export: real .xlsx (SheetJS, already a dependency) or CSV.
 * - CSV: RFC 4180 quoting (quotes, commas, newlines), UTF-8 BOM so Excel shows Thai,
 *   downloaded through a Blob URL (a data: URI is cut at the first `#`).
 * - CSV/XLSX injection guard: text cells starting with = + - @ (or tab / CR) get a leading '.
 * - Numbers are rounded to 2 decimals.
 */
export interface ExportColumn<T> {
  header: string;
  value: (row: T, index: number) => string | number | null | undefined;
}


function cellValue(v: unknown): string | number {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : '';
  const s = String(v);
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

export function toCsv<T>(rows: T[], columns: ExportColumn<T>[]): string {
  const esc = (v: string | number) => {
    if (typeof v === 'number') return String(v);
    return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
  };
  const lines = [columns.map((c) => esc(cellValue(c.header))).join(',')];
  rows.forEach((r, i) => lines.push(columns.map((c) => esc(cellValue(c.value(r, i)))).join(',')));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadReport<T>(format: 'csv' | 'xlsx', baseName: string, sheetName: string, rows: T[], columns: ExportColumn<T>[]) {
  if (format === 'csv') {
    saveBlob(new Blob([toCsv(rows, columns)], { type: 'text/csv;charset=utf-8' }), `${baseName}.csv`);
    return `${baseName}.csv`;
  }
  const XLSX = await import('xlsx');
  const aoa = [columns.map((c) => c.header), ...rows.map((r, i) => columns.map((c) => cellValue(c.value(r, i))))];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = columns.map((c) => ({ wch: Math.max(10, Math.min(40, c.header.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31));
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  saveBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${baseName}.xlsx`);
  return `${baseName}.xlsx`;
}
