import React from 'react';
import type { StoreSettings } from '@/lib/store-settings-storage';
import { getReceiptOptions } from '@/lib/receipt-options';

/**
 * Shop block (top left) of every A4 document: receipt / tax invoice, claim, purchase order,
 * payment voucher, supplier return. Store name always; the rest as Settings > รูปแบบใบเสร็จ (A4)
 * allows. The seller tax id appears only for a VAT shop (getReceiptOptions).
 */
export function A4StoreHeader({
  settings,
  className = '',
  showHeaderText = true,
}: {
  settings: StoreSettings;
  className?: string;
  /** the shop's slogan belongs on customer documents; supplier documents pass false */
  showHeaderText?: boolean;
}) {
  const o = getReceiptOptions(settings).a4;
  const logo = o.showLogo && settings.logoUrl ? settings.logoUrl : null;
  const contact = [
    o.showTaxId && settings.taxId?.trim() ? (
      <span key="tax">
        <b>เลขประจำตัวผู้เสียภาษี:</b> {settings.taxId}
      </span>
    ) : null,
    o.showPhone && settings.storePhone ? (
      <span key="phone">
        <b>โทร:</b> {settings.storePhone}
      </span>
    ) : null,
    o.showEmail && settings.storeEmail ? (
      <span key="email">
        <b>อีเมล:</b> {settings.storeEmail}
      </span>
    ) : null,
  ].filter(Boolean);

  return (
    <div data-a4-store-header="" className={`space-y-0.5 ${className}`}>
      <div className="flex items-center gap-2">
        {logo && (
          // eslint-disable-next-line @next/next/no-img-element -- printed document: a plain <img> is what the PDF/print capture sees
          <img src={logo} alt="" className="h-10 max-w-[120px] object-contain" />
        )}
        <div>
          <h2 className="text-lg font-black text-slate-900 tracking-tight leading-none">{settings.storeName}</h2>
          {o.showBranch && settings.branchName && (
            <span className="text-[10.5px] font-bold text-slate-700 tracking-wide">สาขา: {settings.branchName}</span>
          )}
        </div>
      </div>
      {o.showAddress && settings.storeAddress && (
        <p className="text-[10.5px] text-slate-600 leading-snug pt-0.5 whitespace-pre-wrap">{settings.storeAddress}</p>
      )}
      {contact.length > 0 && <div className="flex flex-wrap gap-x-3 text-[10.5px] text-slate-600">{contact}</div>}
      {showHeaderText && o.showHeaderText && settings.receiptHeader && (
        <p className="text-[10.5px] text-slate-600 leading-snug whitespace-pre-wrap">{settings.receiptHeader}</p>
      )}
    </div>
  );
}

/** The shop's footer text on an A4 document (Settings: ข้อความส่วนท้าย), when switched on. */
export function A4FooterText({ settings, className = '' }: { settings: StoreSettings; className?: string }) {
  if (!getReceiptOptions(settings).a4.showFooterText || !settings.receiptFooter) return null;
  return <p className={`whitespace-pre-wrap ${className}`}>{settings.receiptFooter}</p>;
}
