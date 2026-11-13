'use client';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { formatDocDate } from '@/lib/utils';
import { paymentMethodLabel } from '@/lib/receipt-mapper';
import { StoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe } from '@/lib/pdf-print-service';
import { formatQty, mulQty, subQty } from '@/lib/qty';

export interface ReceiptData {
  orderNumber: string;
  createdAt: string;
  customerName?: string | null;
  userName?: string;
  items: Array<{
    name: string;
    quantity: number;
    unitName: string;
    unitPrice: number;
    lineTotal: number;
    discountAmount?: number;
    claimQuantity?: number;
    claimDefectReason?: string;
    itemNote?: string;
    bundleData?: {
      isBundle?: boolean;
      bundleItems?: Array<{
        productId: string;
        productName: string;
        quantity: number;
        unitName?: string;
      }>;
    };
  }>;
  subtotal: number;
  billDiscountAmount: number;
  pointsDiscountAmount?: number;
  pointsUsed?: number;
  claimDiscountAmount?: number;
  claimInfo?: {
    claimId: string;
    originalOrderNumber?: string;
    productName: string;
    quantity: number;
    unitName: string;
    defectReason: string;
    discountAmount: number;
  };
  customerPointsEarned?: number;
  customerPointsBalance?: number;
  vatAmount: number;
  totalAmount: number;
  paymentMethod: string;
  payments?: Array<{ method: string; amount: number; referenceNo?: string }>;
  cashReceived?: number;
  changeAmount?: number;
  note?: string;
  /** unpaid part of a credit sale (ค้างชำระ) */
  outstandingAmount?: number;
  /** VAT rate of the bill (orders.vat_rate); defaults to the store setting */
  vatRate?: number;
  /** POS terminal that made the sale, when known */
  terminalName?: string;
  /** reprint of an existing bill -> "พิมพ์ซ้ำ" marker with the reprint time */
  isReprint?: boolean;
  reprintedAt?: string;
}

export const SAMPLE_RECEIPT_DATA: ReceiptData = {
  orderNumber: 'ORD-20260901-0001',
  createdAt: new Date().toISOString(),
  customerName: 'คุณสมชาย ใจดี',
  userName: 'พนักงานขาย (POS-01)',
  items: [
    {
      name: 'กาแฟสดปุริม คลาสสิก',
      quantity: 1,
      unitName: 'แก้ว',
      unitPrice: 55,
      lineTotal: 55,
    },
    {
      name: 'ขนมปังปิ้งเนยนมสด',
      quantity: 2,
      unitName: 'ชิ้น',
      unitPrice: 25,
      lineTotal: 50,
    },
  ],
  subtotal: 105,
  billDiscountAmount: 0,
  vatAmount: 6.87,
  totalAmount: 105,
  paymentMethod: 'เงินสด',
  payments: [{ method: 'CASH', amount: 105 }],
  cashReceived: 500,
  changeAmount: 395,
  customerPointsEarned: 1,
  customerPointsBalance: 125,
  note: '',
};

interface ThermalReceiptViewProps {
  data: ReceiptData;
  settings: StoreSettings;
  className?: string;
}

/**
 * Printable width of an 80 mm thermal roll: 576 printer dots (72 mm) = 288 CSS px, the width the
 * desktop app lays slips out at (desktop/escpos-raster.js). The preview uses the same width, so
 * line breaks on screen are the line breaks on paper.
 */
export const SLIP_WIDTH_PX = 288;

