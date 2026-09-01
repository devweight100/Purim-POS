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
import { formatCurrency, thaiBahtText } from '@/lib/utils';
import { SupplierReturnNote } from '@/lib/types';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';
import { toast } from 'sonner';

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
  const storeSettings = loadStoreSettings();

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

  // Print via iframe with 100% WYSIWYG style preservation
  const handlePrint = () => {
    if (!docRef.current) return;
    printDocumentIframe(docRef.current, `ใบส่งคืนสินค้า / ใบลดหนี้ - ${returnNote.id}`, 'a4');
  };

  // Export to PDF (Strict WYSIWYG A4 Fit)
  const handleDownloadPdf = async () => {
    if (!docRef.current) return;
    setIsExporting(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'supplier-return-pdf' });
    try {
      const filename = `DebitNote_${returnNote.id}.pdf`;
      const success = await exportElementToPdf(docRef.current, filename, 'a4');
      if (success) {
        toast.success('ดาวน์โหลดไฟล์ PDF สำเร็จเรียบร้อย', { id: 'supplier-return-pdf' });
      } else {
        toast.error('ไม่สามารถสร้างไฟล์ PDF ได้', { id: 'supplier-return-pdf' });
      }
    } catch (e) {
      console.error('PDF export failed:', e);
      toast.error('สร้าง PDF ไม่สำเร็จ', { id: 'supplier-return-pdf' });
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

        {/* Scrollable Printable Document Preview (A4 Sheet Preview) */}
        <div className="flex-1 overflow-y-auto pr-1 py-4 flex justify-center bg-slate-200/70 rounded-2xl border border-slate-300">
          <div
            ref={docRef}
            className="a4-doc-sheet w-[210mm] max-w-[210mm] min-h-[297mm] bg-white border border-slate-300 rounded-sm p-[10mm] shadow-2xl text-slate-800 text-[11.5px] flex flex-col justify-between box-border select-none"
            style={{ width: '210mm', maxWidth: '210mm', minHeight: '297mm', boxSizing: 'border-box' }}
          >
            <div className="space-y-3.5">
            {/* Store & Document Header */}
            <div className="flex justify-between items-start border-b-2 border-slate-800 pb-3.5">
              <div className="space-y-1 max-w-[58%]">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-indigo-600 text-white font-black flex items-center justify-center text-xs">
                    P
                  </div>
                  <h2 className="text-base font-black text-slate-900">{storeSettings.storeName || 'ร้านปุริม POS'}</h2>
                </div>
                {storeSettings.branchName && (
                  <p className="text-[10.5px] text-slate-600 font-medium">สาขา: {storeSettings.branchName}</p>
                )}
                <p className="text-slate-600 text-[10.5px] leading-tight">
                  {storeSettings.storeAddress}
                </p>
                <div className="text-[10.5px] text-slate-600 flex flex-wrap gap-x-3">
                  {storeSettings.taxId && <span><b>เลขผู้เสียภาษี:</b> {storeSettings.taxId}</span>}
                  {storeSettings.storePhone && <span><b>โทร:</b> {storeSettings.storePhone}</span>}
                </div>
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

            {/* ─── FIXED-HEIGHT RETURN ITEMS TABLE FRAME (Expanded by 5 lines to fill A4 sheet) ─── */}
            <div className="border border-slate-300 rounded-xl overflow-hidden min-h-[155mm] flex flex-col justify-between bg-white">
              <table className="w-full h-full flex-1 border-collapse text-xs">
                <thead className="bg-slate-100 text-slate-800 font-bold border-b-2 border-slate-300">
                  <tr>
                    <th className="py-2.5 px-2 text-center w-12 border-r border-slate-300">ลำดับ</th>
                    <th className="py-2.5 px-3 text-center border-r border-slate-300">รายการสินค้า / รหัสสินค้า (SKU)</th>
                    <th className="py-2.5 px-2.5 text-center w-48 border-r border-slate-300">หมวดหมู่ / อาการชำรุด / เหตุผล</th>
                    <th className="py-2.5 px-2 text-center w-20 border-r border-slate-300">จำนวน</th>
                    <th className="py-2.5 px-2.5 text-center w-24 border-r border-slate-300">ราคาทุน (฿)</th>
                    <th className="py-2.5 px-3 text-center w-28">รวมทุน (฿)</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Category 1: Defective Items */}
                  {defectiveItems.map((item, idx) => (
                    <tr key={`def-${idx}`} className="hover:bg-slate-50/50">
                      <td className="py-2 px-2 text-center font-mono text-slate-500 border-r border-slate-300">{idx + 1}</td>
                      <td className="py-2 px-3 border-r border-slate-300">
                        <p className="font-bold text-slate-900 leading-tight">{item.productName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">SKU: {item.sku}</p>
                        {item.claimId && (
                          <p className="text-[9.5px] text-indigo-600 font-mono font-medium">ใบเคลม: #{item.claimId}</p>
                        )}
                      </td>
                      <td className="py-2 px-2.5 text-rose-700 font-medium leading-tight border-r border-slate-300">
                        <span className="inline-block bg-rose-50 text-rose-700 border border-rose-200 text-[10px] px-1.5 py-0.5 rounded font-bold mr-1">ชำรุด</span>
                        {item.defectReason || 'สินค้าชำรุดจากการใช้งาน'}
                      </td>
                      <td className="py-2 px-2 text-center font-mono font-bold border-r border-slate-300">
                        {item.quantity} {item.unitName || 'ชิ้น'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono border-r border-slate-300">{formatCurrency(item.unitCost)}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(item.totalCost)}
                      </td>
                    </tr>
                  ))}

                  {/* Category 2: Overstock Items */}
                  {overstockItems.map((item, idx) => (
                    <tr key={`ovs-${idx}`} className="hover:bg-slate-50/50">
                      <td className="py-2 px-2 text-center font-mono text-slate-500 border-r border-slate-300">{defectiveItems.length + idx + 1}</td>
                      <td className="py-2 px-3 border-r border-slate-300">
                        <p className="font-bold text-slate-900 leading-tight">{item.productName}</p>
                        <p className="text-[10px] text-slate-500 font-mono">SKU: {item.sku}</p>
                      </td>
                      <td className="py-2 px-2.5 text-sky-800 font-medium leading-tight border-r border-slate-300">
                        <span className="inline-block bg-sky-50 text-sky-700 border border-sky-200 text-[10px] px-1.5 py-0.5 rounded font-bold mr-1">คืนสต็อก</span>
                        {item.returnReason || 'สินค้าปกติขายไม่ออก / คืนสต็อก'}
                      </td>
                      <td className="py-2 px-2 text-center font-mono font-bold border-r border-slate-300">
                        {item.quantity} {item.unitName || 'ชิ้น'}
                      </td>
                      <td className="py-2 px-2.5 text-right font-mono border-r border-slate-300">{formatCurrency(item.unitCost)}</td>
                      <td className="py-2 px-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(item.totalCost)}
                      </td>
                    </tr>
                  ))}

                  {/* Empty Space Row: Vertical lines extend down to the bottom border with ZERO horizontal lines */}
                  <tr className="h-full">
                    <td className="py-2 px-2 border-r border-slate-300">&nbsp;</td>
                    <td className="py-2 px-3 border-r border-slate-300">&nbsp;</td>
                    <td className="py-2 px-2.5 border-r border-slate-300">&nbsp;</td>
                    <td className="py-2 px-2 border-r border-slate-300">&nbsp;</td>
                    <td className="py-2 px-2.5 border-r border-slate-300">&nbsp;</td>
                    <td className="py-2 px-3">&nbsp;</td>
                  </tr>
                </tbody>
              </table>

              {/* Bottom of the table frame: Total Summary Bar */}
              <div className="border-t-2 border-slate-300 bg-slate-50 p-3 space-y-1.5 shrink-0">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-slate-700 font-medium">
                    จำนวนสินค้ารวม: <b className="text-slate-900 font-mono font-bold">{returnNote.totalQuantity} ชิ้น</b>
                    {defectiveItems.length > 0 && overstockItems.length > 0 && (
                      <span className="text-slate-500 ml-2">(ชำรุด {formatCurrency(defectiveTotal)} • ปกติ {formatCurrency(overstockTotal)})</span>
                    )}
                  </span>
                  <span className="font-bold text-indigo-900 text-xs font-sans">
                    ({thaiBahtText(returnNote.totalCreditAmount)})
                  </span>
                </div>
                <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                  <span className="font-black text-slate-900 text-sm">
                    มูลค่าลดหนี้สุทธิที่หักจริง (Total Credit Amount):
                  </span>
                  <span className="font-black text-indigo-700 text-base font-mono">
                    {formatCurrency(returnNote.totalCreditAmount)}
                  </span>
                </div>
              </div>
            </div>

            {/* Notes & Deductions Summary Row */}
            <div className="grid grid-cols-2 gap-3 pt-0.5">
              <div className="space-y-1 bg-slate-50 p-2.5 rounded-lg border border-slate-200 text-[10.5px]">
                <p className="font-bold text-slate-700 flex items-center gap-1">
                  <Tag className="w-3 h-3 text-indigo-600" />
                  <span>หมายเหตุประกอบเอกสาร:</span>
                </p>
                <p className="text-slate-600 leading-relaxed italic">
                  {returnNote.notes || 'ส่งคืนสินค้าตามข้อตกลงเพื่อหักลดยอดหนี้ในใบเรียกเก็บเงิน/ใบสั่งซื้อของบริษัท'}
                </p>
              </div>

              <div className="space-y-1 bg-indigo-50/40 p-2.5 rounded-lg border border-indigo-200 text-[10.5px]">
                <div className="flex justify-between text-slate-600">
                  <span>เครดิตคงเหลือที่ยังไม่ได้หัก:</span>
                  <strong className="font-mono text-emerald-700 font-bold">{formatCurrency(returnNote.remainingCreditAmount)}</strong>
                </div>
                {returnNote.deductions && returnNote.deductions.length > 0 && (
                  <div className="pt-1 border-t border-indigo-200 space-y-0.5 text-[9.5px]">
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
            </div>

            </div>

            {/* Signature Blocks (Pinned at bottom of A4) */}
            <div className="mt-auto pt-6 pb-2 border-t border-slate-300 grid grid-cols-2 gap-8 text-center text-xs">
              <div className="space-y-4">
                <p className="font-bold text-slate-700">ผู้ส่งคืนสินค้า (ตัวแทนร้านปุริม)</p>
                <div className="border-b border-dashed border-slate-400 w-44 mx-auto"></div>
                <p className="text-slate-500 text-[10.5px]">วันที่: ......./......./............</p>
              </div>
              <div className="space-y-4">
                <p className="font-bold text-slate-700">ผู้รับมอบสินค้า (ตัวแทนบริษัทผู้จำหน่าย)</p>
                <div className="border-b border-dashed border-slate-400 w-44 mx-auto"></div>
                <p className="text-slate-500 text-[10.5px]">วันที่: ......./......./............</p>
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
