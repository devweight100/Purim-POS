/**
 * Store calendar = Asia/Bangkok (UTC+7, no DST), whatever time zone the server process or the
 * browser runs in. Every report day bucket and date filter goes through these helpers.
 * Instants are epoch milliseconds; backend/src/common/bangkok-date.ts wraps them into Date objects
 * and 400 errors for request parameters.
 */
export const BANGKOK_OFFSET_MS = 7 * 3600 * 1000;
export const DAY_MS = 86400000;
export const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** YYYY-MM-DD of the Bangkok day containing the instant ('' when the date is invalid). */
export function bangkokDayKey(d: Date | string | number): string {
  const t = new Date(d).getTime();
  if (isNaN(t)) return '';
  return new Date(t + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}

/** Epoch ms of Bangkok 00:00 of the day containing `d`. */
export function bangkokStartOfDay(d: Date | string | number = Date.now()): number {
  const t = new Date(d).getTime() + BANGKOK_OFFSET_MS;
  return t - (((t % DAY_MS) + DAY_MS) % DAY_MS) - BANGKOK_OFFSET_MS;
}

/** Epoch ms of Bangkok 00:00 of the 1st of the month containing `d`. */
export function bangkokStartOfMonth(d: Date | string | number = Date.now()): number {
  const local = new Date(new Date(d).getTime() + BANGKOK_OFFSET_MS);
  return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1) - BANGKOK_OFFSET_MS;
}

/** Epoch ms of Bangkok 00:00 of a YYYY-MM-DD key (NaN when it is not of that form). */
export function bangkokDayStart(key: string): number {
  const m = DATE_ONLY.exec(key || '');
  if (!m) return NaN;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - BANGKOK_OFFSET_MS;
}

/** Bangkok year / month (0-based) / day of an instant. */
export function bangkokParts(d: Date | string | number = Date.now()) {
  const x = new Date(new Date(d).getTime() + BANGKOK_OFFSET_MS);
  return { year: x.getUTCFullYear(), month: x.getUTCMonth(), day: x.getUTCDate() };
}

/** Epoch ms of Bangkok 00:00 on year/month(0-based)/day (month may overflow, like Date.UTC). */
export function bangkokDate(year: number, month: number, day = 1): number {
  return Date.UTC(year, month, day) - BANGKOK_OFFSET_MS;
}

/** Report periods offered by the Reports page. */
export type ReportTimeRange = 'today' | 'yesterday' | '7days' | '30days' | 'thisMonth' | 'lastMonth' | 'thisYear' | 'all' | 'custom';
export const REPORT_TIME_RANGES: readonly ReportTimeRange[] = ['today', 'yesterday', '7days', '30days', 'thisMonth', 'lastMonth', 'thisYear', 'all', 'custom'];

/** [start, end) in epoch ms for a report range, using the Bangkok calendar. Custom end dates are inclusive days. */
export function reportRangeBounds(
  timeRange: ReportTimeRange,
  customStart?: string,
  customEnd?: string,
  now: number = Date.now(),
): { start: number; end: number } {
  const today = bangkokStartOfDay(now);
  const tomorrow = today + DAY_MS;
  const { year, month } = bangkokParts(now);
  switch (timeRange) {
    case 'today':
      return { start: today, end: tomorrow };
    case 'yesterday':
      return { start: today - DAY_MS, end: today };
    case '7days':
      return { start: today - 6 * DAY_MS, end: tomorrow };
    case '30days':
      return { start: today - 29 * DAY_MS, end: tomorrow };
    case 'thisMonth':
      return { start: bangkokDate(year, month, 1), end: tomorrow };
    case 'lastMonth':
      return { start: bangkokDate(year, month - 1, 1), end: bangkokDate(year, month, 1) };
    case 'thisYear':
      return { start: bangkokDate(year, 0, 1), end: tomorrow };
    case 'custom': {
      const s = customStart ? bangkokDayStart(customStart) : NaN;
      const e = customEnd ? bangkokDayStart(customEnd) : NaN;
      // custom end date is inclusive: the whole Bangkok day, up to next day 00:00 (exclusive)
      return { start: isNaN(s) ? -Infinity : s, end: isNaN(e) ? Infinity : e + DAY_MS };
    }
    case 'all':
    default:
      return { start: -Infinity, end: Infinity };
  }
}
