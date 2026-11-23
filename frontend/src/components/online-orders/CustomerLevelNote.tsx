'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { DEFAULT_LEVEL_NAMES, normalizeLevel, type PriceLevel } from '@shared/online-shop';

interface Coverage {
  levelNames: Record<PriceLevel, string>;
  total: number;
  missing: Record<2 | 3 | 4 | 5, number>;
}

let cached: { at: number; data: Coverage } | null = null;

/**
 * Customer form, price level: what a LINE customer linked to this member sees in the online shop, and that products
 * without a price at this level are sold at ราคาปลีก (shared price-level rule, also in the POS: empty / 0 -> retail),
 * with how many products have no price at this level yet.
 */
export function CustomerLevelNote({ level: raw }: { level: number | undefined }) {
  const level = normalizeLevel(raw);
  const [data, setData] = useState<Coverage | null>(() => cached?.data ?? null);

  useEffect(() => {
    if (cached && Date.now() - cached.at < 30_000) return;
    let alive = true;
    apiFetch<Coverage>('/online-shop/level-coverage').then(
      (d) => {
        cached = { at: Date.now(), data: d };
        if (alive) setData(d);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, []);

  const name = (data?.levelNames ?? DEFAULT_LEVEL_NAMES)[level];
  const missing = level > 1 && data ? data.missing[level as 2 | 3 | 4 | 5] : null;
  return (
    <p data-testid="customer-level-note" className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-3 py-2 text-xs leading-relaxed text-slate-700">
      ร้านออนไลน์ LINE: ลูกค้าที่ผูก LINE กับสมาชิกนี้จะเห็น <b>“{name}”</b>
      {level > 1 && (
        <>
          {' '}— สินค้าที่ยังไม่ได้ตั้งราคาระดับ {level} (ว่างหรือ 0) จะใช้ราคาปลีก (ระดับ 1) แทน และลูกค้าจะเห็นป้าย “ราคาปลีก”
          {missing !== null && (
            <>
              {' '}· สินค้าที่ยังไม่มีราคาระดับ {level}: <b className={missing > 0 ? 'text-amber-800' : 'text-emerald-800'}>{missing.toLocaleString('th-TH')}</b> จาก {data!.total.toLocaleString('th-TH')} รายการ (ตั้งได้ในหน้าสินค้า ช่องราคาระดับ {level})
            </>
          )}
        </>
      )}
    </p>
  );
}
