'use client';

import { useState } from 'react';
import { toast } from 'sonner';
import { LayoutList, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThermalReceiptView, SAMPLE_RECEIPT_DATA } from '@/components/pos/ThermalReceiptView';
import { ReceiptA4Document, type ReceiptA4Data } from '@/components/pos/ReceiptA4PdfModal';
import { saveStoreSettingsToBackend, type StoreSettings } from '@/lib/store-settings-storage';
import {
  A4_ONLY_LABELS,
  SLIP_ONLY_LABELS,
  STORE_INFO_LABELS,
  getReceiptOptions,
  normalizeReceiptOptions,
  type ReceiptOptions,
} from '@/lib/receipt-options';

export type ReceiptLayout = 'slip' | 'a4';

export const LAYOUT_TABS: Array<[ReceiptLayout, string]> = [
  ['slip', 'สลิป (80mm)'],
  ['a4', 'A4'],
];

export function LayoutTabs({ value, onChange }: { value: ReceiptLayout; onChange: (v: ReceiptLayout) => void }) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-slate-300 overflow-hidden bg-white">
      {LAYOUT_TABS.map(([key, label]) => (
        <button
          key={key}
          type="button"
          role="tab"
          aria-selected={value === key}
          onClick={() => onChange(key)}
          className={`px-3 py-1.5 text-xs font-bold ${value === key ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

/**
 * Settings > รูปแบบใบเสร็จ: what the slip and the A4 receipt show (saved on the server for every
 * terminal). Changes show in the preview at once; "บันทึก" sends PATCH /settings { receiptOptions }.
 */
export function ReceiptOptionsSection({
  settings,
  onChange,
  layout,
  onLayoutChange,
  disabled,
}: {
  settings: StoreSettings;
  onChange: (next: StoreSettings) => void;
  layout: ReceiptLayout;
  onLayoutChange: (v: ReceiptLayout) => void;
  /** settings could not be loaded from the server: never save over them */
  disabled?: boolean;
}) {
  const [saving, setSaving] = useState(false);
  const stored = normalizeReceiptOptions(settings.receiptOptions);
  const effective = getReceiptOptions(settings);
  const vat = settings.vatEnabled === true;
  const rows: Array<[string, string]> = [...STORE_INFO_LABELS, ...(layout === 'slip' ? SLIP_ONLY_LABELS : A4_ONLY_LABELS)];

  const toggle = (key: string, value: boolean) => {
    const next: ReceiptOptions = {
      ...stored,
      [layout]: { ...stored[layout], [key]: value },
    } as ReceiptOptions;
    onChange({ ...settings, receiptOptions: next });
  };

  const save = async () => {
    if (disabled) {
      toast.error('ยังบันทึกไม่ได้: โหลดข้อมูลร้านจากเซิร์ฟเวอร์ไม่สำเร็จ กรุณากด "ลองใหม่" ก่อน');
      return;
    }
    setSaving(true);
    try {
      const saved = await saveStoreSettingsToBackend({ receiptOptions: stored });
      // keep other fields the user is still editing; take the server's copy of the options
      onChange({ ...settings, receiptOptions: saved.receiptOptions });
      toast.success('บันทึกรูปแบบใบเสร็จแล้ว (ใช้กับทุกเครื่อง)');
    } catch (err) {
      toast.error('บันทึกรูปแบบใบเสร็จไม่สำเร็จ: ' + (err instanceof Error ? err.message : String(err)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="bg-white border-slate-200 shadow-2xs" data-testid="receipt-options">
      <CardHeader className="pb-3 border-b border-slate-100">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="flex items-center text-lg text-slate-900 font-bold">
            <LayoutList className="w-5 h-5 mr-2.5 text-indigo-600" />
            รูปแบบใบเสร็จ
          </CardTitle>
          <LayoutTabs value={layout} onChange={onLayoutChange} />
        </div>
        <CardDescription className="text-slate-500 text-xs">
          เลือกว่าจะให้แสดงอะไรบน{layout === 'slip' ? 'สลิป 80mm (ใบเสร็จ, รับชำระหนี้, สรุปกะ, ใบรับเคลม)' : 'เอกสาร A4 (ใบเสร็จ/ใบกำกับภาษี, ใบเคลม, ใบสั่งซื้อ, ใบสำคัญจ่าย, ใบส่งคืน)'} ชื่อร้านแสดงเสมอ
          {!vat && ' · ร้านไม่ได้จด VAT: ไม่มีคำว่าภาษี / VAT / เลขผู้เสียภาษี บนเอกสาร'}
        </CardDescription>
      </CardHeader>
      <CardContent className="pt-4 space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2">
          {rows.map(([key, label]) => {
            const isTax = key === 'showTaxId';
            const checked = isTax ? effective[layout].showTaxId : (stored[layout] as Record<string, boolean>)[key];
            return (
              <label key={key} className={`flex items-start gap-2 text-sm ${isTax ? 'text-slate-500' : 'text-slate-800 cursor-pointer'}`}>
                <input
                  type="checkbox"
                  className="mt-0.5 w-4 h-4 accent-indigo-600"
                  checked={checked}
                  disabled={isTax}
                  onChange={(e) => toggle(key, e.target.checked)}
                  data-option={key}
                />
                <span>
                  {label}
                  {isTax && (
                    <span className="block text-[11px] text-slate-500">
                      {vat ? 'ร้านที่จด VAT ต้องแสดงเลขผู้เสียภาษีในใบกำกับภาษี' : 'ร้านไม่ได้จด VAT จึงไม่แสดงข้อมูลภาษี'}
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold h-10 rounded-xl gap-2"
        >
          <Save className="w-4 h-4" /> {saving ? 'กำลังบันทึก...' : 'บันทึกรูปแบบใบเสร็จ'}
        </Button>
      </CardContent>
    </Card>
  );
}

/** Sample A4 bill for the settings preview (same items as the sample slip). */
function sampleA4(vatEnabled: boolean): ReceiptA4Data {
  const s = SAMPLE_RECEIPT_DATA;
  return {
    orderNumber: s.orderNumber,
    createdAt: s.createdAt,
    customerName: s.customerName || undefined,
    customerAddress: '123 ถนนตัวอย่าง แขวงตัวอย่าง เขตตัวอย่าง กรุงเทพฯ 10000',
    customerTaxId: '0105500000000',
    customerPhone: '081-234-5678',
    userName: s.userName,
    items: s.items.map((i) => ({ name: i.name, quantity: i.quantity, unitName: i.unitName, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    subtotal: s.subtotal,
    billDiscountAmount: s.billDiscountAmount,
    vatAmount: vatEnabled ? s.vatAmount : 0,
    totalAmount: s.totalAmount,
    paymentMethod: s.paymentMethod,
    payments: s.payments,
    cashReceived: s.cashReceived,
    changeAmount: s.changeAmount,
    customerPointsEarned: s.customerPointsEarned,
    customerPointsBalance: s.customerPointsBalance,
  };
}

/** A4 sheet scale in the preview column. */
const A4_PREVIEW_ZOOM = 0.5;

/** Live preview: the very components that print (ThermalReceiptView / ReceiptA4Document) with sample data. */
export function ReceiptPreview({ settings, layout }: { settings: StoreSettings; layout: ReceiptLayout }) {
  const vat = settings.vatEnabled === true;
  if (layout === 'a4') {
    return (
      <div data-testid="receipt-preview-a4" style={{ zoom: A4_PREVIEW_ZOOM }}>
        <ReceiptA4Document data={sampleA4(vat)} settings={settings} />
      </div>
    );
  }
  return (
    <div data-testid="receipt-preview-slip">
      <ThermalReceiptView data={{ ...SAMPLE_RECEIPT_DATA, note: 'ตัวอย่างหมายเหตุ', vatAmount: vat ? SAMPLE_RECEIPT_DATA.vatAmount : 0 }} settings={settings} />
    </div>
  );
}
