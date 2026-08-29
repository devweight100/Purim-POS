'use client';

import { useRef, useState } from 'react';
import { 
  Building2, CheckCircle2, Download, Printer, 
  X, FileText, ShieldAlert, Package, Tag
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { SupplierReturnNote } from '@/lib/types';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface SupplierReturnPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnNote: SupplierReturnNote | null;
}

export function SupplierReturnPdfModal({
  open,
  onOpenChange,
  returnNote,
}: SupplierReturnPdfModalProps) {
  const docRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);

  if (!returnNote) return null;

  const defectiveItems = returnNote.items.filter((i) => i.itemType === 'DEFECTIVE');
  const overstockItems = returnNote.items.filter((i) => i.itemType === 'OVERSTOCK');

  const defectiveTotal = returnNote.defectiveTotalCost !== undefined 
    ? returnNote.defectiveTotalCost 
    : defectiveItems.reduce((s, i) => s + i.totalCost, 0);

  const overstockTotal = returnNote.overstockTotalCost !== undefined 
    ? returnNote.overstockTotalCost 
    : overstockItems.reduce((s, i) => s + i.totalCost, 0);

  const totalItemCost = defectiveTotal + overstockTotal;

  // Print via browser
  const handlePrint = () => {
    if (!docRef.current) return;
    const printContent = docRef.current.innerHTML;
    const win = window.open('', '', 'width=900,height=800');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>ใบส่งคืนสินค้า / ใบลดหนี้ - ${returnNote.id}</title>
            <style>
              body {
                font-family: 'Prompt', 'Sarabun', -apple-system, BlinkMacSystemFont, sans-serif;
                margin: 0;
                padding: 6mm;
                background: #fff;
                color: #0f172a;
                font-size: 11px;
                line-height: 1.35;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
              }
              @page {
                size: A4 portrait;
                margin: 6mm;
              }
              table { width: 100%; border-collapse: collapse; page-break-inside: auto; }
              tr { page-break-inside: avoid; page-break-after: auto; }
              th, td { border: 1px solid #cbd5e1; padding: 4px 6px; font-size: 10px; }
              th { background-color: #f8fafc; font-weight: 700; }
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

  // Export to PDF (Strict A4 Fit Guarantee)
  const handleDownloadPdf = async () => {
    if (!docRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(docRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
      });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      
      const pdfWidth = 210;
      const pdfHeight = 297;
      const margin = 8;
      const printWidth = pdfWidth - (margin * 2);
      const printHeight = pdfHeight - (margin * 2);

      const imgHeight = (canvas.height * printWidth) / canvas.width;

      if (imgHeight <= printHeight) {
        // Fits on 1 single A4 page
        pdf.addImage(imgData, 'PNG', margin, margin, printWidth, imgHeight);
      } else {
        // If only slightly overflowing (> 75% fit), scale down slightly so it fits on 1 page!
        const fitScale = printHeight / imgHeight;
        if (fitScale >= 0.75) {
          pdf.addImage(imgData, 'PNG', margin, margin, printWidth * fitScale, printHeight);
        } else {
          // Multi-page cleanly
          let heightLeft = imgHeight;
          let position = margin;
          pdf.addImage(imgData, 'PNG', margin, position, printWidth, imgHeight);
          heightLeft -= printHeight;
          while (heightLeft > 0) {
            position = heightLeft - imgHeight + margin;
            pdf.addPage();
            pdf.addImage(imgData, 'PNG', margin, position, printWidth, imgHeight);
            heightLeft -= printHeight;
          }
        }
      }

      pdf.save(`DebitNote_${returnNote.id}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-4xl max-h-[92vh] flex flex-col bg-slate-100 border-slate-200 text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="pb-2.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-800">
              <FileText className="w-5 h-5 text-indigo-600" />
              <span>ใบส่งคืนสินค้า / ใบลดหนี้ผู้จำหน่าย (Debit Note)</span>
            </DialogTitle>
            <Badge variant="outline" className="font-mono text-xs px-2.5 py-0.5 bg-white font-bold text-indigo-700 border-indigo-200">
              {returnNote.id}
            </Badge>
          </div>
        </DialogHeader>

        {/* Scrollable Printable Document Preview (Optimized strictly for A4) */}
        <div className="flex-1 overflow-y-auto pr-1 py-2 flex justify-center">
          <div
            ref={docRef}
            className="w-full max-w-[740px] bg-white border border-slate-200 rounded-xl p-5 shadow-sm text-slate-800 text-[11px] space-y-3.5"
          >
            {/* Store & Document Header */}
            <div className="flex justify-between items-start border-b border-slate-200 pb-3">
              <div className="space-y-0.5 max-w-[58%]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-black flex items-center justify-center text-xs">
                    P
                  </div>
                  <h2 className="text-base font-black text-slate-900">ร้านปุริม POS</h2>
                </div>
                <p className="text-slate-600 text-[10px] leading-tight">
                  123/45 ถ.มิตรภาพ ต.ในเมือง อ.เมือง จ.ขอนแก่น 40000 | โทร: 081-234-5678<br />
                  เลขประจำตัวผู้เสียภาษี: 0405562001234
                </p>
              </div>

              <div className="text-right space-y-0.5">
                <h3 className="text-sm font-black text-indigo-900 uppercase tracking-tight">
                  ใบส่งคืนสินค้า / ใบลดหนี้
                </h3>
                <p className="text-[10px] font-semibold text-slate-500">DEBIT NOTE / RETURN NOTE</p>
                <div className="pt-1 text-[10px] space-y-0.5 font-mono">
                  <p><b className="text-slate-700">เลขที่:</b> <span className="text-indigo-600 font-bold">{returnNote.id}</span></p>
                  <p><b className="text-slate-700">วันที่:</b> {new Date(returnNote.returnDate).toLocaleDateString('th-TH')}</p>
                  {returnNote.linkedPoNumber && (
                    <p><b className="text-slate-700">อ้างอิงใบสั่งซื้อ:</b> <span className="font-bold text-amber-700">{returnNote.linkedPoNumber}</span></p>
                  )}
                </div>
              </div>
            </div>

            {/* Supplier & Store Information Grid */}
            <div className="grid grid-cols-2 gap-3 bg-slate-50/90 p-3 rounded-lg border border-slate-200 text-[10.5px]">
              <div className="space-y-0.5">
                <span className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider block">
                  ส่งคืนถึงบริษัทผู้จำหน่าย (Supplier):
                </span>
                <p className="font-bold text-slate-900 text-xs">{returnNote.supplierName}</p>
                {returnNote.supplierContact && (
                  <p className="text-slate-600 text-[10px]">ผู้ติดต่อ: {returnNote.supplierContact}</p>
                )}
                {returnNote.supplierPhone && (
                  <p className="text-slate-600 text-[10px]">โทรศัพท์: {returnNote.supplierPhone}</p>
                )}
                {returnNote.supplierAddress && (
                  <p className="text-slate-600 text-[10px] leading-tight truncate">{returnNote.supplierAddress}</p>
                )}
              </div>

              <div className="space-y-1 text-right">
                <span className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider block">
                  สถานะเอกสาร & วัตถุประสงค์:
                </span>
                <div>
                  {returnNote.status === 'DEDUCTED' ? (
                    <Badge className="bg-emerald-600 text-white font-bold text-[10px] py-0">หักลดหนี้ในบิล PO แล้ว</Badge>
                  ) : returnNote.status === 'PARTIALLY_DEDUCTED' ? (
                    <Badge className="bg-sky-600 text-white font-bold text-[10px] py-0">หักลดหนี้บางส่วน</Badge>
                  ) : returnNote.status === 'CANCELLED' ? (
                    <Badge variant="outline" className="border-slate-300 text-slate-400 text-[10px] py-0">ยกเลิกเอกสารแล้ว</Badge>
                  ) : (
                    <Badge variant="outline" className="border-amber-400 text-amber-800 bg-amber-50 font-bold text-[10px] py-0">
                      รอหักลดหนี้กับบริษัท
                    </Badge>
                  )}
                </div>
                <p className="text-slate-600 text-[10px] pt-0.5">
                  ผู้ออกเอกสาร: <strong className="text-slate-800">{returnNote.createdBy || 'เจ้าหน้าที่ฝ่ายส่งคืน'}</strong>
                </p>
              </div>
            </div>

            {/* SECTION 1: Defective / Warranty RMA Items */}
            {defectiveItems.length > 0 && (
              <div className="space-y-1">
                <div className="flex items-center justify-between border-b border-rose-200 pb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                    <h4 className="font-extrabold text-slate-900 text-xs flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5 text-rose-600" />
                      <span>หมวด 1: สินค้าชำรุด / เสียหาย (Defective Claims)</span>
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-rose-700 bg-rose-50 px-1.5 py-0.2 rounded border border-rose-200">
                    {defectiveItems.length} รายการ
                  </span>
                </div>

                <table className="w-full text-[10px] border border-slate-200">
                  <thead className="bg-rose-50/50 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-1.5 text-center w-8">ลำดับ</th>
                      <th className="p-1.5 text-left">รายการสินค้า / SKU</th>
                      <th className="p-1.5 text-left w-36">อาการชำรุด</th>
                      <th className="p-1.5 text-right w-14">จำนวน</th>
                      <th className="p-1.5 text-right w-20">ราคาทุน (฿)</th>
                      <th className="p-1.5 text-right w-24">รวมทุน (฿)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {defectiveItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="p-1.5 text-center text-slate-500">{idx + 1}</td>
                        <td className="p-1.5">
                          <p className="font-bold text-slate-900 leading-tight">{item.productName}</p>
                          <p className="text-[9px] text-slate-500 font-mono">SKU: {item.sku}</p>
                          {item.claimId && (
                            <p className="text-[9px] text-indigo-600 font-mono font-medium">ใบเคลม: #{item.claimId}</p>
                          )}
                        </td>
                        <td className="p-1.5 text-rose-700 font-medium leading-tight">
                          {item.defectReason || 'สินค้าชำรุดจากการใช้งาน'}
                        </td>
                        <td className="p-1.5 text-right font-mono font-bold">
                          {item.quantity} {item.unitName || 'ชิ้น'}
                        </td>
                        <td className="p-1.5 text-right font-mono">{formatCurrency(item.unitCost)}</td>
                        <td className="p-1.5 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(item.totalCost)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-rose-50/40 font-bold text-slate-900 border-t border-slate-300">
                      <td colSpan={5} className="p-1.5 text-right text-rose-900">
                        รวมราคาทุนสินค้าชำรุด:
                      </td>
                      <td className="p-1.5 text-right font-mono text-rose-700">
                        {formatCurrency(defectiveTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* SECTION 2: Normal / Overstock / Unsold Items */}
            {overstockItems.length > 0 && (
              <div className="space-y-1 pt-1">
                <div className="flex items-center justify-between border-b border-sky-200 pb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-sky-500"></span>
                    <h4 className="font-extrabold text-slate-900 text-xs flex items-center gap-1">
                      <Package className="w-3.5 h-3.5 text-sky-600" />
                      <span>หมวด 2: สินค้าปกติ / ขายไม่ออก / คืนสต็อก (Overstock Returns)</span>
                    </h4>
                  </div>
                  <span className="text-[10px] font-bold text-sky-700 bg-sky-50 px-1.5 py-0.2 rounded border border-sky-200">
                    {overstockItems.length} รายการ
                  </span>
                </div>

                <table className="w-full text-[10px] border border-slate-200">
                  <thead className="bg-sky-50/50 text-slate-700 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-1.5 text-center w-8">ลำดับ</th>
                      <th className="p-1.5 text-left">รายการสินค้า / SKU</th>
                      <th className="p-1.5 text-left w-36">เหตุผลการส่งคืน</th>
                      <th className="p-1.5 text-right w-14">จำนวน</th>
                      <th className="p-1.5 text-right w-20">ราคาทุน (฿)</th>
                      <th className="p-1.5 text-right w-24">รวมทุน (฿)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {overstockItems.map((item, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/60">
                        <td className="p-1.5 text-center text-slate-500">{idx + 1}</td>
                        <td className="p-1.5">
                          <p className="font-bold text-slate-900 leading-tight">{item.productName}</p>
                          <p className="text-[9px] text-slate-500 font-mono">SKU: {item.sku}</p>
                        </td>
                        <td className="p-1.5 text-sky-800 font-medium leading-tight">
                          {item.returnReason || 'สินค้าปกติขายไม่ออก / คืนสต็อก'}
                        </td>
                        <td className="p-1.5 text-right font-mono font-bold">
                          {item.quantity} {item.unitName || 'ชิ้น'}
                        </td>
                        <td className="p-1.5 text-right font-mono">{formatCurrency(item.unitCost)}</td>
                        <td className="p-1.5 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(item.totalCost)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-sky-50/40 font-bold text-slate-900 border-t border-slate-300">
                      <td colSpan={5} className="p-1.5 text-right text-sky-900">
                        รวมราคาทุนสินค้าปกติ:
                      </td>
                      <td className="p-1.5 text-right font-mono text-sky-700">
                        {formatCurrency(overstockTotal)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Grand Totals & Debt Deduction Reconciliation Box */}
            <div className="grid grid-cols-2 gap-3 pt-1">
              <div className="space-y-1.5 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[10px]">
                <p className="font-bold text-slate-700 flex items-center gap-1">
                  <Tag className="w-3 h-3 text-indigo-600" />
                  <span>หมายเหตุประกอบเอกสาร:</span>
                </p>
                <p className="text-slate-600 leading-relaxed italic">
                  {returnNote.notes || 'ส่งคืนสินค้าตามข้อตกลงเพื่อหักลดยอดหนี้ในใบเรียกเก็บเงิน/ใบสั่งซื้อของบริษัท'}
                </p>

                {returnNote.deductions && returnNote.deductions.length > 0 && (
                  <div className="pt-1.5 border-t border-slate-200 space-y-0.5 text-[9.5px]">
                    <span className="font-bold text-slate-700 block">ประวัติการตัดหนี้ในใบ PO:</span>
                    {returnNote.deductions.map((d, i) => (
                      <div key={i} className="flex justify-between text-slate-600">
                        <span>• ตัดหนี้บิล {d.billNumber}:</span>
                        <strong className="text-emerald-700 font-mono">-{formatCurrency(d.deductedAmount)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1 bg-indigo-50/50 p-2.5 rounded-lg border border-indigo-200 text-[10.5px]">
                <div className="flex justify-between text-slate-600">
                  <span>รวมจำนวนสินค้าที่ส่งคืน:</span>
                  <span className="font-bold font-mono text-slate-900">{returnNote.totalQuantity} ชิ้น</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>ยอดสินค้าชำรุด (หมวด 1):</span>
                  <span className="font-mono text-slate-800">{formatCurrency(defectiveTotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>ยอดสินค้าปกติ (หมวด 2):</span>
                  <span className="font-mono text-slate-800">{formatCurrency(overstockTotal)}</span>
                </div>
                <div className="flex justify-between text-slate-600">
                  <span>รวมราคาทุนสินค้าทั้งหมด:</span>
                  <span className="font-mono text-slate-800">{formatCurrency(totalItemCost)}</span>
                </div>
                {Math.abs(totalItemCost - returnNote.totalCreditAmount) > 0.01 && (
                  <div className="flex justify-between text-[10px] text-amber-900 font-bold bg-amber-50/80 px-1.5 py-0.2 rounded border border-amber-200">
                    <span>ปรับยอดหักบิล / ส่วนลดท้ายบิล:</span>
                    <span className="font-mono">
                      {returnNote.totalCreditAmount < totalItemCost ? '-' : '+'}
                      {formatCurrency(Math.abs(totalItemCost - returnNote.totalCreditAmount))}
                    </span>
                  </div>
                )}
                <div className="flex justify-between border-t border-indigo-200 pt-1 text-xs font-black text-indigo-950">
                  <span>มูลค่าลดหนี้สุทธิที่หักจริง (Total Credit):</span>
                  <span className="font-mono text-indigo-700 text-sm">{formatCurrency(returnNote.totalCreditAmount)}</span>
                </div>
                <div className="flex justify-between text-[10px] text-slate-600 pt-0.5 font-semibold">
                  <span>เครดิตคงเหลือที่ยังไม่ได้หัก:</span>
                  <span className="font-mono text-emerald-700">{formatCurrency(returnNote.remainingCreditAmount)}</span>
                </div>
              </div>
            </div>

            {/* Signature Blocks (Compact) */}
            <div className="grid grid-cols-2 gap-6 pt-4 text-[10px]">
              <div className="text-center space-y-6">
                <p className="font-bold text-slate-700">ผู้ส่งคืนสินค้า (ตัวแทนร้านปุริม)</p>
                <div className="border-b border-dashed border-slate-400 w-40 mx-auto"></div>
                <p className="text-slate-500">วันที่: ......./......./............</p>
              </div>
              <div className="text-center space-y-6">
                <p className="font-bold text-slate-700">ผู้รับมอบสินค้า (ตัวแทนบริษัทผู้จำหน่าย)</p>
                <div className="border-b border-dashed border-slate-400 w-40 mx-auto"></div>
                <p className="text-slate-500">วันที่: ......./......./............</p>
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <DialogFooter className="pt-2.5 border-t border-slate-200 flex justify-between items-center shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="rounded-xl font-bold text-slate-700"
          >
            ปิดหน้าต่าง
          </Button>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handlePrint}
              className="gap-1.5 rounded-xl font-bold border-indigo-300 text-indigo-700 hover:bg-indigo-50"
            >
              <Printer className="w-4 h-4" />
              <span>พิมพ์เอกสาร (Print)</span>
            </Button>

            <Button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExporting}
              className="gap-1.5 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md"
            >
              <Download className="w-4 h-4" />
              <span>{isExporting ? 'กำลังสร้าง PDF...' : 'ดาวน์โหลด PDF (A4)'}</span>
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
