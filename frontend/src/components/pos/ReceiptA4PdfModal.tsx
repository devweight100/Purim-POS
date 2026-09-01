'use client';

import { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { formatCurrency, formatDate, thaiBahtText } from '@/lib/utils';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Printer, Download, ExternalLink, FileText, CheckCircle2, 
  Building2, User, Phone, MapPin, CreditCard, ShieldCheck, AlertCircle, ShieldAlert 
} from 'lucide-react';
import { toast } from 'sonner';

export interface ReceiptA4Data {
  orderNumber: string;
  createdAt: string;
  customerName?: string | null;
  customerPhone?: string | null;
  customerAddress?: string | null;
  customerTaxId?: string | null;
  customerBranch?: string | null;
  customerCompany?: string | null;
  userName?: string;
  claimDiscountAmount?: number;
  claimInfo?: {
    claimId: string;
    originalOrderNumber?: string;
    productName: string;
    quantity: number;
    unitName: string;
    defectReason: string;
    discountAmount: number;
  };
  items: Array<{
    sku?: string;
    name: string;
    quantity: number;
    unitName: string;
    unitPrice: number;
    lineTotal: number;
    discountAmount?: number;
  }>;
  subtotal: number;
  billDiscountAmount: number;
  pointsDiscountAmount?: number;
  pointsUsed?: number;
  customerPointsEarned?: number;
  customerPointsBalance?: number;
  vatAmount: number;
  totalAmount: number;
  paymentMethod: string;
  payments?: Array<{ method: string; amount: number; referenceNo?: string }>;
  cashReceived?: number;
  changeAmount?: number;
  
  // Credit Sales & Installment Specific Data
  isCreditBill?: boolean;
  isInstallmentReceipt?: boolean;
  installmentNo?: number;
  installmentAmount?: number;
  totalOrderAmount?: number;
  accumulatedPaid?: number;
  remainingDebt?: number;
  installmentDate?: string;
}

interface ReceiptA4PdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ReceiptA4Data | null;
}

