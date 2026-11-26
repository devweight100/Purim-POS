import { bangkokDayKey, bangkokParts, bangkokDate, DAY_MS } from '@shared/bangkok-date';

/**
 * Date-range pages open on TODAY (Asia/Bangkok) (owner 2026-11-26, docs/round-shift-today-bundle-replace.md).
 * Nothing is remembered across visits: a fresh open is always today; the user changes it from there.
 */
export type DayPreset = 'today' | 'yesterday' | '7days' | 'thisMonth' | 'all';

/** YYYY-MM-DD of today in Bangkok. */
export function todayKey(now: number = Date.now()): string {
  return bangkokDayKey(now);
}

/** [start, end] YYYY-MM-DD (end inclusive) of a preset; 'all' = ['', '']. */
export function presetDays(p: DayPreset, now: number = Date.now()): [string, string] {
  const today = todayKey(now);
  if (p === 'today') return [today, today];
  if (p === 'yesterday') {
    const y = bangkokDayKey(now - DAY_MS);
    return [y, y];
  }
  if (p === '7days') return [bangkokDayKey(now - 6 * DAY_MS), today];
  if (p === 'thisMonth') {
    const { year, month } = bangkokParts(now);
    return [bangkokDayKey(bangkokDate(year, month, 1)), today];
  }
  return ['', ''];
}

/** Which preset a [start, end] pair is (null = a custom range). */
export function presetOf(start: string, end: string, now: number = Date.now()): DayPreset | null {
  for (const p of ['today', 'yesterday', '7days', 'thisMonth', 'all'] as DayPreset[]) {
    const [s, e] = presetDays(p, now);
    if (s === start && e === end) return p;
  }
  return null;
}

export const DAY_PRESET_LABELS: [DayPreset, string][] = [
  ['today', 'วันนี้'],
  ['yesterday', 'เมื่อวาน'],
  ['7days', '7 วัน'],
  ['thisMonth', 'เดือนนี้'],
  ['all', 'ทุกวันที่'],
];
