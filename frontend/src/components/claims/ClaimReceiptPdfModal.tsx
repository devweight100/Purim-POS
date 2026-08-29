'use client';

import { useRef, useState } from 'react';
import html2canvas from 'html2canvas';
import jsPDF from 'jspdf';
import { formatCurrency, formatDate, thaiBahtText } from '@/lib/utils';
import { ClaimRecord } from '@/lib/types';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { 
  Printer, Download, ExternalLink, ShieldAlert, CheckCircle2, 
  Building2, User, Phone, MapPin, FileText, QrCode, RotateCcw, AlertTriangle 
} from 'lucide-react';
import { toast } from 'sonner';

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
  const [printFormat, setPrintFormat] = useState<'80mm' | 'a4'>('80mm');
  const [isGenerating, setIsGenerating] = useState(false);

  if (!claim) return null;

  const getResolutionLabel = (type: string) => {
    switch (type) {
      case 'REPLACE_ITEM':
        return '🔄 เปลี่ยนสินค้าชิ้นใหม่ทันที (Replacement)';
      case 'REFUND_CASH':
        return '💵 คืนเป็นเงินสด (Cash Refund)';
      case 'REFUND_TRANSFER':
        return '📱 คืนเป็นเงินโอน (Bank Transfer Refund)';
      case 'STORE_DISCOUNT':
        return '🎟️ เปลี่ยนเป็นส่วนลดบิลซื้อ (Store Discount Voucher)';
      case 'SUPPLIER_RMA':
        return '🏭 รับเข้าส่งเคลมโรงงาน/ซัพพลายเออร์ (RMA)';
      default:
        return type;
    }
  };

  const handleNativePrint = () => {
    if (!printDocRef.current) return;
    const printContent = printDocRef.current.innerHTML;
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);

    const doc = iframe.contentWindow?.document;
    if (doc) {
      doc.open();
      doc.write(`
        <!DOCTYPE html>
        <html>
          <head>
            <title>ใบรับเคลมสินค้า - ${claim.id}</title>
            <meta charset="utf-8" />
            <script src="https://cdn.tailwindcss.com"></script>
            <style>
              @page {
                size: ${printFormat === '80mm' ? '80mm auto' : 'A4 portrait'};
                margin: ${printFormat === '80mm' ? '4mm' : '10mm'};
              }
              body {
                margin: 0;
                padding: 0;
                background-color: #ffffff;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
                font-family: 'Sarabun', 'Inter', -apple-system, sans-serif;
              }
            </style>
          </head>
          <body class="bg-white p-2">
            <div style="width: 100%; max-width: ${printFormat === '80mm' ? '80mm' : '100%'}; margin: 0 auto;">
              ${printContent}
            </div>
            <script>
              setTimeout(() => {
                window.focus();
                window.print();
                setTimeout(() => {
                  window.parent.document.body.removeChild(window.frameElement);
                }, 500);
              }, 300);
            </script>
          </body>
        </html>
      `);
      doc.close();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[96vw] max-w-3xl max-h-[92vh] bg-slate-100 border-slate-300 text-slate-900 rounded-3xl p-4 sm:p-6 shadow-2xl flex flex-col overflow-hidden">
        <DialogHeader className="pb-3 border-b border-slate-200 shrink-0">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <DialogTitle className="text-xl font-extrabold flex items-center gap-2 text-slate-900">
                <ShieldAlert className="w-5 h-5 text-indigo-600" />
                <span>ใบรับเคลมสินค้า / ใบเปลี่ยนสินค้า (Claim Voucher)</span>
              </DialogTitle>
              <p className="text-xs text-slate-500 font-mono mt-0.5">
                เลขที่เอกสารเคลม: <span className="font-bold text-indigo-700">{claim.id}</span>
                <span className="ml-2 font-sans text-slate-400">| อ้างอิงบิลซื้อ: #{claim.orderNumber}</span>
              </p>
            </div>

            {/* Print Mode Switcher & Buttons */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-slate-300 shadow-2xs">
                <button
                  type="button"
                  onClick={() => setPrintFormat('80mm')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                    printFormat === '80mm' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  สลิป 80mm
                </button>
                <button
                  type="button"
                  onClick={() => setPrintFormat('a4')}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-all ${
                    printFormat === 'a4' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-slate-100'
                  }`}
                >
                  กระดาษ A4
                </button>
              </div>

              <Button
                type="button"
                size="sm"
                onClick={handleNativePrint}
                className="h-9 px-4 text-xs font-bold bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl gap-1.5 shadow-sm"
              >
                <Printer className="w-4 h-4" />
                <span>พิมพ์เอกสาร ({printFormat.toUpperCase()})</span>
              </Button>
            </div>
          </div>
        </DialogHeader>

        {/* ─── PRINT PREVIEW CONTAINER ─── */}
        <div className="flex-1 overflow-y-auto p-3 flex justify-center bg-slate-200/70 rounded-2xl border border-slate-300/80 my-2">
          {/* Document Sheet */}
          <div
            ref={printDocRef}
            className={`bg-white text-slate-900 shadow-md border border-slate-300 rounded-sm font-sans ${
              printFormat === '80mm' ? 'w-[320px] p-4 text-[11px]' : 'w-full max-w-[750px] p-8 text-xs'
            }`}
          >
            {/* Header */}
            <div className="text-center pb-3 border-b-2 border-slate-800 space-y-1">
              <div className="flex items-center justify-center gap-1.5">
                <div className="w-6 h-6 rounded bg-indigo-600 text-white font-black text-sm flex items-center justify-center">
                  P
                </div>
                <span className="font-black text-base text-slate-900">ร้านปุริม (Purim POS)</span>
              </div>
              <p className="text-[10.5px] text-slate-500">
                123/45 ถ.สุขุมวิท เขตคลองเตย กทม. 10110 | โทร. 02-123-4567
              </p>
              <div className="pt-1">
                <span className="inline-block bg-indigo-50 border border-indigo-600 text-indigo-900 font-extrabold text-xs px-3 py-0.5 rounded-full uppercase">
                  ใบรับเคลมสินค้า / ใบเปลี่ยนสินค้า
                </span>
              </div>
            </div>

            {/* Document Info */}
            <div className="py-2.5 border-b border-slate-200 space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">เลขที่ใบเคลม:</span>
                <span className="font-mono font-bold text-slate-900">{claim.id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">วันที่รับเคลม:</span>
                <span className="font-bold text-slate-800">{formatDate(claim.claimDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">อ้างอิงบิลเดิม:</span>
                <span className="font-mono font-bold text-indigo-700">#{claim.orderNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">วันที่ซื้อเดิม:</span>
                <span className="text-slate-700 font-medium">{formatDate(claim.orderDate)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-semibold">ชื่อลูกค้า:</span>
                <span className="font-bold text-slate-900">{claim.customerName || 'ลูกค้าทั่วไป'}</span>
              </div>
              {claim.customerPhone && (
                <div className="flex justify-between">
                  <span className="text-slate-500 font-semibold">เบอร์โทรศัพท์:</span>
                  <span className="font-mono text-slate-800">{claim.customerPhone}</span>
                </div>
              )}
            </div>

            {/* Claimed Product Details */}
            <div className="py-3 border-b border-slate-200 space-y-2">
              <span className="font-extrabold text-slate-800 block text-xs">
                รายละเอียดสินค้าที่นำมาเคลม:
              </span>
              <div className="bg-slate-50 p-2.5 rounded-lg border border-slate-200 space-y-1">
                <div className="font-bold text-slate-900 text-xs">{claim.productName}</div>
                <div className="text-[10px] text-slate-500 font-mono">รหัส SKU: {claim.sku}</div>
                <div className="flex justify-between pt-1 border-t border-slate-200 text-xs">
                  <span>จำนวนที่เคลม: <b className="font-mono text-slate-900">{claim.quantity} {claim.unitName}</b></span>
                  <span>มูลค่าเดิม: <b className="font-mono text-indigo-700">{formatCurrency(claim.totalClaimValue)}</b></span>
                </div>
              </div>

              {/* Defect Reason */}
              <div className="space-y-0.5 pt-1">
                <span className="text-[10.5px] font-bold text-rose-700 block">สาเหตุ / อาการเสียที่พบ:</span>
                <p className="bg-rose-50 text-rose-950 p-2 rounded border border-rose-200 text-[11px] leading-relaxed font-medium">
                  {claim.defectReason || 'ไม่ได้ระบุอาการ'}
                </p>
              </div>
            </div>

            {/* Resolution Details */}
            <div className="py-3 border-b border-slate-200 space-y-2">
              <span className="font-extrabold text-slate-800 block text-xs">
                ผลการดำเนินการ (Resolution):
              </span>
              <div className="bg-indigo-50/70 border border-indigo-200 p-2.5 rounded-lg space-y-1.5 text-xs text-indigo-950">
                <div className="font-black flex items-center gap-1.5 text-indigo-900">
                  <CheckCircle2 className="w-4 h-4 text-indigo-600 shrink-0" />
                  <span>{getResolutionLabel(claim.resolutionType)}</span>
                </div>

                {claim.resolutionType === 'REPLACE_ITEM' && (
                  <div className="text-[11px] space-y-0.5 pt-1 border-t border-indigo-200/80">
                    <p><b>สินค้าที่เปลี่ยนให้:</b> {claim.replacementProductName || claim.productName} (จำนวน {claim.quantity} {claim.unitName})</p>
                    <p className="text-emerald-700 font-bold">✨ ได้รับสิทธิ์รับประกันสำหรับสินค้าตัวใหม่ในระบบเรียบร้อยแล้ว</p>
                  </div>
                )}

                {(claim.resolutionType === 'REFUND_CASH' || claim.resolutionType === 'REFUND_TRANSFER') && (
                  <div className="text-[11px] pt-1 border-t border-indigo-200/80 space-y-1">
                    <div className="flex justify-between">
                      <span>จำนวนเงินที่คืนให้ลูกค้า:</span>
                      <span className="font-mono font-black text-rose-700 text-sm">
                        {formatCurrency(claim.refundAmount || claim.totalClaimValue)}
                      </span>
                    </div>
                    {claim.resolutionType === 'REFUND_TRANSFER' && (
                      <div className="bg-white/70 border border-sky-200 rounded-lg p-2 text-sky-950 space-y-0.5">
                        <p><b>บัญชีที่ใช้คืนเงิน:</b> {claim.refundAccountLabel || '-'}</p>
                        <p><b>เลขที่บัญชี / พร้อมเพย์:</b> {claim.refundAccountNumber || '-'}</p>
                      </div>
                    )}
                  </div>
                )}

                {claim.resolutionType === 'STORE_DISCOUNT' && (
                  <div className="text-[11px] flex justify-between pt-1 border-t border-indigo-200/80">
                    <span>มูลค่าส่วนลดสำหรับบิลนี้:</span>
                    <span className="font-mono font-black text-emerald-700 text-sm">
                      {formatCurrency(claim.discountAmount || claim.totalClaimValue)}
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Note */}
            {claim.note && (
              <div className="py-2 border-b border-slate-200 text-[10.5px] text-slate-600">
                <b>หมายเหตุเพิ่มเติม:</b> {claim.note}
              </div>
            )}

            {/* Signatures */}
            <div className="pt-6 grid grid-cols-2 gap-4 text-center text-[10.5px]">
              <div className="space-y-3">
                <p className="text-slate-600 font-semibold">ผู้ส่งเคลม / ลูกค้า</p>
                <div className="pt-6 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
                <p className="text-slate-500">(..........................................)</p>
              </div>

              <div className="space-y-3">
                <p className="text-slate-600 font-semibold">ผู้รับเคลม (พนักงาน)</p>
                <div className="pt-6 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
                <p className="text-slate-800 font-bold">({claim.cashierName || 'พนักงาน POS'})</p>
              </div>
            </div>

            <div className="pt-4 text-center text-[9.5px] text-slate-400">
              * โปรดเก็บเอกสารนี้ไว้เป็นหลักฐานการเคลมสินค้า *
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
