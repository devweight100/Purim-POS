"use client";

import React, { useRef, useState } from 'react';
import { formatDocDate, formatDocDateTime, thaiBahtText } from '@/lib/utils';

/** ฿1,234.50: amounts on a tax invoice always show satang */
const formatCurrency = (v: number | string | null | undefined) =>
  '฿' + (Number(v) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
import { paymentMethodLabel } from '@/lib/receipt-mapper';
import { loadStoreSettings, type StoreSettings } from '@/lib/store-settings-storage';
import { getReceiptOptions } from '@/lib/receipt-options';
import { A4FooterText, A4StoreHeader } from '@/components/common/A4StoreHeader';
import { printDocumentIframe, exportElementToPdf, buildA4Pdf } from '@/lib/pdf-print-service';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Printer,
  Download,
  ExternalLink,
  FileText,
  User,
  MapPin,
  Phone,
  Building2,
  ShieldAlert,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatQty } from '@/lib/qty';

export interface ReceiptA4Item {
  sku?: string;
  name: string;
  quantity: number;
  unitName?: string;
  unitPrice: number;
  discountAmount?: number;
  claimDiscountAmount?: number;
  lineTotal: number;
}

export interface ReceiptA4Data {
  orderNumber: string;
  createdAt: string;
  customerName?: string;
  customerPhone?: string;
  customerAddress?: string;
  customerTaxId?: string;
  customerBranch?: string;
  customerCompany?: string;
  userName?: string;
  items: ReceiptA4Item[];
  subtotal: number;
  billDiscountAmount: number;
  pointsDiscountAmount?: number;
  claimDiscountAmount?: number;
  pointsUsed?: number;
  customerPointsEarned?: number;
  customerPointsBalance?: number;
  vatAmount: number;
  totalAmount: number;
  paymentMethod: string;
  payments?: { method: string; amount: number; referenceNo?: string }[];
  cashReceived?: number;
  changeAmount?: number;
  /** unpaid part of a credit sale */
  outstandingAmount?: number;
  /** reprint -> "สำเนา (COPY)" instead of "ต้นฉบับ (ORIGINAL)" */
  isCopy?: boolean;

  // Credit / Installment Specific metadata
  isCreditBill?: boolean;
  isInstallmentReceipt?: boolean;
  installmentNo?: number;
  installmentAmount?: number;
  totalOrderAmount?: number;
  accumulatedPaid?: number;
  remainingDebt?: number;
  installmentDate?: string;

  // Claim specific info if this sale settles a warranty claim
  claimInfo?: {
    claimId: string;
    productName: string;
    quantity: number;
    unitName?: string;
    discountAmount: number;
    defectReason?: string;
  };
}


interface ReceiptA4PdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  data: ReceiptA4Data | null;
}

/*
 * Paging model (one `.a4-page` = one printed A4 sheet). Capacities are in "row units"
 * (one single-line item row); long names count as several rows.
 *  - page 1 carries the full header + customer/document boxes
 *  - later pages carry a compact header
 *  - the LAST page always carries the totals, VAT, amount in words and signatures
 */
const ROWS_FIRST_PAGE = 27;
const ROWS_NEXT_PAGE = 34;
const NAME_CHARS_PER_LINE = 50;

function rowWeight(item: ReceiptA4Item): number {
  return 1 + Math.floor(Math.max(0, (item.name || '').length - 1) / NAME_CHARS_PER_LINE);
}

/** Split item indexes into pages so that the last page still has room for the totals block. */
export function paginateA4Rows(items: ReceiptA4Item[], totalsWeight: number): number[][] {
  const pages: number[][] = [];
  let cur: number[] = [];
  let used = 0;
  let cap = ROWS_FIRST_PAGE;
  items.forEach((item, idx) => {
    const w = rowWeight(item);
    if (cur.length > 0 && used + w > cap) {
      pages.push(cur);
      cur = [];
      used = 0;
      cap = ROWS_NEXT_PAGE;
    }
    cur.push(idx);
    used += w;
  });
  if (used + totalsWeight > cap && cur.length > 1) {
    // no room left for the totals: this page is complete, its last row opens the final page
    const last = cur.pop() as number;
    pages.push(cur);
    cur = [last];
  }
  pages.push(cur);
  return pages;
}