export function ReceiptA4PdfModal({ open, onOpenChange, data }: ReceiptA4PdfModalProps) {
  const receiptA4Ref = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const storeSettings = loadStoreSettings();

  if (!data) return null;

  const hasVat = (data.vatAmount || 0) > 0;
  const isInstallment = data.isInstallmentReceipt === true;
  const receiptAmount = isInstallment ? (data.installmentAmount ?? data.totalAmount) : data.totalAmount;

  const totalBeforeVat = hasVat 
    ? Math.max(0, receiptAmount - data.vatAmount) 
    : receiptAmount;

  // Fix vertical table height: minimum 15 rows filled so position below stays constant and fills A4!
  const MIN_ROWS = 15;
  const emptyRowsCount = Math.max(0, MIN_ROWS - (data.items?.length || 0));

  const generatePdfBlob = async () => {
    if (!receiptA4Ref.current) return null;
    try {
      const canvas = await html2canvas(receiptA4Ref.current, {
        scale: 2.5, // Crisp resolution for A4 print
        useCORS: true,
        backgroundColor: '#ffffff',
        logging: false,
      });
      const imgData = canvas.toDataURL('image/png');

      const imgWidth = 210; // A4 Width mm
      const pageHeight = (canvas.height * imgWidth) / canvas.width;

      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: 'a4',
      });

      pdf.addImage(imgData, 'PNG', 0, 0, imgWidth, Math.min(297, pageHeight));
      return pdf;
    } catch (err) {
      console.error('Failed to generate A4 PDF:', err);
      toast.error('ไม่สามารถสร้างเอกสาร A4 PDF ได้');
      return null;
    }
  };

  const handleDownloadPdf = async () => {
    if (!receiptA4Ref.current) return;
    setIsGenerating(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'a4-receipt-pdf' });
    try {
      const prefix = isInstallment 
        ? `Receipt_Inst${data.installmentNo}_` 
        : hasVat ? 'TaxInvoice_A4_' : 'Receipt_A4_';
      const filename = `${prefix}${data.orderNumber}.pdf`;
      const success = await exportElementToPdf(receiptA4Ref.current, filename, 'a4');
      if (success) {
        toast.success('ดาวน์โหลดใบเสร็จรับเงิน A4 (PDF) เรียบร้อยแล้ว', { id: 'a4-receipt-pdf' });
      } else {
        toast.error('ไม่สามารถสร้างไฟล์ PDF ได้', { id: 'a4-receipt-pdf' });
      }
    } catch (err) {
      console.error(err);
      toast.error('เกิดข้อผิดพลาดในการสร้าง PDF', { id: 'a4-receipt-pdf' });
    } finally {
      setIsGenerating(false);
    }
  };

  const handleOpenPdfTab = async () => {
    if (!receiptA4Ref.current) return;
    handleNativePrint();
  };

  const handleNativePrint = () => {
    if (!receiptA4Ref.current) return;
    const docTitle = `${isInstallment ? `ใบเสร็จรับเงิน (งวดที่ ${data.installmentNo})` : hasVat ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี' : 'ใบเสร็จรับเงิน'} (A4) - ${data.orderNumber}`;
    printDocumentIframe(receiptA4Ref.current, docTitle, 'a4');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-[1100px] max-h-[95vh] bg-slate-100 border-slate-300 text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl flex flex-col overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <DialogTitle className="text-xl font-extrabold flex items-center gap-2 text-slate-900">
                <FileText className="w-5 h-5 text-indigo-600" />
                <span>
                  {isInstallment 
                    ? `ใบเสร็จรับเงินค่างวด (งวดที่ ${data.installmentNo}) - ขนาด A4`
                    : hasVat 
                    ? 'ใบเสร็จรับเงิน / ใบกำกับภาษีเต็มรูปแบบ (ขนาด A4)' 
                    : 'ใบเสร็จรับเงินเต็มรูปแบบ (ขนาด A4)'}
                </span>
              </DialogTitle>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                เอกสารเลขที่: {data.orderNumber}
                {isInstallment && (
                  <span className="ml-2 bg-indigo-100 text-indigo-800 text-[11px] font-bold px-2 py-0.5 rounded-md font-sans">
                    รับชำระงวดที่ {data.installmentNo}: {formatCurrency(data.installmentAmount || 0)} (คงค้าง {formatCurrency(data.remainingDebt || 0)})
                  </span>
                )}
                {!hasVat && !isInstallment && (
                  <span className="ml-2 text-emerald-600 font-sans font-bold">(แบบไม่มี VAT)</span>
                )}
              </p>
            </div>

            {/* Action Buttons Toolbar */}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleOpenPdfTab}
                disabled={isGenerating}
                className="h-9 px-3 text-xs font-bold border-slate-300 hover:bg-white text-slate-700 rounded-xl gap-1.5 shadow-xs"
                title="เปิดเอกสาร A4 ในแท็บใหม่"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>เปิดแท็บใหม่</span>
              </Button>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={isGenerating}
                className="h-9 px-3 text-xs font-bold border-slate-300 hover:bg-white text-slate-700 rounded-xl gap-1.5 shadow-xs"
                title="ดาวน์โหลดไฟล์ A4 PDF"
              >
                <Download className="w-3.5 h-3.5" />
                <span>ดาวน์โหลด PDF</span>
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={handleNativePrint}
                disabled={isGenerating}
                className="h-9 px-4 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl gap-1.5 shadow-sm"
                title="สั่งพิมพ์เอกสาร A4 ทันที"
              >
                <Printer className="w-4 h-4" />
                <span>พิมพ์เอกสาร A4</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* ─── A4 PAPER PREVIEW CONTAINER ─── */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4 flex justify-center bg-slate-200/70 rounded-2xl border border-slate-300/80 my-2">
          {/* Exact A4 Document Sheet (210mm proportional container) */}
          <div
            ref={receiptA4Ref}
            className="a4-container w-[210mm] max-w-[210mm] min-h-[297mm] bg-white p-[10mm] shadow-xl text-slate-900 font-sans border border-slate-300 rounded-sm flex flex-col justify-between box-border"
            style={{ width: '210mm', maxWidth: '210mm', minHeight: '297mm', boxSizing: 'border-box' }}
          >
            {/* TOP SECTION: Header & Parties Information */}
            <div className="space-y-5">
              {/* 1. Header (Store Branding & Title Box) */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 pb-4 border-b-2 border-slate-800">
                {/* Store Branding */}
                <div className="space-y-1 max-w-[450px]">
                  <div className="flex items-center gap-2">
                    <div className="w-9 h-9 rounded-lg bg-indigo-600 text-white flex items-center justify-center font-black text-lg shadow-sm">
                      P
                    </div>
                    <div>
                      <h2 className="text-xl font-black text-slate-900 tracking-tight leading-none">
                        {storeSettings.storeName || 'ร้านปุริม (Purim POS)'}
                      </h2>
                      {storeSettings.branchName && (
                        <span className="text-[11px] font-bold text-indigo-700 tracking-wide">
                          สาขา: {storeSettings.branchName}
                        </span>
                      )}
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-600 leading-relaxed pt-1">
                    {storeSettings.storeAddress}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                    {storeSettings.taxId && <span><b>เลขประจำตัวผู้เสียภาษี:</b> {storeSettings.taxId}</span>}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-600">
                    {storeSettings.storePhone && <span><b>โทร:</b> {storeSettings.storePhone}</span>}
                    {storeSettings.storeEmail && <span><b>อีเมล:</b> {storeSettings.storeEmail}</span>}
                  </div>
                </div>

                {/* Document Title Box */}
                <div className="sm:text-right border-2 border-indigo-700 bg-indigo-50/60 p-3 rounded-xl min-w-[240px]">
                  <h3 className="text-base font-black text-indigo-950 uppercase tracking-tight">
                    {isInstallment 
                      ? 'ใบเสร็จรับเงิน' 
                      : hasVat 
                      ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี' 
                      : 'ใบเสร็จรับเงิน'}
                  </h3>
                  <span className="text-[11px] font-extrabold text-indigo-700 block">
                    {isInstallment
                      ? `RECEIPT (INSTALLMENT NO. ${data.installmentNo})`
                      : hasVat 
                      ? 'RECEIPT / TAX INVOICE' 
                      : 'RECEIPT'}
                  </span>
                  <div className="flex gap-1 justify-end mt-1">
                    {isInstallment && (
                      <span className="inline-block bg-amber-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                        ชำระงวดที่ {data.installmentNo}
                      </span>
                    )}
                    <span className="inline-block bg-indigo-600 text-white text-[10px] font-bold px-2 py-0.5 rounded">
                      ต้นฉบับ (ORIGINAL)
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. Document Info & Customer Details (2 Columns Box) */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                {/* Customer Box (Left) */}
                <div className="border border-slate-300 rounded-xl p-3.5 bg-slate-50/50 space-y-1">
                  <div className="font-extrabold text-slate-900 border-b border-slate-200 pb-1 flex items-center gap-1.5">
                    {data.customerCompany ? <Building2 className="w-3.5 h-3.5 text-indigo-600" /> : <User className="w-3.5 h-3.5 text-sky-600" />}
                    <span>ข้อมูลลูกค้า / ผู้ซื้อ (Customer Details)</span>
                  </div>
                  <div className="pt-0.5 space-y-0.5">
                    <div className="text-[12.5px] font-bold text-slate-900">
                      {data.customerCompany || data.customerName || 'ลูกค้าทั่วไป (General Customer)'}
                    </div>
                    {data.customerAddress && (
                      <div className="text-slate-600 leading-tight flex items-start gap-1">
                        <MapPin className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
                        <span>{data.customerAddress}</span>
                      </div>
                    )}
                    {data.customerTaxId && (
                      <div className="text-slate-700">
                        <b>เลขผู้เสียภาษี:</b> <span className="font-mono">{data.customerTaxId}</span>
                        {data.customerBranch && <span className="ml-2 font-medium">({data.customerBranch})</span>}
                      </div>
                    )}
                    {data.customerPhone && (
                      <div className="text-slate-700 flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-400" />
                        <span>โทร: {data.customerPhone}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Metadata Box (Right) */}
                <div className="border border-slate-300 rounded-xl p-3.5 bg-slate-50/50 space-y-1">
                  <div className="font-extrabold text-slate-900 border-b border-slate-200 pb-1 flex items-center gap-1.5">
                    <FileText className="w-3.5 h-3.5 text-indigo-600" />
                    <span>ข้อมูลเอกสาร (Document Details)</span>
                  </div>
                  <div className="pt-0.5 space-y-1">
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">เลขที่เอกสาร (No.):</span>
                      <span className="font-mono font-bold text-slate-900 text-[12.5px]">{data.orderNumber}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">
                        {isInstallment ? 'วันที่รับชำระ (Payment Date):' : 'วันที่ออกเอกสาร (Date):'}
                      </span>
                      <span className="font-bold text-slate-800">
                        {formatDate(isInstallment && data.installmentDate ? data.installmentDate : data.createdAt)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">พนักงานขาย (Cashier):</span>
                      <span className="font-medium text-slate-800">{data.userName || 'พนักงาน POS'}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500 font-semibold">ช่องทางชำระ (Payment):</span>
                      <span className="font-bold text-indigo-700">{data.paymentMethod}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* 3. Items Table (Expanded Description, Compact Numeric Columns, All Black Text, Fixed 10-Row Height, NO Note Text) */}
              <div className="border border-slate-300 rounded-xl overflow-hidden bg-white">
                <table className="w-full text-left border-collapse text-xs">
                  <thead className="bg-slate-100 text-black font-extrabold border-b-2 border-slate-300">
                    <tr>
                      <th className="py-2.5 px-2 text-center w-[36px] border-r border-slate-300 text-black font-black">#</th>
                      <th className="py-2.5 px-3 text-center border-r border-slate-300 text-black font-black">รายการสินค้า (Description)</th>
                      <th className="py-2.5 px-1.5 text-center w-[52px] border-r border-slate-300 text-black font-black">จำนวน</th>
                      <th className="py-2.5 px-1.5 text-center w-[52px] border-r border-slate-300 text-black font-black">หน่วย</th>
                      <th className="py-2.5 px-2 text-center w-[85px] border-r border-slate-300 text-black font-black">ราคา/หน่วย</th>
                      <th className="py-2.5 px-2 text-center w-[75px] border-r border-slate-300 text-black font-black">ส่วนลด</th>
                      <th className="py-2.5 px-2.5 text-center w-[95px] text-black font-black">จำนวนเงิน (฿)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Actual Item Rows (No horizontal divider lines, all pure black text, NO note text) */}
                    {data.items.map((item, idx) => (
                      <tr key={idx} className="min-h-[34px] text-black">
                        <td className="py-2 px-2 text-center font-mono text-black font-bold border-r border-slate-300 align-top">{idx + 1}</td>
                        <td className="py-2 px-3 border-r border-slate-300 align-top">
                          <div className="font-bold text-black leading-snug">{item.name}</div>
                        </td>
                        <td className="py-2 px-1.5 text-center font-bold text-black border-r border-slate-300 font-mono align-top">{item.quantity}</td>
                        <td className="py-2 px-1.5 text-center text-black font-medium border-r border-slate-300 align-top">{item.unitName || 'ชิ้น'}</td>
                        <td className="py-2 px-2 text-right font-mono text-black font-bold border-r border-slate-300 align-top">{formatCurrency(item.unitPrice)}</td>
                        <td className="py-2 px-2 text-right font-mono text-black font-bold border-r border-slate-300 align-top">
                          {item.discountAmount && item.discountAmount > 0 ? `-${formatCurrency(item.discountAmount)}` : '-'}
                        </td>
                        <td className="py-2 px-2.5 text-right font-bold font-mono text-black align-top">{formatCurrency(item.lineTotal)}</td>
                      </tr>
                    ))}

                    {/* Fixed Vertical Grid Empty Rows (No horizontal dividers, only vertical column dividers) */}
                    {Array.from({ length: emptyRowsCount }).map((_, emptyIdx) => (
                      <tr key={`empty-${emptyIdx}`} className="h-[34px]">
                        <td className="py-1.5 px-2 text-center border-r border-slate-300 text-transparent select-none">-</td>
                        <td className="py-1.5 px-3 border-r border-slate-300 text-transparent select-none">-</td>
                        <td className="py-1.5 px-1.5 text-center border-r border-slate-300 text-transparent select-none">-</td>
                        <td className="py-1.5 px-1.5 text-center border-r border-slate-300 text-transparent select-none">-</td>
                        <td className="py-1.5 px-2 text-right border-r border-slate-300 text-transparent select-none">-</td>
                        <td className="py-1.5 px-2 text-right border-r border-slate-300 text-transparent select-none">-</td>
                        <td className="py-1.5 px-2.5 text-right text-transparent select-none">-</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* 4. Financial Calculations & Summary Box */}
              <div className="grid grid-cols-1 sm:grid-cols-12 gap-4 text-xs pt-1">
                {/* Left side: Thai Baht Text & Payment Details (5 cols) */}
                <div className="sm:col-span-5 space-y-2.5">
                  {/* Thai Baht text banner */}
                  <div className="bg-slate-100 p-2.5 rounded-xl border border-slate-200">
                    <span className="text-[11px] font-bold text-slate-600 block">จำนวนเงินตัวอักษร (Amount in Words):</span>
                    <span className="text-xs font-black text-slate-900 leading-snug">{thaiBahtText(receiptAmount)}</span>
                  </div>

                  {/* Payment Breakdown */}
                  {data.payments && data.payments.length > 0 && (
                    <div className="border border-slate-200 rounded-xl p-2.5 bg-slate-50 space-y-1">
                      <span className="font-bold text-slate-800 block text-[11px]">รายละเอียดการชำระเงิน:</span>
                      {data.payments.map((p, i) => (
                        <div key={i} className="flex justify-between text-[11px] text-slate-700">
                          <span>
                            • {p.method === 'CASH' ? 'เงินสด' : p.method === 'QR_PROMPTPAY' ? 'QR พร้อมเพย์' : p.method === 'CREDIT_CARD' ? 'บัตรเครดิต' : p.method === 'CREDIT_NOTE' ? 'เงินเชื่อ' : p.method}
                            {p.referenceNo ? ` (${p.referenceNo})` : ''}
                          </span>
                          <span className="font-mono font-bold text-slate-900">{formatCurrency(p.amount)}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Member Loyalty Point info */}
                  {data.customerName && (data.customerPointsBalance !== undefined || data.customerPointsEarned !== undefined) && (
                    <div className="border border-slate-200 bg-slate-50 p-2 rounded-xl text-[11px] text-slate-600 flex justify-between">
                      <span>🪙 ได้รับแต้ม: <b className="text-emerald-700 font-bold">+{data.customerPointsEarned ?? 0}</b></span>
                      <span>แต้มคงเหลือ: <b className="text-slate-900 font-black">{(data.customerPointsBalance ?? 0).toLocaleString()}</b> แต้ม</span>
                    </div>
                  )}

                  {/* Combined Warranty Claim Voucher Card */}
                  {data.claimInfo && (
                    <div className="border-2 border-emerald-300 bg-emerald-50/70 p-3 rounded-xl space-y-1 text-xs shadow-2xs">
                      <div className="flex items-center justify-between text-emerald-950 font-extrabold border-b border-emerald-200 pb-1">
                        <div className="flex items-center gap-1.5">
                          <ShieldAlert className="w-4 h-4 text-emerald-700 shrink-0" />
                          <span>ข้อมูลการเคลมสินค้า (Warranty Claim)</span>
                        </div>
                        <span className="font-mono text-indigo-700 font-bold">#{data.claimInfo.claimId}</span>
                      </div>
                      <div className="text-slate-800 text-[11px] pt-0.5">
                        • สินค้าที่เคลม: <b className="text-slate-900">{data.claimInfo.productName}</b> ({data.claimInfo.quantity} {data.claimInfo.unitName})
                      </div>
                      {data.claimInfo.defectReason && (
                        <div className="text-slate-600 text-[10.5px]">
                          • อาการเสีย: {data.claimInfo.defectReason}
                        </div>
                      )}
                      <div className="flex justify-between items-center text-emerald-800 font-bold pt-1 border-t border-emerald-200 text-xs">
                        <span>ส่วนลดเคลมนำมาหักในบิลนี้:</span>
                        <span className="font-mono font-black text-sm">-{formatCurrency(data.claimInfo.discountAmount)}</span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Right side: Compact Calculation Breakdown Box (7 cols) */}
                <div className="sm:col-span-7 border-2 border-slate-300 rounded-xl p-3.5 bg-slate-50/90 space-y-1.5 text-xs">
                  {/* CASE 1: Installment Receipt for Credit Sale (Compact & Clean layout) */}
                  {isInstallment ? (
                    <>
                      <div className="flex justify-between text-slate-700 text-xs">
                        <span className="font-semibold">ยอดรวมตามคำสั่งซื้อ (Total Order):</span>
                        <span className="font-mono font-bold text-slate-900">
                          {formatCurrency(data.totalOrderAmount || data.totalAmount)}
                        </span>
                      </div>

                      <div className="flex justify-between text-slate-600 text-xs">
                        <span>ยอดชำระสะสมรวม (Total Paid):</span>
                        <span className="font-mono font-semibold">{formatCurrency(data.accumulatedPaid || 0)}</span>
                      </div>

                      <div className="flex justify-between text-rose-700 text-xs font-bold pt-0.5 border-t border-slate-200">
                        <span>ยอดคงค้างชำระ (Remaining):</span>
                        <span className="font-mono font-black">
                          {(data.remainingDebt || 0) <= 0 ? '฿0 (ชำระครบแล้ว)' : formatCurrency(data.remainingDebt || 0)}
                        </span>
                      </div>

                      {/* Prominent Compact Receipt Amount Banner */}
                      <div className="flex justify-between items-center text-slate-900 pt-2 mt-1 border-t-2 border-slate-800 bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
                        <div>
                          <span className="text-xs font-black text-indigo-950 block">ยอดรับชำระในใบเสร็จนี้ (งวดที่ {data.installmentNo})</span>
                          <span className="text-[10px] font-bold text-slate-500 block">RECEIPT AMOUNT</span>
                        </div>
                        <span className="font-mono text-xl font-black text-indigo-700">
                          {formatCurrency(receiptAmount)}
                        </span>
                      </div>
                    </>
                  ) : (
                    /* CASE 2: Normal Sale or Fully Settled Credit Sale (Identical to standard customer receipt) */
                    <>
                      <div className="flex justify-between text-slate-700 text-[13px]">
                        <span className="font-semibold">รวมเป็นเงิน (Subtotal):</span>
                        <span className="font-mono font-bold text-slate-900 text-sm">{formatCurrency(data.subtotal)}</span>
                      </div>

                      {data.billDiscountAmount > 0 && (
                        <div className="flex justify-between text-rose-600 text-[12.5px]">
                          <span>ส่วนลดท้ายบิล (Bill Discount):</span>
                          <span className="font-mono font-bold">-{formatCurrency(data.billDiscountAmount)}</span>
                        </div>
                      )}

                      {data.pointsDiscountAmount !== undefined && data.pointsDiscountAmount > 0 && (
                        <div className="flex justify-between text-amber-800 text-[12.5px]">
                          <span>ส่วนลดแต้มสมาชิก ({data.pointsUsed?.toLocaleString() || 0} แต้ม):</span>
                          <span className="font-mono font-bold">-{formatCurrency(data.pointsDiscountAmount)}</span>
                        </div>
                      )}

                      {data.claimDiscountAmount !== undefined && data.claimDiscountAmount > 0 && (
                        <div className="flex justify-between text-emerald-700 text-[12.5px] font-bold">
                          <span>ส่วนลดเคลมสินค้า (Claim Discount):</span>
                          <span className="font-mono font-bold">-{formatCurrency(data.claimDiscountAmount)}</span>
                        </div>
                      )}

                      {/* Only show VAT calculation lines when hasVat is TRUE */}
                      {hasVat && (
                        <>
                          <div className="flex justify-between text-slate-700 pt-1.5 border-t border-slate-200 text-[12.5px]">
                            <span>มูลค่าสินค้าก่อนภาษี (Net Subtotal):</span>
                            <span className="font-mono font-bold">{formatCurrency(totalBeforeVat)}</span>
                          </div>

                          <div className="flex justify-between text-slate-700 text-[12.5px]">
                            <span>ภาษีมูลค่าเพิ่ม 7% (VAT 7%):</span>
                            <span className="font-mono font-bold">{formatCurrency(data.vatAmount)}</span>
                          </div>
                        </>
                      )}

                      {/* Prominent Wide Grand Total Banner */}
                      <div className="flex justify-between items-center text-slate-900 pt-2.5 mt-1 border-t-2 border-slate-800 bg-white p-3 rounded-lg border border-slate-200 shadow-2xs">
                        <div>
                          <span className="text-sm font-black text-indigo-950 block">จำนวนเงินรวมทั้งสิ้น</span>
                          <span className="text-[11px] font-bold text-slate-500 block">TOTAL AMOUNT</span>
                        </div>
                        <span className="font-mono text-2xl font-black text-indigo-700">
                          {formatCurrency(data.totalAmount)}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* BOTTOM SECTION: Signatures & Stamp Authorization (Pinned at bottom of A4) */}
            <div className="mt-auto pt-6 pb-2 border-t border-slate-300 grid grid-cols-2 gap-8 text-xs text-center">
              {/* Customer / Receiver Signature */}
              <div className="space-y-4">
                <p className="text-slate-600 font-semibold">ผู้รับสินค้า / ผู้จ่ายเงิน (Customer / Receiver)</p>
                <div className="pt-8 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <p>(....................................................................)</p>
                  <p>วันที่ (Date): ......./......./............</p>
                </div>
              </div>

              {/* Cashier / Authorizer Signature */}
              <div className="space-y-4">
                <p className="text-slate-600 font-semibold">ผู้รับเงิน / ผู้มีอำนาจลงนาม (Cashier / Authorized Signature)</p>
                <div className="pt-8 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
                <div className="text-[11px] text-slate-500 space-y-0.5">
                  <p>({data.userName || 'พนักงานขาย / ผู้รับเงิน'})</p>
                  <p>วันที่ (Date): {new Date(isInstallment && data.installmentDate ? data.installmentDate : data.createdAt).toLocaleDateString('th-TH')}</p>
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
