'use client';

import React from 'react';
import { Store } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { StoreSettings } from '@/lib/store-settings-storage';

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
    itemNote?: string;
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
        className={`w-[80mm] max-w-[80mm] min-h-[130mm] bg-white text-slate-900 px-3.5 py-4 shadow-xl font-mono text-[11px] leading-snug rounded-sm space-y-2.5 overflow-hidden box-border select-none ${className}`}
        style={{ width: '80mm', maxWidth: '80mm', boxSizing: 'border-box' }}
      >
        {/* Header */}
        <div className="text-center space-y-0.5 pb-2.5 border-b border-dashed border-slate-400">
          <div className="flex items-center justify-center gap-1.5 font-bold text-sm font-sans text-slate-900">
            <Store className="w-4 h-4 text-sky-600 shrink-0" />
            <span className="truncate">{settings.storeName || 'ร้านปุริม (PURIM POS)'}</span>
          </div>

          {settings.branchName && (
            <p className="text-[9.5px] text-slate-600 font-sans">
              สาขา: {settings.branchName}
            </p>
          )}

          {settings.taxId && (
            <p className="text-[9.5px] text-slate-600 font-mono">
              เลขประจำตัวผู้เสียภาษี: {settings.taxId}
            </p>
          )}

          <p className="text-[9.5px] text-slate-600 leading-tight break-words font-sans whitespace-pre-wrap">
            {settings.storeAddress || '123/45 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110'}
          </p>

          {settings.storePhone && (
            <p className="text-[9.5px] text-slate-600 font-mono">
              โทร: {settings.storePhone}
            </p>
          )}

          {settings.storeEmail && (
            <p className="text-[9px] text-slate-500 font-sans">
              {settings.storeEmail}
            </p>
          )}

          {/* Custom Receipt Header Slogan */}
          {settings.receiptHeader && (
            <div className="pt-1 pb-0.5">
              <p className="text-[9.5px] text-slate-800 font-sans font-medium whitespace-pre-wrap leading-tight">
                {settings.receiptHeader}
              </p>
            </div>
          )}

          <div className="pt-0.5">
            <span className="text-[11px] font-black border border-slate-900 px-2.5 py-0.5 rounded font-sans inline-block text-slate-900">
              ใบเสร็จรับเงิน
            </span>
          </div>
        </div>

        {/* Meta Details */}
        <div className="text-[10.5px] space-y-0.5 pb-2 border-b border-dashed border-slate-400">
          <div className="flex justify-between items-center gap-1">
            <span className="text-slate-600 shrink-0">เลขที่บิล:</span>
            <span className="font-bold truncate text-right font-mono">{data.orderNumber}</span>
          </div>
          <div className="flex justify-between items-center gap-1">
            <span className="text-slate-600 shrink-0">วันที่:</span>
            <span className="truncate text-right">{new Date(data.createdAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'medium' })}</span>
          </div>
          <div className="flex justify-between items-center gap-1">
            <span className="text-slate-600 shrink-0">พนักงานขาย:</span>
            <span className="truncate text-right">{data.userName || 'พนักงาน POS'}</span>
          </div>
          <div className="flex justify-between items-center gap-1">
            <span className="text-slate-600 shrink-0">ลูกค้า:</span>
            <span className="font-bold text-slate-900 truncate text-right max-w-[170px]">{data.customerName || 'ลูกค้าทั่วไป (Walk-in)'}</span>
          </div>
        </div>

        {/* Items Table */}
        <div className="space-y-1.5 py-1 border-b border-dashed border-slate-400">
          <div className="flex justify-between text-[10.5px] font-bold border-b border-slate-200 pb-1">
            <span className="w-1/2">รายการ</span>
            <span className="w-1/6 text-center">จำนวน</span>
            <span className="w-1/3 text-right">รวม (฿)</span>
          </div>

          {data.items.map((item, idx) => (
            <div key={idx} className="text-[10.5px] space-y-0.5">
              <div className="font-bold text-slate-900 leading-tight break-words">
                {idx + 1}. {item.name}
              </div>
              <div className="flex justify-between items-center text-slate-600 text-[9.5px] pl-2.5">
                <span className="truncate pr-1">{item.quantity} {item.unitName} x {formatCurrency(item.unitPrice)}</span>
                <span className="font-bold text-slate-900 shrink-0">{formatCurrency(item.lineTotal)}</span>
              </div>
              {item.itemNote && (
                <div className="text-[9px] text-slate-400 italic pl-2.5 pt-0.5 break-words">
                  📝 โน้ต: {item.itemNote}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Totals Summary */}
        <div className="space-y-1 text-[10.5px] pt-1 pb-2 border-b border-dashed border-slate-400">
          <div className="flex justify-between items-center">
            <span className="text-slate-600">รวมเงิน:</span>
            <span className="shrink-0">{formatCurrency(data.subtotal)}</span>
          </div>
          {data.billDiscountAmount > 0 && (
            <div className="flex justify-between items-center text-red-600 font-semibold">
              <span className="truncate pr-1">ส่วนลดท้ายบิล:</span>
              <span className="shrink-0">-{formatCurrency(data.billDiscountAmount)}</span>
            </div>
          )}
          {data.pointsDiscountAmount !== undefined && data.pointsDiscountAmount > 0 && (
            <div className="flex justify-between items-center text-amber-800 font-bold">
              <span className="truncate pr-1">ส่วนลดใช้แต้ม ({data.pointsUsed?.toLocaleString() || 0} แต้ม):</span>
              <span className="shrink-0">-{formatCurrency(data.pointsDiscountAmount)}</span>
            </div>
          )}
          {data.claimDiscountAmount !== undefined && data.claimDiscountAmount > 0 && (
            <div className="flex justify-between items-center text-emerald-700 font-bold">
              <span className="truncate pr-1">หักส่วนลดเคลมสินค้า:</span>
              <span className="shrink-0">-{formatCurrency(data.claimDiscountAmount)}</span>
            </div>
          )}
          <div className="flex justify-between items-center text-[13px] font-black text-slate-900 pt-1 border-t border-slate-300">
            <span>ยอดรวมสุทธิ:</span>
            <span className="text-sky-700 shrink-0">{formatCurrency(data.totalAmount)}</span>
          </div>
        </div>

        {/* Claim Details Voucher Box (Combined with receipt) */}
        {data.claimInfo && (
          <div className="py-2 border-b border-dashed border-slate-400 text-[10px] space-y-1 bg-slate-50 p-2 rounded">
            <div className="font-extrabold text-slate-900 flex justify-between items-center">
              <span>🛡️ ข้อมูลการเคลมสินค้า:</span>
              <span className="font-mono text-indigo-700 font-bold">#{data.claimInfo.claimId}</span>
            </div>
            <div className="text-slate-700">
              • สินค้าที่เคลม: <b className="text-slate-900">{data.claimInfo.productName}</b> ({data.claimInfo.quantity} {data.claimInfo.unitName})
            </div>
            {data.claimInfo.defectReason && (
              <div className="text-slate-600">
                • อาการเสีย: {data.claimInfo.defectReason}
              </div>
            )}
            <div className="flex justify-between items-center font-bold text-emerald-800 pt-1 border-t border-slate-200">
              <span>ส่วนลดเคลมที่นำมาหักในบิลนี้:</span>
              <span>-{formatCurrency(data.claimInfo.discountAmount)}</span>
            </div>
          </div>
        )}

        {/* Payment Info */}
        <div className="space-y-0.5 text-[10.5px] pb-2 border-b border-dashed border-slate-400">
          <div className="flex justify-between items-center font-bold text-slate-900 border-b border-slate-200 pb-0.5">
            <span className="shrink-0">ชำระโดย:</span>
            <span className="truncate text-right">{data.paymentMethod}</span>
          </div>

          {/* Itemized Payment Breakdown (Split Payment) */}
          {data.payments && data.payments.length > 0 && (
            <div className="space-y-0.5 pt-0.5 bg-slate-50 p-1.5 rounded border border-slate-200">
              {data.payments.map((p, pIdx) => {
                const methodName = 
                  p.method === 'CASH' ? 'เงินสด (Cash)' :
                  p.method === 'QR_PROMPTPAY' ? 'คิวอาร์ / พร้อมเพย์ (PromptPay)' :
                  p.method === 'CREDIT_CARD' ? 'บัตรเครดิต' :
                  p.method === 'TRANSFER' ? 'โอนเงิน' : p.method;
                return (
                  <div key={pIdx} className="flex justify-between items-center text-slate-800 font-semibold text-[10px]">
                    <span className="truncate pr-1">• {methodName}</span>
                    <span className="font-extrabold text-slate-900 shrink-0">{formatCurrency(p.amount)}</span>
                  </div>
                );
              })}
            </div>
          )}

          {data.cashReceived !== undefined && data.cashReceived > 0 && (
            <div className="flex justify-between items-center text-slate-600 pt-0.5">
              <span>รับเงินมา:</span>
              <span className="shrink-0">{formatCurrency(data.cashReceived)}</span>
            </div>
          )}
          {data.changeAmount !== undefined && data.changeAmount > 0 && (
            <div className="flex justify-between items-center font-bold text-emerald-700">
              <span>เงินทอน:</span>
              <span className="shrink-0">{formatCurrency(data.changeAmount)}</span>
            </div>
          )}
        </div>

        {/* Member Loyalty Points Summary (1 Line Compact) */}
        {data.customerName && (data.customerPointsBalance !== undefined || data.customerPointsEarned !== undefined) && (
          <div className="flex items-center justify-between text-[10px] font-bold bg-slate-50 px-2 py-1 rounded border border-slate-300 text-slate-800">
            <span className="flex items-center gap-1">
              <span>🪙 ได้แต้ม:</span>
              <b className="text-emerald-700 font-extrabold">+{data.customerPointsEarned ?? 0}</b>
              {data.pointsUsed !== undefined && data.pointsUsed > 0 && (
                <span className="text-rose-600 font-normal text-[9px]">(ใช้ {data.pointsUsed.toLocaleString()})</span>
              )}
            </span>
            <span>แต้มรวม: <b className="text-slate-950 font-black">{(data.customerPointsBalance ?? 0).toLocaleString()}</b> แต้ม</span>
          </div>
        )}

        {/* Bill Note / Remarks (หมายเหตุท้ายบิล) */}
        {data.note && (
          <div className="text-[10px] text-slate-800 bg-slate-50 p-2 rounded border border-slate-300 space-y-0.5 break-words text-left">
            <span className="font-bold text-slate-900 block text-[10px]">📌 หมายเหตุ:</span>
            <p className="text-slate-700 whitespace-pre-wrap leading-relaxed">{data.note}</p>
          </div>
        )}

        {/* Footer */}
        <div className="text-center pt-1 space-y-1 text-[9.5px] text-slate-700 font-sans">
          {settings.receiptFooter ? (
            <p className="font-medium leading-relaxed whitespace-pre-wrap">
              {settings.receiptFooter}
            </p>
          ) : (
            <>
              <p className="font-medium text-[8.5px] leading-tight text-slate-700 break-words">
                * สินค้ารับเปลี่ยนเฉพาะชำรุดภายใน 7 วันพร้อมใบเสร็จ *
              </p>
              <p className="font-bold text-slate-900 pt-0.5">🙏 ขอบคุณที่อุดหนุน ร้านปุริม 🙏</p>
            </>
          )}
        </div>
      </div>
    );
  }
);

ThermalReceiptView.displayName = 'ThermalReceiptView';
