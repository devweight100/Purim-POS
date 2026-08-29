'use client';

import { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { formatCurrency, formatDate, thaiBahtText } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Printer, Download, ExternalLink, FileText, CheckCircle2, 
  Building2, User, Phone, MapPin, AlertCircle, ShieldAlert, ArrowLeftRight, Clock
} from 'lucide-react';
import { toast } from 'sonner';
import { SupplierReturnNote } from '@/lib/types';

interface SupplierReturnPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnNote: SupplierReturnNote | null;
}

export function SupplierReturnPdfModal({ open, onOpenChange, returnNote }: SupplierReturnPdfModalProps) {
  const returnA4Ref = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  if (!returnNote) return null;

  const generatePdfBlob = async () => {
    if (!returnA4Ref.current) return null;
    try {
      const canvas = await html2canvas(returnA4Ref.current, {
        scale: 2.5,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const imgData = canvas.toDataURL('image/png');
      const imgWidth = 210;
      const pageHeight = (canvas.height * imgWidth) / canvas.width;

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [imgWidth, Math.max(pageHeight, 297)],
      });

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, pageHeight);
      return pdf.output('blob');
    } catch (err) {
      console.error('Error generating PDF:', err);
      return null;
    }
  };

  const handlePrint = async () => {
    setIsGenerating(true);
    toast.loading('กำลังจัดเตรียมไฟล์สำหรับพิมพ์...');
    try {
      const blob = await generatePdfBlob();
      toast.dismiss();
      if (!blob) {
        toast.error('ไม่สามารถสร้างไฟล์สำหรับสั่งพิมพ์ได้');
        return;
      }
      const url = URL.createObjectURL(blob);
      const printWindow = window.open(url);
      if (printWindow) {
        printWindow.onload = () => {
          printWindow.print();
        };
      } else {
        toast.error('กรุณาอนุญาต Pop-up บนเบราว์เซอร์เพื่อพิมพ์เอกสาร');
      }
    } catch {
      toast.dismiss();
      toast.error('เกิดข้อผิดพลาดในการสั่งพิมพ์');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleDownloadPdf = async () => {
    setIsGenerating(true);
    toast.loading('กำลังสร้างไฟล์ PDF...');
    try {
      const blob = await generatePdfBlob();
      toast.dismiss();
      if (!blob) {
        toast.error('สร้าง PDF ไม่สำเร็จ');
        return;
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Supplier_Return_${returnNote.id}_${returnNote.supplierName.replace(/\s+/g, '_')}.pdf`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('ดาวน์โหลด PDF สำเร็จแล้ว');
    } catch {
      toast.dismiss();
      toast.error('เกิดข้อผิดพลาดในการดาวน์โหลด PDF');
    } finally {
      setIsGenerating(false);
    }
  };

  const isDeducted = returnNote.status === 'DEDUCTED';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[900px] max-w-[900px] h-[92vh] max-h-[92vh] bg-white border-slate-200 text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pr-6">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-sm">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-black text-slate-900 tracking-tight flex items-center gap-2">
                  <span>ใบส่งคืนสินค้าเคลม / ใบลดหนี้</span>
                  <span className="font-mono text-base font-bold text-rose-700 bg-rose-50 px-2 py-0.5 rounded-lg border border-rose-200">
                    {returnNote.id}
                  </span>
                </DialogTitle>
                <p className="text-xs text-slate-500 font-medium">
                  เอกสารสำหรับส่งคืนบริษัทคู่ค้า พร้อมระบุยอดหักลดหนี้ตามราคาทุน
                </p>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handlePrint}
                disabled={isGenerating}
                className="h-9 gap-1.5 border-slate-300 hover:bg-slate-100 text-slate-700 font-bold rounded-xl shadow-2xs"
              >
                <Printer className="w-4 h-4 text-slate-600" />
                <span>พิมพ์เอกสาร</span>
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={isGenerating}
                className="h-9 gap-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-2xs"
              >
                <Download className="w-4 h-4" />
                <span>ดาวน์โหลด PDF</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* ─── A4 PAPER PREVIEW CONTAINER ─── */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4 flex justify-center bg-slate-200/70 rounded-2xl border border-slate-300/80 my-2">
          {/* Exact A4 Sheet */}
          <div
            ref={returnA4Ref}
            className="w-full max-w-[800px] min-h-[1100px] bg-white p-8 sm:p-10 shadow-lg text-slate-900 font-sans border border-slate-300 rounded-sm flex flex-col justify-between"
            style={{ boxSizing: 'border-box' }}
          >
            {/* TOP SECTION: Header & Supplier Information */}
            <div className="space-y-5">
              {/* 1. Header (Store Branding & Title Box) */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-4 border-b-2 border-slate-800">
                {/* Store Branding */}
                <div className="space-y-1 max-w-[450px]">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-rose-600 text-white flex items-center justify-center font-black text-lg shadow-sm">
                      P
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-slate-900 tracking-tight leading-none">ร้านปุริม (Purim POS)</h2>
                      <span className="text-[11px] font-bold text-rose-700 tracking-wide">PURIM POINT OF SALE CO., LTD.</span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed pt-1">
                    123/45 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพมหานคร 10110
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                    <span><b>เลขประจำตัวผู้เสียภาษี:</b> 0-1055-66012-34-5 (สำนักงานใหญ่)</span>
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                    <span><b>โทร:</b> 02-123-4567, 089-123-4567</span>
                    <span><b>อีเมล:</b> purchase@purimpos.com</span>
                  </div>
                </div>

                {/* Document Title Box */}
                <div className="sm:text-right border-2 border-rose-700 bg-rose-50/60 p-3.5 rounded-xl min-w-[260px]">
                  <h3 className="text-base font-black text-rose-950 uppercase tracking-tight">
                    ใบส่งคืนสินค้าเคลม / ใบลดหนี้
                  </h3>
                  <span className="text-[11px] font-extrabold text-rose-700 block">
                    SUPPLIER RETURN & DEBIT NOTE
                  </span>
                  <div className="mt-2 space-y-1 text-xs">
                    <div className="flex justify-between sm:justify-end gap-3">
                      <span className="text-slate-500 font-semibold">เลขที่เอกสาร:</span>
                      <b className="font-mono font-black text-slate-900">{returnNote.id}</b>
                    </div>
                    <div className="flex justify-between sm:justify-end gap-3">
                      <span className="text-slate-500 font-semibold">วันที่ส่งคืน:</span>
                      <span className="font-bold text-slate-800">{new Date(returnNote.returnDate).toLocaleDateString('th-TH')}</span>
                    </div>
                  </div>
                  <div className="mt-2 flex justify-end">
                    {isDeducted ? (
                      <span className="inline-block bg-emerald-600 text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-2xs">
                        ✓ หักลดยอดบิลแล้ว (DEDUCTED)
                      </span>
                    ) : (
                      <span className="inline-block bg-amber-600 text-white text-[11px] font-bold px-2 py-0.5 rounded shadow-2xs">
                        ⏳ รอหักในรอบบิลถัดไป (PENDING)
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* 2. Supplier Details Box */}
              <div className="border border-slate-300 rounded-xl p-4 bg-slate-50/60 space-y-2 text-xs">
                <div className="font-extrabold text-slate-900 text-sm flex items-center gap-2 border-b border-slate-200 pb-2">
                  <Building2 className="w-4 h-4 text-rose-600" />
                  <span>ข้อมูลบริษัทคู่ค้า / ผู้จำหน่าย (Supplier Information)</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                  <div>
                    <span className="text-slate-500 block">ชื่อบริษัท / ผู้จำหน่าย:</span>
                    <b className="text-slate-900 text-sm font-black">{returnNote.supplierName}</b>
                  </div>
                  <div>
                    <span className="text-slate-500 block">ผู้ติดต่อ / แผนกเคลม:</span>
                    <span className="text-slate-800 font-bold">{returnNote.supplierContact || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">เบอร์โทรศัพท์:</span>
                    <span className="text-slate-800 font-semibold">{returnNote.supplierPhone || '-'}</span>
                  </div>
                  <div>
                    <span className="text-slate-500 block">ที่อยู่บริษัท:</span>
                    <span className="text-slate-700">{returnNote.supplierAddress || '-'}</span>
                  </div>
                </div>
              </div>

              {/* 3. Items Table */}
              <div className="border border-slate-300 rounded-xl overflow-hidden shadow-2xs">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-100/90 border-b border-slate-300 text-slate-800 font-black">
                      <th className="p-2.5 text-center w-12 border-r border-slate-200">ลำดับ</th>
                      <th className="p-2.5 border-r border-slate-200">รายการสินค้าเคลมที่ส่งคืน</th>
                      <th className="p-2.5 border-r border-slate-200">อาการเสีย / สาเหตุ</th>
                      <th className="p-2.5 text-right w-24 border-r border-slate-200">จำนวน</th>
                      <th className="p-2.5 text-right w-28 border-r border-slate-200">ราคาทุน/หน่วย</th>
                      <th className="p-2.5 text-right w-32">มูลค่าหักหนี้รวม</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-800">
                    {returnNote.items.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="p-2.5 text-center font-mono text-slate-500 border-r border-slate-200">{idx + 1}</td>
                        <td className="p-2.5 border-r border-slate-200 font-semibold">
                          <div className="font-bold text-slate-900">{item.productName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">
                            SKU: {item.sku} · รหัสเคลม: {item.claimId}
                          </div>
                        </td>
                        <td className="p-2.5 border-r border-slate-200 text-slate-600">
                          <span className="text-rose-700 font-medium">{item.defectReason}</span>
                          <span className="block text-[10px] text-slate-400">บิลขาย: {item.originalOrderNumber}</span>
                        </td>
                        <td className="p-2.5 text-right font-black border-r border-slate-200">
                          {item.quantity} {item.unitName}
                        </td>
                        <td className="p-2.5 text-right font-bold text-slate-700 border-r border-slate-200">
                          {formatCurrency(item.unitCost)}
                        </td>
                        <td className="p-2.5 text-right font-black text-rose-700 text-sm">
                          {formatCurrency(item.totalCost)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 4. Financial Deduction Summary Box */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 p-4 rounded-xl border-2 border-rose-300 bg-rose-50/50">
                <div className="space-y-1">
                  <span className="text-xs text-rose-900 font-bold block">
                    จำนวนเงินตัวอักษร (Amount in Thai Baht):
                  </span>
                  <p className="text-sm font-extrabold text-rose-950">
                    ({thaiBahtText(returnNote.totalCreditAmount)})
                  </p>
                  <p className="text-[11px] text-slate-600 pt-1">
                    * ทางร้านขอหักลดยอดมูลค่าสินค้าเคลมนี้ ออกจากบิลเรียกเก็บเงิน/ใบแจ้งหนี้รอบถัดไปของทางบริษัท
                  </p>
                </div>

                <div className="sm:text-right min-w-[240px] space-y-1.5 border-t sm:border-t-0 pt-2 sm:pt-0 border-rose-200">
                  <div className="flex justify-between sm:justify-end gap-4 text-xs text-slate-600 font-bold">
                    <span>จำนวนสินค้ารวม:</span>
                    <span className="font-black text-slate-900">{returnNote.totalQuantity} ชิ้น</span>
                  </div>
                  <div className="flex justify-between sm:justify-end gap-4 text-base font-black text-rose-900 border-t border-rose-200 pt-1">
                    <span>ยอดขอหักลดหนี้รวม:</span>
                    <span className="text-xl font-black text-rose-700 font-mono">
                      {formatCurrency(returnNote.totalCreditAmount)}
                    </span>
                  </div>
                  {returnNote.remainingCreditAmount < returnNote.totalCreditAmount && (
                    <div className="flex justify-between sm:justify-end gap-4 text-xs font-bold text-emerald-700 pt-1">
                      <span>คงเหลือรอหักบิลหน้า:</span>
                      <span>{formatCurrency(returnNote.remainingCreditAmount)}</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Deduction History if any */}
              {returnNote.deductions && returnNote.deductions.length > 0 && (
                <div className="p-3 bg-emerald-50 rounded-xl border border-emerald-200 text-xs text-emerald-900 space-y-1">
                  <span className="font-bold block">ประวัติการนำไปหักลดหนี้ในบิลเรียกเก็บเงิน:</span>
                  {returnNote.deductions.map((d, idx) => (
                    <div key={idx} className="flex justify-between text-[11px]">
                      <span>บิลเลขที่: <b>{d.billNumber}</b> ({new Date(d.deductedAt).toLocaleDateString('th-TH')})</span>
                      <span>หักลบ: <b className="text-emerald-700 font-mono">-{formatCurrency(d.deductedAmount)}</b> (จ่ายสุทธิ {formatCurrency(d.netPaid)})</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* BOTTOM SECTION: Signatures */}
            <div className="pt-10 border-t border-slate-300 grid grid-cols-2 gap-8 text-center text-xs">
              <div className="space-y-4">
                <p className="text-slate-700 font-bold">ผู้ส่งมอบสินค้าเคลม (ร้านปุริม)</p>
                <div className="pt-10 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <p>({returnNote.createdBy || 'เจ้าหน้าที่ฝ่ายเคลม'})</p>
                  <p>วันที่: {new Date(returnNote.returnDate).toLocaleDateString('th-TH')}</p>
                </div>
              </div>

              <div className="space-y-4">
                <p className="text-slate-700 font-bold">ผู้รับสินค้าเคลม / ตัวแทนบริษัทคู่ค้า</p>
                <div className="pt-10 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <p>(....................................................................)</p>
                  <p>วันที่: ......./......./...........</p>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-200 flex justify-end shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 border-slate-300 text-slate-700 font-bold rounded-xl"
          >
            ปิดหน้าต่าง
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}