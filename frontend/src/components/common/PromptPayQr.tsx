'use client';

import { useMemo } from 'react';
import { promptPayQr, qrPath } from '@/lib/promptpay-qr';
import { formatPromptPayAmount, type PromptPayIdType } from '@shared/promptpay';

const baht = (v: number) => '฿' + v.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

interface Props {
  type: PromptPayIdType;
  id: string;
  amount: number;
  accountName?: string;
  /** QR side in px (the code scales down to the available width). */
  size?: number;
  /** Smaller caption (account form preview). */
  compact?: boolean;
  className?: string;
}

/**
 * PromptPay QR with the amount locked, generated in the browser (works offline). The amount, the
 * account name and the masked PromptPay ID are printed under it for the customer to check.
 * data-payload holds the EMVCo payload (tests read it).
 */
export function PromptPayQr({ type, id, amount, accountName, size = 280, compact = false, className = '' }: Props) {
  const qr = useMemo(() => promptPayQr(type, id, amount), [type, id, amount]);
  if (!qr) {
    return (
      <div data-testid="promptpay-qr-empty" className={`flex flex-col items-center justify-center text-center text-slate-500 gap-1 ${className}`}>
        <span className="text-sm font-semibold">ใส่ยอดเงินที่มากกว่า ฿0 เพื่อสร้าง QR พร้อมเพย์</span>
      </div>
    );
  }
  const quiet = 4;
  const n = qr.modules.length + quiet * 2;
  return (
    <div data-testid="promptpay-qr" data-payload={qr.payload} data-amount={formatPromptPayAmount(amount)} className={`flex flex-col items-center text-center ${className}`}>
      <svg
        role="img"
        aria-label={`QR พร้อมเพย์ ยอด ${baht(amount)}`}
        viewBox={`0 0 ${n} ${n}`}
        width={size}
        height={size}
        shapeRendering="crispEdges"
        className="max-w-full h-auto bg-white"
      >
        <rect width={n} height={n} fill="#ffffff" />
        <path d={qrPath(qr.modules, quiet)} fill="#000000" />
      </svg>
      <div className={compact ? 'mt-1 space-y-0' : 'mt-2 space-y-0.5'}>
        <div data-testid="promptpay-qr-amount" className={`font-extrabold font-mono text-slate-900 ${compact ? 'text-lg' : 'text-3xl'}`}>
          {baht(amount)}
        </div>
        {accountName && <div className={`font-bold text-slate-800 ${compact ? 'text-xs' : 'text-base'}`}>{accountName}</div>}
        <div className={`font-mono text-slate-600 ${compact ? 'text-xs' : 'text-base'}`}>
          พร้อมเพย์ {qr.masked}
        </div>
      </div>
    </div>
  );
}
