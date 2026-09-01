'use client';

import { useRef, useState } from 'react';
import { 
  Building2, CheckCircle2, Download, Printer, 
  FileText, Store, Phone, MapPin, Hash
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
import { PayablePaymentEntry, SupplierPayableBill } from '@/lib/payable-service';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';
import { toast } from 'sonner';

interface PaymentVoucherModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  paymentEntry: PayablePaymentEntry | null;
  bill: SupplierPayableBill | null;
}

export function PaymentVoucherModal({
  open,
  onOpenChange,
  paymentEntry,
  bill,
}: PaymentVoucherModalProps) {
  const docRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [storeSettings] = useState(() => loadStoreSettings());

  if (!paymentEntry || !bill) return null;

  const handlePrint = () => {
    if (!docRef.current) return;
    printDocumentIframe(docRef.current, `ใบสำคัญจ่าย - ${paymentEntry.id}`, 'a4');
  };

  const handleDownloadPdf = async () => {
    if (!docRef.current) return;
    setIsExporting(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'voucher-pdf-gen' });
    try {
      const filename = `PaymentVoucher_${paymentEntry.id}.pdf`;
      const success = await exportElementToPdf(docRef.current, filename, 'a4');
      if (success) {
        toast.success('ดาวน์โหลดใบสำคัญจ่าย (PDF) สำเร็จเรียบร้อย', { id: 'voucher-pdf-gen' });
      } else {
        toast.error('ไม่สามารถสร้างไฟล์ PDF ได้', { id: 'voucher-pdf-gen' });
      }
    } catch (err) {
      console.error('PDF export failed:', err);
      toast.error('เกิดข้อผิดพลาดในการสร้างไฟล์ PDF', { id: 'voucher-pdf-gen' });
    } finally {
      setIsExporting(false);
    }
  };

  const filledRowsCount = 1 + paymentEntry.deductedNotes.length + (paymentEntry.discountAmount && paymentEntry.discountAmount > 0 ? 1 : 0);
  const MIN_VOUCHER_ROWS = 9;
  const emptyRowsCount = Math.max(0, MIN_VOUCHER_ROWS - filledRowsCount);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-5xl max-h-[95vh] flex flex-col bg-slate-100 border-slate-300 text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl overflow-hidden font-sans">
        <DialogHeader className="pb-2.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-extrabold flex items-center gap-2 text-slate-800">
              <FileText className="w-5 h-5 text-indigo-600" />
              <span>ตัวอย่างใบสำคัญจ่าย (Payment Voucher Preview)</span>
            </DialogTitle>
            <Badge variant="outline" className="font-mono text-xs px-2.5 py-0.5 bg-white font-bold text-indigo-700 border-indigo-200">
              {paymentEntry.id}
            </Badge>
          </div>
        </DialogHeader>

        {/* Scrollable Container with centered true A4 Sheet */}
        <div className="flex-1 overflow-y-auto pr-1 py-4 flex justify-center bg-slate-200/70 rounded-2xl border border-slate-300">
          {/* Strict A4 Document Sheet: 210mm x 297mm with fixed bottom signature */}
          <div
            ref={docRef}
            className="w-[210mm] min-h-[297mm] max-w-[210mm] bg-white border border-slate-300 rounded-xs p-[10mm] shadow-xl text-slate-800 text-[11px] leading-relaxed flex flex-col justify-between box-border font-sans"
            style={{ width: '210mm', minHeight: '297mm', maxWidth: '210mm', boxSizing: 'border-box' }}
          >
            {/* ─── TOP SECTION: LETTERHEAD, DOCUMENT META & PAYEE INFO ─── */}
            <div className="space-y-4">
              {/* Letterhead */}
              <div className="flex justify-between items-start border-b-2 border-slate-800 pb-3">
                <div className="space-y-1 max-w-[60%]">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-black flex items-center justify-center text-sm shadow-xs">
                      <Store className="w-5 h-5" />
                    </div>
                    <div>
                      <h2 className="text-base font-black text-slate-900 leading-tight">
                        {storeSettings.storeName || 'ร้านปุริม POS'}
                      </h2>
                      {storeSettings.branchName && (
                        <p className="text-[10px] text-slate-500 font-medium">สาขา: {storeSettings.branchName}</p>
                      )}
                    </div>
                  </div>

                  {storeSettings.storeAddress && (
                    <p className="text-slate-600 text-[10px] leading-tight whitespace-pre-wrap">
                      {storeSettings.storeAddress}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-x-3 text-[10px] text-slate-600 font-mono">
                    {storeSettings.taxId && <span>เลขผู้เสียภาษี: <b>{storeSettings.taxId}</b></span>}
                    {storeSettings.storePhone && <span>โทร: <b>{storeSettings.storePhone}</b></span>}
                    {storeSettings.storeEmail && <span>อีเมล: <b>{storeSettings.storeEmail}</b></span>}
                  </div>
                </div>

                <div className="text-right space-y-1">
                  <h1 className="text-xl font-black text-indigo-950 uppercase tracking-wide">
                    ใบสำคัญจ่าย
                  </h1>
                  <p className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">
                    PAYMENT VOUCHER
                  </p>
                  <div className="pt-1 text-[10.5px] space-y-0.5 font-mono">
                    <p><span className="text-slate-500 font-sans">เลขที่เอกสาร:</span> <b className="text-indigo-700 font-bold">{paymentEntry.id}</b></p>
                    <p><span className="text-slate-500 font-sans">วันที่จ่ายเงิน:</span> <b>{new Date(paymentEntry.paymentDate).toLocaleDateString('th-TH')}</b></p>
                    <p><span className="text-slate-500 font-sans">อ้างอิงใบสั่งซื้อ (PO):</span> <b className="text-amber-800 font-bold">{bill.poNumber}</b></p>
                  </div>
                </div>
              </div>

              {/* Payee / Supplier Box & Payment Method */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div className="space-y-0.5 border-r border-slate-200 pr-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    จ่ายให้แก่ผู้จำหน่าย (Payee / Supplier):
                  </span>
                  <p className="font-extrabold text-slate-900 text-sm">{bill.supplierName}</p>
                  {bill.supplierContact && <p className="text-slate-600">ผู้ติดต่อ: {bill.supplierContact}</p>}
                  {bill.supplierPhone && <p className="text-slate-600 font-mono">โทร: {bill.supplierPhone}</p>}
                </div>

                <div className="space-y-1 pl-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    วิธีการชำระเงิน (Payment Method):
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-600 text-white font-bold text-xs px-2 py-0.5">
                      {paymentEntry.paymentMethod === 'CASH'
                        ? '💵 ชำระด้วยเงินสด (Cash)'
                        : paymentEntry.paymentMethod === 'TRANSFER'
                        ? '📱 โอนเงินผ่านธนาคาร (Bank Transfer)'
                        : '💳 เช็ค / อื่นๆ'}
                    </Badge>
                  </div>
                  {paymentEntry.bankAccountLabel && (
                    <p className="text-slate-700 text-[11px] font-medium mt-0.5">
                      บัญชี: <span className="font-mono">{paymentEntry.bankAccountLabel}</span>
                    </p>
                  )}
                  {paymentEntry.referenceNo && (
                    <p className="text-slate-500 text-[10.5px] font-mono">
                      เลขอ้างอิง / สลิปโอน: {paymentEntry.referenceNo}
                    </p>
                  )}
                </div>
              </div>

              {/* ─── FIXED-HEIGHT TABLE FRAME ─── */}
              {/* Outer frame is fixed in height so layout never collapses or jumps */}
              <div className="border border-slate-300 rounded-xl overflow-hidden min-h-[110mm] flex flex-col justify-between bg-white">
                <table className="w-full text-xs">
                  <thead className="bg-slate-100 text-slate-800 font-bold border-b-2 border-slate-300">
                    <tr>
                      <th className="py-2.5 px-3 text-center w-14 border-r border-slate-300">ลำดับ</th>
                      <th className="py-2.5 px-3 text-center border-r border-slate-300">รายการ / รายละเอียดการตัดจ่ายหนี้</th>
                      <th className="py-2.5 px-3 text-center w-44">จำนวนเงิน (บาท)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {/* Row 1: Bill Amount */}
                    <tr className="hover:bg-slate-50/50">
                      <td className="py-2.5 px-3 text-center font-mono text-slate-500 border-r border-slate-300">1</td>
                      <td className="py-2.5 px-3 border-r border-slate-300">
                        <p className="font-bold text-slate-900">ชำระค่าสินค้าตามใบสั่งซื้อเลขที่ {bill.poNumber}</p>
                        <p className="text-[10.5px] text-slate-500">วันที่เปิดบิลสั่งซื้อ: {new Date(bill.billDate).toLocaleDateString('th-TH')}</p>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                        {formatCurrency(paymentEntry.totalBillAmount)}
                      </td>
                    </tr>

                    {/* Deducted Debit Notes */}
                    {paymentEntry.deductedNotes.map((dn, idx) => (
                      <tr key={idx} className="bg-indigo-50/30">
                        <td className="py-2.5 px-3 text-center font-bold text-indigo-600 border-r border-slate-300">-</td>
                        <td className="py-2.5 px-3 border-r border-slate-300 text-indigo-950">
                          <p className="font-bold">หักประกบใบลดหนี้เลขที่ {dn.returnNoteId}</p>
                          <p className="text-[10.5px] text-indigo-700">เครดิตสินค้าชำรุด / ส่งคืนผู้จำหน่าย</p>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-indigo-700">
                          -{formatCurrency(dn.amount)}
                        </td>
                      </tr>
                    ))}

                    {/* Bill Discount */}
                    {paymentEntry.discountAmount && paymentEntry.discountAmount > 0 && (
                      <tr className="bg-amber-50/30">
                        <td className="py-2.5 px-3 text-center font-bold text-amber-700 border-r border-slate-300">%</td>
                        <td className="py-2.5 px-3 border-r border-slate-300 text-amber-950">
                          <p className="font-bold">ส่วนลดท้ายบิลจากผู้จำหน่าย</p>
                          <p className="text-[10.5px] text-amber-700">ส่วนลดเจรจาการค้าตามข้อตกลง</p>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                          -{formatCurrency(paymentEntry.discountAmount)}
                        </td>
                      </tr>
                    )}

                    {/* Empty Grid Rows so vertical lines run all the way down to hit the bottom border */}
                    {Array.from({ length: emptyRowsCount }).map((_, emptyIdx) => (
                      <tr key={`empty-${emptyIdx}`} className="h-8">
                        <td className="py-2.5 px-3 text-center border-r border-slate-300 text-transparent select-none">-</td>
                        <td className="py-2.5 px-3 border-r border-slate-300 text-transparent select-none">-</td>
                        <td className="py-2.5 px-3 text-transparent select-none">-</td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                {/* Bottom of the table frame: Total Summary bar */}
                <div className="border-t-2 border-slate-300 bg-slate-50 p-3 space-y-1.5">
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-700 text-xs">จำนวนเงินตัวอักษร:</span>
                    <span className="font-bold text-indigo-900 text-xs font-sans">
                      ({thaiBahtText(paymentEntry.netCashOrTransferPaid)})
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                    <span className="font-black text-slate-900 text-sm">
                      ยอดเงินสุทธิที่จ่ายจริง (Net Paid Amount):
                    </span>
                    <span className="font-black text-emerald-800 text-base font-mono">
                      {formatCurrency(paymentEntry.netCashOrTransferPaid)}
                    </span>
                  </div>
                </div>
              </div>

              {paymentEntry.note && (
                <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-0.5">
                  <span className="font-bold text-slate-800 block">หมายเหตุเพิ่มเติม:</span>
                  <p className="whitespace-pre-wrap leading-relaxed">{paymentEntry.note}</p>
                </div>
              )}
            </div>

            {/* ─── BOTTOM SECTION: SIGNATURE BLOCKS (ALWAYS PINNED TO BOTTOM) ─── */}
            <div className="mt-auto pt-6 pb-2 border-t border-slate-300">
              <div className="grid grid-cols-2 gap-12 text-center text-xs">
                {/* Sign 1: ผู้อนุมัติจ่าย */}
                <div className="space-y-6">
                  <p className="font-bold text-slate-800">ผู้อนุมัติจ่าย (Authorized By)</p>
                  <div className="border-b border-dashed border-slate-400 w-52 mx-auto"></div>
                  <div className="text-[10.5px] text-slate-500 space-y-0.5">
                    <p>( ผู้จัดการ / เจ้าของร้าน )</p>
                    <p>วันที่: ......./......./............</p>
                  </div>
                </div>

                {/* Sign 2: ผู้รับเงิน */}
                <div className="space-y-6">
                  <p className="font-bold text-slate-800">ผู้รับเงิน / ผู้แทนจำหน่าย (Received By)</p>
                  <div className="border-b border-dashed border-slate-400 w-52 mx-auto"></div>
                  <div className="text-[10.5px] text-slate-500 space-y-0.5">
                    <p>( {bill.supplierName} )</p>
                    <p>วันที่: ......./......./............</p>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-between items-center text-[10.5px] text-slate-600 border-t border-slate-200 mt-4">
                <span>ผู้จัดทำเอกสาร: <b className="text-slate-900 font-sans">{paymentEntry.cashierName || 'เจ้าหน้าที่การเงิน'}</b></span>
                <span className="font-mono text-slate-400 text-[9.5px]">เอกสารนี้ออกโดยระบบอัตโนมัติ Purim POS • พิมพ์เมื่อ {new Date().toLocaleString('th-TH')}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Modal Footer Controls */}
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
              className="gap-1.5 rounded-xl font-bold border-indigo-300 text-indigo-700 hover:bg-indigo-50 h-10 px-4"
            >
              <Printer className="w-4 h-4" />
              <span>พิมพ์ใบสำคัญจ่าย (A4)</span>
            </Button>

            <Button
              type="button"
              onClick={handleDownloadPdf}
              disabled={isExporting}
              className="gap-1.5 rounded-xl font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-md h-10 px-4"
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
