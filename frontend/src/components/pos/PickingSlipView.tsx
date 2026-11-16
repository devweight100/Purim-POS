'use client';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { formatDocDate } from '@/lib/utils';
import { formatQty } from '@/lib/qty';
import type { StoreSettings } from '@/lib/store-settings-storage';
import { printDocumentIframe } from '@/lib/pdf-print-service';
import { PICKING_DOC_LABEL, type PickingSlipData } from '@/lib/picking-slip';
import { SLIP_WIDTH_PX, SlipPaper, SlipRow, SlipRule } from './slip-parts';

/** Tick box drawn with a border (a "☐" glyph is missing from some printer-side fonts). */
function Tick({ small = false }: { small?: boolean }) {
  return (
    <span
      aria-hidden="true"
      data-tick=""
      className={`inline-block shrink-0 border-2 border-black bg-white ${small ? 'w-[12px] h-[12px] mt-[3px]' : 'w-[16px] h-[16px] mt-[2px]'}`}
    />
  );
}

/**
 * ใบจัดของ: 80 mm slip (the 58 mm printer prints the same layout scaled to its width), black on white.
 * Shop name small, big title, document no. + date, customer (online delivery: phone, address, ส่ง /
 * รับเองที่ร้าน), note, then one row per line: tick box, name (wraps), quantity + unit large. Bundles list their
 * parts with their own tick boxes. No prices, money totals or VAT anywhere.
 */
export const PickingSlipView = React.forwardRef<HTMLDivElement, { data: PickingSlipData; settings: StoreSettings; className?: string }>(
  ({ data, settings, className = '' }, ref) => {
    const lineCount = data.lines.length;
    return (
      <SlipPaper ref={ref} className={className}>
        <div className="text-center leading-tight" data-picking-slip="">
          <div className="text-[11px] break-words">{settings.storeName}</div>
          <div className="mt-0.5 text-[20px] font-bold">ใบจัดของ</div>
          {data.isReprint && (
            <div className="mt-0.5 font-bold">*** พิมพ์ซ้ำ {formatDocDate(data.reprintedAt || new Date(), { time: true })} ***</div>
          )}
        </div>

        <SlipRule />

        <div className="space-y-0.5">
          {data.docNo && <SlipRow label={PICKING_DOC_LABEL[data.source]} value={<span className="font-bold">{data.docNo}</span>} />}
          <SlipRow label="วันที่" value={formatDocDate(data.createdAt, { time: true })} />
          <div className="flex items-start gap-2">
            <span className="shrink-0">ลูกค้า</span>
            <span className="min-w-0 flex-1 text-right text-[14px] font-bold break-words">{data.customerName || 'ลูกค้าทั่วไป'}</span>
          </div>
          {data.fulfillment && (
            <div className="text-center text-[15px] font-bold border-2 border-black rounded-sm py-0.5 my-1">
              {data.fulfillment === 'DELIVERY' ? 'ส่ง (ร้านไปส่ง)' : 'รับเองที่ร้าน'}
            </div>
          )}
          {data.phone && <SlipRow label="โทร" value={<span className="font-bold">{data.phone}</span>} />}
          {data.address && <div className="whitespace-pre-wrap break-words">ที่อยู่: {data.address}</div>}
          {data.note && <div className="whitespace-pre-wrap break-words font-bold">หมายเหตุ: {data.note}</div>}
        </div>

        <SlipRule />

        <div className="flex justify-between text-[11px]">
          <span>รายการ</span>
          <span>จำนวน</span>
        </div>
        <div>
          {data.lines.map((line, i) => (
            <div key={i} className="py-1 border-b border-dashed border-black last:border-b-0" data-picking-line="">
              <div className="flex items-start gap-1.5">
                <Tick />
                <span className="min-w-0 flex-1 text-[14px] font-bold leading-snug break-words">{line.name}</span>
                <span className="shrink-0 text-right text-[16px] font-bold leading-snug tabular-nums whitespace-nowrap">
                  {formatQty(line.quantity, { grouping: true })} {line.unitName}
                </span>
              </div>
              {line.note && <div className="pl-[22px] text-[11px] break-words">หมายเหตุ: {line.note}</div>}
              {line.parts && line.parts.length > 0 && (
                <div className="pl-[22px] mt-0.5 space-y-0.5">
                  {line.parts.map((p, k) => (
                    <div key={k} className="flex items-start gap-1.5 text-[12px]">
                      <Tick small />
                      <span className="min-w-0 flex-1 break-words">{p.name}</span>
                      <span className="shrink-0 text-right font-bold tabular-nums whitespace-nowrap">
                        {formatQty(p.quantity, { grouping: true })} {p.unitName}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>

        <SlipRule />
        <div className="text-[13px] font-bold">รวม {lineCount.toLocaleString('th-TH')} รายการ</div>

        <div className="mt-4 space-y-4 text-[12px]">
          <div className="flex items-end gap-1">
            <span className="shrink-0">ผู้จัด</span>
            <span className="flex-1 border-b border-dotted border-black" />
          </div>
          <div className="flex items-end gap-1">
            <span className="shrink-0">ผู้ตรวจ</span>
            <span className="flex-1 border-b border-dotted border-black" />
          </div>
        </div>
      </SlipPaper>
    );
  },
);
PickingSlipView.displayName = 'PickingSlipView';

/** Print the picking slip (desktop app: slip printer as a raster picture; browser: print preview). */
export function printPickingSlip(data: PickingSlipData, settings: StoreSettings): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  document.getElementById('direct-picking-slip-container')?.remove();
  const container = document.createElement('div');
  container.id = 'direct-picking-slip-container';
  container.setAttribute('aria-hidden', 'true');
  Object.assign(container.style, { position: 'fixed', left: '-9999px', top: '0', width: `${SLIP_WIDTH_PX}px`, pointerEvents: 'none', zIndex: '-9999' });
  document.body.appendChild(container);
  const root = createRoot(container);
  flushSync(() => root.render(<PickingSlipView data={data} settings={settings} />));
  const slip = (container.firstElementChild as HTMLElement | null) || container;
  return printDocumentIframe(slip, `ใบจัดของ ${data.docNo || ''}`.trim(), '80mm').finally(() => {
    setTimeout(() => {
      try {
        root.unmount();
        container.remove();
      } catch {
        /* already gone */
      }
    }, 1000);
  });
}
