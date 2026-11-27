'use client';

import React, { useRef, useState } from 'react';
import { toast } from 'sonner';
import { Printer, Truck } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { A4StoreHeader } from '@/components/common/A4StoreHeader';
import { formatCurrency, formatDocDate } from '@/lib/utils';
import { formatQty } from '@/lib/qty';
import { loadStoreSettings, type StoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe } from '@/lib/pdf-print-service';
import { useEnterSubmit } from '@/lib/keyboard/enter-submit';
import { DELIVERY_NOTE_REF_LABEL, DELIVERY_NOTE_TITLE, type DeliveryNoteData } from '@/lib/delivery-note';
import { closeDeliveryNote, useDeliveryNote, type DeliveryNoteFormat } from '@/lib/pos/delivery-note-store';
import { SlipPaper, SlipRow, SlipRule, SlipShopHeader, slipMoney } from './slip-parts';

/**
 * บิลส่งของ (docs/pos-member-picker.md): the 80 mm slip (default) and the A4 sheet of a held bill / the cart / a held
 * online order, and the preview dialog that prints them. Not a receipt: no receipt number, no VAT / tax-invoice
 * wording (the seller tax id is left out too), no payment method or change; a clear "ยังไม่ได้ชำระเงิน" block.
 */


/** a shop header without the seller tax id (this is not a tax document) */
const noTax = (s: StoreSettings): StoreSettings => ({ ...s, taxId: '' });

function refLine(d: DeliveryNoteData) {
  return d.reference ? `${DELIVERY_NOTE_REF_LABEL[d.source]} ${d.reference}` : DELIVERY_NOTE_REF_LABEL[d.source];
}

/** the "not paid yet" block shared by both layouts */
function unpaidText(d: DeliveryNoteData) {
  return d.feePending ? 'ยอดที่ต้องชำระ (ยังไม่รวมค่าส่ง)' : 'ยอดที่ต้องชำระ';
}

export const DeliveryNoteSlip = React.forwardRef<HTMLDivElement, { data: DeliveryNoteData; settings: StoreSettings }>(
  ({ data: d, settings }, ref) => (
    <SlipPaper ref={ref}>
      <div data-delivery-note="80mm">
        <SlipShopHeader settings={noTax(settings)} title={<span className="text-[20px]">{DELIVERY_NOTE_TITLE}</span>} showTaxId={false}>
          <div className="text-[11px]">(ไม่ใช่ใบเสร็จรับเงิน)</div>
          {!!d.printCount && <div className="text-[11px] font-bold">พิมพ์ครั้งที่ {d.printCount + 1}</div>}
        </SlipShopHeader>
        <SlipRule />
        <div className="space-y-0.5">
          <SlipRow label="อ้างอิง" value={<span className="font-bold">{refLine(d)}</span>} />
          <SlipRow label="วันที่พิมพ์" value={formatDocDate(d.printedAt, { time: true })} />
          {d.heldAt && <SlipRow label={d.source === 'online' ? 'วันที่สั่ง' : 'พักบิลเมื่อ'} value={formatDocDate(d.heldAt, { time: true })} />}
          <div className="flex items-start gap-2">
            <span className="shrink-0">ลูกค้า</span>
            <span className="min-w-0 flex-1 text-right text-[14px] font-bold break-words">{d.customerName || 'ลูกค้าทั่วไป'}</span>
          </div>
          {d.fulfillment && <SlipRow label="การรับของ" value={<span className="font-bold">{d.fulfillment === 'DELIVERY' ? 'ร้านไปส่ง' : 'รับเองที่ร้าน'}</span>} />}
          {d.phone && <SlipRow label="โทร" value={<span className="font-bold">{d.phone}</span>} />}
          {d.address && <div className="whitespace-pre-wrap break-words">ที่อยู่: <span className="font-bold">{d.address}</span></div>}
          {d.note && <div className="whitespace-pre-wrap break-words">หมายเหตุ: {d.note}</div>}
        </div>
        <SlipRule />
        <div>
          {d.lines.map((l, i) => (
            <div key={i} className="py-0.5" data-delivery-line="">
              <div className="break-words font-bold">{l.name}</div>
              <SlipRow
                label={`${formatQty(l.quantity, { grouping: true })} ${l.unitName} x ${slipMoney(l.unitPrice)}`}
                value={slipMoney(l.lineTotal)}
              />
              {l.discount > 0 && <SlipRow label="  ส่วนลด" value={`-${slipMoney(l.discount)}`} />}
              {l.note && <div className="text-[11px] break-words">หมายเหตุ: {l.note}</div>}
            </div>
          ))}
        </div>
        <SlipRule />
        <div className="space-y-0.5">
          <SlipRow label={`รวมค่าสินค้า ${d.lines.length.toLocaleString('th-TH')} รายการ`} value={slipMoney(d.goodsTotal)} />
          {d.billDiscount > 0 && <SlipRow label="ส่วนลดท้ายบิล" value={`-${slipMoney(d.billDiscount)}`} />}
          {d.pointsDiscount > 0 && <SlipRow label="ส่วนลดจากแต้ม" value={`-${slipMoney(d.pointsDiscount)}`} />}
          {d.claimDiscount > 0 && <SlipRow label="ส่วนลดสินค้าเคลม" value={`-${slipMoney(d.claimDiscount)}`} />}
          {d.deliveryFee !== null && <SlipRow label="ค่าส่ง" value={slipMoney(d.deliveryFee)} />}
          {d.feePending && <SlipRow label="ค่าส่ง" value="ร้านแจ้งภายหลัง" />}
          <SlipRow className="text-[15px] font-bold" label="ยอดรวมทั้งสิ้น" value={slipMoney(d.total)} />
        </div>
        <div className="mt-1.5 border-2 border-black p-1.5 text-center" data-delivery-unpaid="">
          <div className="text-[14px] font-bold">ยังไม่ได้ชำระเงิน</div>
          <div className="text-[12px]">{unpaidText(d)}</div>
          <div className="text-[20px] font-bold tabular-nums">฿{slipMoney(d.total)}</div>
        </div>
        <div className="mt-4 space-y-4 text-[12px]">
          <div className="flex items-end gap-1">
            <span className="shrink-0">ผู้ส่งของ</span>
            <span className="flex-1 border-b border-dotted border-black" />
          </div>
          <div className="flex items-end gap-1">
            <span className="shrink-0">ผู้รับของ</span>
            <span className="flex-1 border-b border-dotted border-black" />
          </div>
        </div>
        <div className="mt-2 text-[11px]">พนักงาน: {d.cashierName || '-'}</div>
      </div>
    </SlipPaper>
  ),
);
DeliveryNoteSlip.displayName = 'DeliveryNoteSlip';

