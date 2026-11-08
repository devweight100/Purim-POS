/**
 * Store calendar = Asia/Bangkok (UTC+7, no DST), independent of the browser / OS time zone.
 * Every report day bucket and date filter goes through these helpers.
 */
export const BANGKOK_OFFSET_MS = 7 * 3600 * 1000;
export const DAY_MS = 86400000;

/** YYYY-MM-DD of the Bangkok day containing the instant. */
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

/** Epoch ms of Bangkok 00:00 of a YYYY-MM-DD key (NaN when invalid). */
export function bangkokDayStart(key: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key || '');
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
