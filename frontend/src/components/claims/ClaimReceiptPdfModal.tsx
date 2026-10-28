'use client';

import { useRef, useState } from 'react';
import { formatCurrency, formatDate, thaiBahtText } from '@/lib/utils';
import { ClaimRecord } from '@/lib/types';
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
  Printer, Download, ShieldAlert, CheckCircle2, 
  Building2, User, Phone, MapPin, FileText, Store, Sparkles, Hash, Mail
} from 'lucide-react';
import { toast } from 'sonner';
import { BarcodeView } from '@/components/common/BarcodeView';

interface ClaimReceiptPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  claim: ClaimRecord | null;
}

export function ClaimReceiptPdfModal({
  open,
  onOpenChange,
  claim,
}: ClaimReceiptPdfModalProps) {
  const printDocRef = useRef<HTMLDivElement>(null);
  const [printFormat, setPrintFormat] = useState<'80mm' | 'a4'>('a4');
  const [isExporting, setIsExporting] = useState(false);
  const [storeSettings] = useState(() => loadStoreSettings());

  if (!claim) return null;

  const resolutionLabels: Record<string, string> = {
    REPLACE_ITEM: 'เปลี่ยนสินค้าตัวใหม่ทันที (Replacement)',
    REFUND_CASH: 'คืนเงินสดให้ลูกค้า (Cash Refund)',
    REFUND_TRANSFER: 'โอนเงินคืนลูกค้า (Bank Transfer)',
    CLAIM_DISCOUNT: 'ออกคูปองส่วนลดเพื่อใช้ซื้อสินค้าใหม่ (Claim Discount)',
    VENDOR_CLAIM: 'ส่งเคลมบริษัทผู้จัดจำหน่าย (Vendor Claim)',
    REPAIR: 'ส่งซ่อม (Repair)',
    REJECT: 'ปฏิเสธการเคลม (Reject)',
  };

  const getResolutionLabel = (type: string) => {
    return resolutionLabels[type] || type;
  };

  // Direct WYSIWYG Print with 100% style fidelity
  const handleNativePrint = () => {
    if (!printDocRef.current) return;
    printDocumentIframe(printDocRef.current, `ใบรับเคลมสินค้า - ${claim.id}`, printFormat);
  };

  // Download PDF (True WYSIWYG PDF file)
  const handleDownloadPdf = async () => {
    if (!printDocRef.current) return;
    setIsExporting(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'claim-pdf-gen' });
    try {
      const filename = printFormat === '80mm' ? `ClaimSlip_${claim.id}.pdf` : `ClaimDoc_A4_${claim.id}.pdf`;
      const success = await exportElementToPdf(printDocRef.current, filename, printFormat);
      if (success) {
        toast.success('ดาวน์โหลดไฟล์ PDF เรียบร้อยแล้ว', { id: 'claim-pdf-gen' });
      } else {
        toast.error('ไม่สามารถสร้างไฟล์ PDF ได้', { id: 'claim-pdf-gen' });
      }
    } catch (err) {
      console.error(err);
      toast.error('เกิดข้อผิดพลาดในการสร้าง PDF', { id: 'claim-pdf-gen' });
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[98vw] max-w-5xl max-h-[94vh] bg-slate-100 border-slate-300 text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl flex flex-col overflow-hidden">
        {/* Modal Header */}
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <DialogTitle className="text-xl font-extrabold flex items-center gap-2 text-slate-900">
                <ShieldAlert className="w-5 h-5 text-indigo-600" />
                <span>ตัวอย่างเอกสารเคลมสินค้า (Claim Preview & Print)</span>
              </DialogTitle>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                เลขที่เอกสารเคลม: <span className="font-bold text-indigo-700">{claim.id}</span>
                <span className="ml-2 font-sans text-slate-400">| อ้างอิงบิลเดิม: #{claim.orderNumber}</span>
              </p>
            </div>

            {/* Print Mode Switcher & Actions */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-300 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setPrintFormat('80mm')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    printFormat === '80mm' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  สลิป 80mm
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('a4')}
                  className={`px-3 py-1 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    printFormat === 'a4' ? 'bg-indigo-600 text-white shadow-2xs' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  กระดาษ A4
                </button>
              </div>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadPdf}
                disabled={isExporting}
                className="h-9 px-3 text-xs font-bold border-slate-300 text-slate-700 hover:bg-slate-50 rounded-xl gap-1.5"
              >
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">ดาวน์โหลด PDF</span>
              </Button>

              <Button
                type="button"
                size="sm"
                onClick={handleNativePrint}
                className="h-9 px-4 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl gap-1.5 shadow-sm cursor-pointer"
              >
                <Printer className="w-4 h-4" />
                <span>พิมพ์เอกสาร ({printFormat.toUpperCase()})</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* ─── SCROLLABLE PREVIEW CONTAINER ─── */}
        <div className="flex-1 overflow-y-auto p-4 flex justify-center bg-slate-200/70 rounded-2xl border border-slate-300 my-2">
          {/* Target Sheet for Print & Canvas */}
          <div ref={printDocRef}>
            {/* ════════════════════════════════════════════════════════════════
                FORMAT 1: 80MM THERMAL SLIP PAPER PREVIEW
            ════════════════════════════════════════════════════════════════ */}
            {printFormat === '80mm' && (
              <div 
                className="receipt-container w-full max-w-[78mm] sm:max-w-[80mm] print:w-full print:max-w-full min-h-[140mm] bg-white text-black px-3.5 py-4 shadow-2xl font-sans text-[11.5px] leading-snug rounded-none space-y-2 box-border border-2 border-black print:border-none print:p-0 relative select-none"
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
                    <p className="text-[11px] text-black font-bold font-mono">เลขผู้เสียภาษี: {storeSettings.taxId}</p>
                  )}

                  <p className="text-[10.5px] text-black font-bold font-sans leading-tight break-words">
                    {storeSettings.storeAddress}
                  </p>

                  {storeSettings.storePhone && (
                    <p className="text-[11px] text-black font-bold font-mono">โทร: {storeSettings.storePhone}</p>
                  )}

                  {storeSettings.receiptHeader && (
                    <p className="text-[10.5px] text-black font-bold font-sans pt-0.5 whitespace-pre-wrap">
                      {storeSettings.receiptHeader}
                    </p>
                  )}

                  <div className="pt-1">
                    <span className="text-[13px] font-black border-2 border-black px-3 py-0.5 rounded-none font-sans inline-block text-black uppercase tracking-wider">
                      ใบรับเคลมสินค้า / สลิปเปลี่ยนของ
                    </span>
                  </div>

                  {/* ─── BARCODE OF CLAIM ID ─── */}
                  <div className="pt-2 pb-1 flex justify-center bg-white">
                    <BarcodeView value={claim.id} width={1.8} height={44} fontSize={12} />
                  </div>
                </div>

                {/* Claim Meta */}
                <div className="text-[11.5px] space-y-1 pb-2 border-b-2 border-dashed border-black font-bold text-black">
                  <div className="flex justify-between items-center gap-1">
                    <span className="shrink-0">เลขที่ใบเคลม:</span>
                    <span className="font-black truncate text-right font-mono text-black text-[12px]">{claim.id}</span>
                  </div>
                  <div className="flex justify-between items-center gap-1">
                    <span className="shrink-0">วันที่รับเคลม:</span>
                    <span className="font-bold truncate text-right font-mono text-[11px]">{formatDate(claim.claimDate)}</span>
                  </div>
                  <div className="flex justify-between items-center gap-1">
                    <span className="shrink-0">อ้างอิงบิลเดิม:</span>
                    <span className="font-black text-black truncate text-right font-mono">#{claim.orderNumber}</span>
                  </div>
                  <div className="flex justify-between items-center gap-1">
                    <span className="shrink-0">ลูกค้า:</span>
                    <span className="font-black text-black truncate text-right max-w-[170px]">{claim.customerName || 'ลูกค้าทั่วไป (Walk-in)'}</span>
                  </div>
                  {claim.customerPhone && (
                    <div className="flex justify-between items-center gap-1">
                      <span className="shrink-0">เบอร์โทร:</span>
                      <span className="font-bold font-mono">{claim.customerPhone}</span>
                    </div>
                  )}
                </div>

                {/* Claimed Item */}
                <div className="space-y-1.5 py-1.5 border-b-2 border-dashed border-black text-[11.5px] font-bold text-black">
                  <div className="font-black text-black break-words font-sans text-[12px]">
                    1. {claim.productName}
                  </div>
                  <div className="flex justify-between text-black text-[11px] pl-1">
                    <span>รหัส: {claim.sku}</span>
                    <span>จำนวน: <b className="font-black font-mono">{claim.quantity} {claim.unitName}</b></span>
                  </div>
                  <div className="flex justify-between text-[11.5px] font-black text-black pl-1">
                    <span>มูลค่าเดิม:</span>
                    <span className="font-mono">{formatCurrency(claim.totalClaimValue)}</span>
                  </div>

                  {/* Defect Reason */}
                  <div className="border-2 border-black p-1.5 text-[11px] text-black font-bold my-1">
                    <b>อาการเสีย:</b> {claim.defectReason || 'ไม่ระบุอาการ'}
                  </div>
                </div>

                {/* Resolution */}
                <div className="py-1.5 border-b-2 border-dashed border-black space-y-1 text-black font-bold text-[11.5px]">
                  <div className="text-[12px] font-black text-black flex items-center gap-1">
                    <CheckCircle2 className="w-4 h-4 text-black shrink-0 stroke-[2.5]" />
                    <span>ผลการพิจารณา: {getResolutionLabel(claim.resolutionType)}</span>
                  </div>

                  {claim.resolutionType === 'REPLACE_ITEM' && (
                    <div className="text-[11px] text-black pl-1">
                      เปลี่ยนเป็น: <b>{claim.replacementProductName || claim.productName}</b>
                    </div>
                  )}

                  {(claim.resolutionType === 'REFUND_CASH' || claim.resolutionType === 'REFUND_TRANSFER') && (
                    <div className="flex justify-between text-[12px] font-black text-black pl-1 pt-1 border-t border-black">
                      <span>ยอดเงินคืน:</span>
                      <span className="font-mono text-[14px]">{formatCurrency(claim.refundAmount || claim.totalClaimValue)}</span>
                    </div>
                  )}

                  {claim.resolutionType === 'STORE_DISCOUNT' && (
                    <div className="flex justify-between text-[12px] font-black text-black pl-1 pt-1 border-t border-black">
                      <span>ส่วนลดบิลนี้:</span>
                      <span className="font-mono text-[14px]">{formatCurrency(claim.discountAmount || claim.totalClaimValue)}</span>
                    </div>
                  )}
                </div>

                {/* Signatures in Slip */}
                <div className="pt-3 grid grid-cols-2 gap-2 text-center text-[10.5px] font-bold text-black">
                  <div>
                    <div className="pt-4 border-b-2 border-black mx-auto w-4/5 border-dashed" />
                    <p className="mt-1">ผู้ส่งเคลม (ลูกค้า)</p>
                  </div>
                  <div>
                    <div className="pt-4 border-b-2 border-black mx-auto w-4/5 border-dashed" />
                    <p className="font-black mt-1">({claim.cashierName || 'พนักงาน'})</p>
                  </div>
                </div>

                {/* Slip Footer Policy */}
                <div className="text-center pt-2 space-y-1 text-[10.5px] text-black font-bold border-t-2 border-black mt-2">
                  {storeSettings.receiptFooter ? (
                    <p className="whitespace-pre-wrap leading-tight">{storeSettings.receiptFooter}</p>
                  ) : (
                    <p>* โปรดเก็บสลิปนี้ไว้เป็นหลักฐานการเคลมสินค้า *</p>
                  )}
                </div>
              </div>
            )}

            {/* ════════════════════════════════════════════════════════════════
                FORMAT 2: FORMAL A4 SHEET DOCUMENT PREVIEW
            ════════════════════════════════════════════════════════════════ */}
            {printFormat === 'a4' && (
              <div 
                className="a4-container w-[210mm] max-w-[210mm] min-h-[297mm] bg-white text-slate-900 p-[10mm] shadow-2xl font-sans text-xs leading-relaxed rounded-sm flex flex-col justify-between box-border border border-slate-300 relative select-none"
                style={{ width: '210mm', maxWidth: '210mm', minHeight: '297mm', boxSizing: 'border-box' }}
              >
                <div className="space-y-3.5">
                {/* A4 Header */}
                <div className="flex justify-between items-start border-b-2 border-slate-800 pb-4">
                  <div className="space-y-1 max-w-[60%]">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-lg bg-indigo-600 text-white font-black flex items-center justify-center text-base">
                        P
                      </div>
                      <h2 className="text-lg font-black text-slate-900">
                        {storeSettings.storeName || 'ร้านปุริม ซุปเปอร์มาร์เก็ต'}
                      </h2>
                    </div>

                    {storeSettings.branchName && (
                      <p className="text-xs text-slate-600 font-medium">สาขา: {storeSettings.branchName}</p>
                    )}

                    <p className="text-slate-600 text-[11px] leading-tight">
                      {storeSettings.storeAddress}
                    </p>

                    <div className="text-[11px] text-slate-600 flex flex-wrap gap-x-4">
                      {storeSettings.taxId && <span><b>เลขผู้เสียภาษี:</b> {storeSettings.taxId}</span>}
                      {storeSettings.storePhone && <span><b>โทร:</b> {storeSettings.storePhone}</span>}
                      {storeSettings.storeEmail && <span><b>อีเมล:</b> {storeSettings.storeEmail}</span>}
                    </div>
                  </div>

                  {/* Document Title & Metadata Box */}
                  <div className="text-right space-y-1">
                    <h3 className="text-base font-black text-indigo-900 uppercase tracking-tight">
                      ใบรับเคลมสินค้า / เปลี่ยนสินค้า
                    </h3>
                    <p className="text-[10.5px] font-bold text-slate-500 font-mono">CLAIM VOUCHER / REPLACEMENT</p>
                    <div className="pt-1.5 text-xs space-y-1 font-mono">
                      <p><b className="text-slate-700">เลขที่เอกสารเคลม:</b> <span className="text-indigo-700 font-bold">{claim.id}</span></p>
                      <p><b className="text-slate-700">วันที่รับเคลม:</b> {formatDate(claim.claimDate)}</p>
                      <p><b className="text-slate-700">อ้างอิงบิลเดิม:</b> <span className="font-bold text-slate-900">#{claim.orderNumber}</span></p>
                      <p><b className="text-slate-700">วันที่ซื้อเดิม:</b> {formatDate(claim.orderDate)}</p>
                    </div>
                  </div>
                </div>

                {/* Customer Details Box */}
                <div className="grid grid-cols-2 gap-4 bg-slate-50 p-3.5 rounded-xl border border-slate-200 text-xs">
                  <div className="space-y-1">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      ข้อมูลลูกค้า / ผู้ส่งเคลม (Customer):
                    </span>
                    <p className="font-bold text-slate-900 text-sm">{claim.customerName || 'ลูกค้าทั่วไป (Walk-in)'}</p>
                    {claim.customerPhone && (
                      <p className="text-slate-700 font-mono"><b>เบอร์โทรศัพท์:</b> {claim.customerPhone}</p>
                    )}
                  </div>

                  <div className="space-y-1 text-right">
                    <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider block">
                      ผู้ดำเนินการรับเคลม (Staff):
                    </span>
                    <p className="font-bold text-slate-900">{claim.cashierName || 'พนักงาน POS'}</p>
                    <p className="text-slate-500 text-[11px]">สถานะ: อนุมัติการเคลมเรียบร้อย</p>
                  </div>
                </div>

                  {/* Formal Itemized Claims Table */}
                  <div className="space-y-1.5 pt-2">
                    <span className="font-bold text-xs text-slate-900">1. รายการสินค้าที่นำมาเคลม (Claimed Items)</span>
                    <div className="border border-slate-300 rounded-xl overflow-hidden min-h-[95mm] flex flex-col justify-between bg-white">
                      <table className="w-full h-full flex-1 border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-100 font-bold text-slate-800 border-b-2 border-slate-300">
                            <th className="py-2 px-3 text-center w-12 border-r border-slate-300">ลำดับ</th>
                            <th className="py-2 px-3 text-center w-32 border-r border-slate-300">รหัสสินค้า (SKU)</th>
                            <th className="py-2 px-3 text-center border-r border-slate-300">ชื่อรายการสินค้า</th>
                            <th className="py-2 px-3 text-center w-48 border-r border-slate-300">สาเหตุ / อาการเสียที่พบ</th>
                            <th className="py-2 px-3 text-center w-24 border-r border-slate-300">จำนวน</th>
                            <th className="py-2 px-3 text-center w-28">มูลค่าเดิม</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="hover:bg-slate-50/50">
                            <td className="py-2.5 px-3 text-center font-mono font-bold border-r border-slate-300">1</td>
                            <td className="py-2.5 px-3 font-mono font-bold text-indigo-700 border-r border-slate-300">{claim.sku}</td>
                            <td className="py-2.5 px-3 font-bold text-slate-900 border-r border-slate-300">{claim.productName}</td>
                            <td className="py-2.5 px-3 text-rose-700 font-medium border-r border-slate-300">
                              {claim.defectReason || 'ไม่ระบุอาการ'}
                            </td>
                            <td className="py-2.5 px-3 text-center font-mono font-bold border-r border-slate-300">
                              {claim.quantity} {claim.unitName}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono font-black text-slate-900">
                              {formatCurrency(claim.totalClaimValue)}
                            </td>
                          </tr>

                          {/* Empty Space Row: Vertical lines extend down to the bottom border with ZERO horizontal lines */}
                          <tr className="h-full">
                            <td className="py-2 px-3 border-r border-slate-300">&nbsp;</td>
                            <td className="py-2 px-3 border-r border-slate-300">&nbsp;</td>
                            <td className="py-2 px-3 border-r border-slate-300">&nbsp;</td>
                            <td className="py-2 px-3 border-r border-slate-300">&nbsp;</td>
                            <td className="py-2 px-3 border-r border-slate-300">&nbsp;</td>
                            <td className="py-2 px-3">&nbsp;</td>
                          </tr>
                        </tbody>
                        <tfoot>
                          <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                            <td colSpan={4} className="py-2 px-3 text-right text-slate-600 border-r border-slate-300">
                              จำนวนรวม: {claim.quantity} {claim.unitName}
                            </td>
                            <td className="py-2 px-3 text-center text-slate-700 border-r border-slate-300">มูลค่ารวม:</td>
                            <td className="py-2 px-3 text-right font-mono font-black text-indigo-700">
                              {formatCurrency(claim.totalClaimValue)}
                            </td>
                          </tr>
                        </tfoot>
                      </table>
                    </div>
                    <div className="text-[11px] text-right font-medium text-slate-500 font-mono">
                      ({thaiBahtText(claim.totalClaimValue)})
                    </div>
                  </div>

                {/* Resolution & Compensation Box */}
                <div className="space-y-1.5 pt-2">
                  <span className="font-bold text-xs text-slate-900">2. ผลการพิจารณาและการชดเชย (Resolution & Compensation)</span>
                  <div className="bg-indigo-50/70 border border-indigo-200 rounded-xl p-3.5 space-y-2 text-xs">
                    <div className="flex items-center gap-2 font-bold text-indigo-950 text-sm">
                      <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                      <span>{getResolutionLabel(claim.resolutionType)}</span>
                    </div>

                    {claim.resolutionType === 'REPLACE_ITEM' && (
                      <div className="bg-white p-3 rounded-lg border border-indigo-200 space-y-1 text-slate-800">
                        <p><b>สินค้าตัวใหม่ที่มอบให้ลูกค้า:</b> {claim.replacementProductName || claim.productName}</p>
                        <p><b>จำนวนที่เปลี่ยน:</b> {claim.quantity} {claim.unitName}</p>
                        <p className="text-emerald-700 font-semibold">✨ บันทึกการรับประกันสินค้าชิ้นใหม่ในระบบเรียบร้อยแล้ว</p>
                      </div>
                    )}

                    {(claim.resolutionType === 'REFUND_CASH' || claim.resolutionType === 'REFUND_TRANSFER') && (
                      <div className="bg-white p-3 rounded-lg border border-rose-200 space-y-1 text-slate-800">
                        <div className="flex justify-between items-center text-sm font-black text-rose-700">
                          <span>จำนวนเงินสด / เงินโอนที่คืนให้ลูกค้า:</span>
                          <span className="font-mono text-base">{formatCurrency(claim.refundAmount || claim.totalClaimValue)}</span>
                        </div>
                        {claim.resolutionType === 'REFUND_TRANSFER' && (
                          <div className="text-xs text-slate-600 pt-1">
                            <p><b>บัญชีปลายทาง:</b> {claim.refundAccountLabel || '-'}</p>
                            <p><b>เลขที่บัญชี:</b> {claim.refundAccountNumber || '-'}</p>
                          </div>
                        )}
                      </div>
                    )}

                    {claim.resolutionType === 'STORE_DISCOUNT' && (
                      <div className="bg-white p-3 rounded-lg border border-emerald-200 flex justify-between items-center text-sm font-black text-emerald-800">
                        <span>มูลค่าส่วนลดเครดิตสำหรับซื้อสินค้า:</span>
                        <span className="font-mono text-base">{formatCurrency(claim.discountAmount || claim.totalClaimValue)}</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Additional Note */}
                {claim.note && (
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200 text-xs">
                    <b>หมายเหตุเพิ่มเติม:</b> {claim.note}
                  </div>
                )}

                {/* Store Policy & Terms */}
                <div className="p-3 bg-slate-50/80 rounded-lg border border-slate-200 text-[11px] text-slate-600 space-y-0.5">
                  <span className="font-bold text-slate-800 block">เงื่อนไขการรับเคลมสินค้า:</span>
                  <p>1. เอกสารนี้ออกเพื่อเป็นหลักฐานการรับเคลมหรือเปลี่ยนสินค้าของทางร้านค้า</p>
                  <p>2. สินค้าที่เปลี่ยนใหม่หรือได้รับการชดเชยจะอยู่ภายใต้นโยบายการรับประกันของบริษัทฯ</p>
                  {storeSettings.receiptFooter && (
                    <p className="text-slate-700 pt-0.5 whitespace-pre-wrap">{storeSettings.receiptFooter}</p>
                  )}
                </div>

                </div>

                {/* Formal Signatures Grid (Pinned at the bottom of A4) */}
                <div className="mt-auto pt-6 pb-2 border-t border-slate-300 grid grid-cols-2 gap-8 text-center text-xs">
                  <div className="space-y-4">
                    <p className="font-bold text-slate-700">ลงชื่อ ผู้ส่งเคลม / ลูกค้า</p>
                    <div className="pt-8 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
                    <p className="text-slate-600">({claim.customerName || '................................................'})</p>
                    <p className="text-[10.5px] text-slate-400">วันที่: ......./......./...........</p>
                  </div>

                  <div className="space-y-4">
                    <p className="font-bold text-slate-700">ลงชื่อ ผู้รับเคลม / เจ้าหน้าที่ผู้อนุมัติ</p>
                    <div className="pt-8 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
                    <p className="text-slate-900 font-bold">({claim.cashierName || 'พนักงาน POS'})</p>
                    <p className="text-[10.5px] text-slate-400">วันที่: {formatDate(claim.claimDate)}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Modal Footer */}
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
