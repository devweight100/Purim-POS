'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, ExternalLink, FileText, CheckCircle2, Store } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';

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

interface ReceiptPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ReceiptData | null;
}

export function ReceiptPdfModal({ open, onOpenChange, data }: ReceiptPdfModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const storeSettings = loadStoreSettings();

  if (!data) return null;

  const generatePdfBlob = async () => {
    if (!receiptRef.current) return null;
    try {
      const canvas = await html2canvas(receiptRef.current, {
        scale: 3, // High DPI resolution for crisp printing
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');

      const imgWidth = 80; // 80mm standard receipt width
      const pageHeight = (canvas.height * imgWidth) / canvas.width;

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [imgWidth, pageHeight + 5],
      });

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, pageHeight);
      return pdf;
    } catch (err) {
      console.error('Failed to generate PDF:', err);
      toast.error('ไม่สามารถสร้างไฟล์ PDF ได้');
      return null;
    }
  };

  const handleDownloadPdf = async () => {
    setIsGenerating(true);
    const pdf = await generatePdfBlob();
    if (pdf) {
      pdf.save(`Receipt-${data.orderNumber}.pdf`);
      toast.success(`ดาวน์โหลดไฟล์ PDF ใบเสร็จ ${data.orderNumber} เรียบร้อยแล้ว!`);
    }
    setIsGenerating(false);
  };

  const handleOpenPdfTab = async () => {
    setIsGenerating(true);
    const pdf = await generatePdfBlob();
    if (pdf) {
      const blobUrl = pdf.output('bloburl');
      window.open(blobUrl, '_blank');
    }
    setIsGenerating(false);
  };

  const handlePrint = () => {
    if (!receiptRef.current) return;
    const printContent = receiptRef.current.innerHTML;
    const win = window.open('', '', 'width=400,height=700');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>พิมพ์ใบเสร็จ - ${data.orderNumber}</title>
            <style>
              body {
                font-family: 'Prompt', 'Sarabun', -apple-system, BlinkMacSystemFont, sans-serif;
                margin: 0;
                padding: 10px;
                background: #fff;
                color: #000;
                font-size: 12px;
              }
              @page {
                size: 80mm auto;
                margin: 0;
              }
              .no-print { display: none; }
            </style>
          </head>
          <body>
            ${printContent}
            <script>
              window.onload = function() {
                window.print();
                window.close();
              };
            </script>
          </body>
        </html>
      `);
      win.document.close();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] flex flex-col bg-slate-100 border-slate-200 text-slate-900 rounded-3xl p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-bold flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-800">
              <FileText className="w-6 h-6 text-sky-600" />
              <span>ตัวอย่างใบเสร็จรับเงิน (PDF Receipt)</span>
            </div>
            <span className="text-xs font-mono text-slate-500 font-normal bg-slate-200 px-2.5 py-1 rounded-md">
              {data.orderNumber}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm shrink-0 my-2">
          <div className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            <span>สร้างไฟล์ PDF 80mm Thermal Receipt อัตโนมัติ</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenPdfTab}
              disabled={isGenerating}
              className="border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold gap-1.5 rounded-xl h-9"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              เปิด PDF ในแท็บใหม่
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isGenerating}
              className="border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 text-xs font-bold gap-1.5 rounded-xl h-9"
            >
              <Download className="w-3.5 h-3.5" />
              ดาวน์โหลด PDF
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold gap-1.5 rounded-xl h-9 shadow-md"
            >
              <Printer className="w-3.5 h-3.5" />
              พิมพ์ใบเสร็จ (Print)
            </Button>
          </div>
        </div>

        {/* Live Thermal Slip Receipt Scrollable Container */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 flex justify-center bg-slate-200/70 rounded-2xl">
          <div
            ref={receiptRef}
            className="w-[80mm] max-w-[80mm] min-h-[130mm] bg-white text-slate-900 px-3.5 py-4 shadow-xl font-mono text-[11px] leading-snug rounded-sm space-y-2.5 overflow-hidden box-border"
            style={{ width: '80mm', maxWidth: '80mm', boxSizing: 'border-box' }}
          >
            {/* Header */}
            <div className="text-center space-y-0.5 pb-2.5 border-b border-dashed border-slate-400">
              <div className="flex items-center justify-center gap-1.5 font-bold text-sm font-sans text-slate-900">
                <Store className="w-4 h-4 text-sky-600 shrink-0" />
                <span className="truncate">{storeSettings.storeName || 'ร้านปุริม (PURIM POS)'}</span>
              </div>
              {storeSettings.branchName && (
                <p className="text-[9.5px] text-slate-600 font-sans">
                  สาขา: {storeSettings.branchName}
                </p>
              )}
              {storeSettings.taxId && (
                <p className="text-[9.5px] text-slate-600 font-mono">
                  เลขประจำตัวผู้เสียภาษี: {storeSettings.taxId}
                </p>
              )}
              <p className="text-[9.5px] text-slate-600 leading-tight break-words font-sans">
                {storeSettings.storeAddress || '123/45 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110'}<br />
                {storeSettings.storePhone ? `โทร: ${storeSettings.storePhone}` : ''}
              </p>

              {/* Custom Receipt Header Slogan */}
              {storeSettings.receiptHeader && (
                <div className="pt-1 pb-0.5">
                  <p className="text-[9.5px] text-slate-700 font-sans whitespace-pre-wrap leading-tight">
                    {storeSettings.receiptHeader}
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
              {storeSettings.receiptFooter ? (
                <p className="font-medium leading-relaxed whitespace-pre-wrap">
                  {storeSettings.receiptFooter}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
