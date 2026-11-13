'use client';

import React from 'react';
import type { StoreSettings } from '@/lib/store-settings-storage';

/**
 * Building blocks of every 80 mm slip (receipt, debt payment, shift summary).
 *
 * Printable width of an 80 mm thermal roll: 576 printer dots (72 mm) = 288 CSS px, the width the
 * desktop app lays slips out at (desktop/escpos-raster.js). The preview uses the same width, so
 * line breaks on screen are the line breaks on paper. Black on white only: grey, colours,
 * emoji and icons do not survive the 1-bit thermal print.
 */
export const SLIP_WIDTH_PX = 288;

/** 1,234.50 (always 2 decimals, no currency sign: every amount on a slip is in baht) */
export const slipMoney = (v: number | string | undefined | null) =>
  (Number(v) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function SlipRow({ label, value, className = '' }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex justify-between items-start gap-2 ${className}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

export const SlipRule = () => <div className="border-t border-dashed border-black my-1" />;

/** Root of a slip: fixed printable width, black on white. */
export const SlipPaper = React.forwardRef<HTMLDivElement, { children: React.ReactNode; className?: string }>(
  ({ children, className = '' }, ref) => (
    <div
      ref={ref}
      data-slip-root=""
      className={`bg-white text-black font-sans text-[12px] leading-snug font-semibold box-border ${className}`}
      style={{ width: SLIP_WIDTH_PX, maxWidth: '100%', color: '#000000', backgroundColor: '#ffffff', margin: '0 auto', padding: '4px 4px 8px' }}
    >
      {children}
    </div>
  ),
);
SlipPaper.displayName = 'SlipPaper';

/** Shop name, branch, address, phone, (tax id) and the document title. */
export function SlipShopHeader({
  settings,
  title,
  showTaxId = true,
  children,
}: {
  settings: StoreSettings;
  title: React.ReactNode;
  showTaxId?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="text-center leading-tight">
      <div className="text-[16px] font-bold break-words">{settings.storeName}</div>
      {settings.branchName && <div className="mt-0.5">{settings.branchName}</div>}
      {settings.storeAddress && <div className="mt-0.5 text-[11px] whitespace-pre-wrap break-words">{settings.storeAddress}</div>}
      {settings.storePhone && <div className="mt-0.5 text-[11px]">โทร {settings.storePhone}</div>}
      {showTaxId && settings.taxId && <div className="mt-0.5 text-[11px]">เลขประจำตัวผู้เสียภาษี {settings.taxId}</div>}
      {settings.receiptHeader && <div className="mt-0.5 text-[11px] whitespace-pre-wrap break-words">{settings.receiptHeader}</div>}
      <div className="mt-1.5 text-[14px] font-bold">{title}</div>
      {children}
    </div>
  );
}
