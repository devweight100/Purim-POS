'use client';

import { useRef, useState } from 'react';
import { 
  Building2, CheckCircle2, Download, Printer, 
  X, FileText, Receipt, DollarSign, Banknote
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
import { PayablePaymentEntry, SupplierPayableBill } from '@/lib/payable-service';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

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

  if (!paymentEntry || !bill) return null;

  const handlePrint = () => {
    if (!docRef.current) return;
    const printContent = docRef.current.innerHTML;
    const win = window.open('', '', 'width=900,height=800');
    if (win) {
      win.document.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>ใบสำคัญจ่าย - ${paymentEntry.id}</title>
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
              table { width: 100%; border-collapse: collapse; }
              th, td { border: 1px solid #cbd5e1; padding: 5px 8px; font-size: 10.5px; }
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
      const printWidth = pdfWidth - margin * 2;
      const printHeight = pdfHeight - margin * 2;
      const imgHeight = (canvas.height * printWidth) / canvas.width;

      if (imgHeight <= printHeight) {
        pdf.addImage(imgData, 'PNG', margin, margin, printWidth, imgHeight);
      } else {
        const fitScale = printHeight / imgHeight;
        if (fitScale >= 0.75) {
          pdf.addImage(imgData, 'PNG', margin, margin, printWidth * fitScale, printHeight);
        } else {
          pdf.addImage(imgData, 'PNG', margin, margin, printWidth, imgHeight);
        }
      }

      pdf.save(`Voucher_${paymentEntry.id}.pdf`);
    } catch (e) {
      console.error('PDF export failed:', e);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[92vh] flex flex-col bg-slate-100 border-slate-200 text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl overflow-hidden">
        <DialogHeader className="pb-2.5 border-b border-slate-200 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-lg font-bold flex items-center gap-2 text-slate-800">
              <FileText className="w-5 h-5 text-indigo-600" />
              <span>ใบสำคัญจ่าย (Payment Voucher)</span>
            </DialogTitle>
            <Badge variant="outline" className="font-mono text-xs px-2.5 py-0.5 bg-white font-bold text-indigo-700 border-indigo-200">
              {paymentEntry.id}
            </Badge>
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto pr-1 py-2 flex justify-center">
          <div
            ref={docRef}
            className="w-full max-w-[720px] bg-white border border-slate-200 rounded-xl p-6 shadow-sm text-slate-800 text-[11px] space-y-4"
          >
            {/* Header */}
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
                  ใบสำคัญจ่าย
                </h3>
                <p className="text-[10px] font-semibold text-slate-500">PAYMENT VOUCHER</p>
                <div className="pt-1 text-[10px] space-y-0.5 font-mono">
                  <p><b className="text-slate-700">เลขที่สำคัญจ่าย:</b> <span className="text-indigo-600 font-bold">{paymentEntry.id}</span></p>
                  <p><b className="text-slate-700">วันที่จ่าย:</b> {new Date(paymentEntry.paymentDate).toLocaleDateString('th-TH')}</p>
                  <p><b className="text-slate-700">อ้างอิงบิลสั่งซื้อ:</b> <span className="font-bold text-amber-700">{bill.poNumber}</span></p>
                </div>
              </div>
            </div>

            {/* Supplier Information */}
            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 flex justify-between text-[10.5px]">
              <div className="space-y-0.5">
                <span className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider block">
                  จ่ายให้แก่ (Payee):
                </span>
                <p className="font-bold text-slate-900 text-xs">{bill.supplierName}</p>
                {bill.supplierContact && <p className="text-slate-600">ผู้ติดต่อ: {bill.supplierContact}</p>}
                {bill.supplierPhone && <p className="text-slate-600">โทร: {bill.supplierPhone}</p>}
              </div>

              <div className="space-y-1 text-right">
                <span className="text-[9.5px] font-bold text-slate-500 uppercase tracking-wider block">
                  วิธีชำระเงิน:
                </span>
                <Badge className="bg-emerald-600 text-white font-bold text-[10px]">
                  {paymentEntry.paymentMethod === 'CASH'
                    ? '💵 เงินสด (Cash)'
                    : paymentEntry.paymentMethod === 'TRANSFER'
                    ? '📱 เงินโอน (Transfer)'
                    : '💳 เช็ค/อื่นๆ'}
                </Badge>
                {paymentEntry.bankAccountLabel && (
                  <p className="text-slate-600 text-[10px]">{paymentEntry.bankAccountLabel}</p>
                )}
                {paymentEntry.referenceNo && (
                  <p className="text-slate-500 text-[10px] font-mono">อ้างอิง: {paymentEntry.referenceNo}</p>
                )}
              </div>
            </div>

            {/* Breakdown Table */}
            <table className="w-full border border-slate-200 text-[10.5px]">
              <thead className="bg-slate-50 text-slate-700 font-bold border-b border-slate-200">
                <tr>
                  <th className="p-2 text-center w-10">ลำดับ</th>
                  <th className="p-2 text-left">รายการ / รายละเอียดการตัดจ่าย</th>
                  <th className="p-2 text-right w-36">จำนวนเงิน (฿)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                <tr>
                  <td className="p-2 text-center text-slate-500">1</td>
                  <td className="p-2">
                    <p className="font-bold text-slate-900">ชำระค่าสินค้าตามใบสั่งซื้อ {bill.poNumber}</p>
                    <p className="text-[10px] text-slate-500">วันที่เปิดบิล: {new Date(bill.billDate).toLocaleDateString('th-TH')}</p>
                  </td>
                  <td className="p-2 text-right font-mono font-bold text-slate-900">
                    {formatCurrency(paymentEntry.totalBillAmount)}
                  </td>
                </tr>

                {/* Deducted Debit Notes */}
                {paymentEntry.deductedNotes.map((dn, idx) => (
                  <tr key={idx} className="bg-indigo-50/40">
                    <td className="p-2 text-center text-indigo-700 font-bold">-</td>
                    <td className="p-2 text-indigo-950">
                      <p className="font-bold">ประกบหักเอกสารลดหนี้ {dn.returnNoteId}</p>
                      <p className="text-[10px] text-indigo-700">ใบลดหนี้สินค้าส่งคืน/สินค้าชำรุด</p>
                    </td>
                    <td className="p-2 text-right font-mono font-bold text-indigo-700">
                      -{formatCurrency(dn.amount)}
                    </td>
                  </tr>
                ))}

                <tr className="bg-slate-50 font-bold text-slate-900 border-t border-slate-300">
                  <td colSpan={2} className="p-2 text-right">
                    ยอดเงินสุทธิที่จ่ายจริง (Net Payment Paid):
                  </td>
                  <td className="p-2 text-right font-mono text-emerald-700 text-sm">
                    {formatCurrency(paymentEntry.netCashOrTransferPaid)}
                  </td>
                </tr>
              </tbody>
            </table>

            {paymentEntry.note && (
              <p className="text-[10px] text-slate-500 italic bg-slate-50 p-2 rounded border border-slate-200">
                หมายเหตุ: {paymentEntry.note}
              </p>
            )}

            {/* Signature Blocks */}
            <div className="grid grid-cols-2 gap-8 pt-6 text-[10px]">
              <div className="text-center space-y-6">
                <p className="font-bold text-slate-700">ผู้อนุมัติจ่าย (Authorized By)</p>
                <div className="border-b border-dashed border-slate-400 w-44 mx-auto"></div>
                <p className="text-slate-500">วันที่: ......./......./............</p>
              </div>
              <div className="text-center space-y-6">
                <p className="font-bold text-slate-700">ผู้รับเงิน / บริษัทผู้จำหน่าย (Received By)</p>
                <div className="border-b border-dashed border-slate-400 w-44 mx-auto"></div>
                <p className="text-slate-500">วันที่: ......./......./............</p>
              </div>
            </div>
          </div>
        </div>

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
              <span>พิมพ์ใบสำคัญจ่าย</span>
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
