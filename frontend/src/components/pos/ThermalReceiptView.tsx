'use client';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { Store } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { StoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe } from '@/lib/pdf-print-service';
import { BarcodeView } from '@/components/common/BarcodeView';

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
  paymentMethod: 'เงินสด (Cash)',
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

export const ThermalReceiptView = React.forwardRef<HTMLDivElement, ThermalReceiptViewProps>(
  ({ data, settings, className = '' }, ref) => {
    return (
      <div
        ref={ref}
        className={`w-full max-w-[78mm] sm:max-w-[80mm] print:w-full print:max-w-full bg-white text-black font-sans text-[12px] leading-snug rounded-none space-y-2 overflow-hidden box-border select-none border border-black print:border-none print:p-0 ${className}`}
        style={{
          boxSizing: 'border-box',
          color: '#000000',
          backgroundColor: '#ffffff',
          margin: '0 auto',
          padding: '2mm 1.5mm',
        }}
      >
        {/* ─── 1. Header (ชื่อร้าน, สาขา, เลขประจำตัวผู้เสียภาษี) ─── */}
        <div className="text-center space-y-1 pb-2 border-b-2 border-black">
          <div className="flex items-center justify-center gap-1.5 font-black text-base sm:text-lg font-sans text-black">
            <Store className="w-5 h-5 text-black shrink-0 stroke-[2.5]" />
            <span className="truncate">{settings.storeName}</span>
          </div>

          {settings.branchName && (
            <p className="text-[11px] text-black font-bold font-sans">
              สาขา: {settings.branchName}
            </p>
          )}

          {settings.taxId && (
            <p className="text-[11px] text-black font-bold font-mono">
              เลขประจำตัวผู้เสียภาษี: {settings.taxId}
            </p>
          )}

          {settings.storeAddress && (
            <p className="text-[10.5px] text-black font-bold leading-tight break-words font-sans whitespace-pre-wrap">
              {settings.storeAddress}
            </p>
          )}

          {settings.storePhone && (
            <p className="text-[11px] text-black font-bold font-mono">
              โทร: {settings.storePhone}
            </p>
          )}

          {settings.storeEmail && (
            <p className="text-[10.5px] text-black font-bold font-sans">
              {settings.storeEmail}
            </p>
          )}

          {/* Custom Receipt Header Slogan */}
          {settings.receiptHeader && (
            <div className="pt-0.5">
              <p className="text-[10.5px] text-black font-bold font-sans whitespace-pre-wrap leading-tight">
                {settings.receiptHeader}
              </p>
            </div>
          )}

          <div className="pt-1">
            <span className="text-[13px] font-black border-2 border-black px-3 py-0.5 rounded-none font-sans inline-block text-black uppercase tracking-wider">
              ใบเสร็จรับเงิน
            </span>
          </div>
        </div>

        {/* ─── 2. Meta Details (เลขที่บิล, วันที่, พนักงาน, ลูกค้า) ─── */}
        <div className="text-[11.5px] space-y-1 pb-2 border-b-2 border-dashed border-black text-black font-bold">
          <div className="flex justify-between items-center gap-1">
            <span className="shrink-0">เลขที่บิล:</span>
            <span className="font-black truncate text-right font-mono text-black text-[12px]">{data.orderNumber}</span>
          </div>
          <div className="flex justify-between items-center gap-1">
            <span className="shrink-0">วันที่:</span>
            <span className="font-bold truncate text-right font-mono text-black text-[11px]">
              {new Date(data.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })}
            </span>
          </div>
          <div className="flex justify-between items-center gap-1">
            <span className="shrink-0">พนักงานขาย:</span>
            <span className="font-bold truncate text-right text-black">{data.userName || 'พนักงาน POS'}</span>
          </div>
          <div className="flex justify-between items-center gap-1">
            <span className="shrink-0">ลูกค้า:</span>
            <span className="font-black text-black truncate text-right max-w-[170px]">
              {data.customerName || 'ลูกค้าทั่วไป (Walk-in)'}
            </span>
          </div>
        </div>

        {/* ─── 3. Items Table (ตารางรายการสินค้า) ─── */}
        <div className="space-y-1.5 py-1.5 border-b-2 border-dashed border-black">
          <div className="flex justify-between text-[11.5px] font-black border-b-2 border-black pb-1 text-black">
            <span className="w-1/2">รายการ</span>
            <span className="w-1/4 text-center">จำนวน</span>
            <span className="w-1/4 text-right">รวม (฿)</span>
          </div>

          {data.items.map((item, idx) => (
            <div key={idx} className="text-[11.5px] space-y-0.5 text-black pt-1">
              <div className="font-black text-black leading-tight break-words text-[12px]">
                {idx + 1}. {item.name}
              </div>

              {/* แสดงรายการสินค้าย่อยในเซ็ต (Bundle Components) */}
              {item.bundleData?.bundleItems && item.bundleData.bundleItems.length > 0 && (
                <div className="pl-2 text-[10.5px] text-black font-bold space-y-0.5 border-l-2 border-black my-1">
                  {item.bundleData.bundleItems.map((bItem, bIdx) => (
                    <div key={bIdx} className="flex justify-between">
                      <span>• {bItem.productName}</span>
                      <span className="font-black font-mono">x{bItem.quantity * item.quantity}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center text-black text-[11px] pl-1 font-bold">
                <span className="truncate pr-1">
                  {item.quantity} {item.unitName} x {formatCurrency(item.unitPrice)}
                </span>
                <span className="font-black text-black shrink-0 font-mono text-[12px]">
                  {formatCurrency(item.lineTotal)}
                </span>
              </div>

              {item.discountAmount !== undefined && item.discountAmount > 0 && (
                <div className="text-[10.5px] text-black font-black pl-1">
                  * ส่วนลด: -{formatCurrency(item.discountAmount)}
                </div>
              )}

              {item.claimQuantity !== undefined && item.claimQuantity > 0 && (
                <div className="text-[11px] text-black font-black pl-1">
                  * เคลมฟรี: {item.claimQuantity} {item.unitName} (คิดเงิน {Math.max(0, item.quantity - item.claimQuantity)} {item.unitName})
                </div>
              )}

              {item.itemNote && (
                <div className="text-[10.5px] text-black font-bold pl-1 pt-0.5 break-words">
                  [โน้ต: {item.itemNote}]
                </div>
              )}
            </div>
          ))}
        </div>

        {/* ─── 4. Totals Summary (ยอดรวม, ส่วนลด, ยอดสุทธิ) ─── */}
        <div className="space-y-1 text-[11.5px] pt-1.5 pb-2 border-b-2 border-dashed border-black text-black font-bold">
          <div className="flex justify-between items-center">
            <span>รวมเงิน:</span>
            <span className="shrink-0 font-mono font-bold text-[12px]">{formatCurrency(data.subtotal)}</span>
          </div>

          {data.billDiscountAmount > 0 && (
            <div className="flex justify-between items-center font-black">
              <span className="truncate pr-1">ส่วนลดท้ายบิล:</span>
              <span className="shrink-0 font-mono text-[12px]">-{formatCurrency(data.billDiscountAmount)}</span>
            </div>
          )}

          {data.pointsDiscountAmount !== undefined && data.pointsDiscountAmount > 0 && (
            <div className="flex justify-between items-center font-black">
              <span className="truncate pr-1">ส่วนลดแต้ม ({data.pointsUsed?.toLocaleString() || 0}):</span>
              <span className="shrink-0 font-mono text-[12px]">-{formatCurrency(data.pointsDiscountAmount)}</span>
            </div>
          )}

          {data.claimDiscountAmount !== undefined && data.claimDiscountAmount > 0 && (
            <div className="flex justify-between items-center font-black">
              <span className="truncate pr-1">หักส่วนลดเคลม:</span>
              <span className="shrink-0 font-mono text-[12px]">-{formatCurrency(data.claimDiscountAmount)}</span>
            </div>
          )}

          {data.vatAmount > 0 && (
            <div className="flex justify-between items-center font-bold text-[10.5px]">
              <span>ภาษีมูลค่าเพิ่ม (รวมในบิล):</span>
              <span className="shrink-0 font-mono text-[11px]">{formatCurrency(data.vatAmount)}</span>
            </div>
          )}

          {/* ยอดรวมสุทธิ - ตัวหนาใหญ่พิเศษ สีดำสนิท พร้อมเส้นคู่ชัดเจน */}
          <div className="flex justify-between items-center text-[15px] font-black text-black pt-1.5 pb-1.5 border-t-2 border-b-2 border-black my-1.5">
            <span>ยอดรวมสุทธิ:</span>
            <span className="shrink-0 text-[17px] font-mono font-black">{formatCurrency(data.totalAmount)} ฿</span>
          </div>
        </div>

        {/* ─── 5. Claim Details Voucher Box (ถ้ามีส่วนลดเคลม) ─── */}
        {data.claimInfo && (
          <div className="py-1 border-2 border-black text-[11px] space-y-1 p-2 my-1 text-black font-bold">
            <div className="font-black flex justify-between items-center border-b border-black pb-0.5">
              <span>[ข้อมูลการเคลมสินค้า]</span>
              <span className="font-mono font-black">#{data.claimInfo.claimId}</span>
            </div>
            <div>• สินค้า: {data.claimInfo.productName} ({data.claimInfo.quantity} {data.claimInfo.unitName})</div>
            {data.claimInfo.defectReason && (
              <div>• อาการเสีย: {data.claimInfo.defectReason}</div>
            )}
            <div className="flex justify-between items-center font-black pt-0.5 border-t border-dashed border-black">
              <span>ส่วนลดเคลมที่นำมาหักในบิลนี้:</span>
              <span className="font-mono">-{formatCurrency(data.claimInfo.discountAmount)}</span>
            </div>
          </div>
        )}

        {/* ─── 6. Payment Info (วิธีชำระเงิน, รับเงินมา, เงินทอน) ─── */}
        <div className="space-y-1 text-[11.5px] pb-2 border-b-2 border-dashed border-black text-black font-bold">
          <div className="flex justify-between items-center font-black border-b border-black pb-1">
            <span className="shrink-0">ชำระโดย:</span>
            <span className="truncate text-right">{data.paymentMethod}</span>
          </div>

          {/* แจกแจงการแบ่งชำระ (Split Payment) */}
          {data.payments && data.payments.length > 0 && (
            <div className="space-y-0.5 pt-1 p-1 border-2 border-black my-1">
              {data.payments.map((p, pIdx) => {
                const methodName = 
                  p.method === 'CASH' ? 'เงินสด (Cash)' :
                  p.method === 'QR_PROMPTPAY' ? 'คิวอาร์ (PromptPay)' :
                  p.method === 'CREDIT_CARD' ? 'บัตรเครดิต' :
                  p.method === 'TRANSFER' ? 'โอนเงิน' : p.method;
                return (
                  <div key={pIdx} className="flex justify-between items-center text-black font-bold text-[11px]">
                    <span className="truncate pr-1">• {methodName}</span>
                    <span className="font-black shrink-0 font-mono">{formatCurrency(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {data.cashReceived !== undefined && data.cashReceived > 0 && (
            <div className="flex justify-between items-center font-bold pt-0.5">
              <span>รับเงินมา:</span>
              <span className="shrink-0 font-mono font-bold text-[12px]">{formatCurrency(data.cashReceived)}</span>
            </div>
          )}
          {data.changeAmount !== undefined && data.changeAmount > 0 && (
            <div className="flex justify-between items-center font-black text-[13.5px] pt-1">
              <span>เงินทอน:</span>
              <span className="shrink-0 font-mono font-black text-[15px]">{formatCurrency(data.changeAmount)}</span>
            </div>
          )}
        </div>

        {/* ─── 7. Member Loyalty Points Summary ─── */}
        {data.customerName && (data.customerPointsBalance !== undefined || data.customerPointsEarned !== undefined) && (
          <div className="flex items-center justify-between text-[11px] font-black border-2 border-black px-2 py-1 text-black my-1.5">
            <span>
              แต้มที่ได้: +{data.customerPointsEarned ?? 0}
              {data.pointsUsed !== undefined && data.pointsUsed > 0 && (
                <span className="font-bold"> (ใช้ {data.pointsUsed.toLocaleString()})</span>
              )}
            </span>
            <span>แต้มรวม: <b className="font-black font-mono">{(data.customerPointsBalance ?? 0).toLocaleString()}</b> แต้ม</span>
          </div>
        )}

        {/* ─── 8. Bill Note / Remarks (หมายเหตุท้ายบิล) ─── */}
        {data.note && (
          <div className="text-[11px] text-black border-2 border-black p-2 space-y-0.5 break-words text-left font-bold my-1.5">
            <span className="block font-black">[หมายเหตุ]</span>
            <p className="whitespace-pre-wrap leading-relaxed">{data.note}</p>
          </div>
        )}

        {/* ─── 9. Footer (ข้อความท้ายบิล) ─── */}
        {settings.receiptFooter ? (
          <div className="text-center pt-1 space-y-0.5 text-[10.5px] text-black font-bold font-sans">
            <p className="leading-tight whitespace-pre-wrap">
              {settings.receiptFooter}
            </p>
          </div>
        ) : null}

        <div className="text-center text-[12px] font-black text-black pt-1 tracking-wider border-t-2 border-black mt-2">
          *** ขอบคุณที่ใช้บริการ ***
        </div>
      </div>
    );
  }
);

ThermalReceiptView.displayName = 'ThermalReceiptView';

/**
 * Direct printing helper for Epson TM-T82 thermal receipt printer.
 * Renders the receipt off-screen and invokes printDocumentIframe cleanly.
 */
export function printThermalReceiptDirect(data: ReceiptData, settings: StoreSettings) {
  if (typeof window === 'undefined') return;

  const old = document.getElementById('direct-thermal-receipt-container');
  if (old) old.remove();

  const container = document.createElement('div');
  container.id = 'direct-thermal-receipt-container';
  container.style.position = 'fixed';
  container.style.left = '-9999px';
  container.style.top = '-9999px';
  container.style.width = '80mm';
  container.style.opacity = '0';
  container.style.pointerEvents = 'none';
  container.style.zIndex = '-9999';
  document.body.appendChild(container);

  const root = createRoot(container);
  root.render(<ThermalReceiptView data={data} settings={settings} />);

  setTimeout(() => {
    printDocumentIframe(container, `พิมพ์ใบเสร็จ - ${data.orderNumber}`, '80mm');
    setTimeout(() => {
      try {
        root.unmount();
        container.remove();
      } catch (e) {}
    }, 4000);
  }, 120);
}
