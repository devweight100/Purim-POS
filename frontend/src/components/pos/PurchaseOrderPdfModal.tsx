'use client';

import { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, FileText, CheckCircle2, Store, Building2, Calendar, FileCheck } from 'lucide-react';
import { formatCurrency, formatDate } from '@/lib/utils';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { toast } from 'sonner';

export interface PurchaseOrderData {
  id: string;
  poNumber: string;
  createdAt: string;
  status: string;
  supplier?: {
    id?: string;
    name?: string;
    contactName?: string;
    phone?: string;
    email?: string;
    address?: string;
    creditTerms?: number;
  };
  supplierName?: string;
  totalAmount: number;
  discountType?: 'baht' | 'percent';
  discountValue?: number;
  items: Array<{
    id?: string;
    productId?: string;
    name?: string;
    sku?: string;
    quantity: number;
    receivedQuantity?: number;
    unitCost: number;
    unitName?: string;
    multiplier?: number;
    discountType?: 'baht' | 'percent';
    discountValue?: number;
  }>;
}

interface PurchaseOrderPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  po: PurchaseOrderData | null;
}

function thaiBahtText(num: number): string {
  if (!num || isNaN(num) || num <= 0) return "ศูนย์บาทถ้วน";
  const thaiNums = ["ศูนย์", "หนึ่ง", "สอง", "สาม", "สี่", "ห้า", "หก", "เจ็ด", "แปด", "เก้า"];
  const thaiUnits = ["", "สิบ", "ร้อย", "พัน", "หมื่น", "แสน", "ล้าน"];
  
  const [bahtStr, satangStr] = num.toFixed(2).split(".");
  let bahtVal = parseInt(bahtStr, 10);
  
  if (bahtVal === 0) return "ศูนย์บาทถ้วน";

  let result = "";
  const str = bahtVal.toString();
  const len = str.length;

  for (let i = 0; i < len; i++) {
    const digit = parseInt(str[i], 10);
    const pos = len - 1 - i;
    const unitPos = pos % 6;

    if (digit !== 0) {
      if (unitPos === 1 && digit === 1) {
        result += "สิบ";
      } else if (unitPos === 1 && digit === 2) {
        result += "ยี่สิบ";
      } else if (unitPos === 0 && digit === 1 && len > 1 && i === len - 1) {
        result += "เอ็ด";
      } else {
        result += thaiNums[digit] + thaiUnits[unitPos];
      }
    }
    if (unitPos === 0 && pos > 0) {
      result += "ล้าน";
    }
  }

  result += "บาท";
  const satangVal = parseInt(satangStr, 10);
  if (satangVal === 0) {
    result += "ถ้วน";
  } else {
    if (satangVal < 10) {
      result += thaiNums[satangVal] + "สตางค์";
    } else {
      const ten = Math.floor(satangVal / 10);
      const unit = satangVal % 10;
      if (ten === 1) result += "สิบ";
      else if (ten === 2) result += "ยี่สิบ";
      else result += thaiNums[ten] + "สิบ";

      if (unit === 1) result += "เอ็ด";
      else if (unit > 1) result += thaiNums[unit];
      result += "สตางค์";
    }
  }
  return result;
}