export function ReceiptA4PdfModal({ open, onOpenChange, data }: ReceiptA4PdfModalProps) {
  const receiptA4Ref = useRef<HTMLDivElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const storeSettings = loadStoreSettings();
  // ต้นฉบับ (for the buyer) / สำเนา (the shop's copy): reprints default to a copy, the cashier can switch
  const [copyChoice, setCopyChoice] = useState<{ doc: string; copy: boolean } | null>(null);

  if (!data) return null;

  const { vatShop, hasVat, isInstallment, docTitleTh, pageCount } = receiptA4Meta(data, storeSettings);
  const isCopy = copyChoice && copyChoice.doc === data.orderNumber ? copyChoice.copy : data.isCopy === true;
  // a VAT shop issues a full tax invoice, which needs the shop's tax id
  const missingTaxId = vatShop && !String(storeSettings.taxId || '').trim();

  const handleDownloadPdf = async () => {
    if (!receiptA4Ref.current) return;
    setIsGenerating(true);
    toast.loading('กำลังสร้างไฟล์ PDF...', { id: 'a4-receipt-pdf' });
    try {
      const prefix = isInstallment
        ? `Receipt_Inst${data.installmentNo}_`
        : hasVat ? 'TaxInvoice_A4_' : 'Receipt_A4_';
      const filename = `${prefix}${data.orderNumber}${isCopy ? '_COPY' : ''}.pdf`;
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
    setIsGenerating(true);
    toast.loading('กำลังจัดเตรียมเอกสาร A4...', { id: 'a4-receipt-tab' });
    try {
      const pdf = await buildA4Pdf(receiptA4Ref.current);
      const blobUrl = pdf.output('bloburl');
      window.open(blobUrl, '_blank');
      toast.success('เปิดเอกสารในแท็บใหม่แล้ว', { id: 'a4-receipt-tab' });
    } catch (err) {
      console.error('Failed to generate A4 PDF:', err);
      toast.error('ไม่สามารถสร้างเอกสาร A4 PDF ได้', { id: 'a4-receipt-tab' });
      handleNativePrint();
    } finally {
      setIsGenerating(false);
    }
  };

  const handleNativePrint = () => {
    if (!receiptA4Ref.current) return;
    const docTitle = `${isInstallment ? `ใบเสร็จรับเงิน (งวดที่ ${data.installmentNo})` : docTitleTh} (A4) - ${data.orderNumber}`;
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
                {pageCount > 1 && <span className="ml-2 font-sans font-bold text-slate-700">({pageCount} หน้า)</span>}
                <span className="ml-2 inline-flex rounded-md border border-slate-300 overflow-hidden font-sans align-middle">
                  {([false, true] as const).map((copy) => (
                    <button
                      key={String(copy)}
                      type="button"
                      onClick={() => setCopyChoice({ doc: data.orderNumber, copy })}
                      className={`px-2 py-0.5 text-[11px] font-bold ${isCopy === copy ? 'bg-slate-800 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'}`}
                    >
                      {copy ? 'สำเนา' : 'ต้นฉบับ'}
                    </button>
                  ))}
                </span>
                {isInstallment && (
                  <span className="ml-2 bg-indigo-100 text-indigo-800 text-[11px] font-bold px-2 py-0.5 rounded-md font-sans">
                    รับชำระงวดที่ {data.installmentNo}: {formatCurrency(data.installmentAmount || 0)} (คงค้าง {formatCurrency(data.remainingDebt || 0)})
                  </span>
                )}
                {vatShop && !hasVat && !isInstallment && (
                  <span className="ml-2 text-emerald-600 font-sans font-bold">(แบบไม่มี VAT)</span>
                )}
              </p>
              {missingTaxId && (
                <p className="mt-1 text-[11px] font-bold text-amber-800 bg-amber-100 border border-amber-300 rounded-lg px-2 py-1 font-sans">
                  ยังไม่ได้ตั้งค่าเลขประจำตัวผู้เสียภาษีของร้าน - ใบกำกับภาษีที่ไม่มีเลขผู้เสียภาษีใช้เป็นหลักฐานภาษีไม่ได้ (ตั้งค่าที่ ตั้งค่าร้านค้า)
                </p>
              )}
            </div>

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

        {/* ─── A4 PAPER PREVIEW: one sheet per printed page ─── */}
        <div className="flex-1 overflow-y-auto p-2 sm:p-4 flex justify-center bg-slate-200/70 rounded-2xl border border-slate-300/80 my-2">
          <ReceiptA4Document ref={receiptA4Ref} data={data} settings={storeSettings} isCopy={isCopy} />
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


/** Everything the A4 receipt derives from the bill and the shop's VAT setting. */
export function receiptA4Meta(data: ReceiptA4Data, settings: StoreSettings) {
  // a shop without VAT prints a plain receipt: no tax invoice title, no VAT lines, no tax ids
  const vatShop = settings.vatEnabled === true;
  const vatNum = Number(data.vatAmount) || 0;
  const hasVat = vatShop && vatNum > 0;
  const isInstallment = data.isInstallmentReceipt === true;
  const rawReceiptAmount = isInstallment ? (data.installmentAmount ?? data.totalAmount) : data.totalAmount;
  const receiptAmount = Number(rawReceiptAmount) || 0;
  const vatRateLabel = Number(settings.vatRate) || 7;
  const totalBeforeVat = hasVat ? Math.max(0, receiptAmount - vatNum) : receiptAmount;
  const docTitleTh = isInstallment ? 'ใบเสร็จรับเงิน' : hasVat ? 'ใบเสร็จรับเงิน / ใบกำกับภาษี' : 'ใบเสร็จรับเงิน';
  const docTitleEn = isInstallment
    ? `RECEIPT (INSTALLMENT NO. ${data.installmentNo})`
    : hasVat
    ? 'RECEIPT / TAX INVOICE'
    : 'RECEIPT';
  const docDate = isInstallment && data.installmentDate ? data.installmentDate : data.createdAt;
  // room the totals + signatures need on the last page, in row units
  const totalsWeight =
    13 +
    (data.payments && data.payments.length > 0 ? 1 + Math.ceil(data.payments.length / 2) : 0) +
    (data.claimInfo ? 4 : 0) +
    (data.outstandingAmount && data.outstandingAmount > 0 ? 1 : 0);
  const pages = paginateA4Rows(data.items, totalsWeight);
  const pageCount = pages.length;
  // a short single-page bill keeps a few empty grid rows (looks like a pre-printed form)
  const emptyRowsCount = pageCount === 1 && data.items.length <= 5 ? 6 - data.items.length : 0;
  return {
    vatShop, hasVat, isInstallment, receiptAmount, vatRateLabel, totalBeforeVat, docTitleTh, docTitleEn, docDate,
    pages, pageCount, emptyRowsCount,
  };
}

/**
 * The A4 receipt / tax invoice itself (one `.a4-page` per printed sheet). The dialog prints this
 * node, and the settings page previews the same component.
 */
export const ReceiptA4Document = React.forwardRef<
  HTMLDivElement,
  { data: ReceiptA4Data; settings: StoreSettings; isCopy?: boolean }
>(function ReceiptA4Document({ data, settings: storeSettings, isCopy = false }, ref) {
  const o = getReceiptOptions(storeSettings).a4;
  const {
    vatShop, hasVat, isInstallment, receiptAmount, vatRateLabel, totalBeforeVat, docTitleTh, docTitleEn, docDate,
    pages, pageCount, emptyRowsCount,
  } = receiptA4Meta(data, storeSettings);
  const tableHead = (
    <thead className="bg-slate-100 text-black font-extrabold border-b-2 border-slate-300">
      <tr>
        <th className="py-1.5 px-2 text-center w-[36px] border-r border-slate-300 text-black font-black">#</th>
        <th className="py-1.5 px-3 text-center border-r border-slate-300 text-black font-black">รายการสินค้า (Description)</th>
        <th className="py-1.5 px-1.5 text-center w-[52px] border-r border-slate-300 text-black font-black">จำนวน</th>
        <th className="py-1.5 px-1.5 text-center w-[52px] border-r border-slate-300 text-black font-black">หน่วย</th>
        <th className="py-1.5 px-2 text-center w-[85px] border-r border-slate-300 text-black font-black">ราคา/หน่วย</th>
        <th className="py-1.5 px-2 text-center w-[75px] border-r border-slate-300 text-black font-black">ส่วนลด</th>
        <th className="py-1.5 px-2.5 text-center w-[95px] text-black font-black">จำนวนเงิน (฿)</th>
      </tr>
    </thead>
  );

  const copyBadge = (
    <span className={`inline-block text-white text-[9.5px] font-bold px-1.5 py-0.5 rounded ${isCopy ? 'bg-slate-700' : 'bg-indigo-600'}`}>
      {isCopy ? 'สำเนา (COPY)' : 'ต้นฉบับ (ORIGINAL)'}
    </span>
  );



  const fullHeader = (
    <div className="flex flex-row justify-between items-start gap-4 pb-2.5 border-b-2 border-slate-800">
      <A4StoreHeader settings={storeSettings} className="max-w-[450px]" />

      <div className="text-right border-2 border-indigo-700 bg-indigo-50/60 p-2.5 rounded-xl min-w-[220px]">
        <h3 className="text-sm font-black text-indigo-950 uppercase tracking-tight">{docTitleTh}</h3>
        <span className="text-[10.5px] font-extrabold text-indigo-700 block">{docTitleEn}</span>
        <div className="flex gap-1 justify-end mt-1">
          {isInstallment && (
            <span className="inline-block bg-amber-600 text-white text-[9.5px] font-bold px-1.5 py-0.5 rounded">
              ชำระงวดที่ {data.installmentNo}
            </span>
          )}
          {copyBadge}
        </div>
      </div>
    </div>
  );

  const compactHeader = (pageNo: number) => (
    <div className="flex flex-row justify-between items-end gap-4 pb-1.5 border-b-2 border-slate-800">
      <div>
        <h2 className="text-base font-black text-slate-900 leading-none">{storeSettings.storeName || 'ร้านปุริม (Purim POS)'}</h2>
        <span className="text-[10.5px] text-slate-600">
          {docTitleTh} เลขที่ <b className="font-mono">{data.orderNumber}</b> วันที่ {formatDocDate(docDate)}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-[10.5px] font-bold text-slate-700">(ต่อ) หน้า {pageNo}/{pageCount}</span>
        {copyBadge}
      </div>
    </div>
  );

  const partiesBlock = (
    <div className="grid grid-cols-2 gap-2.5 text-xs">
      <div className="border border-slate-300 rounded-xl p-2.5 bg-slate-50/50 space-y-0.5">
        <div className="font-extrabold text-slate-900 border-b border-slate-200 pb-1 flex items-center gap-1.5">
          {data.customerCompany ? <Building2 className="w-3.5 h-3.5 text-indigo-600" /> : <User className="w-3.5 h-3.5 text-sky-600" />}
          <span className="text-[11px]">ข้อมูลลูกค้า / ผู้ซื้อ (Customer Details)</span>
        </div>
        <div className="pt-0.5 space-y-0.5">
          <div className="text-[11.5px] font-bold text-slate-900">
            {data.customerCompany || data.customerName || 'ลูกค้าทั่วไป (General Customer)'}
          </div>
          {o.showCustomerDetails && data.customerAddress && (
            <div className="text-slate-600 leading-tight flex items-start gap-1 text-[10.5px]">
              <MapPin className="w-3 h-3 text-slate-400 mt-0.5 shrink-0" />
              <span>{data.customerAddress}</span>
            </div>
          )}
          {vatShop && o.showCustomerDetails && data.customerTaxId && (
            <div className="text-slate-700 text-[10.5px]">
              <b>เลขผู้เสียภาษี:</b> <span className="font-mono">{data.customerTaxId}</span>
              {data.customerBranch && <span className="ml-2 font-medium">({data.customerBranch})</span>}
            </div>
          )}
          {o.showCustomerDetails && data.customerPhone && (
            <div className="text-slate-700 flex items-center gap-1 text-[10.5px]">
              <Phone className="w-3 h-3 text-slate-400" />
              <span>โทร: {data.customerPhone}</span>
            </div>
          )}
        </div>
      </div>

      <div className="border border-slate-300 rounded-xl p-2.5 bg-slate-50/50 space-y-0.5">
        <div className="font-extrabold text-slate-900 border-b border-slate-200 pb-1 flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-indigo-600" />
          <span className="text-[11px]">ข้อมูลเอกสาร (Document Details)</span>
        </div>
        <div className="pt-0.5 space-y-0.5 text-[11px]">
          <div className="flex justify-between">
            <span className="text-slate-500 font-semibold">เลขที่เอกสาร (No.):</span>
            <span className="font-mono font-bold text-slate-900">{data.orderNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-slate-500 font-semibold">
              {isInstallment ? 'วันที่รับชำระ (Payment Date):' : 'วันที่ออกเอกสาร (Date):'}
            </span>
            <span className="font-bold text-slate-800">{formatDocDateTime(docDate)}</span>
          </div>
          {o.showCashier && (
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">พนักงานขาย (Cashier):</span>
              <span className="font-medium text-slate-800">{data.userName || 'พนักงาน POS'}</span>
            </div>
          )}
          <div className="flex justify-between">
            <span className="text-slate-500 font-semibold">ช่องทางชำระ (Payment):</span>
            <span className="font-bold text-indigo-700">{data.paymentMethod}</span>
          </div>
          {isCopy && (
            <div className="flex justify-between">
              <span className="text-slate-500 font-semibold">พิมพ์สำเนาเมื่อ:</span>
              <span className="font-medium text-slate-800">{formatDocDateTime(new Date())}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const summaryBlock = (
    <div className="grid grid-cols-12 gap-3 text-xs pt-0.5 break-inside-avoid">
      <div className="col-span-5 space-y-1.5">
        {o.showAmountInWords && (
          <div className="bg-slate-100 p-2 rounded-xl border border-slate-200">
            <span className="text-[10px] font-bold text-slate-600 block">จำนวนเงินตัวอักษร (Amount in Words):</span>
            <span className="text-[11.5px] font-black text-slate-900 leading-snug">{thaiBahtText(receiptAmount)}</span>
          </div>
        )}

        {o.showPaymentDetails && data.payments && data.payments.length > 0 && (
          <div className="border border-slate-200 rounded-xl p-2 bg-slate-50 space-y-0.5">
            <span className="font-bold text-slate-800 block text-[10.5px]">รายละเอียดการชำระเงิน:</span>
            {data.payments.map((p, i) => (
              <div key={i} className="flex justify-between text-[10.5px] text-slate-700">
                <span>
                  • {paymentMethodLabel(p.method)}
                  {p.referenceNo ? ` (${p.referenceNo})` : ''}
                </span>
                <span className="font-mono font-bold text-slate-900">{formatCurrency(p.amount)}</span>
              </div>
            ))}
            {data.cashReceived !== undefined && data.cashReceived > 0 && (
              <div className="flex justify-between text-[10.5px] text-slate-700 pt-0.5 border-t border-slate-200">
                <span>รับเงินมา</span>
                <span className="font-mono font-bold text-slate-900">{formatCurrency(data.cashReceived)}</span>
              </div>
            )}
            {data.changeAmount !== undefined && data.changeAmount > 0 && (
              <div className="flex justify-between text-[10.5px] text-slate-700">
                <span>เงินทอน</span>
                <span className="font-mono font-bold text-slate-900">{formatCurrency(data.changeAmount)}</span>
              </div>
            )}
          </div>
        )}

        {o.showPoints && data.customerName && (data.customerPointsEarned ?? 0) > 0 && (
          <div className="border border-slate-200 bg-slate-50 p-1.5 rounded-xl text-[10px] text-slate-600 flex justify-between">
            <span>ได้รับแต้ม: <b className="text-emerald-700 font-bold">+{data.customerPointsEarned ?? 0}</b></span>
            {data.customerPointsBalance !== undefined && (
              <span>แต้มคงเหลือ: <b className="text-slate-900 font-black">{data.customerPointsBalance.toLocaleString()}</b> แต้ม</span>
            )}
          </div>
        )}

        {data.claimInfo && (
          <div className="border-2 border-emerald-300 bg-emerald-50/70 p-2 rounded-xl space-y-0.5 text-xs shadow-2xs">
            <div className="flex items-center justify-between text-emerald-950 font-extrabold border-b border-emerald-200 pb-0.5">
              <div className="flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 text-emerald-700 shrink-0" />
                <span className="text-[10.5px]">ข้อมูลการเคลมสินค้า (Warranty Claim)</span>
              </div>
              <span className="font-mono text-indigo-700 font-bold text-[10.5px]">#{data.claimInfo.claimId}</span>
            </div>
            <div className="text-slate-800 text-[10px] pt-0.5">
              • สินค้า: <b className="text-slate-900">{data.claimInfo.productName}</b> ({formatQty(data.claimInfo.quantity)} {data.claimInfo.unitName})
            </div>
            {data.claimInfo.defectReason && (
              <div className="text-slate-600 text-[9.5px]">• อาการเสีย: {data.claimInfo.defectReason}</div>
            )}
            <div className="flex justify-between items-center text-emerald-800 font-bold pt-0.5 border-t border-emerald-200 text-[11px]">
              <span>ส่วนลดเคลมนำมาหักในบิลนี้:</span>
              <span className="font-mono font-black text-xs">-{formatCurrency(data.claimInfo.discountAmount)}</span>
            </div>
          </div>
        )}
      </div>

      <div className="col-span-7 border-2 border-slate-300 rounded-xl p-2.5 bg-slate-50/90 space-y-1 text-xs">
        {isInstallment ? (
          <>
            <div className="flex justify-between text-slate-700 text-xs">
              <span className="font-semibold">ยอดรวมตามคำสั่งซื้อ (Total Order):</span>
              <span className="font-mono font-bold text-slate-900">{formatCurrency(data.totalOrderAmount || data.totalAmount)}</span>
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
            <div className="flex justify-between items-center text-slate-900 pt-1.5 mt-0.5 border-t-2 border-slate-800 bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
              <div>
                <span className="text-[11px] font-black text-indigo-950 block">ยอดรับชำระในใบเสร็จนี้ (งวดที่ {data.installmentNo})</span>
                <span className="text-[9px] font-bold text-slate-500 block">RECEIPT AMOUNT</span>
              </div>
              <span className="font-mono text-lg font-black text-indigo-700">{formatCurrency(receiptAmount)}</span>
            </div>
          </>
        ) : (
          <>
            <div className="flex justify-between text-slate-700 text-[11.5px]">
              <span className="font-semibold">รวมเป็นเงิน (Subtotal):</span>
              <span className="font-mono font-bold text-slate-900">{formatCurrency(data.subtotal)}</span>
            </div>

            {data.billDiscountAmount > 0 && (
              <div className="flex justify-between text-rose-600 text-[11px]">
                <span>ส่วนลดท้ายบิล (Bill Discount):</span>
                <span className="font-mono font-bold">-{formatCurrency(data.billDiscountAmount)}</span>
              </div>
            )}

            {data.pointsDiscountAmount !== undefined && data.pointsDiscountAmount > 0 && (
              <div className="flex justify-between text-amber-800 text-[11px]">
                <span>ส่วนลดแต้มสมาชิก ({data.pointsUsed?.toLocaleString() || 0} แต้ม):</span>
                <span className="font-mono font-bold">-{formatCurrency(data.pointsDiscountAmount)}</span>
              </div>
            )}

            {data.claimDiscountAmount !== undefined && data.claimDiscountAmount > 0 && (
              <div className="flex justify-between text-emerald-700 text-[11px] font-bold">
                <span>ส่วนลดเคลมสินค้า (Claim Discount):</span>
                <span className="font-mono font-bold">-{formatCurrency(data.claimDiscountAmount)}</span>
              </div>
            )}

            {hasVat && (
              <>
                <div className="flex justify-between text-slate-700 pt-1 border-t border-slate-200 text-[11px]">
                  <span>มูลค่าสินค้าก่อนภาษี (Net Subtotal):</span>
                  <span className="font-mono font-bold">{formatCurrency(totalBeforeVat)}</span>
                </div>
                <div className="flex justify-between text-slate-700 text-[11px]">
                  <span>ภาษีมูลค่าเพิ่ม {vatRateLabel}% (VAT {vatRateLabel}%):</span>
                  <span className="font-mono font-bold">{formatCurrency(data.vatAmount)}</span>
                </div>
              </>
            )}

            <div className="flex justify-between items-center text-slate-900 pt-1.5 mt-0.5 border-t-2 border-slate-800 bg-white p-2.5 rounded-lg border border-slate-200 shadow-2xs">
              <div>
                <span className="text-xs font-black text-indigo-950 block">จำนวนเงินรวมทั้งสิ้น</span>
                <span className="text-[9.5px] font-bold text-slate-500 block">TOTAL AMOUNT</span>
              </div>
              <span className="font-mono text-xl font-black text-indigo-700">{formatCurrency(data.totalAmount)}</span>
            </div>

            {data.outstandingAmount !== undefined && data.outstandingAmount > 0 && (
              <div className="flex justify-between text-rose-700 text-[11.5px] font-black pt-0.5">
                <span>ยอดค้างชำระ (เงินเชื่อ):</span>
                <span className="font-mono">{formatCurrency(data.outstandingAmount)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );

  const signatures = (
    <div className="pt-3 pb-1 border-t border-slate-300 grid grid-cols-2 gap-8 text-xs text-center break-inside-avoid">
      <div className="space-y-1.5">
        <p className="text-slate-600 font-semibold text-[10.5px]">ผู้รับสินค้า / ผู้จ่ายเงิน (Customer / Receiver)</p>
        <div className="pt-5 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
        <div className="text-[10px] text-slate-500 space-y-0.5">
          <p>(....................................................................)</p>
          <p>วันที่ (Date): ......./......./............</p>
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-slate-600 font-semibold text-[10.5px]">ผู้รับเงิน / ผู้มีอำนาจลงนาม (Cashier / Authorized Signature)</p>
        <div className="pt-5 border-b border-slate-400 mx-auto w-3/4 border-dashed" />
        <div className="text-[10px] text-slate-500 space-y-0.5">
          <p>({data.userName || 'พนักงานขาย / ผู้รับเงิน'})</p>
          <p>วันที่ (Date): {formatDocDate(docDate)}</p>
        </div>
      </div>
    </div>
  );

  return (
    <div ref={ref} className="a4-preview-stack flex flex-col gap-4">
            {pages.map((rowIdx, pageIdx) => {
              const isFirst = pageIdx === 0;
              const isLast = pageIdx === pageCount - 1;
              return (
                <div
                  key={pageIdx}
                  className="a4-page a4-container w-[210mm] max-w-[210mm] min-h-[297mm] bg-white p-[8mm] shadow-xl text-slate-900 font-sans border border-slate-300 rounded-sm flex flex-col box-border"
                  style={{ width: '210mm', maxWidth: '210mm', minHeight: '297mm', boxSizing: 'border-box' }}
                >
                  <div className="space-y-2.5">
                    {isFirst ? fullHeader : compactHeader(pageIdx + 1)}
                    {isFirst && partiesBlock}

                    <div className="border border-slate-300 rounded-xl overflow-hidden bg-white">
                      <table className="w-full text-left border-collapse text-xs">
                        {tableHead}
                        <tbody>
                          {rowIdx.map((idx) => {
                            const item = data.items[idx];
                            return (
                              <tr key={idx} className="min-h-[28px] text-black border-t border-slate-200">
                                <td className="py-1 px-2 text-center font-mono text-black font-bold border-r border-slate-300 align-top">{idx + 1}</td>
                                <td className="py-1 px-3 border-r border-slate-300 align-top">
                                  <div className="font-bold text-black leading-snug">{item.name}</div>
                                </td>
                                <td className="py-1 px-1.5 text-center font-bold text-black border-r border-slate-300 font-mono align-top">{formatQty(item.quantity, { grouping: true })}</td>
                                <td className="py-1 px-1.5 text-center text-black font-medium border-r border-slate-300 align-top">{item.unitName || 'ชิ้น'}</td>
                                <td className="py-1 px-2 text-right font-mono text-black font-bold border-r border-slate-300 align-top">{formatCurrency(item.unitPrice)}</td>
                                <td className="py-1 px-2 text-right font-mono text-black font-bold border-r border-slate-300 align-top">
                                  {item.discountAmount && item.discountAmount > 0 ? `-${formatCurrency(item.discountAmount)}` : '-'}
                                </td>
                                <td className="py-1 px-2.5 text-right font-bold font-mono text-black align-top">{formatCurrency(item.lineTotal)}</td>
                              </tr>
                            );
                          })}

                          {isLast && Array.from({ length: emptyRowsCount }).map((_, emptyIdx) => (
                            <tr key={`empty-${emptyIdx}`} className="h-[26px]">
                              <td className="py-0.5 px-2 border-r border-slate-300 text-transparent select-none">-</td>
                              <td className="py-0.5 px-3 border-r border-slate-300 text-transparent select-none">-</td>
                              <td className="py-0.5 px-1.5 border-r border-slate-300 text-transparent select-none">-</td>
                              <td className="py-0.5 px-1.5 border-r border-slate-300 text-transparent select-none">-</td>
                              <td className="py-0.5 px-2 border-r border-slate-300 text-transparent select-none">-</td>
                              <td className="py-0.5 px-2 border-r border-slate-300 text-transparent select-none">-</td>
                              <td className="py-0.5 px-2.5 text-transparent select-none">-</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    {isLast && summaryBlock}
                  </div>

                  <div className="mt-auto pt-3 space-y-1">
                    {isLast && <A4FooterText settings={storeSettings} className="text-center text-[10.5px] text-slate-700" />}
                    {isLast ? (o.showSignatures ? signatures : null) : (
                      <p className="text-right text-[10.5px] font-bold text-slate-600">มีต่อหน้าถัดไป ...</p>
                    )}
                    {pageCount > 1 && (
                      <p className="text-center text-[9.5px] text-slate-500">หน้า {pageIdx + 1} / {pageCount}</p>
                    )}
                  </div>
                </div>
              );
            })}
    </div>
  );
});
