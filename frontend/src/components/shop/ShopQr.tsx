'use client';

import { useMemo } from 'react';
import qrcode from 'qrcode-generator';
import { qrPath } from '@/lib/promptpay-qr';
import { baht } from '@/lib/shop/shop-api';

/** PromptPay QR from the payload the server built (amount locked). data-payload for tests. */
export function ShopQr({ payload, amount, accountName, maskedId }: { payload: string; amount: number; accountName: string; maskedId: string }) {
  const modules = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(payload, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => qr.isDark(r, c)));
  }, [payload]);
  const n = modules.length + 8;
  return (
    <div data-testid="shop-qr" data-payload={payload} className="flex flex-col items-center text-center">
      <svg role="img" aria-label={`QR พร้อมเพย์ ยอด ${baht(amount)}`} viewBox={`0 0 ${n} ${n}`} width={260} height={260} shapeRendering="crispEdges" className="h-auto max-w-full bg-white">
        <rect width={n} height={n} fill="#ffffff" />
        <path d={qrPath(modules, 4)} fill="#000000" />
      </svg>
      <p className="mt-2 text-3xl font-extrabold">{baht(amount)}</p>
      <p className="text-lg font-bold">{accountName}</p>
      <p className="text-lg text-slate-700">พร้อมเพย์ {maskedId}</p>
    </div>
  );
}
