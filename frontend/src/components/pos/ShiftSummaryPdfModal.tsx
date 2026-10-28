'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, ExternalLink, FileText, CheckCircle2, Store, Building2 } from 'lucide-react';
import { formatCurrency } from '@/lib/utils';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import { BarcodeView } from '@/components/common/BarcodeView';
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';
import { loadStoreSettings } from '@/lib/store-settings-storage';

export interface BankAccountBreakdownItem {
  accountLabel: string;
  amount: number;
}

export interface ShiftSummaryData {
  shiftId: string;
  userId?: string;
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
  const [storeSettings] = useState(() => loadStoreSettings());

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
    if (!summaryRef.current) return;
    setIsGenerating(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'shift-pdf' });
    try {
      const success = await exportElementToPdf(summaryRef.current, `Shift-Summary-${data.shiftId}.pdf`, '80mm');
      if (success) {
        toast.success(`ดาวน์โหลดไฟล์ PDF ใบสรุปกะ #${data.shiftId} เรียบร้อยแล้ว!`, { id: 'shift-pdf' });
      } else {
        toast.error('ไม่สามารถสร้างไฟล์ PDF ได้', { id: 'shift-pdf' });
      }
    } catch (e) {
      toast.error('เกิดข้อผิดพลาดในการสร้าง PDF', { id: 'shift-pdf' });
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
    if (!summaryRef.current) return;
    printDocumentIframe(summaryRef.current, `พิมพ์ใบสรุปปิดกะ - Shift ${data.shiftId}`, '80mm');
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
            className="w-full max-w-[78mm] sm:max-w-[80mm] print:w-full print:max-w-full bg-white text-black px-3.5 py-4 shadow-2xl font-sans text-[11.5px] leading-snug rounded-none space-y-2 overflow-hidden box-border h-fit border border-black print:border-none print:p-0"
            style={{ boxSizing: 'border-box', color: '#000000', backgroundColor: '#ffffff', margin: '0 auto' }}
          >
            {/* Store Header */}
            <div className="text-center space-y-1 pb-2 border-b-2 border-black">
              <div className="flex items-center justify-center gap-1.5 font-black text-base sm:text-lg font-sans text-black">
                <Store className="w-5 h-5 text-black shrink-0 stroke-[2.5]" />
                <span className="truncate">{storeSettings.storeName || 'ร้านปุริม (PURIM POS)'}</span>
              </div>
              {storeSettings.branchName && (
                <p className="text-[11px] text-black font-bold font-sans">สาขา: {storeSettings.branchName}</p>
              )}
              {storeSettings.taxId && (
                <p className="text-[11px] text-black font-bold font-mono">เลขประจำตัวผู้เสียภาษี: {storeSettings.taxId}</p>
              )}
              {storeSettings.storeAddress && (
                <p className="text-[10.5px] text-black font-bold leading-tight break-words font-sans">
                  {storeSettings.storeAddress}
                </p>
              )}
              {storeSettings.storePhone && (
                <p className="text-[11px] text-black font-bold font-mono">โทร: {storeSettings.storePhone}</p>
              )}
              <div className="pt-1">
                <span className="text-[13px] font-black border-2 border-black px-3 py-0.5 rounded-none font-sans inline-block text-black uppercase tracking-wider">
                  ใบสรุปปิดกะการขาย
                </span>
              </div>

              {/* Barcode of Shift ID */}
              <div className="pt-2 pb-1 flex justify-center bg-white">
                <BarcodeView value={data.shiftId} width={1.8} height={44} fontSize={12} />
              </div>
            </div>

            {/* Shift Meta */}
            <div className="text-[11.5px] space-y-1 pb-2 border-b-2 border-dashed border-black font-bold text-black">
              <div className="flex justify-between items-center gap-1">
                <span className="shrink-0">รหัสกะ:</span>
                <span className="font-black truncate text-right font-mono text-black text-[12px]">#{data.shiftId}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="shrink-0">พนักงานขาย:</span>
                <span className="font-bold text-black truncate text-right">{data.userName}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="shrink-0">เปิดกะ:</span>
                <span className="truncate text-right font-mono text-[11px]">{new Date(data.openedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
              <div className="flex justify-between items-center gap-1">
                <span className="shrink-0">ปิดกะ:</span>
                <span className="truncate text-right font-mono text-[11px]">{new Date(data.closedAt).toLocaleString('th-TH', { dateStyle: 'short', timeStyle: 'short' })}</span>
              </div>
            </div>

            {/* Sales Breakdown */}
            <div className="space-y-1 text-[11.5px] pb-2 border-b-2 border-dashed border-black text-black font-bold">
              <div className="font-black text-black border-b-2 border-black pb-0.5 font-sans">
                📊 ยอดขายแยกตามช่องทาง
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• เงินสด (Cash):</span>
                <span className="shrink-0 font-mono text-[12px]">{formatCurrency(data.cashSales)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• QR (พร้อมเพย์):</span>
                <span className="shrink-0 font-mono text-[12px]">{formatCurrency(data.qrSales)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• โอนเงิน (Transfer):</span>
                <span className="shrink-0 font-mono text-[12px]">{formatCurrency(data.transferSales)}</span>
              </div>

              {/* Itemized Bank Account Breakdown for QR & Transfer */}
              {data.bankAccountBreakdown && data.bankAccountBreakdown.length > 0 && (
                <div className="my-1 p-1.5 border-2 border-black rounded space-y-0.5 font-sans">
                  <div className="text-[10px] font-black text-black border-b border-black pb-0.5 flex items-center gap-1">
                    <Building2 className="w-3.5 h-3.5 text-black shrink-0" />
                    <span>แยกตามบัญชีธนาคาร:</span>
                  </div>
                  {data.bankAccountBreakdown.map((item, idx) => (
                    <div key={idx} className="flex justify-between items-center text-[10.5px] text-black font-bold pl-1">
                      <span className="truncate pr-1 max-w-[155px]" title={item.accountLabel}>• {item.accountLabel}:</span>
                      <span className="font-black text-black shrink-0 font-mono">{formatCurrency(item.amount)}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• บัตรเครดิต:</span>
                <span className="shrink-0 font-mono text-[12px]">{formatCurrency(data.cardSales)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• เงินเชื่อ (Credit / ลูกหนี้):</span>
                <span className="font-bold shrink-0 font-mono text-[12px]">{formatCurrency(data.creditSales || 0)}</span>
              </div>
              <div className="flex justify-between items-center text-[14px] font-black text-black pt-1 border-t-2 border-black my-1">
                <span>รวมยอดขายสุทธิ:</span>
                <span className="shrink-0 font-mono text-[16px]">{formatCurrency(data.totalSales)}</span>
              </div>
            </div>

            {/* Debt Collections (การรับชำระหนี้ / เงินเชื่อประจำกะ) */}
            <div className="space-y-1 text-[11.5px] pb-2 border-b-2 border-dashed border-black text-black font-bold">
              <div className="font-black text-black border-b-2 border-black pb-0.5 font-sans flex items-center justify-between">
                <span>💳 รับชำระหนี้ / เงินเชื่อประจำกะ</span>
                <span className="font-mono text-[11.5px]">
                  {(data.debtCollectionCount || 0)} บิล
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• จำนวนบิลที่รับชำระ:</span>
                <span className="font-black shrink-0">{(data.debtCollectionCount || 0)} บิล</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• ยอดรับชำระเงินสด:</span>
                <span className="font-black shrink-0 font-mono text-[12px]">{formatCurrency(data.debtCollectionCash || 0)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• ยอดรับชำระ QR / โอน:</span>
                <span className="font-black shrink-0 font-mono text-[12px]">{formatCurrency(data.debtCollectionQrTransfer || 0)}</span>
              </div>
              <div className="flex justify-between items-center font-black text-black pt-1 border-t-2 border-black">
                <span>รวมยอดรับชำระหนี้ทั้งสิ้น:</span>
                <span className="shrink-0 font-mono text-[13px]">
                  {formatCurrency(data.debtCollectionTotal || 0)}
                </span>
              </div>
            </div>

            {/* Discounts Breakdown (สรุปส่วนลดประจำกะ) */}
            <div className="space-y-1 text-[11.5px] pb-2 border-b-2 border-dashed border-black text-black font-bold">
              <div className="font-black text-black border-b-2 border-black pb-0.5 font-sans">
                🔖 สรุปส่วนลดประจำกะ
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• ส่วนลดการค้า / ท้ายบิล:</span>
                <span className="shrink-0 font-mono text-[12px]">-{formatCurrency(data.billDiscountsTotal || 0)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="truncate pr-1">• ส่วนลดแต้มสะสมสมาชิก:</span>
                <span className="shrink-0 font-mono text-[12px]">-{formatCurrency(data.pointsDiscountsTotal || 0)}</span>
              </div>
              <div className="flex justify-between items-center font-black text-black pt-1 border-t-2 border-black">
                <span>รวมส่วนลดทั้งหมด:</span>
                <span className="shrink-0 font-mono text-[13px]">
                  -{formatCurrency((data.billDiscountsTotal || 0) + (data.pointsDiscountsTotal || 0))}
                </span>
              </div>
            </div>

            {/* Shift Stats */}
            <div className="space-y-1 text-[11.5px] pb-2 border-b-2 border-dashed border-black text-black font-bold">
              <div className="font-black text-black border-b-2 border-black pb-0.5 font-sans">
                📈 สถิติกะการขาย
              </div>
              <div className="flex justify-between items-center">
                <span>ออเดอร์สำเร็จ:</span>
                <span className="font-black shrink-0 font-mono text-[12px]">{data.orderCount} บิล</span>
              </div>
              <div className="flex justify-between items-center">
                <span>ออเดอร์ยกเลิก (Void):</span>
                <span className="font-black shrink-0 font-mono text-[12px]">{data.voidCount} บิล</span>
              </div>
            </div>

            {/* Cash Drawer Reconciliation (กระทบยอดเงินสดในลิ้นชัก) */}
            <div className="space-y-1 text-[11.5px] pb-2 border-b-2 border-dashed border-black text-black font-bold">
              <div className="font-black text-black border-b-2 border-black pb-0.5 font-sans flex items-center justify-between">
                <span>💵 กระทบยอดเงินสดในลิ้นชัก</span>
              </div>
              <div className="flex justify-between items-center">
                <span>เงินสดตั้งต้น (เปิดกะ):</span>
                <span className="shrink-0 font-mono text-[12px]">{formatCurrency(data.openingCash)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>(+) ยอดขายเงินสด:</span>
                <span className="shrink-0 font-mono text-[12px]">+{formatCurrency(data.cashSales)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>(+) เงินเข้าลิ้นชัก (Cash In):</span>
                <span className="shrink-0 font-mono text-[12px]">+{formatCurrency(data.cashIn)}</span>
              </div>
              <div className="flex justify-between items-center">
                <span>(-) เงินออกลิ้นชัก (Cash Out):</span>
                <span className="shrink-0 font-mono text-[12px]">-{formatCurrency(data.cashOut)}</span>
              </div>
              {data.cashRefunds !== undefined && data.cashRefunds > 0 && (
                <div className="flex justify-between items-center">
                  <span>(-) คืนเงินสดเคลม ({data.claimRefundCount || 1} ครั้ง):</span>
                  <span className="shrink-0 font-mono text-[12px]">-{formatCurrency(data.cashRefunds)}</span>
                </div>
              )}
              
              <div className="flex justify-between items-center font-bold text-black pt-1 border-t-2 border-black">
                <span>เงินสดที่ควรมีในลิ้นชัก:</span>
                <span className="shrink-0 font-mono font-black text-[13px]">{formatCurrency(data.expectedCash)}</span>
              </div>
              <div className="flex justify-between items-center font-black text-black">
                <span>เงินสดที่นับได้จริง:</span>
                <span className="shrink-0 font-mono font-black text-[14px]">{formatCurrency(data.actualCash)}</span>
              </div>

              {/* Prominent Cash Reconciliation Result Box */}
              <div className="flex justify-between items-center font-black text-[12px] p-2 mt-1 border-2 border-black bg-white">
                <span>ผลการกระทบยอด:</span>
                <span className="font-black text-[13px] font-sans">
                  {diff === 0 
                    ? 'ครบพอดี (฿0.00)' 
                    : diff > 0 
                    ? `เงินสดเกิน (+${formatCurrency(diff)})` 
                    : `เงินสดขาด (-${formatCurrency(Math.abs(diff))})`}
                </span>
              </div>
            </div>

            {/* Footer Signatures */}
            <div className="pt-2 space-y-2.5 text-[11px] text-black font-bold">
              <div className="flex justify-between items-center">
                <span>ลงชื่อพนักงาน:</span>
                <span>.................................</span>
              </div>
              <div className="flex justify-between items-center">
                <span>ลงชื่อผู้ตรวจ:</span>
                <span>.................................</span>
              </div>
              <div className="text-center text-[10px] text-black pt-1 border-t-2 border-black">
                พิมพ์เมื่อ: {new Date().toLocaleString('th-TH')}
              </div>
            </div>

          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
