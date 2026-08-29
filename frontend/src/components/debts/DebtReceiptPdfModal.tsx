'use client';

import { useRef, useState } from 'react';
import { DebtRecord, DebtPaymentInstallment } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileText, Printer, Download, ExternalLink, CheckCircle2, Store, User, Building2, CreditCard } from 'lucide-react';
import { toast } from 'sonner';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';

interface DebtReceiptPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  debtRecord: DebtRecord | null;
  installment: DebtPaymentInstallment | null;
}

export function DebtReceiptPdfModal({ open, onOpenChange, debtRecord, installment }: DebtReceiptPdfModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  if (!debtRecord || !installment) return null;

  const progressAfter = debtRecord.totalAmount > 0 
    ? Math.min(100, Math.round(((installment.previousPaid + installment.amountPaid) / debtRecord.totalAmount) * 100))
    : 100;

  const generatePdfBlob = async () => {
    if (!receiptRef.current) return null;
    try {
      const canvas = await html2canvas(receiptRef.current, {
        scale: 3,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');

      const imgWidth = 80;
      const pageHeight = (canvas.height * imgWidth) / canvas.width;

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [imgWidth, pageHeight],
      });

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, pageHeight);
      return pdf;
    } catch (err) {
      console.error('Failed to generate PDF debt receipt:', err);
      toast.error('ไม่สามารถสร้างไฟล์ PDF ใบเสร็จรับชำระได้');
      return null;
    }
  };

  const handleDownloadPdf = async () => {
    setIsGenerating(true);
    const pdf = await generatePdfBlob();
    if (pdf) {
      pdf.save(`DebtReceipt-${debtRecord.orderNumber}-Inst${installment.installmentNo}.pdf`);
      toast.success(`ดาวน์โหลดไฟล์ PDF ใบเสร็จรับเงิน #${debtRecord.orderNumber} เรียบร้อยแล้ว!`);
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
    const win = window.open('', '', 'width=400,height=750');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>ใบเสร็จรับชำระหนี้ - ${debtRecord.orderNumber}</title>
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

  const getMethodLabel = (method: string) => {
    switch (method) {
      case 'CASH': return '💵 เงินสด (Cash)';
      case 'QR_PROMPTPAY': return '📱 QR PromptPay';
      case 'TRANSFER': return '🏦 โอนเงินผ่านธนาคาร';
      case 'CREDIT_CARD': return '💳 บัตรเครดิต';
      default: return method;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[94vh] flex flex-col bg-slate-100 border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="pb-2.5 border-b border-slate-200 shrink-0">
          <DialogTitle className="text-lg sm:text-xl font-bold flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-800">
              <FileText className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>ใบเสร็จรับเงินชำระหนี้ (Debt Payment Receipt)</span>
            </div>
            <span className="text-xs font-mono text-emerald-700 font-bold bg-emerald-100 border border-emerald-300 px-2.5 py-1 rounded-md">
              งวดที่ {installment.installmentNo}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-2.5 rounded-2xl border border-slate-200 shadow-sm shrink-0 my-1">
          <div className="text-xs text-slate-600 font-medium flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span className="hidden sm:inline">สลิปรับชำระ 80mm Thermal Receipt อัตโนมัติ</span>
            <span className="sm:hidden">สลิป 80mm</span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenPdfTab}
              disabled={isGenerating}
              className="border-slate-300 hover:bg-slate-100 text-slate-700 text-xs font-bold gap-1 rounded-xl h-9 px-2.5"
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
              className="border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100 text-xs font-bold gap-1 rounded-xl h-9 px-2.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>ดาวน์โหลด</span>
            </Button>
            <Button
              size="sm"
              onClick={handlePrint}
              className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold gap-1 rounded-xl h-9 px-3 shadow-md"
            >
              <Printer className="w-3.5 h-3.5" />
              <span>พิมพ์สลิป</span>
            </Button>
          </div>
        </div>

        {/* Thermal Receipt Preview Container (Symmetrical Equal Top-Bottom Padding) */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-3 sm:p-4 flex justify-center bg-slate-300/60 rounded-2xl border border-slate-300/80 min-h-[420px] max-h-[72vh]">
          <div
            ref={receiptRef}
            className="w-[80mm] max-w-[80mm] bg-white text-slate-900 px-4 py-5 shadow-2xl font-mono text-[10.5px] leading-snug rounded-sm space-y-2.5 overflow-hidden box-border h-fit"
            style={{ width: '80mm', maxWidth: '80mm', boxSizing: 'border-box' }}
          >
            {/* Store Header */}
            <div className="text-center space-y-0.5 pb-2 border-b border-dashed border-slate-400">
              <div className="flex items-center justify-center gap-1.5 font-bold text-sm font-sans text-slate-900">
                <Store className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="truncate">ร้านปุริม (PURIM POS)</span>
              </div>
              <p className="text-[9px] text-slate-600 leading-tight break-words">
                123/45 ถนนสุขุมวิท กรุงเทพฯ 10110 โทร: 081-234-5678
              </p>
              <div className="pt-0.5">
                <span className="text-[11px] font-black border border-slate-900 px-2.5 py-0.5 rounded font-sans inline-block text-slate-900 bg-slate-50">
                  ใบเสร็จรับเงินชำระหนี้ / ชำระเงินเชื่อ
                </span>
              </div>
            </div>

            {/* Receipt Meta & Customer Info */}
            <div className="text-[10px] space-y-0.5 pb-1.5 border-b border-dashed border-slate-400">
              <div className="flex justify-between items-center gap-1">
                <span className="text-slate-600 shrink-0">เลขที่บิลอ้างอิง:</span>
                <span className="font-bold truncate text-right font-mono text-slate-900">{debtRecord.orderNumber}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="text-slate-600 shrink-0">วันที่ซื้อเดิม:</span>
                <span className="truncate text-right">{new Date(debtRecord.orderDate).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="text-slate-600 shrink-0">วันที่รับชำระ:</span>
                <span className="font-bold text-emerald-700 truncate text-right">{new Date(installment.paymentDate).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div className="flex justify-between items-center gap-1 pt-1 border-t border-slate-100">
                <span className="text-slate-600 shrink-0 flex items-center gap-1">
                  {debtRecord.customerType === 'COMPANY' ? <Building2 className="w-3 h-3 text-indigo-600" /> : <User className="w-3 h-3 text-sky-600" />}
                  ลูกค้า:
                </span>
                <span className="font-bold text-slate-900 truncate text-right">{debtRecord.customerName}</span>
              </div>
              {debtRecord.companyName && (
                <div className="flex justify-between items-center gap-1 text-[9px] text-slate-600">
                  <span className="shrink-0">บริษัท:</span>
                  <span className="truncate text-right">{debtRecord.companyName}</span>
                </div>
              )}
              {debtRecord.taxId && (
                <div className="flex justify-between items-center gap-1 text-[9px] text-slate-600">
                  <span className="shrink-0">เลขผู้เสียภาษี:</span>
                  <span className="font-mono text-right">{debtRecord.taxId}</span>
                </div>
              )}
              {debtRecord.customerPhone && (
                <div className="flex justify-between items-center gap-1 text-[9px] text-slate-600">
                  <span className="shrink-0">โทร:</span>
                  <span className="text-right">{debtRecord.customerPhone}</span>
                </div>
              )}
            </div>

            {/* Payment Settlement Breakdown */}
            <div className="space-y-1 text-[10px] pb-2 border-b border-dashed border-slate-400">
              <div className="font-bold text-slate-900 border-b border-slate-200 pb-0.5 font-sans flex items-center justify-between">
                <span>📑 รายละเอียดการชำระเงิน</span>
                <span className="text-[9.5px] text-slate-500 font-normal">งวดที่ {installment.installmentNo}</span>
              </div>

              <div className="flex justify-between items-center">
                <span className="text-slate-600 truncate pr-1">• ยอดเต็มตามบิล:</span>
                <span className="shrink-0 font-bold text-slate-900">{formatCurrency(debtRecord.totalAmount)}</span>
              </div>
              <div className="flex justify-between items-center text-slate-600">
                <span className="truncate pr-1">• ยอดที่เคยชำระแล้ว:</span>
                <span className="shrink-0">{formatCurrency(installment.previousPaid)}</span>
              </div>

              {/* Amount Paid This Time */}
              <div className="flex justify-between items-center text-emerald-800 font-bold bg-emerald-50/80 p-1.5 rounded-lg border border-emerald-200 my-1">
                <span className="truncate pr-1 font-sans">💳 ยอดที่ชำระในครั้งนี้:</span>
                <span className="shrink-0 text-[12px] font-black text-emerald-700">
                  +{formatCurrency(installment.amountPaid)}
                </span>
              </div>

              <div className="flex justify-between items-center text-[9.5px] text-slate-600 pl-1">
                <span className="truncate pr-1">• ช่องทางชำระ:</span>
                <span className="font-bold text-slate-800 shrink-0">{getMethodLabel(installment.paymentMethod)}</span>
              </div>

              {installment.accountLabel && (
                <div className="flex justify-between items-center text-[9px] text-slate-600 pl-1">
                  <span className="truncate pr-1">• บัญชีรับเงิน:</span>
                  <span className="font-mono text-sky-700 shrink-0">{installment.accountLabel}</span>
                </div>
              )}

              {installment.referenceNo && (
                <div className="flex justify-between items-center text-[9px] text-slate-600 pl-1">
                  <span className="truncate pr-1">• เลขอ้างอิง:</span>
                  <span className="font-mono text-slate-700 shrink-0">{installment.referenceNo}</span>
                </div>
              )}

              {installment.note && (
                <div className="text-[9px] text-slate-500 italic pl-1">
                  * หมายเหตุ: {installment.note}
                </div>
              )}
            </div>

            {/* Remaining Balance & Progress Box */}
            <div className="space-y-1 text-[10px] pb-2 border-b border-dashed border-slate-400">
              <div className="flex justify-between items-center font-black text-slate-900 pt-0.5">
                <span>ยอดหนี้คงเหลือสุทธิ:</span>
                <span className={`text-[12.5px] shrink-0 ${installment.remainingAfter <= 0 ? 'text-emerald-700 font-extrabold' : 'text-rose-600 font-black'}`}>
                  {formatCurrency(installment.remainingAfter)}
                </span>
              </div>

              {/* Progress Power Bar */}
              <div className="space-y-1 pt-1">
                <div className="flex justify-between items-center text-[9px] font-bold text-slate-600">
                  <span>ความคืบหน้าการชำระ:</span>
                  <span className={progressAfter === 100 ? 'text-emerald-700' : 'text-amber-700'}>
                    {progressAfter}% {progressAfter === 100 ? '(ชำระครบแล้ว)' : `(คงค้าง ${formatCurrency(installment.remainingAfter)})`}
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2 overflow-hidden border border-slate-300">
                  <div 
                    className={`h-full transition-all duration-300 ${progressAfter === 100 ? 'bg-emerald-500' : 'bg-amber-500'}`}
                    style={{ width: `${progressAfter}%` }}
                  />
                </div>
              </div>

              {/* Status Badge */}
              <div className={`text-center font-bold text-[10.5px] p-1.5 rounded mt-1.5 border ${
                installment.remainingAfter <= 0 
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-300' 
                  : 'bg-amber-50 text-amber-900 border-amber-300'
              }`}>
                {installment.remainingAfter <= 0 
                  ? '✅ ชำระครบถ้วนสมบูรณ์แล้ว (Fully Paid)' 
                  : `⏳ บันทึกรับชำระเรียบร้อย (คงค้าง ${formatCurrency(installment.remainingAfter)})`}
              </div>
            </div>

            {/* Signatures */}
            <div className="pt-2 space-y-2 text-[9px] text-slate-600">
              <div className="flex justify-between items-center">
                <span>ผู้รับเงิน ({installment.cashierName}):</span>
                <span>.................................</span>
              </div>
              <div className="flex justify-between items-center">
                <span>ผู้ชำระเงิน:</span>
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
