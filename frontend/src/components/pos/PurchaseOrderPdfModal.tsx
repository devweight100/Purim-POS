'use client';

import { useState, useRef } from 'react';
import { calculatePurchaseBill } from '@shared/po-calc';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Printer, Download, FileText, CheckCircle2, Building2, Calendar, FileCheck } from 'lucide-react';
import { formatCurrency, formatDocDate, thaiBahtText } from '@/lib/utils';
import { toast } from 'sonner';
import { BarcodeView } from '@/components/common/BarcodeView';
import { A4StoreHeader } from '@/components/common/A4StoreHeader';
import { loadStoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe, exportElementToPdf } from '@/lib/pdf-print-service';
import { formatQty } from '@/lib/qty';

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

type Num = number | string | null;

/** A PO line in any shape this document accepts (server PO, older local POs): every field optional. */
interface PoLikeItem {
  name?: string;
  productName?: string;
  sku?: string;
  unit?: string;
  unitName?: string;
  quantity?: Num;
  qty?: Num;
  unitCost?: Num;
  cost?: Num;
  price?: Num;
  discountType?: string | null;
  discountValue?: Num;
  vatType?: string | null;
  vatRate?: Num;
  product?: { name?: string; sku?: string; unit?: string } | null;
}

/** A purchase order in any shape this document accepts. */
interface PoLike {
  id?: string;
  notes?: string | null;
  poNumber?: string;
  poCode?: string;
  createdAt?: string;
  date?: string;
  status?: string;
  supplier?: string | {
    name?: string;
    contactName?: string;
    contact?: string;
    phone?: string;
    tel?: string;
    email?: string;
    address?: string;
    creditTerms?: Num;
  } | null;
  supplierName?: string;
  contactName?: string;
  phone?: string;
  email?: string;
  address?: string;
  creditTerms?: Num;
  items?: PoLikeItem[];
  orderItems?: PoLikeItem[];
  purchaseOrderItems?: PoLikeItem[];
  vatType?: string | null;
  hasVat?: boolean;
  billDiscountType?: string | null;
  billDiscountValue?: Num;
  discountType?: string | null;
  discountValue?: Num;
}

interface PurchaseOrderPdfModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  po: PurchaseOrderData | null;
}

const PO_STATUS_LABELS: Record<string, string> = {
  DRAFT: 'ฉบับร่าง',
  PENDING: 'รออนุมัติ',
  ISSUED: 'ออกใบสั่งซื้อแล้ว',
  ORDERED: 'สั่งซื้อแล้ว',
  PARTIALLY_RECEIVED: 'รับสินค้าบางส่วน',
  RECEIVED: 'รับสินค้าครบแล้ว',
  COMPLETED: 'เสร็จสมบูรณ์',
  CANCELLED: 'ยกเลิก',
};

export function poStatusLabel(status: string | null | undefined): string {
  const key = String(status || '').toUpperCase();
  return PO_STATUS_LABELS[key] || String(status || '-');
}

