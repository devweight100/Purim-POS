'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, ExternalLink, FileText, CheckCircle2 } from 'lucide-react';
import { formatDocDate } from '@/lib/utils';
import { SlipPaper, SlipRow, SlipRule, SlipShopHeader, slipMoney } from '@/components/pos/slip-parts';
import { capturePrintable as html2canvas } from '@/lib/pdf-print-service';
import jsPDF from 'jspdf';
import { toast } from 'sonner';
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';
import { loadStoreSettings } from '@/lib/store-settings-storage';

export interface BankAccountBreakdownItem {
  accountLabel: string;
  amount: number;
}

export interface ShiftSummaryData {
  /** UUID or shift number; prefer shiftCode/code for display */
  shiftId: string;
  /** readable shift number, e.g. SHF-261100003 */
  shiftCode?: string;
  code?: string;
  shiftNumber?: string;
  /** OPEN / CLOSED - an open shift is printed as "ยังไม่ปิดกะ" */
  status?: string;
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
  /** shift still open: no closing time / counted cash yet */
  isOpen?: boolean;
  /** cashIn excludes cash debt collections, which then get their own line */
  cashInExcludesDebt?: boolean;
  returnsTotal?: number;
  returnCount?: number;
  netSales?: number;
  returnRefundAmount?: number;
  returnRefundCount?: number;
  voidRefundAmount?: number;
  voidRefundCount?: number;
  claimRefundAmount?: number;
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
  const shiftLabel = data ? data.shiftCode || data.code || data.shiftNumber || data.shiftId : '';
  const isOpenShift = !!data?.isOpen || String(data?.status || '').toUpperCase() === 'OPEN';

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
      const success = await exportElementToPdf(summaryRef.current, `Shift-Summary-${shiftLabel}.pdf`, '80mm');
      if (success) {
        toast.success(`ดาวน์โหลดไฟล์ PDF ใบสรุปกะ #${shiftLabel} เรียบร้อยแล้ว!`, { id: 'shift-pdf' });
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
    printDocumentIframe(summaryRef.current, `พิมพ์ใบสรุปปิดกะ - Shift ${shiftLabel}`, '80mm');
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
              #{shiftLabel}
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

        {/* Slip preview: exactly what prints (288 px = 72 mm printable width) */}
        <div className="flex-1 overflow-y-auto overflow-x-auto p-3 sm:p-4 flex justify-center bg-slate-300/60 rounded-2xl border border-slate-300/80 min-h-[420px] max-h-[72vh]">
          <div className="bg-white shadow-md ring-1 ring-slate-300 self-start">
            <SlipPaper ref={summaryRef}>
              <SlipShopHeader
                settings={storeSettings}
                showTaxId={false}
                title={isOpenShift ? 'สรุปยอดระหว่างกะ (ยังไม่ปิดกะ)' : 'ใบสรุปปิดกะ'}
              />

              <SlipRule />
              <div className="space-y-0.5">
                <SlipRow label="กะ" value={<span className="font-bold">{shiftLabel}</span>} />
                <SlipRow label="พนักงาน" value={data.userName} />
                <SlipRow label="เปิดกะ" value={formatDocDate(data.openedAt, { time: true })} />
                <SlipRow label="ปิดกะ" value={isOpenShift ? 'ยังไม่ปิดกะ' : formatDocDate(data.closedAt, { time: true })} />
                <SlipRow label="บิลขาย / ยกเลิก" value={`${data.orderCount} / ${data.voidCount}`} />
              </div>

              <SlipRule />
              <div className="font-bold">ยอดขายตามช่องทาง</div>
              <div className="space-y-0.5">
                <SlipRow label="เงินสด" value={slipMoney(data.cashSales)} />
                <SlipRow label="QR พร้อมเพย์" value={slipMoney(data.qrSales)} />
                <SlipRow label="โอนเงิน" value={slipMoney(data.transferSales)} />
                {data.bankAccountBreakdown?.map((item, idx) => (
                  <SlipRow key={idx} className="pl-2 text-[11px]" label={`- ${item.accountLabel}`} value={slipMoney(item.amount)} />
                ))}
                <SlipRow label="บัตรเครดิต" value={slipMoney(data.cardSales)} />
                <SlipRow label="เงินเชื่อ (ลูกหนี้)" value={slipMoney(data.creditSales || 0)} />
                <SlipRow className="text-[14px] font-bold pt-0.5" label="รวมยอดขาย" value={slipMoney(data.totalSales)} />
                {!!data.returnsTotal && (
                  <>
                    <SlipRow label={`คืนสินค้า (${data.returnCount || 0} ครั้ง)`} value={`-${slipMoney(data.returnsTotal)}`} />
                    <SlipRow className="text-[14px] font-bold" label="ยอดขายสุทธิ" value={slipMoney(data.netSales ?? data.totalSales - data.returnsTotal)} />
                  </>
                )}
                {((data.billDiscountsTotal || 0) > 0 || (data.pointsDiscountsTotal || 0) > 0) && (
                  <div className="text-[11px] pt-0.5">
                    <SlipRow label="ส่วนลดท้ายบิล (รวมในยอดแล้ว)" value={`-${slipMoney(data.billDiscountsTotal || 0)}`} />
                    {(data.pointsDiscountsTotal || 0) > 0 && <SlipRow label="ส่วนลดแต้ม" value={`-${slipMoney(data.pointsDiscountsTotal || 0)}`} />}
                  </div>
                )}
              </div>

              {(data.debtCollectionCount || 0) > 0 && (
                <>
                  <SlipRule />
                  <div className="font-bold">รับชำระหนี้ ({data.debtCollectionCount} รายการ)</div>
                  <div className="space-y-0.5">
                    <SlipRow label="เงินสด" value={slipMoney(data.debtCollectionCash || 0)} />
                    <SlipRow label="QR / โอน" value={slipMoney(data.debtCollectionQrTransfer || 0)} />
                    <SlipRow className="font-bold" label="รวมรับชำระหนี้" value={slipMoney(data.debtCollectionTotal || 0)} />
                  </div>
                </>
              )}

              <SlipRule />
              <div className="font-bold">เงินสดในลิ้นชัก</div>
              <div className="space-y-0.5">
                <SlipRow label="เงินทอนตั้งต้น" value={slipMoney(data.openingCash)} />
                <SlipRow label="+ ขายเงินสด" value={slipMoney(data.cashSales)} />
                {!!data.debtCollectionCash && data.cashInExcludesDebt && <SlipRow label="+ รับชำระหนี้เงินสด" value={slipMoney(data.debtCollectionCash)} />}
                {data.cashIn > 0 && <SlipRow label="+ นำเงินเข้า" value={slipMoney(data.cashIn)} />}
                {data.cashOut > 0 && <SlipRow label="- นำเงินออก" value={slipMoney(data.cashOut)} />}
                {!!data.returnRefundAmount && (
                  <SlipRow label={`- คืนเงินคืนสินค้า (${data.returnRefundCount || 1})`} value={slipMoney(data.returnRefundAmount)} />
                )}
                {!!data.voidRefundAmount && <SlipRow label={`- คืนเงินยกเลิกบิล (${data.voidRefundCount || 1})`} value={slipMoney(data.voidRefundAmount)} />}
                {(data.returnRefundAmount !== undefined ? !!data.claimRefundAmount : (data.cashRefunds || 0) > 0) && (
                  <SlipRow
                    label={`- คืนเงินเคลม (${data.claimRefundCount || 1})`}
                    value={slipMoney(data.returnRefundAmount !== undefined ? data.claimRefundAmount || 0 : data.cashRefunds || 0)}
                  />
                )}
                <SlipRow className="font-bold pt-0.5" label="เงินสดที่ควรมี" value={slipMoney(data.expectedCash)} />
                <SlipRow className="font-bold" label="นับได้จริง" value={isOpenShift ? 'ยังไม่ได้นับ' : slipMoney(data.actualCash)} />
                <SlipRow
                  className="text-[14px] font-bold"
                  label={isOpenShift ? 'ผลต่าง' : Math.abs(diff) < 0.005 ? 'ผลต่าง (ครบพอดี)' : diff > 0 ? 'เงินเกิน' : 'เงินขาด'}
                  value={isOpenShift ? '-' : `${diff > 0.005 ? '+' : diff < -0.005 ? '-' : ''}${slipMoney(Math.abs(diff))}`}
                />
              </div>

              <SlipRule />
              <div className="text-[11px] pt-4 grid grid-cols-2 gap-3 text-center">
                <div>
                  <div className="border-b border-dotted border-black h-5" />
                  พนักงาน
                </div>
                <div>
                  <div className="border-b border-dotted border-black h-5" />
                  ผู้ตรวจนับ
                </div>
              </div>
              <div className="text-center text-[11px] pt-1">พิมพ์ {formatDocDate(new Date(), { time: true })}</div>
            </SlipPaper>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
