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
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';

import { ThermalReceiptView, ReceiptData } from './ThermalReceiptView';
export type { ReceiptData };

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
    if (!receiptRef.current) return;
    setIsGenerating(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'pos-receipt-pdf' });
    try {
      const filename = `Receipt-${data.orderNumber}.pdf`;
      const success = await exportElementToPdf(receiptRef.current, filename, '80mm');
      if (success) {
        toast.success(`ดาวน์โหลดไฟล์ PDF ใบเสร็จ ${data.orderNumber} เรียบร้อยแล้ว!`, { id: 'pos-receipt-pdf' });
      } else {
        toast.error('ไม่สามารถสร้างไฟล์ PDF ได้', { id: 'pos-receipt-pdf' });
      }
    } catch (err) {
      console.error(err);
      toast.error('เกิดข้อผิดพลาดในการสร้าง PDF', { id: 'pos-receipt-pdf' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenPdfTab = async () => {
    if (!receiptRef.current) return;
    handlePrint();
  };

  const handlePrint = () => {
    if (!receiptRef.current) return;
    printDocumentIframe(receiptRef.current, `พิมพ์ใบเสร็จ - ${data.orderNumber}`, '80mm');
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
          <ThermalReceiptView ref={receiptRef} data={data} settings={storeSettings} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
