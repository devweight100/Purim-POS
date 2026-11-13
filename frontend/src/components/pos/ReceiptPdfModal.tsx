'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, FileText, CheckCircle2 } from 'lucide-react';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { toast } from 'sonner';
import { exportElementToPdf } from '@/lib/pdf-print-service';

import { ThermalReceiptView, ReceiptData, printThermalReceiptDirect } from './ThermalReceiptView';
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

  // same function as the POS sale: the slip is rendered off-screen and printed from there,
  // so a reprint comes out exactly like the original (plus the "พิมพ์ซ้ำ" line)
  const handlePrint = () => {
    printThermalReceiptDirect(data, storeSettings);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-2xl max-h-[90vh] flex flex-col bg-slate-100 border-slate-200 text-slate-900 rounded-3xl p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <DialogTitle className="text-xl font-bold flex items-center justify-between">
            <div className="flex items-center gap-2 text-slate-800">
              <FileText className="w-6 h-6 text-sky-600" />
              <span>ตัวอย่างใบเสร็จรับเงิน</span>
            </div>
            <span className="text-xs font-mono text-slate-500 font-normal bg-slate-200 px-2.5 py-1 rounded-md">
              {data.orderNumber}
            </span>
          </DialogTitle>
        </DialogHeader>

        {/* Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between gap-2 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm shrink-0 my-2">
          <div className="text-xs text-slate-700 font-bold flex items-center gap-1.5">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>สลิป 80mm ตามที่จะพิมพ์ออกเครื่องพิมพ์ใบเสร็จ</span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
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
              className="bg-black hover:bg-slate-800 text-white text-xs font-bold gap-1.5 rounded-xl h-9 shadow-md"
            >
              <Printer className="w-3.5 h-3.5" />
              พิมพ์ใบเสร็จ
            </Button>
          </div>
        </div>

        {/* Live Thermal Slip Receipt Scrollable Container */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-4 flex justify-center bg-slate-200/70 rounded-2xl">
          {/* paper edge: the slip itself is exactly what prints (288 px = 72 mm printable width) */}
          <div className="bg-white shadow-md ring-1 ring-slate-300 self-start">
            <ThermalReceiptView ref={receiptRef} data={data} settings={storeSettings} />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
