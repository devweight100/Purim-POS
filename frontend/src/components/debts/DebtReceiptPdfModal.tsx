'use client';

import { useRef, useState } from 'react';
import { DebtRecord, DebtPaymentInstallment } from '@/lib/types';
import { formatDocDate } from '@/lib/utils';
import { paymentMethodLabel } from '@/lib/receipt-mapper';
import { SlipPaper, SlipRow, SlipRule, SlipShopHeader, slipMoney } from '@/components/pos/slip-parts';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FileText, Printer, Download, ExternalLink, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { capturePrintable as html2canvas } from '@/lib/pdf-print-service';
import jsPDF from 'jspdf';
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';
import { loadStoreSettings } from '@/lib/store-settings-storage';

interface DebtReceiptPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  debtRecord: DebtRecord | null;
  installment: DebtPaymentInstallment | null;
}

export function DebtReceiptPdfModal({ open, onOpenChange, debtRecord, installment }: DebtReceiptPdfModalProps) {
  const receiptRef = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [storeSettings] = useState(() => loadStoreSettings());

  if (!debtRecord || !installment) return null;

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
    if (!receiptRef.current) return;
    setIsGenerating(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'debt-pdf' });
    try {
      const docCode = installment.receiptNo || debtRecord.orderNumber;
      const success = await exportElementToPdf(receiptRef.current, `DebtReceipt-${docCode}.pdf`, '80mm');
      if (success) {
        toast.success(`ดาวน์โหลดไฟล์ PDF ใบเสร็จรับเงิน #${docCode} เรียบร้อยแล้ว!`, { id: 'debt-pdf' });
      } else {
        toast.error('ไม่สามารถสร้างไฟล์ PDF ได้', { id: 'debt-pdf' });
      }
    } catch (e) {
      toast.error('เกิดข้อผิดพลาดในการสร้าง PDF', { id: 'debt-pdf' });
    } finally {
      setIsGenerating(false);
    }
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
    const docCode = installment.receiptNo || debtRecord.orderNumber;
    printDocumentIframe(receiptRef.current, `ใบเสร็จรับชำระหนี้ - ${docCode}`, '80mm');
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

        {/* Slip preview: exactly what prints (288 px = 72 mm printable width) */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-3 sm:p-4 flex justify-center bg-slate-300/60 rounded-2xl border border-slate-300/80 min-h-[420px] max-h-[72vh]">
          <div className="bg-white shadow-md ring-1 ring-slate-300 self-start">
            <SlipPaper ref={receiptRef}>
              <SlipShopHeader settings={storeSettings} title="ใบเสร็จรับเงิน (รับชำระหนี้)" />

              <SlipRule />
              <div className="space-y-0.5">
                {installment.receiptNo && <SlipRow label="เลขที่" value={<span className="font-bold">{installment.receiptNo}</span>} />}
                <SlipRow label="วันที่รับชำระ" value={formatDocDate(installment.paymentDate, { time: true })} />
                <SlipRow label="อ้างอิงบิล" value={debtRecord.orderNumber} />
                <SlipRow label="วันที่บิล" value={formatDocDate(debtRecord.orderDate)} />
                <SlipRow label="ลูกค้า" value={<span className="break-words">{debtRecord.companyName || debtRecord.customerName}</span>} />
                {debtRecord.companyName && debtRecord.customerName && debtRecord.companyName !== debtRecord.customerName && (
                  <SlipRow label="ผู้ติดต่อ" value={debtRecord.customerName} />
                )}
                {storeSettings.vatEnabled === true && debtRecord.taxId && <SlipRow label="เลขผู้เสียภาษี" value={debtRecord.taxId} />}
                {debtRecord.customerPhone && <SlipRow label="โทร" value={debtRecord.customerPhone} />}
              </div>

              <SlipRule />
              <div className="space-y-0.5">
                <SlipRow label="ยอดตามบิล" value={slipMoney(debtRecord.totalAmount)} />
                <SlipRow label="ชำระก่อนหน้า" value={slipMoney(installment.previousPaid)} />
                <SlipRow className="text-[16px] font-bold pt-0.5" label={`รับชำระงวดที่ ${installment.installmentNo}`} value={slipMoney(installment.amountPaid)} />
                <SlipRow label="ชำระโดย" value={paymentMethodLabel(installment.paymentMethod)} />
                {installment.accountLabel && <SlipRow label="บัญชีรับเงิน" value={installment.accountLabel} />}
                {installment.referenceNo && <SlipRow label="เลขอ้างอิง" value={installment.referenceNo} />}
                <SlipRow
                  className="text-[14px] font-bold pt-0.5"
                  label={installment.remainingAfter > 0 ? 'ยอดค้างชำระคงเหลือ' : 'ชำระครบแล้ว คงเหลือ'}
                  value={slipMoney(Math.max(0, installment.remainingAfter))}
                />
              </div>
              {installment.note && (
                <>
                  <SlipRule />
                  <div className="text-[11px] whitespace-pre-wrap break-words">หมายเหตุ: {installment.note}</div>
                </>
              )}

              <SlipRule />
              <div className="text-[11px] pt-3 space-y-0.5">
                <div className="border-b border-dotted border-black h-5" />
                <div className="text-center">ผู้รับเงิน {installment.cashierName ? `(${installment.cashierName})` : ''}</div>
              </div>
            </SlipPaper>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
