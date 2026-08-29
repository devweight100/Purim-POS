'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, ExternalLink, FileText, CheckCircle2, Store, Building2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';

export interface BankAccountBreakdownItem {
  accountLabel: string;
  amount: number;
}

export interface ShiftSummaryData {
  shiftId: string;
  userName: string;
  openedAt: string;
  closedAt: string;
  openingCash: number;
  cashSales: number;
  qrSales: number;
  cardSales: number;
  transferSales: number;
  creditSales?: number;
  totalSales: number;
  debtCollectionCount?: number;
  debtCollectionTotal?: number;
  debtCollectionCash?: number;
  debtCollectionQrTransfer?: number;
  cashIn: number;
  cashOut: number;
  cashRefunds?: number;
  claimRefundCount?: number;
  orderCount: number;
  voidCount: number;
  expectedCash: number;
  actualCash: number;
  billDiscountsTotal?: number;
  pointsDiscountsTotal?: number;
  bankAccountBreakdown?: BankAccountBreakdownItem[];
}

interface ShiftSummaryPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ShiftSummaryData | null;
}

export function ShiftSummaryPdfModal({ open, onOpenChange, data }: ShiftSummaryPdfModalProps) {
  const summaryRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  if (!data) return null;

  const diff = data.actualCash - data.expectedCash;

  const generatePdfBlob = async () => {
    if (!summaryRef.current) return null;
    try {
      const canvas = await html2canvas(summaryRef.current, {
        scale: 3, // High DPI for clear slip printing
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');

      const imgWidth = 80; // 80mm thermal paper width
      const pageHeight = (canvas.height * imgWidth) / canvas.width;

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [imgWidth, pageHeight],
      });

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, pageHeight);
      return pdf;
    } catch (err) {
      console.error('Failed to generate PDF shift summary:', err);
      toast.error('ไม่สามารถสร้างไฟล์ PDF สรุปกะได้');
      return null;
    }
  };

  const handleDownloadPdf = async () => {
    setIsGenerating(true);
    const pdf = await generatePdfBlob();
    if (pdf) {
      pdf.save(`Shift-Summary-${data.shiftId}.pdf`);
      toast.success(`ดาวน์โหลดไฟล์ PDF ใบสรุปกะ #${data.shiftId} เรียบร้อยแล้ว!`);
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
    if (!summaryRef.current) return;
    const printContent = summaryRef.current.innerHTML;
    const win = window.open('', '', 'width=400,height=750');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>พิมพ์ใบสรุปปิดกะ - Shift ${data.shiftId}</title>
            <style>
              body {
                font-family: 'Prompt', 'Sarabun', -apple-system, BlinkMacSystemFont, sans-serif;
                margin: 0;
                padding: 10px;
                background: #fff;
                color: #000;
                font-size: 11px;
              }
              @page {
                size: 80mm auto;
                margin: 0;
              }
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
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[94vh] flex flex-col bg-slate-100 border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="pb-2.5 border-b border-slate-200 shrink-0">
          <DialogTitle className="text-lg sm:text-xl font-bold flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-800">
              <FileText className="w-5 h-5 text-sky-600 shrink-0" />
              <span>ใบสรุปปิดกะ (Shift Summary PDF)</span>
            </div>
            <span className="text-xs font-mono text-slate-600 font-bold bg-slate-200 px-2.5 py-1 rounded-md">
              #{data.shiftId}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm shrink-0 my-1">
          <div className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="hidden sm:inline">สลิปสรุปปิดกะ 80mm Thermal Slip</span>
            <span className="sm:hidden">สลิป 80mm</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenPdfTab}
              disabled={isGenerating}
              className="border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold gap-1 rounded-xl h-10 px-2.5"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">เปิด PDF แท็บใหม่</span>
              <span className="sm:hidden">เปิด PDF</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadPdf}
              disabled={isGenerating}
              className="border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 text-xs font-bold gap-1 rounded-xl h-10 px-2.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>ดาวน์โหลด</span>
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              className="bg-sky-600 hover:bg-sky-700 text-white text-xs font-bold gap-1 rounded-xl h-10 px-3 shadow-md"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>พิมพ์สลิป</span>
            </Button>
          </div>
        </div>

        {/* Thermal Receipt Preview Container (Scrollable with comfortable height) */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-3 sm:p-4 flex justify-center bg-slate-300/60 rounded-2xl border border-slate-300/80 min-h-[420px] max-h-[72vh]">
          <div
            ref={summaryRef}
            className="w-[80mm] max-w-[80mm] bg-white text-slate-900 px-4 py-5 shadow-2xl font-mono text-[10.5px] leading-snug rounded-sm space-y-2.5 overflow-hidden box-border h-fit"
            style={{ width: '80mm', maxWidth: '80mm', boxSizing: 'border-box' }}
          >
            {/* Store Header */}
            <div className="text-center space-y-0.5 pb-2 border-b border-dashed border-slate-400">
              <div className="flex items-center justify-center gap-1.5 font-bold text-sm font-sans text-slate-900">
                <Store className="w-4 h-4 text-sky-600 shrink-0" />
                <span className="truncate">ร้านปุริม (PURIM POS)</span>
              </div>
              <p className="text-[9px] text-slate-600 leading-tight break-words">
                123/45 ถนนสุขุมวิท กรุงเทพฯ 10110 โทร: 081-234-5678
              </p>
              <div className="pt-0.5">
                <span className="text-[11px] font-black border border-slate-900 px-2.5 py-0.5 rounded font-sans inline-block text-slate-900">
                  ใบสรุปปิดกะการขาย
                </span>
              </div>
            </div>

            {/* Shift Meta */}
            <div className="text-[10px] space-y-0.5 pb-1.5 border-b border-dashed border-slate-400">
              <div className="flex justify-between items-center gap-1">
                <span className="text-slate-600 shrink-0">รหัสกะ:</span>
                <span className="font-bold truncate text-right font-mono">#{data.shiftId}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="text-slate-600 shrink-0">พนักงานขาย:</span>
                <span className="font-bold text-slate-900 truncate text-right">{data.userName}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="text-slate-600 shrink-0">เปิดกะ:</span>
                <span className="truncate text-right">{new Date(data.openedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="text-slate-600 shrink-0">ปิดกะ:</span>
                <span className="truncate text-right">{new Date(data.closedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
            </div>

            {/* Sales Breakdown */}
            <div className="space-y-0.5 text-[10px] pb-1.5 border-b border-dashed border-slate-400">
              <div className="font-bold text-slate-900 border-b border-slate-200 pb-0.5 font-sans">
                📊 ยอดขายแยกตามช่องทาง
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 truncate pr-1">• เงินสด (Cash):</span>
                <span className="shrink-0">{formatCurrency(data.cashSales)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 truncate pr-1">• QR (พร้อมเพย์):</span>
                <span className="shrink-0">{formatCurrency(data.qrSales)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600 truncate pr-1">• โอนเงิน (Transfer):</span>
                <span className="shrink-0">{formatCurrency(data.transferSales)}</span>
              </div>

              {/* Itemized Bank Account Breakdown for QR & Transfer */}
              {data.bankAccountBreakdown && data.bankAccountBreakdown.length > 0 && (
                <div className="my-0.5 p-1.5 bg-slate-50 border border-slate-200 rounded space-y-0.5 font-sans">
                  <div className="text-[9px] font-bold text-slate-800 border-b border-slate-200 pb-0.5 flex items-center gap-1">
                    <Building2 className="w-3 h-3 text-sky-600 shrink-0" />
                    <span>แยกตามบัญชีธนาคาร:</span>
                  </div>
                  {data.bankAccountBreakdown.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-[9.5px] text-slate-800 font-semibold pl-1">
                      <span className="truncate pr-1 max-w-[155px]" title={item.accountLabel}>• {item.accountLabel}:</span>
                      <span className="font-bold text-sky-700 shrink-0">{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center">
                <span className="text-slate-600 truncate pr-1">• บัตรเครดิต:</span>
                <span className="shrink-0">{formatCurrency(data.cardSales)}</span>
              </div>
              <div className="flex justify-between items-center text-indigo-700 font-semibold">
                <span className="truncate pr-1">• เงินเชื่อ (Credit / ลูกหนี้):</span>
                <span className="font-bold shrink-0">{formatCurrency(data.creditSales || 0)}</span>
              </div>
              <div className="flex justify-between items-center text-[12px] font-black text-slate-900 pt-1 border-t border-slate-300">
                <span>รวมยอดขายสุทธิ:</span>
                <span className="text-sky-700 shrink-0">{formatCurrency(data.totalSales)}</span>
              </div>
            </div>

            {/* Debt Collections (การรับชำระหนี้ / เงินเชื่อประจำกะ) */}
            <div className="space-y-0.5 text-[10px] pb-1.5 border-b border-dashed border-slate-400">
              <div className="font-bold text-slate-900 border-b border-slate-200 pb-0.5 font-sans flex items-center justify-between">
                <span>💳 รับชำระหนี้ / เงินเชื่อประจำกะ</span>
                <span className="font-bold text-emerald-700 font-mono text-[10.5px]">
                  {(data.debtCollectionCount || 0)} บิล
                </span>
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span className="truncate pr-1">• จำนวนบิลที่รับชำระ:</span>
                <span className="font-bold text-slate-900 shrink-0">{(data.debtCollectionCount || 0)} บิล</span>
              </div>
              <div className="flex justify-between items-center text-emerald-700">
                <span className="truncate pr-1">• ยอดรับชำระเงินสด:</span>
                <span className="font-bold shrink-0">{formatCurrency(data.debtCollectionCash || 0)}</span>
              </div>
              <div className="flex justify-between items-center text-sky-700">
                <span className="truncate pr-1">• ยอดรับชำระ QR / โอน:</span>
                <span className="font-bold shrink-0">{formatCurrency(data.debtCollectionQrTransfer || 0)}</span>
              </div>
              <div className="flex justify-between items-center font-extrabold text-slate-900 pt-0.5 border-t border-slate-200">
                <span>รวมยอดรับชำระหนี้ทั้งสิ้น:</span>
                <span className="text-emerald-700 shrink-0 font-bold">
                  {formatCurrency(data.debtCollectionTotal || 0)}
                </span>
              </div>
            </div>

            {/* Discounts Breakdown (สรุปส่วนลดประจำกะ) */}
            <div className="space-y-0.5 text-[10px] pb-1.5 border-b border-dashed border-slate-400">
              <div className="font-bold text-slate-900 border-b border-slate-200 pb-0.5 font-sans">
                🔖 สรุปส่วนลดประจำกะ
              </div>
              <div className="flex justify-between items-center text-rose-700">
                <span className="truncate pr-1">• ส่วนลดการค้า / ท้ายบิล:</span>
                <span className="font-bold shrink-0">{formatCurrency(data.billDiscountsTotal || 0)}</span>
              </div>
              <div className="flex justify-between items-center text-amber-800">
                <span className="truncate pr-1">• ส่วนลดแต้มสะสมสมาชิก:</span>
                <span className="font-bold shrink-0">{formatCurrency(data.pointsDiscountsTotal || 0)}</span>
              </div>
              <div className="flex justify-between items-center font-extrabold text-slate-900 pt-0.5 border-t border-slate-200">
                <span>รวมส่วนลดทั้งหมด:</span>
                <span className="text-rose-600 shrink-0">
                  {formatCurrency((data.billDiscountsTotal || 0) + (data.pointsDiscountsTotal || 0))}
                </span>
              </div>
            </div>

            {/* Shift Stats */}
            <div className="space-y-0.5 text-[10px] pb-1.5 border-b border-dashed border-slate-400">
              <div className="font-bold text-slate-900 border-b border-slate-200 pb-0.5 font-sans">
                📈 สถิติกะการขาย
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">ออเดอร์สำเร็จ:</span>
                <span className="font-bold text-emerald-700 shrink-0">{data.orderCount} บิล</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">ออเดอร์ยกเลิก (Void):</span>
                <span className="font-bold text-rose-600 shrink-0">{data.voidCount} บิล</span>
              </div>
            </div>

            {/* Cash Drawer Reconciliation (กระทบยอดเงินสดในลิ้นชัก) */}
            <div className="space-y-1 text-[10px] pb-2 border-b border-dashed border-slate-400">
              <div className="font-bold text-slate-900 border-b border-slate-200 pb-0.5 font-sans flex items-center justify-between">
                <span>💵 กระทบยอดเงินสดในลิ้นชัก</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-slate-600">เงินสดตั้งต้น (เปิดกะ):</span>
                <span className="shrink-0 font-bold text-slate-800">{formatCurrency(data.openingCash)}</span>
              </div>
              <div className="flex justify-between items-center text-emerald-700 font-semibold">
                <span>(+) ยอดขายเงินสด:</span>
                <span className="shrink-0">+{formatCurrency(data.cashSales)}</span>
              </div>
              <div className="flex justify-between items-center text-emerald-700">
                <span>(+) เงินเข้าลิ้นชัก (Cash In):</span>
                <span className="shrink-0">+{formatCurrency(data.cashIn)}</span>
              </div>
              <div className="flex justify-between items-center text-rose-600">
                <span>(-) เงินออกลิ้นชัก (Cash Out):</span>
                <span className="shrink-0">-{formatCurrency(data.cashOut)}</span>
              </div>
              {data.cashRefunds !== undefined && data.cashRefunds > 0 && (
                <div className="flex justify-between items-center text-rose-600 font-semibold">
                  <span>(-) คืนเงินสดเคลม ({data.claimRefundCount || 1} ครั้ง):</span>
                  <span className="shrink-0">-{formatCurrency(data.cashRefunds)}</span>
                </div>
              )}
              
              <div className="flex justify-between items-center font-bold text-slate-900 pt-1 border-t border-slate-200">
                <span>เงินสดที่ควรมีในลิ้นชัก:</span>
                <span className="shrink-0 text-[11px] text-slate-900">{formatCurrency(data.expectedCash)}</span>
              </div>
              <div className="flex justify-between items-center font-black text-slate-900">
                <span>เงินสดที่นับได้จริง:</span>
                <span className="text-sky-700 shrink-0 text-[11px]">{formatCurrency(data.actualCash)}</span>
              </div>

              {/* Prominent Cash Reconciliation Result Box */}
              <div className={`flex justify-between items-center font-black text-[11px] p-2 rounded-md mt-1 border ${
                diff === 0 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300 shadow-xs' 
                  : diff > 0 
                  ? 'bg-sky-50 text-sky-800 border-sky-300 shadow-xs' 
                  : 'bg-rose-50 text-rose-800 border-rose-300 shadow-xs'
              }`}>
                <span>ผลการกระทบยอด:</span>
                <span className="font-extrabold text-[11.5px] font-sans">
                  {diff === 0 
                    ? '✅ เงินสดครบพอดี (฿0.00)' 
                    : diff > 0 
                    ? `🔵 เงินสดเกิน (+${formatCurrency(diff)})` 
                    : `🔴 เงินสดขาด (-${formatCurrency(Math.abs(diff))})`}
                </span>
              </div>
            </div>

            {/* Footer Signatures */}
            <div className="pt-1.5 space-y-2 text-[9px] text-slate-600">
              <div className="flex justify-between items-center">
                <span>ลงชื่อพนักงาน:</span>
                <span>.................................</span>
              </div>
              <div className="flex justify-between items-center">
                <span>ลงชื่อผู้ตรวจ:</span>
                <span>.................................</span>
              </div>
              <div className="text-center text-[8.5px] text-slate-400 pt-1 border-t border-slate-200">
                พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}
              </div>
            </div>

          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
