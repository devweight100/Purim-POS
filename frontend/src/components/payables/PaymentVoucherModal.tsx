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
import { PayablePaymentEntry, SupplierPayableBill, PaymentVoucher } from '@/lib/payable-service';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';
import { toast } from 'sonner';

interface PaymentVoucherModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  voucher?: PaymentVoucher | null;
  paymentEntry?: PayablePaymentEntry | null;
  bill?: SupplierPayableBill | null;
}

export function PaymentVoucherModal({
  open,
  onOpenChange,
  voucher,
  paymentEntry,
  bill,
}: PaymentVoucherModalProps) {
  const docRef = useRef<HTMLDivElement>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [storeSettings] = useState(() => loadStoreSettings());

  // Consolidate into unified voucher data
  const data: PaymentVoucher | null = voucher || (paymentEntry && bill ? {
    id: paymentEntry.id,
    voucherNumber: paymentEntry.id,
    supplierId: bill.supplierId,
    supplierName: bill.supplierName,
    supplierContact: bill.supplierContact,
    supplierPhone: bill.supplierPhone,
    supplierAddress: bill.supplierAddress,
    paymentDate: paymentEntry.paymentDate,
    bills: [
      {
        poId: bill.poId,
        poNumber: bill.poNumber,
        supplierInvoiceNo: bill.supplierInvoiceNo || '',
        billDate: bill.billDate,
        totalBillAmount: paymentEntry.totalBillAmount,
        remainingBeforePay: paymentEntry.totalBillAmount,
        amountPaid: paymentEntry.netCashOrTransferPaid,
      }
    ],
    totalBillsAmount: paymentEntry.totalBillAmount,
    deductedCreditAmount: paymentEntry.deductedCreditAmount || 0,
    deductedNotes: paymentEntry.deductedNotes || [],
    discountAmount: paymentEntry.discountAmount,
    netPaidAmount: paymentEntry.netCashOrTransferPaid,
    paymentMethod: paymentEntry.paymentMethod,
    bankAccountId: paymentEntry.bankAccountId,
    bankAccountLabel: paymentEntry.bankAccountLabel,
    referenceNo: paymentEntry.referenceNo,
    note: paymentEntry.note,
    cashierName: paymentEntry.cashierName || 'เจ้าหน้าที่การเงิน',
    createdAt: paymentEntry.paymentDate,
  } : null);

  if (!data) return null;

  const handlePrint = () => {
    if (!docRef.current) return;
    printDocumentIframe(docRef.current, `ใบสำคัญจ่าย - ${data.voucherNumber}`, 'a4');
  };

  const handleDownloadPdf = async () => {
    if (!docRef.current) return;
    setIsExporting(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'voucher-pdf-gen' });
    try {
      const filename = `PaymentVoucher_${data.voucherNumber}.pdf`;
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-5xl max-h-[95vh] flex flex-col bg-slate-100 border-slate-300 text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl overflow-hidden font-sans">
        <DialogHeader className="pb-2.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-extrabold flex items-center gap-2 text-slate-800">
              <FileText className="w-5 h-5 text-indigo-600" />
              <span>ตัวอย่างใบสำคัญจ่าย (Payment Voucher Preview)</span>
            </DialogTitle>
            <div className="flex items-center gap-2">
              {data.status === 'CANCELLED' && (
                <Badge className="bg-rose-600 text-white font-bold text-xs px-2.5 py-0.5">
                  ยกเลิกแล้ว (VOID)
                </Badge>
              )}
              <Badge variant="outline" className="font-mono text-xs px-2.5 py-0.5 bg-white font-bold text-indigo-700 border-indigo-200">
                {data.voucherNumber}
              </Badge>
            </div>
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
              {data.status === 'CANCELLED' && (
                <div className="bg-rose-50 border-2 border-dashed border-rose-400 p-2.5 rounded-lg text-rose-900 flex items-center justify-between text-xs">
                  <div>
                    <span className="font-black text-rose-700 uppercase tracking-wide">⚠️ เอกสารนี้ถูกยกเลิกแล้ว (VOID / CANCELLED)</span>
                    {data.cancelReason && <p className="text-[11px] text-rose-800 mt-0.5 font-medium">เหตุผล: {data.cancelReason}</p>}
                  </div>
                  {data.cancelledAt && (
                    <span className="text-[10px] text-rose-600 font-mono">
                      ยกเลิกเมื่อ: {new Date(data.cancelledAt).toLocaleString('th-TH')}
                    </span>
                  )}
                </div>
              )}

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
                  <div className="flex items-center justify-end gap-2">
                    <h1 className="text-xl font-black text-indigo-950 uppercase tracking-wide">
                      ใบสำคัญจ่าย
                    </h1>
                    {data.status === 'CANCELLED' && (
                      <span className="text-rose-600 text-xs font-black border border-rose-600 px-1.5 py-0.2 rounded">
                        ยกเลิกแล้ว
                      </span>
                    )}
                  </div>
                  <p className="text-[10px] font-bold text-slate-500 tracking-widest uppercase">
                    PAYMENT VOUCHER
                  </p>
                  <div className="pt-1 text-[10.5px] space-y-0.5 font-mono">
                    <p><span className="text-slate-500 font-sans">เลขที่เอกสาร:</span> <b className="text-indigo-700 font-bold">{data.voucherNumber}</b></p>
                    <p><span className="text-slate-500 font-sans">วันที่จ่ายเงิน:</span> <b>{new Date(data.paymentDate).toLocaleDateString('th-TH')}</b></p>
                    <p><span className="text-slate-500 font-sans">จำนวนบิลที่จ่าย:</span> <b className="text-amber-800 font-bold">{data.bills.length} บิล</b></p>
                  </div>
                </div>
              </div>

              {/* Payee / Supplier Box & Payment Method */}
              <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                <div className="space-y-0.5 border-r border-slate-200 pr-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    จ่ายให้แก่ผู้จำหน่าย (Payee / Supplier):
                  </span>
                  <p className="font-extrabold text-slate-900 text-sm">{data.supplierName}</p>
                  {data.supplierContact && <p className="text-slate-600">ผู้ติดต่อ: {data.supplierContact}</p>}
                  {data.supplierPhone && <p className="text-slate-600 font-mono">โทร: {data.supplierPhone}</p>}
                  {data.supplierAddress && <p className="text-slate-500 text-[10px]">{data.supplierAddress}</p>}
                </div>

                <div className="space-y-1 pl-2">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                    วิธีการชำระเงิน (Payment Method):
                  </span>
                  <div className="flex items-center gap-2">
                    <Badge className="bg-emerald-600 text-white font-bold text-xs px-2 py-0.5">
                      {data.paymentMethod === 'CASH'
                        ? '💵 ชำระด้วยเงินสด (Cash)'
                        : data.paymentMethod === 'TRANSFER'
                        ? '📱 โอนเงินผ่านธนาคาร (Bank Transfer)'
                        : '💳 เช็ค / อื่นๆ'}
                    </Badge>
                  </div>
                  {data.bankAccountLabel && (
                    <p className="text-slate-700 text-[11px] font-medium mt-0.5">
                      บัญชี: <span className="font-mono">{data.bankAccountLabel}</span>
                    </p>
                  )}
                  {data.referenceNo && (
                    <p className="text-slate-500 text-[10.5px] font-mono">
                      เลขอ้างอิง / สลิปโอน: {data.referenceNo}
                    </p>
                  )}
                </div>
              </div>

              {/* ─── FIXED-HEIGHT TABLE FRAME (Expanded by 5 lines to fill A4 sheet) ─── */}
              {/* Outer frame is fixed in height so layout never collapses or jumps */}
              <div className="border border-slate-300 rounded-xl overflow-hidden min-h-[150mm] flex flex-col justify-between bg-white">
                <table className="w-full h-full flex-1 border-collapse text-xs">
                  <thead className="bg-slate-100 text-slate-800 font-bold border-b-2 border-slate-300">
                    <tr>
                      <th className="py-2.5 px-3 text-center w-14 border-r border-slate-300">ลำดับ</th>
                      <th className="py-2.5 px-3 text-center border-r border-slate-300">รายการบิล / เลขที่ Invoice / อ้างอิง PO</th>
                      <th className="py-2.5 px-3 text-center w-44">จำนวนเงิน (บาท)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Bill Item Rows */}
                    {data.bills.map((b, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50">
                        <td className="py-2.5 px-3 text-center font-mono text-slate-500 border-r border-slate-300">{idx + 1}</td>
                        <td className="py-2.5 px-3 border-r border-slate-300">
                          <p className="font-bold text-slate-900">
                            ชำระค่าสินค้าตามบิล Invoice: {b.supplierInvoiceNo ? (
                              <span className="text-indigo-700 font-mono font-bold">{b.supplierInvoiceNo}</span>
                            ) : (
                              <span className="text-slate-400 font-normal italic">ไม่ระบุเลขที่บิล</span>
                            )}
                            <span className="text-slate-500 font-normal ml-2 font-mono text-[11px]">(PO: {b.poNumber})</span>
                          </p>
                          <p className="text-[10.5px] text-slate-500">
                            วันที่ในบิล: {new Date(b.billDate).toLocaleDateString('th-TH')}
                            {b.totalBillAmount > b.amountPaid && (
                              <span className="text-amber-800 font-medium ml-2">• ยอดบิลเต็ม: {formatCurrency(b.totalBillAmount)} (ตัดจ่ายครั้งนี้)</span>
                            )}
                          </p>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900">
                          {formatCurrency(b.amountPaid)}
                        </td>
                      </tr>
                    ))}

                    {/* Deducted Debit Notes */}
                    {data.deductedNotes.map((dn, idx) => (
                      <tr key={`dn-${idx}`} className="bg-indigo-50/30">
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
                    {data.discountAmount && data.discountAmount > 0 && (
                      <tr className="bg-amber-50/30">
                        <td className="py-2.5 px-3 text-center font-bold text-amber-700 border-r border-slate-300">%</td>
                        <td className="py-2.5 px-3 border-r border-slate-300 text-amber-950">
                          <p className="font-bold">ส่วนลดท้ายบิลจากผู้จำหน่าย</p>
                          <p className="text-[10.5px] text-amber-700">ส่วนลดเจรจาการค้าตามข้อตกลง</p>
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-amber-700">
                          -{formatCurrency(data.discountAmount)}
                        </td>
                      </tr>
                    )}

                    {/* Empty Space Row: Vertical lines extend down to the bottom border with ZERO horizontal lines */}
                    <tr className="h-full">
                      <td className="py-2.5 px-3 border-r border-slate-300">&nbsp;</td>
                      <td className="py-2.5 px-3 border-r border-slate-300">&nbsp;</td>
                      <td className="py-2.5 px-3">&nbsp;</td>
                    </tr>
                  </tbody>
                </table>

                {/* Bottom of the table frame: Total Summary bar */}
                <div className="border-t-2 border-slate-300 bg-slate-50 p-3 space-y-1.5">
                  {data.bills.length > 1 && (
                    <div className="flex justify-between items-center text-xs pb-1 border-b border-slate-200">
                      <span className="text-slate-600">
                        รวมยอดบิลที่ตัดจ่ายทั้งหมด ({data.bills.length} ใบ):
                      </span>
                      <span className="font-mono font-bold text-slate-800">
                        {formatCurrency(data.totalBillsAmount)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="font-bold text-slate-700 text-xs">จำนวนเงินตัวอักษร:</span>
                    <span className="font-bold text-indigo-900 text-xs font-sans">
                      ({thaiBahtText(data.netPaidAmount)})
                    </span>
                  </div>
                  <div className="flex justify-between items-center pt-1 border-t border-slate-200">
                    <span className="font-black text-slate-900 text-sm">
                      ยอดเงินสุทธิที่จ่ายจริง (Net Paid Amount):
                    </span>
                    <span className="font-black text-emerald-800 text-base font-mono">
                      {formatCurrency(data.netPaidAmount)}
                    </span>
                  </div>
                </div>
              </div>

              {data.note && (
                <div className="text-[11px] text-slate-600 bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-0.5">
                  <span className="font-bold text-slate-800 block">หมายเหตุเพิ่มเติม:</span>
                  <p className="whitespace-pre-wrap leading-relaxed">{data.note}</p>
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
                    <p>( {data.supplierName} )</p>
                    <p>วันที่: ......./......./............</p>
                  </div>
                </div>
              </div>

              <div className="pt-4 flex justify-between items-center text-[10.5px] text-slate-600 border-t border-slate-200 mt-4">
                <span>ผู้จัดทำเอกสาร: <b className="text-slate-900 font-sans">{data.cashierName || 'เจ้าหน้าที่การเงิน'}</b></span>
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