export default function PurchaseOrderPdfModal({ open, onOpenChange, po }: PurchaseOrderPdfModalProps) {
  const [isExporting, setIsExporting] = useState(false);
  // Hooks must run before any early return (React error #310 otherwise).
  const [storeSettings] = useState(() => loadStoreSettings());
  const printRef = useRef<HTMLDivElement>(null);

  if (!po) return null;

  // Safeguard: Unpack if po was passed as an array or object
  const poData = (Array.isArray(po) ? (po.length > 0 ? po[0] : null) : po) as PoLike | null;
  if (!poData || typeof poData !== 'object' || Object.keys(poData).length === 0) return null;

  const supplierObj = (poData.supplier && typeof poData.supplier === 'object') ? poData.supplier : {} as Exclude<PoLike['supplier'], string | null | undefined>;
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
  const items: PoLikeItem[] = Array.isArray(rawItems) ? rawItems : [];

  // Same arithmetic as the server (shared/src/po-calc.ts): per-line discount, bill discount, per-line VAT.
  // Old local-only POs had one VAT setting for the whole bill.
  const legacyVat = poData.vatType || (poData.hasVat ? 'include' : 'none');
  const calc = calculatePurchaseBill(
    items.map((item) => ({
      quantity: Number(item.quantity) || Number(item.qty) || 0,
      unitCost: Number(item.unitCost) || Number(item.cost) || Number(item.price) || 0,
      discountType: item.discountType,
      discountValue: item.discountValue,
      vatType: item.vatType ?? legacyVat,
      vatRate: item.vatRate ?? 7,
    })),
    { type: poData.billDiscountType ?? poData.discountType, value: poData.billDiscountValue ?? poData.discountValue },
  );
  const subtotalBeforeDiscount = Math.round((calc.baseAmount - calc.lineDiscountAmount) * 100) / 100;
  // each line's own discount (without its share of the bill discount), same rule as po-calc
  const lineDiscounts = calc.lines.map((l) =>
    Math.round(Math.min(l.baseAmount, l.discountType === 'percent' ? (l.baseAmount * Math.min(l.discountValue, 100)) / 100 : l.discountValue) * 100) / 100,
  );
  const billDiscountAmount = calc.billDiscountAmount;
  const vatAmount = calc.vatAmount;
  const netAmount = calc.subtotalAmount;
  const finalTotal = calc.totalAmount;
  const usedVatTypes = new Set(calc.lines.filter((l) => l.baseAmount > 0 && l.vatType !== 'NONE').map((l) => l.vatType));
  const vatType: 'none' | 'include' | 'exclude' | 'mixed' =
    usedVatTypes.size === 0 ? 'none' : usedVatTypes.size > 1 || calc.lines.some((l) => l.baseAmount > 0 && l.vatType === 'NONE') ? 'mixed' : usedVatTypes.has('INCLUDED') ? 'include' : 'exclude';
  // purchase VAT is the supplier's tax: a shop without VAT shows VAT columns only when this PO has VAT
  const showVat = storeSettings.vatEnabled === true || vatType !== 'none';
  const vatRates = Array.from(new Set(calc.lines.filter((l) => l.vatType !== 'NONE').map((l) => l.vatRate))).join('/');


  const handlePrint = () => {
    if (!printRef.current) return;
    printDocumentIframe(printRef.current, `ใบสั่งซื้อ - ${poNumber}`, 'a4');
  };

  const handleDownloadPdf = async () => {
    if (!printRef.current) return;
    setIsExporting(true);
    try {
      // multi-page: long POs are split over as many A4 pages as needed
      const ok = await exportElementToPdf(printRef.current, `ใบสั่งซื้อ_${poNumber}.pdf`, 'a4');
      if (ok) toast.success('ดาวน์โหลดไฟล์ PDF เรียบร้อยแล้ว');
      else toast.error('เกิดข้อผิดพลาดในการสร้างไฟล์ PDF');
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
            className="a4-page a4-container w-[210mm] max-w-[210mm] shrink-0 min-h-[297mm] bg-white border border-slate-300 p-[10mm] shadow-lg text-slate-800 font-sans flex flex-col justify-between box-border"
          >
            {/* Top Company Header & Document Title */}
            <div>
              <div className="flex justify-between items-start border-b-2 border-slate-800 pb-3 mb-4">
                <A4StoreHeader settings={storeSettings} showHeaderText={false} className="max-w-[60%]" />
                <div className="text-right flex flex-col items-end">
                  <div className="inline-block bg-sky-600 text-white font-black px-4 py-1.5 rounded text-lg uppercase tracking-wider mb-2">
                    ใบสั่งซื้อ / PURCHASE ORDER
                  </div>
                  <div className="text-xs text-slate-500 font-mono font-bold">ต้นฉบับ (ORIGINAL)</div>
                  <div className="mt-1">
                    <BarcodeView value={poNumber} height={32} />
                  </div>
                </div>
              </div>

              {/* Order Metadata Box */}
              <div className="grid grid-cols-2 gap-4 mb-4">
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
                      <span className="font-bold text-slate-900">{formatDocDate(createdAt, { time: true })}</span>
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
                        {poStatusLabel(status)}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Items Table */}
              <div className="mb-4 overflow-hidden border border-slate-300 rounded-xl">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="bg-slate-800 text-white font-bold uppercase">
                      <th className="p-2.5 text-center w-12 border-r border-slate-700">ลำดับ</th>
                      <th className="p-2.5 w-24 border-r border-slate-700">รหัสสินค้า</th>
                      <th className="p-2.5 border-r border-slate-700">รายการสินค้า (DESCRIPTION)</th>
                      <th className="p-2.5 text-right w-16 border-r border-slate-700">จำนวน</th>
                      <th className="p-2.5 text-right w-20 border-r border-slate-700">หน่วยละ</th>
                      <th className="p-2.5 text-right w-20 border-r border-slate-700">ส่วนลด</th>
                      {showVat && <th className="p-2.5 text-right w-16 border-r border-slate-700">VAT</th>}
                      <th className="p-2.5 text-right w-24">จำนวนเงิน (บาท)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 font-medium">
                    {items.length === 0 ? (
                      <tr>
                        <td colSpan={showVat ? 8 : 7} className="p-8 text-center text-slate-400 font-semibold">
                          ไม่พบรายการสินค้าในใบสั่งซื้อนี้
                        </td>
                      </tr>
                    ) : (
                      items.map((item, idx: number) => {
                        const name = item.name || item.product?.name || item.productName || 'สินค้า';
                        const sku = item.sku || item.product?.sku || '-';
                        const qty = Number(item.quantity) || Number(item.qty) || 0;
                        const cost = Number(item.unitCost) || Number(item.cost) || Number(item.price) || 0;
                        const line = calc.lines[idx];
                        const lineDiscount = lineDiscounts[idx] || 0;
                        // amount after the line's own discount: rows add up to "รวมเป็นเงิน"
                        const lineAmount = Math.round((qty * cost - lineDiscount) * 100) / 100;
                        const unitBadge = item.unitName || item.product?.unit || item.unit || 'ชิ้น';
                        return (
                          <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50/60'}>
                            <td className="p-2.5 text-center text-slate-500 font-semibold border-r border-slate-200">{idx + 1}</td>
                            <td className="p-2.5 font-mono text-slate-700 font-semibold border-r border-slate-200">{sku}</td>
                            <td className="p-2.5 border-r border-slate-200 font-bold text-slate-900">
                              <span>{name}</span>
                              {unitBadge && <span className="ml-1.5 text-[10px] text-sky-700 bg-sky-50 border border-sky-200 px-1.5 py-0.2 rounded font-normal">[{unitBadge}]</span>}
                              {calc.lines[idx]?.vatType === 'INCLUDED' && <span className="ml-1.5 text-[10px] text-emerald-700 font-normal">(ราคารวม VAT {calc.lines[idx].vatRate}%)</span>}
                              {calc.lines[idx]?.vatType === 'EXCLUDED' && <span className="ml-1.5 text-[10px] text-amber-700 font-normal">(+VAT {calc.lines[idx].vatRate}%)</span>}
                            </td>
                            <td className="p-2.5 text-right font-bold text-slate-900 border-r border-slate-200">{formatQty(qty, { grouping: true })}</td>
                            <td className="p-2.5 text-right text-slate-700 border-r border-slate-200">{formatCurrency(cost)}</td>
                            <td className="p-2.5 text-right text-rose-600 border-r border-slate-200">
                              {lineDiscount > 0 ? `-${formatCurrency(lineDiscount)}` : '-'}
                              {lineDiscount > 0 && line?.discountType === 'percent' && (
                                <span className="block text-[10px] text-slate-500">({line.discountValue}%)</span>
                              )}
                            </td>
                            {showVat && (
                              <td className="p-2.5 text-right text-slate-700 border-r border-slate-200">
                                {line && line.vatType !== 'NONE' ? formatCurrency(line.vatAmount) : '-'}
                              </td>
                            )}
                            <td className="p-2.5 text-right font-bold text-slate-900">{formatCurrency(lineAmount)}</td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>

              {/* Summary Calculation Box */}
              <div className="flex flex-col sm:flex-row justify-between items-start gap-4 mb-4">
                {/* Left: Thai Baht Text Box */}
                <div className="w-full sm:w-1/2 border border-slate-300 rounded-xl p-4 bg-slate-50/60 flex flex-col justify-between">
                  <div>
                    <span className="text-xs font-bold text-slate-500 block mb-1">จำนวนเงินตัวอักษร (AMOUNT IN WORDS)</span>
                    <p className="text-sm font-bold text-sky-800 bg-sky-50 border border-sky-200 p-2.5 rounded-lg text-center">
                      ({thaiBahtText(finalTotal)})
                    </p>
                  </div>
                  <div className="mt-3 text-[11px] text-slate-500 italic">
                    {poData.notes && <p className="not-italic text-slate-800 font-semibold mb-1">หมายเหตุ: {poData.notes}</p>}
                    * กรุณาส่งมอบสินค้าพร้อมใบส่งสินค้า/ใบแจ้งหนี้ และระบุเลขที่ใบสั่งซื้อบนเอกสารทุกครั้ง
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
                  {vatType !== 'none' && (
                    <div className="flex justify-between py-1 border-b border-slate-100 text-slate-600">
                      <span className="font-medium">มูลค่าก่อนภาษี (NET BEFORE VAT)</span>
                      <span className="font-semibold text-slate-800">{formatCurrency(netAmount)}</span>
                    </div>
                  )}
                  {showVat && (
                  <div className="flex justify-between py-1 border-b border-slate-100">
                    <span className="text-slate-600 font-semibold">
                      ภาษีมูลค่าเพิ่ม ({vatType === 'none' ? 'Non-VAT' : `VAT ${vatRates}%${vatType === 'mixed' ? ' บางรายการ' : ''}`})
                    </span>
                    <span className={`font-bold ${vatType === 'none' ? 'text-slate-400' : 'text-slate-900'}`}>
                      {vatType === 'none'
                        ? 'ไม่มี VAT (0%)'
                        : vatType === 'include'
                        ? `${formatCurrency(vatAmount)} (รวมในยอด)`
                        : vatType === 'exclude'
                        ? `+${formatCurrency(vatAmount)}`
                        : formatCurrency(vatAmount)}
                    </span>
                  </div>
                  )}
                  <div className="flex justify-between py-2 border-t-2 border-slate-800 text-slate-900 font-black text-sm bg-slate-50 px-2 rounded">
                    <span>จำนวนเงินรวมทั้งสิ้น (GRAND TOTAL)</span>
                    <span className="text-sky-600 text-base">{formatCurrency(finalTotal)}</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Bottom Official Signature Block */}
            <div className="grid grid-cols-2 gap-8 border-t border-slate-300 pt-3 mt-2">
              <div className="text-center space-y-3">
                <p className="text-xs font-bold text-slate-600">ผู้จัดทำเอกสาร / PREPARED BY</p>
                <div className="border-b border-dashed border-slate-400 w-3/4 mx-auto pt-6"></div>
                <div className="text-xs text-slate-500">
                  <p>(........................................................)</p>
                  <p className="mt-1">วันที่ ..... / ..... / .........</p>
                </div>
              </div>

              <div className="text-center space-y-3">
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
