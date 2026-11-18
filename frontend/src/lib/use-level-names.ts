'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { DEFAULT_LEVEL_NAMES, type PriceLevel } from '@shared/online-shop';

let cached: { at: number; names: Record<PriceLevel, string> } | null = null;

/**
 * The shop's names of the price levels (online shop settings, e.g. ราคาปลีก / ราคาส่ง / ราคาส่งพิเศษ), for table
 * headers. Read from GET /online-shop/level-coverage (any staff), cached 60 s; defaults until it answers or on error.
 */
export function useLevelNames(): Record<PriceLevel, string> {
  const [names, setNames] = useState<Record<PriceLevel, string>>(() => cached?.names ?? DEFAULT_LEVEL_NAMES);
  useEffect(() => {
    if (cached && Date.now() - cached.at < 60_000) return;
    let alive = true;
    apiFetch<{ levelNames?: Record<PriceLevel, string> }>('/online-shop/level-coverage').then(
      (d) => {
        if (!d?.levelNames) return;
        cached = { at: Date.now(), names: d.levelNames };
        if (alive) setNames(d.levelNames);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);
  return names;
}

/**
 * Short subtitle for a "ราคา N" header: the level name without the leading "ราคา" ("ราคาส่ง" -> "ส่ง");
 * empty when it only repeats the number ("ราคาระดับ 4").
 */
export function levelSubtitle(name: string | undefined, level: number): string {
  const s = (name || '').trim().replace(/^ราคา\s*/, '').trim();
  if (!s || new RegExp(`^(ระดับ\\s*)?${level}$`).test(s)) return '';
  return s;
}
