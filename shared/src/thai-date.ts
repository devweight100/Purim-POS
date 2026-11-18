/**
 * Short Thai dates for tables and lists (round 4, owner): "18 พ.ย. 69" - day, short Thai month, 2-digit Buddhist
 * year, always Bangkok time. Time ("14:05") only where the owner keeps it (orders / online orders lists, receipts,
 * detail views): listDateTime. Printed A4 documents keep the 4-digit BE form of formatDocDate (frontend lib/utils).
 */
import { BANGKOK_OFFSET_MS } from './bangkok-date';

export const THAI_MONTHS_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

type DateIn = string | number | Date | null | undefined;

function bkk(value: DateIn): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const t = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return isNaN(t) ? null : new Date(t + BANGKOK_OFFSET_MS);
}

/** "18 พ.ย. 69" ('-' when empty / invalid) */
export function listDate(value: DateIn): string {
  const d = bkk(value);
  if (!d) return '-';
  return `${d.getUTCDate()} ${THAI_MONTHS_SHORT[d.getUTCMonth()]} ${String((d.getUTCFullYear() + 543) % 100).padStart(2, '0')}`;
}

/** "14:05" (Bangkok) */
export function listTime(value: DateIn): string {
  const d = bkk(value);
  if (!d) return '-';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** "18 พ.ย. 69 14:05" */
export function listDateTime(value: DateIn): string {
  const d = bkk(value);
  return d ? `${listDate(value)} ${listTime(value)}` : '-';
}