/** 1,234.50 (always 2 decimals, no currency sign: every amount on the slip is in baht) */
const money = (v: number | undefined | null) =>
  (Number(v) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function Row({ label, value, className = '' }: { label: React.ReactNode; value: React.ReactNode; className?: string }) {
  return (
    <div className={`flex justify-between items-start gap-2 ${className}`}>
      <span className="min-w-0 break-words">{label}</span>
      <span className="shrink-0 text-right tabular-nums">{value}</span>
    </div>
  );
}

const Rule = () => <div className="border-t border-dashed border-black my-1" />;

/**
 * 80 mm receipt (ใบเสร็จรับเงิน / ใบกำกับภาษีอย่างย่อ). Black on white, no boxes or grey: what is
 * shown here is exactly what the thermal printer prints (same component, same width, same CSS
 * on screen and on paper).
 */
export const ThermalReceiptView = React.forwardRef<HTMLDivElement, ThermalReceiptViewProps>(
  ({ data, settings, className = '' }, ref) => {
    const vatShown = Number(data.vatAmount) > 0;
    // a VAT-registered shop issues an abbreviated tax invoice (Revenue Code s.86/6)
    const isTaxInvoice = settings.vatEnabled === true || vatShown;
    const vatRate = Number(data.vatRate ?? settings.vatRate) || 7;
    const payments = (data.payments || []).filter((p) => Number(p.amount) > 0);
    const singleMethod = payments.length <= 1;
    const hasPoints =
      !!data.customerName &&
      ((data.customerPointsEarned ?? 0) > 0 || (data.pointsUsed ?? 0) > 0 || data.customerPointsBalance !== undefined);

    return (
      <div
        ref={ref}
        data-slip-root=""
        className={`bg-white text-black font-sans text-[12px] leading-snug font-semibold box-border ${className}`}
        style={{ width: SLIP_WIDTH_PX, maxWidth: '100%', color: '#000000', backgroundColor: '#ffffff', margin: '0 auto', padding: '4px 4px 8px' }}
      >
        {/* ─── Shop ─── */}
        <div className="text-center leading-tight">
          <div className="text-[16px] font-bold break-words">{settings.storeName}</div>
          {settings.branchName && <div className="mt-0.5">{settings.branchName}</div>}
          {settings.storeAddress && <div className="mt-0.5 text-[11px] whitespace-pre-wrap break-words">{settings.storeAddress}</div>}
          {settings.storePhone && <div className="mt-0.5 text-[11px]">โทร {settings.storePhone}</div>}
          {isTaxInvoice && settings.taxId && <div className="mt-0.5 text-[11px]">เลขประจำตัวผู้เสียภาษี {settings.taxId}</div>}
          {settings.receiptHeader && <div className="mt-0.5 text-[11px] whitespace-pre-wrap break-words">{settings.receiptHeader}</div>}
          <div className="mt-1.5 text-[14px] font-bold">
            {isTaxInvoice ? (
              <>
                ใบเสร็จรับเงิน/
                <wbr />
                ใบกำกับภาษีอย่างย่อ
              </>
            ) : (
              'ใบเสร็จรับเงิน'
            )}
          </div>
          {isTaxInvoice && <div className="text-[11px]">(ราคารวมภาษีมูลค่าเพิ่มแล้ว)</div>}
          {data.isReprint && (
            <div className="mt-0.5 font-bold">*** พิมพ์ซ้ำ {formatDocDate(data.reprintedAt || new Date(), { time: true })} ***</div>
          )}
        </div>

        <Rule />

        {/* ─── Bill ─── */}
        <div className="space-y-0.5">
          <Row label="เลขที่" value={<span className="font-bold">{data.orderNumber}</span>} />
          <Row label="วันที่" value={formatDocDate(data.createdAt, { time: true })} />
          <Row label="พนักงาน" value={data.userName || '-'} />
          {data.terminalName && <Row label="เครื่อง" value={data.terminalName} />}
          {data.customerName && <Row label="ลูกค้า" value={<span className="break-words">{data.customerName}</span>} />}
        </div>

        <Rule />

        {/* ─── Items: name, then qty unit x price = amount; a line discount on its own line ─── */}
        <div className="space-y-1">
          {data.items.map((item, idx) => {
            const discount = Number(item.discountAmount) || 0;
            const gross = Number(item.lineTotal) + (discount > 0 ? discount : 0);
            const claimQty = Number(item.claimQuantity) || 0;
            return (
              <div key={idx}>
                <div className="break-words leading-tight">{item.name}</div>
                {item.bundleData?.bundleItems && item.bundleData.bundleItems.length > 0 && (
                  <div className="pl-2 text-[11px]">
                    {item.bundleData.bundleItems.map((b, bIdx) => (
                      <Row key={bIdx} label={`- ${b.productName}`} value={`x${formatQty(mulQty(b.quantity, item.quantity))}`} />
                    ))}
                  </div>
                )}
                <Row className="pl-2" label={`${formatQty(item.quantity)} ${item.unitName} x ${money(item.unitPrice)}`} value={money(gross)} />
                {discount > 0 && <Row className="pl-2" label="ส่วนลด" value={`-${money(discount)}`} />}
                {claimQty > 0 && (
                  <div className="pl-2 text-[11px]">
                    เคลมฟรี {formatQty(claimQty)} {item.unitName} (คิดเงิน {formatQty(Math.max(0, subQty(item.quantity, claimQty)))})
                  </div>
                )}
                {item.itemNote && <div className="pl-2 text-[11px] break-words">หมายเหตุ: {item.itemNote}</div>}
              </div>
            );
          })}
        </div>

        <Rule />

        {/* ─── Totals ─── */}
        <div className="space-y-0.5">
          <Row label={`รวม ${data.items.length} รายการ`} value={money(data.subtotal)} />
          {data.billDiscountAmount > 0 && <Row label="ส่วนลดท้ายบิล" value={`-${money(data.billDiscountAmount)}`} />}
          {(data.pointsDiscountAmount ?? 0) > 0 && (
            <Row label={`ส่วนลดแต้ม (${(data.pointsUsed || 0).toLocaleString('th-TH')} แต้ม)`} value={`-${money(data.pointsDiscountAmount)}`} />
          )}
          {(data.claimDiscountAmount ?? 0) > 0 && <Row label="ส่วนลดเคลมสินค้า" value={`-${money(data.claimDiscountAmount)}`} />}
          <Row className="text-[16px] font-bold pt-0.5" label="ยอดสุทธิ" value={money(data.totalAmount)} />
          {vatShown && (
            <div className="text-[11px] space-y-0.5 pt-0.5">
              <Row label="มูลค่าก่อนภาษี" value={money(Number(data.totalAmount) - Number(data.vatAmount))} />
              <Row label={`ภาษีมูลค่าเพิ่ม ${vatRate}%`} value={money(data.vatAmount)} />
            </div>
          )}
        </div>

        {data.claimInfo && (
          <div className="text-[11px] pt-1 break-words">
            เคลม #{data.claimInfo.claimId}: {data.claimInfo.productName} {formatQty(data.claimInfo.quantity)} {data.claimInfo.unitName}
            {data.claimInfo.defectReason ? ` (${data.claimInfo.defectReason})` : ''}
          </div>
        )}

        <Rule />

        {/* ─── Payment ─── */}
        <div className="space-y-0.5">
          {payments.length === 0 && <Row label="ชำระโดย" value={data.paymentMethod} />}
          {payments.map((p, i) => (
            <Row
              key={i}
              label={singleMethod ? `ชำระโดย ${paymentMethodLabel(p.method)}` : paymentMethodLabel(p.method)}
              value={money(p.amount)}
            />
          ))}
          {(data.cashReceived ?? 0) > 0 && <Row label="รับเงิน" value={money(data.cashReceived)} />}
          {(data.changeAmount ?? 0) > 0 && <Row className="text-[14px] font-bold" label="เงินทอน" value={money(data.changeAmount)} />}
          {(data.outstandingAmount ?? 0) > 0 && (
            <Row className="text-[14px] font-bold" label="ยอดค้างชำระ" value={money(data.outstandingAmount)} />
          )}
        </div>

        {hasPoints && (
          <div className="text-[11px] pt-1 space-y-0.5">
            <Row label="แต้มที่ได้รับ" value={`+${(data.customerPointsEarned ?? 0).toLocaleString('th-TH')}`} />
            {(data.pointsUsed ?? 0) > 0 && <Row label="แต้มที่ใช้" value={`-${(data.pointsUsed ?? 0).toLocaleString('th-TH')}`} />}
            {data.customerPointsBalance !== undefined && <Row label="แต้มคงเหลือ" value={data.customerPointsBalance.toLocaleString('th-TH')} />}
          </div>
        )}

        {data.note && (
          <>
            <Rule />
            <div className="text-[11px] whitespace-pre-wrap break-words">หมายเหตุ: {data.note}</div>
          </>
        )}

        <Rule />
        <div className="text-center text-[11px] whitespace-pre-wrap break-words">{settings.receiptFooter || 'ขอบคุณที่ใช้บริการ'}</div>
      </div>
    );
  }
);

ThermalReceiptView.displayName = 'ThermalReceiptView';

/**
 * THE way to print a receipt slip (after a sale, reprints from the orders page, POS history,
 * document search, payment edits). The slip is rendered off-screen at the printable width and
 * printed from there, never from a node inside a dialog, so every entry point prints the same.
 */
export function printThermalReceiptDirect(data: ReceiptData, settings: StoreSettings) {
  if (typeof window === 'undefined') return;

  const old = document.getElementById('direct-thermal-receipt-container');
  if (old) old.remove();

  const container = document.createElement('div');
  container.id = 'direct-thermal-receipt-container';
  container.setAttribute('aria-hidden', 'true');
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '0';
  container.style.width = `${SLIP_WIDTH_PX}px`;
  container.style.pointerEvents = 'none';
  container.style.zIndex = '-9999';
  document.body.appendChild(container);

  const root = createRoot(container);
  // render synchronously so printing can start right away (no fixed delay)
  flushSync(() => {
    root.render(<ThermalReceiptView data={data} settings={settings} />);
  });

  const receipt = (container.firstElementChild as HTMLElement | null) || container;
  void printDocumentIframe(receipt, `ใบเสร็จ ${data.orderNumber}`, '80mm').finally(() => {
    setTimeout(() => {
      try {
        root.unmount();
        container.remove();
      } catch {
        /* already gone */
      }
    }, 1000);
  });
}
