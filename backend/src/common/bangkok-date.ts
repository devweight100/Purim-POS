import { BadRequestException } from '@nestjs/common';
import * as bkk from '../../../shared/src/bangkok-date';

/**
 * Store calendar = Asia/Bangkok (UTC+7, no DST), whatever TZ the server process runs in.
 * The calendar maths is shared/src/bangkok-date.ts (also used by the screens); this file returns
 * Date objects and turns bad request parameters into 400 errors.
 */
export const BANGKOK_OFFSET_MS = bkk.BANGKOK_OFFSET_MS;
export const DAY_MS = bkk.DAY_MS;
const DATE_ONLY = bkk.DATE_ONLY;

/** YYYY-MM-DD of the Bangkok calendar day that contains `d`. */
export const bangkokDayKey = bkk.bangkokDayKey;

/** Instant of Bangkok 00:00 of the day containing `d`. */
export function bangkokStartOfDay(d: Date | string | number = new Date()): Date {
  return new Date(bkk.bangkokStartOfDay(d));
}

/** Bangkok 00:00 of the 1st of the month containing `d`. */
export function bangkokStartOfMonth(d: Date | string | number = new Date()): Date {
  return new Date(bkk.bangkokStartOfMonth(d));
}

/** Bangkok 00:00 of a YYYY-MM-DD day key (400 when the key is not a real date). */
export function bangkokDayStart(key: string): Date {
  const t = bkk.bangkokDayStart(key);
  if (isNaN(t)) throw new BadRequestException(`รูปแบบวันที่ไม่ถูกต้อง: ${key}`);
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
  if (out.gte && ((out.lt && out.gte >= out.lt) || (out.lte && out.gte > out.lte))) {
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