export default function PurchaseOrderPdfModal({ open, onOpenChange, po }: PurchaseOrderPdfModalProps) {
  const [isExporting, setIsExporting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  if (!po) return null;

  // Safeguard: Unpack if po was passed as an array or object
  const poData: any = Array.isArray(po) ? (po.length > 0 ? po[0] : null) : po;
  if (!poData || typeof poData !== 'object' || Object.keys(poData).length === 0) return null;

  const supplierObj = (poData.supplier && typeof poData.supplier === 'object') ? poData.supplier : {};
  const supplierName = supplierObj.name || poData.supplierName || (typeof poData.supplier === 'string' ? poData.supplier : '') || 'ไม่ระบุผู้จำหน่าย';
  const supplierContact = supplierObj.contactName || supplierObj.contact || poData.contactName || '-';
  const supplierPhone = supplierObj.phone || supplierObj.tel || poData.phone || '-';
  const supplierEmail = supplierObj.email || poData.email || '-';
  const supplierAddress = supplierObj.address || poData.address || '-';
  const creditTerms = supplierObj.creditTerms 
    ? `${supplierObj.creditTerms} วัน` 
    : (poData.creditTerms ? `${poData.creditTerms} วัน` : 'เงินสด / ครบกำหนดในวันส่งสินค้า');

  const poNumber = poData.poNumber || poData.poCode || poData.id || '-';
  const createdAt = poData.createdAt || poData.date || new Date().toISOString();
  const status = poData.status || 'DRAFT';

  // Item calculations
  const rawItems = poData.items || poData.orderItems || poData.purchaseOrderItems || [];
  const items = Array.isArray(rawItems) ? rawItems : [];

  const subtotalBeforeDiscount = items.reduce((sum: number, item: any) => {
    const qty = Number(item.quantity) || Number(item.qty) || 0;
    const cost = Number(item.unitCost) || Number(item.cost) || Number(item.price) || 0;
    const gross = qty * cost;
    const discVal = Number(item.discountValue) || 0;
    const disc = item.discountType === 'percent' ? gross * Math.min(discVal, 100) / 100 : discVal;
    return sum + Math.max(0, gross - disc);
  }, 0);

  const billDiscVal = Number(poData.discountValue) || 0;
  const billDiscountAmount = Math.min(
    subtotalBeforeDiscount,
    poData.discountType === 'percent'
      ? subtotalBeforeDiscount * Math.min(billDiscVal, 100) / 100
      : billDiscVal
  );

  const amountAfterBillDiscount = Math.max(0, subtotalBeforeDiscount - billDiscountAmount);
  const vatType = poData.vatType || (poData.hasVat ? 'include' : 'none');

  let calculatedVat = 0;
  let netBeforeVat = amountAfterBillDiscount;
  let finalTotal = amountAfterBillDiscount;

  if (vatType === 'include') {
    calculatedVat = amountAfterBillDiscount * 7 / 107;
    netBeforeVat = amountAfterBillDiscount - calculatedVat;
    finalTotal = Number(poData.totalAmount) || amountAfterBillDiscount;
  } else if (vatType === 'exclude') {
    calculatedVat = amountAfterBillDiscount * 0.07;
    netBeforeVat = amountAfterBillDiscount;
    finalTotal = Number(poData.totalAmount) || (amountAfterBillDiscount + calculatedVat);
  } else {
    calculatedVat = 0;
    netBeforeVat = amountAfterBillDiscount;
    finalTotal = Number(poData.totalAmount) || amountAfterBillDiscount;
  }

  const vatAmount = poData.vatAmount !== undefined && poData.vatAmount !== null ? Number(poData.vatAmount) : calculatedVat;
  const netAmount = poData.netAmount !== undefined && poData.netAmount !== null ? Number(poData.netAmount) : netBeforeVat;

  const handlePrint = () => {
    if (!printRef.current) return;
    const printContent = printRef.current.innerHTML;
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('กรุณาอนุญาตป๊อปอัปเพื่อพิมพ์เอกสาร');
      return;
    }

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>ใบสั่งซื้อ ${po.poNumber}</title>
          <style>
            @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap');
            * { box-sizing: border-box; margin: 0; padding: 0; font-family: 'Sarabun', sans-serif; }
            body { padding: 20px; color: #1e293b; background: #fff; font-size: 13px; line-height: 1.4; }
            .po-table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            .po-table th { background: #f8fafc; border: 1px solid #cbd5e1; padding: 8px 10px; font-weight: 700; text-align: left; }
            .po-table td { border: 1px solid #cbd5e1; padding: 8px 10px; }
            @media print {
              body { padding: 0; }
              @page { size: A4 portrait; margin: 15mm; }
            }
          </style>
          <script src="https://cdn.tailwindcss.com"></script>
        </head>
        <body onload="setTimeout(() => { window.print(); window.close(); }, 300)">
          ${printContent}
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleDownloadPdf = async () => {
    if (!printRef.current) return;
    setIsExporting(true);
    try {
      const canvas = await html2canvas(printRef.current, {
        scale: 2,
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });

      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;

      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`ใบสั่งซื้อ_${poNumber}.pdf`);
      toast.success('ดาวน์โหลดไฟล์ PDF เรียบร้อยแล้ว');
    } catch (err) {
      toast.error('เกิดข้อผิดพลาดในการสร้างไฟล์ PDF');
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-white border-slate-200 text-slate-900 max-w-4xl max-h-[92vh] overflow-y-auto p-0 flex flex-col">
        {/* Header Action Bar */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-6 py-4 sticky top-0 z-20 shrink-0">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-sky-600" />
            <h3 className="font-bold text-slate-900 text-lg">เอกสารใบสั่งซื้อ (PO: {poNumber})</h3>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handlePrint}
              className="border-slate-300 bg-white font-semibold text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <Printer className="w-4 h-4 mr-1.5 text-sky-600" /> พิมพ์เอกสาร (A4)
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={isExporting}
              onClick={handleDownloadPdf}
              className="bg-sky-500 hover:bg-sky-600 text-white font-semibold shadow-sm"
            >
              <Download className="w-4 h-4 mr-1.5" /> {isExporting ? 'กำลังสร้าง...' : 'ดาวน์โหลด PDF'}
            </Button>
          </div>
        </div>

        {/* Printable PO Sheet Container */}
        <div className="p-6 bg-slate-100/60 overflow-y-auto overflow-x-auto flex-1 flex justify-center">
          <div
            ref={printRef}
            className="w-full max-w-[210mm] min-h-[297mm] bg-white border border-slate-300 p-8 shadow-lg text-slate-800 flex flex-col justify-between"
            style={{ fontFamily: `'Sarabun', sans-serif` }}
          >
            {/* Top Company Header & Document Title */}
            <div>
              <div className="flex justify-between items-start border-b-2 border-slate-800 pb-5 mb-5">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <Store className="w-7 h-7 text-sky-600" />
                    <h1 className="text-2xl font-black text-slate-900 tracking-tight">ร้านปุริม POS / PURIM POS STORE</h1>
                  </div>
                  <p className="text-xs text-slate-600 font-medium">123/45 ถนนรัชดาภิเษก แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310</p>
                  <p className="text-xs text-slate-600 font-medium">เลขประจำตัวผู้เสียภาษี: 0-1055-65012-34-5 | โทร: 02-123-4567 | อีเมล: contact@purimpos.com</p>
                </div>
                <div className="text-right">
                  <div className="inline-block bg-sky-600 text-white font-black px-4 py-1.5 rounded text-lg uppercase tracking-wider mb-2">
                    ใบสั่งซื้อ / PURCHASE ORDER
                  </div>
                  <div className="text-xs text-slate-500 font-mono font-bold">ต้นฉบับ (ORIGINAL)</div>
                </div>
              </div>

              {/* Order Metadata Box */}
              <div className="grid grid-cols-2 gap-4 mb-6">
                {/* Left: Supplier Info */}
                <div className="border border-slate-300 rounded-xl p-4 bg-slate-50/50">
                  <div className="text-xs font-black uppercase text-sky-700 border-b border-slate-200 pb-1 mb-2 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-sky-600" /> ข้อมูลผู้จำหน่าย (SUPPLIER)
                  </div>
                  <div className="text-sm font-bold text-slate-900 mb-1">{supplierName}</div>
                  <div className="text-xs text-slate-700 space-y-0.5">
                    <p><b>ผู้ติดต่อ:</b> {supplierContact}</p>
                    <p><b>เบอร์โทรศัพท์:</b> {supplierPhone}</p>
                    <p><b>อีเมล:</b> {supplierEmail}</p>
                    <p><b>ที่อยู่:</b> {supplierAddress}</p>
                  </div>
                </div>

                {/* Right: PO Document Info */}
                <div className="border border-slate-300 rounded-xl p-4 bg-slate-50/50">
                  <div className="text-xs font-black uppercase text-sky-700 border-b border-slate-200 pb-1 mb-2 flex items-center gap-1.5">
                    <FileCheck className="w-4 h-4 text-sky-600" /> รายละเอียดเอกสาร (DOCUMENT INFO)
                  </div>
                  <div className="text-xs text-slate-700 space-y-1.5">
                    <div className="flex justify-between border-b border-slate-200/60 pb-1">
                      <span className="text-slate-500 font-medium">เลขที่ใบสั่งซื้อ:</span>
                      <span className="font-mono font-bold text-slate-900">{poNumber}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200/60 pb-1">
                      <span className="text-slate-500 font-medium">วันที่สั่งซื้อ:</span>
                      <span className="font-bold text-slate-900">{formatDate(createdAt)}</span>
                    </div>
                    <div className="flex justify-between border-b border-slate-200/60 pb-1">
                      <span className="text-slate-500 font-medium">เงื่อนไขการชำระเงิน:</span>
                      <span className="font-bold text-slate-900">{creditTerms}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-medium">สถานะเอกสาร:</span>
                      <span className={`font-bold px-2 py-0.5 rounded border uppercase text-[11px] ${
                        status === 'CANCELLED'
                          ? 'text-rose-700 bg-rose-50 border-rose-200'
                          : status === 'DRAFT'
                          ? 'text-slate-700 bg-slate-100 border-slate-200'
                          : status === 'ISSUED'
                          ? 'text-sky-700 bg-sky-50 border-sky-200'
                          : status === 'PARTIALLY_RECEIVED'
                          ? 'text-amber-700 bg-amber-50 border-amber-200'
                          : 'text-emerald-700 bg-emerald-50 border-emerald-200'
                      }`}>
                        {status}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="mb-6 overflow-hidden border border-slate-300 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white font-bold uppercase">
                      <th className="p-2.5 text-center w-12 border-r border-slate-700">ลำดับ</th>
                      <th className="p-2.5 w-32 border-r border-slate-700">รหัสสินค้า</th>
                      <th className="p-2.5 border-r border-slate-700">รายการสินค้า (DESCRIPTION)</th>
                      <th className="p-2.5 text-right w-20 border-r border-slate-700">จำนวน</th>
                      <th className="p-2.5 text-right w-24 border-r border-slate-700">หน่วยละ</th>
                      <th className="p-2.5 text-right w-28">จำนวนเงิน (บาท)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-medium">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={6} className="p-8 text-center text-slate-400 font-semibold">
                          ไม่พบรายการสินค้าในใบสั่งซื้อนี้
                        </td>
                      </tr>
                    ) : (
                      items.map((item: any, idx: number) => {
                        const name = item.name || item.product?.name || item.productName || 'สินค้า';
                        const sku = item.sku || item.product?.sku || '-';
                        const qty = Number(item.quantity) || Number(item.qty) || 0;
                        const cost = Number(item.unitCost) || Number(item.cost) || Number(item.price) || 0;
                        const lineGross = qty * cost;
                        const unitBadge = item.unitName || item.product?.unit || item.unit || 'ชิ้น';
                        return (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                            <td className="p-2.5 text-center text-slate-500 font-semibold border-r border-slate-200">{idx + 1}</td>
                            <td className="p-2.5 font-mono text-slate-700 font-semibold border-r border-slate-200">{sku}</td>
                            <td className="p-2.5 border-r border-slate-200 font-bold text-slate-900">
                              <span>{name}</span>
                              {unitBadge && <span className="ml-1.5 text-[10px] text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.2 rounded font-normal">[{unitBadge}]</span>}
                            </td>
                            <td className="p-2.5 text-right font-bold text-slate-900 border-r border-slate-200">{qty.toLocaleString()}</td>
                            <td className="p-2.5 text-right text-slate-700 border-r border-slate-200">{formatCurrency(cost)}</td>
                            <td className="p-2.5 text-right font-bold text-slate-900">{formatCurrency(lineGross)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Summary Calculation Box */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-8">
                {/* Left: Thai Baht Text Box */}
                <div className="w-full sm:w-1/2 border border-slate-300 rounded-xl p-4 bg-slate-50/60 flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-500 block mb-1">จำนวนเงินตัวอักษร (AMOUNT IN WORDS)</span>
                    <p className="text-sm font-bold text-sky-800 bg-sky-50 border border-sky-200 p-2.5 rounded-lg text-center">
                      ({thaiBahtText(finalTotal)})
                    </p>
                  </div>
                  <div className="mt-3 text-[11px] text-slate-500 italic">
                    * หมายเหตุ: กรุณาส่งมอบสินค้าพร้อมใบส่งสินค้า/ใบแจ้งหนี้ และระบุเลขที่ใบสั่งซื้อบนเอกสารทุกครั้ง
                  </div>
                </div>

                {/* Right: Numerical Calculation */}
                <div className="w-full sm:w-1/2 border border-slate-300 rounded-xl p-3 bg-white text-xs space-y-1.5">
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-600 font-semibold">รวมเป็นเงิน (SUBTOTAL)</span>
                    <span className="font-bold text-slate-900">{formatCurrency(subtotalBeforeDiscount)}</span>
                  </div>
                  {billDiscountAmount > 0 && (
                    <div className="flex justify-between py-1 border-b border-slate-100 text-rose-600">
                      <span className="font-semibold">หัก ส่วนลดท้ายบิล (DISCOUNT)</span>
                      <span className="font-bold">-{formatCurrency(billDiscountAmount)}</span>
                    </div>
                  )}
                  {vatType === 'include' && (
                    <div className="flex justify-between py-1 border-b border-slate-100 text-slate-600">
                      <span className="font-medium">มูลค่าก่อนภาษี (NET BEFORE VAT)</span>
                      <span className="font-semibold text-slate-800">{formatCurrency(netAmount)}</span>
                    </div>
                  )}
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-600 font-semibold">
                      ภาษีมูลค่าเพิ่ม ({vatType === 'none' ? 'Non-VAT' : 'VAT 7%'})
                    </span>
                    <span className={`font-bold ${vatType === 'none' ? 'text-slate-400' : 'text-slate-900'}`}>
                      {vatType === 'none'
                        ? 'ไม่มี VAT (0%)'
                        : vatType === 'include'
                        ? `${formatCurrency(vatAmount)} (รวมในยอด)`
                        : `+${formatCurrency(vatAmount)}`}
                    </span>
                  </div>
                  <div className="flex justify-between py-2 border-t-2 border-slate-800 text-slate-900 font-black text-sm bg-slate-50 px-2 rounded">
                    <span>จำนวนเงินรวมทั้งสิ้น (GRAND TOTAL)</span>
                    <span className="text-sky-600 text-base">{formatCurrency(finalTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Official Signature Block */}
            <div className="grid grid-cols-2 gap-8 border-t border-slate-300 pt-6 mt-6">
              <div className="text-center space-y-8">
                <p className="text-xs font-bold text-slate-600">ผู้จัดทำเอกสาร / PREPARED BY</p>
                <div className="border-b border-dashed border-slate-400 w-3/4 mx-auto pt-6"></div>
                <div className="text-xs text-slate-500">
                  <p>(........................................................)</p>
                  <p className="mt-1">วันที่ ..... / ..... / .........</p>
                </div>
              </div>

              <div className="text-center space-y-8">
                <p className="text-xs font-bold text-slate-600">ผู้อนุมัติสั่งซื้อ / AUTHORIZED BY</p>
                <div className="border-b border-dashed border-slate-400 w-3/4 mx-auto pt-6"></div>
                <div className="text-xs text-slate-500">
                  <p>(........................................................)</p>
                  <p className="mt-1">วันที่ ..... / ..... / .........</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