export const DeliveryNoteA4 = React.forwardRef<HTMLDivElement, { data: DeliveryNoteData; settings: StoreSettings }>(
  ({ data: d, settings }, ref) => (
    <div
      ref={ref}
      data-delivery-note="a4"
      className="a4-container w-[210mm] max-w-[210mm] min-h-[297mm] bg-white p-[10mm] text-slate-900 font-sans border border-slate-300 box-border text-[12px] space-y-3"
    >
      <div className="flex justify-between items-start gap-4 pb-2.5 border-b-2 border-slate-800">
        <A4StoreHeader settings={noTax(settings)} className="max-w-[440px]" />
        <div className="text-right border-2 border-slate-800 p-2.5 rounded-lg min-w-[210px]">
          <div className="text-[18px] font-bold">{DELIVERY_NOTE_TITLE}</div>
          <div className="text-[11px]">(ไม่ใช่ใบเสร็จรับเงิน)</div>
          {!!d.printCount && <div className="text-[11px] font-bold">พิมพ์ครั้งที่ {d.printCount + 1}</div>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-slate-300 rounded-lg p-2.5 space-y-0.5">
          <div className="font-bold border-b border-slate-200 pb-1 mb-1">ลูกค้า / ผู้รับของ</div>
          <div className="text-[13px] font-bold">{d.customerName || 'ลูกค้าทั่วไป'}</div>
          {d.phone && <div>โทร: {d.phone}</div>}
          {d.address && <div className="whitespace-pre-wrap break-words">ที่อยู่: {d.address}</div>}
          {d.fulfillment && <div>การรับของ: {d.fulfillment === 'DELIVERY' ? 'ร้านไปส่ง' : 'รับเองที่ร้าน'}</div>}
        </div>
        <div className="border border-slate-300 rounded-lg p-2.5 space-y-0.5">
          <div className="font-bold border-b border-slate-200 pb-1 mb-1">ข้อมูลเอกสาร</div>
          <div className="flex justify-between gap-2"><span>อ้างอิง</span><b>{refLine(d)}</b></div>
          <div className="flex justify-between gap-2"><span>วันที่พิมพ์</span><span>{formatDocDate(d.printedAt, { time: true })}</span></div>
          {d.heldAt && (
            <div className="flex justify-between gap-2">
              <span>{d.source === 'online' ? 'วันที่สั่ง' : 'พักบิลเมื่อ'}</span>
              <span>{formatDocDate(d.heldAt, { time: true })}</span>
            </div>
          )}
          <div className="flex justify-between gap-2"><span>พนักงาน</span><span>{d.cashierName || '-'}</span></div>
        </div>
      </div>
      {d.note && <div className="whitespace-pre-wrap break-words">หมายเหตุ: {d.note}</div>}
      <table className="w-full border-collapse border border-slate-400 text-[12px]">
        <thead className="bg-slate-100">
          <tr>
            <th className="border border-slate-400 px-1.5 py-1 w-[32px]">#</th>
            <th className="border border-slate-400 px-2 py-1 text-left">รายการ</th>
            <th className="border border-slate-400 px-1.5 py-1 w-[60px] text-right">จำนวน</th>
            <th className="border border-slate-400 px-1.5 py-1 w-[56px]">หน่วย</th>
            <th className="border border-slate-400 px-1.5 py-1 w-[84px] text-right">ราคา/หน่วย</th>
            <th className="border border-slate-400 px-1.5 py-1 w-[72px] text-right">ส่วนลด</th>
            <th className="border border-slate-400 px-1.5 py-1 w-[92px] text-right">จำนวนเงิน</th>
          </tr>
        </thead>
        <tbody>
          {d.lines.map((l, i) => (
            <tr key={i} data-delivery-line="">
              <td className="border border-slate-300 px-1.5 py-1 text-center">{i + 1}</td>
              <td className="border border-slate-300 px-2 py-1 break-words">
                {l.name}
                {l.note && <div className="text-[11px] text-slate-600">หมายเหตุ: {l.note}</div>}
              </td>
              <td className="border border-slate-300 px-1.5 py-1 text-right tabular-nums">{formatQty(l.quantity, { grouping: true })}</td>
              <td className="border border-slate-300 px-1.5 py-1 text-center">{l.unitName}</td>
              <td className="border border-slate-300 px-1.5 py-1 text-right tabular-nums">{slipMoney(l.unitPrice)}</td>
              <td className="border border-slate-300 px-1.5 py-1 text-right tabular-nums">{l.discount > 0 ? slipMoney(l.discount) : '-'}</td>
              <td className="border border-slate-300 px-1.5 py-1 text-right tabular-nums">{slipMoney(l.lineTotal)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid grid-cols-2 gap-4 break-inside-avoid">
        <div className="border-2 border-slate-800 rounded-lg p-3 text-center self-start" data-delivery-unpaid="">
          <div className="text-[15px] font-bold">ยังไม่ได้ชำระเงิน</div>
          <div>{unpaidText(d)}</div>
          <div className="text-[22px] font-bold tabular-nums">{formatCurrency(d.total)}</div>
        </div>
        <div className="space-y-1">
          <div className="flex justify-between"><span>รวมค่าสินค้า ({d.lines.length} รายการ)</span><span className="tabular-nums">{slipMoney(d.goodsTotal)}</span></div>
          {d.billDiscount > 0 && <div className="flex justify-between"><span>ส่วนลดท้ายบิล</span><span className="tabular-nums">-{slipMoney(d.billDiscount)}</span></div>}
          {d.pointsDiscount > 0 && <div className="flex justify-between"><span>ส่วนลดจากแต้ม</span><span className="tabular-nums">-{slipMoney(d.pointsDiscount)}</span></div>}
          {d.claimDiscount > 0 && <div className="flex justify-between"><span>ส่วนลดสินค้าเคลม</span><span className="tabular-nums">-{slipMoney(d.claimDiscount)}</span></div>}
          {d.deliveryFee !== null && <div className="flex justify-between"><span>ค่าส่ง</span><span className="tabular-nums">{slipMoney(d.deliveryFee)}</span></div>}
          {d.feePending && <div className="flex justify-between"><span>ค่าส่ง</span><span>ร้านแจ้งภายหลัง</span></div>}
          <div className="flex justify-between border-t-2 border-slate-800 pt-1 text-[15px] font-bold">
            <span>ยอดรวมทั้งสิ้น</span>
            <span className="tabular-nums">{slipMoney(d.total)}</span>
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-10 pt-10 break-inside-avoid text-center">
        <div>
          <div className="border-b border-dotted border-slate-800 h-8" />
          <div className="mt-1">ผู้ส่งของ</div>
          <div className="text-[11px] text-slate-600">วันที่ ......../......../........</div>
        </div>
        <div>
          <div className="border-b border-dotted border-slate-800 h-8" />
          <div className="mt-1">ผู้รับของ</div>
          <div className="text-[11px] text-slate-600">วันที่ ......../......../........</div>
        </div>
      </div>
    </div>
  ),
);
DeliveryNoteA4.displayName = 'DeliveryNoteA4';

// ── the preview / print dialog ──

/** Preview of the delivery note with a slip / A4 choice; Enter = print, Esc = close. Mounted once on the POS page. */
export function DeliveryNoteDialog() {
  const { data, onPrinted } = useDeliveryNote();
  const [format, setFormat] = useState<DeliveryNoteFormat>('80mm');
  const [settings, setSettings] = useState<StoreSettings>(() => loadStoreSettings());
  const [lastData, setLastData] = useState<DeliveryNoteData | null>(null);
  const docRef = useRef<HTMLDivElement>(null);
  // a new note opens on the slip (default) with the latest shop settings
  if (data && data !== lastData) {
    setLastData(data);
    setFormat('80mm');
    setSettings(loadStoreSettings());
  }

  const close = closeDeliveryNote;
  const print = async () => {
    if (!data || !docRef.current) return;
    const el = (docRef.current.firstElementChild as HTMLElement | null) || docRef.current;
    await printDocumentIframe(el, `${DELIVERY_NOTE_TITLE} ${data.reference}`.trim(), format);
    onPrinted?.(format);
    toast.success(`ส่งพิมพ์${DELIVERY_NOTE_TITLE}${data.reference ? ` ${data.reference}` : ''} แล้ว`);
    close();
  };
  const onEnter = useEnterSubmit(print, { disabled: !data });

  return (
    <Dialog open={!!data} onOpenChange={(o) => !o && close()}>
      <DialogContent
        onKeyDown={onEnter}
        data-testid="delivery-note-dialog"
        className="flex flex-col gap-0 p-0 overflow-hidden w-[calc(100vw-2rem)] sm:max-w-[920px] h-[min(900px,calc(100dvh-2rem))] bg-white"
      >
        <DialogHeader className="border-b border-slate-200 pl-6 pr-16 py-4 bg-slate-50 shrink-0">
          <DialogTitle className="text-xl font-semibold flex items-center gap-2.5">
            <Truck className="w-6 h-6 text-sky-600 shrink-0" />
            {DELIVERY_NOTE_TITLE}
          </DialogTitle>
          <DialogDescription className="text-sm text-slate-500">
            ใช้ส่งของ / เก็บเงินลูกค้า · ไม่ใช่ใบเสร็จ ไม่ตัดสต็อก ไม่บันทึกการขาย บิลพักยังอยู่เหมือนเดิม · Enter = พิมพ์ · Esc = ปิด
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center justify-between gap-btn px-6 py-3 border-b border-slate-200 shrink-0">
          <div className="flex gap-btn" role="group" aria-label="ขนาดกระดาษ">
            <Button type="button" variant={format === '80mm' ? 'default' : 'outline'} aria-pressed={format === '80mm'} onClick={() => setFormat('80mm')}>
              สลิป 80mm
            </Button>
            <Button type="button" variant={format === 'a4' ? 'default' : 'outline'} aria-pressed={format === 'a4'} onClick={() => setFormat('a4')}>
              กระดาษ A4
            </Button>
          </div>
          <div className="flex gap-btn">
            <Button type="button" variant="outline" onClick={close}>ปิด</Button>
            <Button type="button" onClick={() => void print()} autoFocus data-testid="delivery-note-print">
              <Printer className="w-4 h-4" /> พิมพ์บิลส่งของ
            </Button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto bg-slate-200/70 p-4" data-testid="delivery-note-preview">
          {data && (
            <div ref={docRef} className={format === 'a4' ? 'w-fit mx-auto shadow-md' : 'w-fit mx-auto shadow-md ring-1 ring-slate-300'}>
              {format === '80mm' ? <DeliveryNoteSlip data={data} settings={settings} /> : <DeliveryNoteA4 data={data} settings={settings} />}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
