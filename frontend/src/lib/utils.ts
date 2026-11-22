import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import { listDate, listDateTime } from "@shared/thai-date"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format currency with THB symbol and comma thousands separators e.g. ฿12,500 (no decimal if whole) or ฿12,500.50 (2 decimals if fraction)
 */
export function formatCurrency(amount: number | string | null | undefined): string {
  // style pass 2026-11-22 (docs/ui-style.md): money always with 2 decimals ("฿1,234.50", "฿4,798.00"), so the
  // digits of a money column line up; negative as "-฿1,234.50"
  const val = Number(amount) || 0;
  return (val < 0 ? '-฿' : '฿') + Math.abs(val).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format number with comma thousands separators e.g. 12,500 or 12,500.50
 */
export function formatNumber(amount: number | string | null | undefined): string {
  const val = Number(amount) || 0;
  const hasDecimal = val % 1 !== 0;
  return val.toLocaleString('th-TH', {
    minimumFractionDigits: hasDecimal ? 2 : 0,
    maximumFractionDigits: 2,
  });
}

/** Tables / lists: "18 พ.ย. 69" (no time; round 4). Kept under the old name for its many callers. */
export function formatDate(dateStr: string | Date | null | undefined): string {
  return listDate(dateStr);
}

const THAI_DIGITS = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
const THAI_UNITS = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน"];

/** Read 0..999999. `hasHigher` = digits precede this group (e.g. the part after "ล้าน"). */
function readThaiGroup(group: number, hasHigher: boolean): string {
  if (group <= 0) return "";
  const str = String(group);
  const len = str.length;
  let out = "";
  for (let i = 0; i < len; i++) {
    const digit = Number(str[i]);
    const pos = len - 1 - i;
    if (digit === 0) continue;
    if (pos === 1) {
      out += digit === 1 ? "สิบ" : digit === 2 ? "ยี่สิบ" : THAI_DIGITS[digit] + "สิบ";
    } else if (pos === 0) {
      out += digit === 1 && (group > 1 || hasHigher) ? "เอ็ด" : THAI_DIGITS[digit];
    } else {
      out += THAI_DIGITS[digit] + THAI_UNITS[pos];
    }
  }
  return out;
}

/** Read a non-negative integer of any size: groups of 6 digits joined with "ล้าน". */
function readThaiInteger(n: number, hasHigher = false): string {
  if (n >= 1_000_000) {
    const high = Math.floor(n / 1_000_000);
    const low = n % 1_000_000;
    return readThaiInteger(high, hasHigher) + "ล้าน" + readThaiGroup(low, true);
  }
  return readThaiGroup(n, hasHigher);
}

/**
 * Convert an amount in baht to Thai words (Excel BAHTTEXT style), e.g.
 * 1250.50 -> หนึ่งพันสองร้อยห้าสิบบาทห้าสิบสตางค์, 11,000,000 -> สิบเอ็ดล้านบาทถ้วน,
 * 0.25 -> ยี่สิบห้าสตางค์, -5 -> ลบห้าบาทถ้วน.
 */
export function thaiBahtText(num: number | string | null | undefined): string {
  if (num === null || num === undefined || num === "") return "ศูนย์บาทถ้วน";
  const n = typeof num === "string" ? parseFloat(num.replace(/,/g, "")) : Number(num);
  if (!Number.isFinite(n)) return "ศูนย์บาทถ้วน";

  const totalSatang = Math.round(Math.abs(n) * 100);
  if (totalSatang === 0) return "ศูนย์บาทถ้วน";
  const baht = Math.floor(totalSatang / 100);
  const satang = totalSatang % 100;

  let result = n < 0 ? "ลบ" : "";
  if (baht > 0) result += readThaiInteger(baht) + "บาท";
  result += satang === 0 ? "ถ้วน" : readThaiGroup(satang, false) + "สตางค์";
  return result;
}

const DOC_TIME_ZONE = "Asia/Bangkok";

/**
 * Tables and lists (round 4, owner): short Thai date without time, e.g. "18 พ.ย. 69" (Bangkok, 2-digit BE year).
 * The one formatter for list dates (shared/src/thai-date.ts, also used by the backend).
 */
export const formatListDate = listDate;
/** "18 พ.ย. 69 14:05": only where the time is kept (orders / online orders lists, detail views, receipts). */
export const formatListDateTime = listDateTime;

/**
 * The one date format for printed documents: dd/MM/yyyy (Buddhist year, 4 digits) and,
 * optionally, HH:mm - always in Bangkok time, whatever the terminal's time zone.
 * e.g. 07/11/2569 14:05
 */
export function formatDocDate(
  value: string | number | Date | null | undefined,
  opts: { time?: boolean; seconds?: boolean } = {}
): string {
  if (value === null || value === undefined || value === "") return "-";
  const date = value instanceof Date ? value : new Date(value);
  if (isNaN(date.getTime())) return "-";
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: DOC_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "00";
  const year = Number(get("year")) + 543;
  let out = `${get("day")}/${get("month")}/${year}`;
  if (opts.time) {
    out += ` ${get("hour")}:${get("minute")}`;
    if (opts.seconds) out += `:${get("second")}`;
  }
  return out;
}

/** dd/MM/yyyy HH:mm (Buddhist year, Bangkok time) */
export function formatDocDateTime(value: string | number | Date | null | undefined): string {
  return formatDocDate(value, { time: true });
}
