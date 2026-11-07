import { BadRequestException } from '@nestjs/common';

/**
 * Store calendar = Asia/Bangkok (UTC+7, no DST), whatever TZ the server process runs in.
 * Every "day" bucket and date-only filter in reports / finance goes through these helpers.
 */
export const BANGKOK_OFFSET_MS = 7 * 3600 * 1000;
export const DAY_MS = 86400000;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD of the Bangkok calendar day that contains `d`. */
export function bangkokDayKey(d: Date | string | number): string {
  return new Date(new Date(d).getTime() + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Instant of Bangkok 00:00 of the day containing `d`. */
export function bangkokStartOfDay(d: Date | string | number = new Date()): Date {
  const t = new Date(d).getTime() + BANGKOK_OFFSET_MS;
  return new Date(t - (((t % DAY_MS) + DAY_MS) % DAY_MS) - BANGKOK_OFFSET_MS);
}

/** Bangkok 00:00 of the 1st of the month containing `d`. */
export function bangkokStartOfMonth(d: Date | string | number = new Date()): Date {
  const local = new Date(new Date(d).getTime() + BANGKOK_OFFSET_MS);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - BANGKOK_OFFSET_MS);
}

/** Bangkok 00:00 of a YYYY-MM-DD day key. */
export function bangkokDayStart(key: string): Date {
  const m = DATE_ONLY.exec(key);
  if (!m) throw new BadRequestException(`รูปแบบวันที่ไม่ถูกต้อง: ${key}`);
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - BANGKOK_OFFSET_MS;
  if (bangkokDayKey(t) !== key) throw new BadRequestException(`วันที่ไม่ถูกต้อง: ${key}`);
  return new Date(t);
}

export function addDays(d: Date, days: number): Date {
  return new Date(d.getTime() + days * DAY_MS);
}

/**
 * Turns `from` / `to` query params into a Prisma date filter.
 * - date-only YYYY-MM-DD means the whole Bangkok day: from = that day 00:00, to = next day 00:00 (exclusive)
 * - a full ISO timestamp is used as is (to inclusive)
 * Invalid input -> 400 (never a silent "no filter" or a 500).
 */
export function dateRangeFilter(from?: string | null, to?: string | null): { gte?: Date; lt?: Date; lte?: Date } | undefined {
  const out: { gte?: Date; lt?: Date; lte?: Date } = {};
  if (from) out.gte = parseDateParam(from, 'start');
  if (to) {
    if (DATE_ONLY.test(to.trim())) out.lt = addDays(bangkokDayStart(to.trim()), 1);
    else out.lte = parseDateParam(to, 'end');
  }
  if (out.gte && (out.lt ?? out.lte) && out.gte.getTime() > (out.lt ?? out.lte)!.getTime()) {
    throw new BadRequestException('วันที่เริ่มต้นต้องไม่เกินวันที่สิ้นสุด');
  }
  return out.gte || out.lt || out.lte ? out : undefined;
}

/** Start of the range for a date-only value (Bangkok 00:00); ISO timestamps are parsed as given. */
export function parseDateParam(value: string, _which: 'start' | 'end' = 'start'): Date {
  const v = String(value).trim();
  if (DATE_ONLY.test(v)) return bangkokDayStart(v);
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new BadRequestException(`รูปแบบวันที่ไม่ถูกต้อง: ${value}`);
  return d;
}

/** Exclusive end instant of a range filter (lt, or lte + 1ms). */
export function rangeEnd(r: { lt?: Date; lte?: Date } | undefined, fallback: Date): Date {
  if (r?.lt) return r.lt;
  if (r?.lte) return new Date(r.lte.getTime() + 1);
  return fallback;
}
