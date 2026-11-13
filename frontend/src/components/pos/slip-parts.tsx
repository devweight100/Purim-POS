'use client';

import React from 'react';
import type { StoreSettings } from '@/lib/store-settings-storage';
import { getReceiptOptions } from '@/lib/receipt-options';

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

/**
 * Shop part of every slip (receipt, debt payment, shift summary, claim): store name (always), then
 * what Settings > รูปแบบใบเสร็จ (slip) allows. The seller tax id appears only for a VAT shop.
 */
export function SlipShopHeader({
  settings,
  title,
  showTaxId = true,
  children,
}: {
  settings: StoreSettings;
  title: React.ReactNode;
  /** false on internal papers (shift summary) that are never tax documents */
  showTaxId?: boolean;
  children?: React.ReactNode;
}) {
  const o = getReceiptOptions(settings).slip;
  return (
    <div className="text-center leading-tight">
      {o.showLogo && settings.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- printed slip: a plain <img> is what the raster renderer captures
        <img src={settings.logoUrl} alt="" className="mx-auto mb-1 max-h-[64px] max-w-[160px] object-contain grayscale" />
      )}
      <div className="text-[16px] font-bold break-words">{settings.storeName}</div>
      {o.showBranch && settings.branchName && <div className="mt-0.5">{settings.branchName}</div>}
      {o.showAddress && settings.storeAddress && (
        <div className="mt-0.5 text-[11px] whitespace-pre-wrap break-words">{settings.storeAddress}</div>
      )}
      {o.showPhone && settings.storePhone && <div className="mt-0.5 text-[11px]">โทร {settings.storePhone}</div>}
      {o.showEmail && settings.storeEmail && <div className="mt-0.5 text-[11px] break-words">{settings.storeEmail}</div>}
      {showTaxId && o.showTaxId && settings.taxId && <div className="mt-0.5 text-[11px]">เลขประจำตัวผู้เสียภาษี {settings.taxId}</div>}
      {o.showHeaderText && settings.receiptHeader && (
        <div className="mt-0.5 text-[11px] whitespace-pre-wrap break-words">{settings.receiptHeader}</div>
      )}
      <div className="mt-1.5 text-[14px] font-bold">{title}</div>
      {children}
    </div>
  );
}

/** Footer text of a slip (Settings: ข้อความส่วนท้าย), or `fallback` when the shop wrote none. Nothing when switched off. */
export function SlipFooter({ settings, fallback = 'ขอบคุณที่ใช้บริการ' }: { settings: StoreSettings; fallback?: string }) {
  if (!getReceiptOptions(settings).slip.showFooterText) return null;
  const text = settings.receiptFooter || fallback;
  if (!text) return null;
  return <div className="text-center text-[11px] whitespace-pre-wrap break-words">{text}</div>;
}
