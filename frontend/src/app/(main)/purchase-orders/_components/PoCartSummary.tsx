import type { PoTotals } from '@shared/po-calc';
import { formatCurrency } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Keyboard } from 'lucide-react';
import { addQty, formatQty } from '@/lib/qty';
import type { BillVatMode, DiscountKind, PoCartItem, PurchaseOrder } from './po-shared';

interface Props {
  cartItems: PoCartItem[];
  liveBill: PoTotals;
  billDiscountValue: number;
  setBillDiscountValue: (v: number) => void;
  billDiscountType: DiscountKind;
  setBillDiscountType: (v: DiscountKind) => void;
  vatType: BillVatMode;
  applyVatToAll: (t: BillVatMode) => void;
  editingPo: PurchaseOrder | null;
  handleCreatePO: () => void;
}

/** Totals, bill discount, VAT for all lines, save button and the keyboard-shortcut bar. */
export function PoCartSummary({
  cartItems, liveBill, billDiscountValue, setBillDiscountValue, billDiscountType, setBillDiscountType,
  vatType, applyVatToAll, editingPo, handleCreatePO,
}: Props) {
  const subtotalBeforeDiscount = liveBill.baseAmount;
  const itemDiscountTotal = liveBill.lineDiscountAmount;
  const vatAmount = liveBill.vatAmount;
  const netBeforeVat = liveBill.subtotalAmount;
  const cartTotal = liveBill.totalAmount;
  return (
    <>
      {/* Bottom Summary Bar */}
      <div className="shrink-0 border-t border-slate-200 bg-white p-4 shadow-lg">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600">
            <Badge className="bg-sky-500 text-white font-bold px-3 py-1 text-sm">
              เลือกสั่งรวม {cartItems.length} รายการ
            </Badge>
            <span>จำนวนชิ้นรวม: <b>{formatQty(addQty(...cartItems.map((i) => i.quantity || 0)))}</b> ชิ้น</span>
          </div>

          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-500">ยอดรวมก่อนส่วนลด</span>
              <span className="font-semibold text-slate-900">{formatCurrency(subtotalBeforeDiscount)}</span>
            </div>
            {itemDiscountTotal > 0 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">ส่วนลดรายการ</span>
                <span className="font-semibold text-red-600">-{formatCurrency(itemDiscountTotal)}</span>
              </div>
            )}
            <div className="grid grid-cols-[1fr_100px_68px] items-center gap-2 text-sm">
              <span className="text-slate-500">ส่วนลดท้ายบิล</span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={billDiscountValue}
                onChange={(e) => setBillDiscountValue(Math.max(0, Number(e.target.value) || 0))}
                className="h-9 bg-white text-right text-sm border-slate-300 font-semibold"
              />
              <select
                value={billDiscountType}
                onChange={(e) => setBillDiscountType(e.target.value as 'baht' | 'percent')}
                className="h-9 rounded-lg border border-slate-300 bg-white px-2 text-xs font-medium text-slate-700 outline-none focus:border-sky-500"
              >
                <option value="baht">บาท</option>
                <option value="percent">%</option>
              </select>
            </div>

            {/* VAT Configuration Toggle */}
            <div className="space-y-1.5 pt-1.5 border-t border-slate-100">
              <div className="flex items-center justify-between text-xs text-slate-600">
                <span className="font-semibold text-slate-700">ตั้ง VAT ทุกรายการ:</span>
                <span className="text-[11px] text-slate-500 font-medium">แก้รายตัวได้ที่ช่อง VAT ของแต่ละรายการ</span>
              </div>
              <div className="grid grid-cols-3 gap-1 bg-slate-100 p-1 rounded-lg border border-slate-200 text-xs">
                <button
                  type="button"
                  onClick={() => applyVatToAll('none')}
                  className={`py-1.5 px-2 rounded-md font-semibold text-center transition-all ${
                    vatType === 'none'
                      ? 'bg-white text-slate-900 shadow-sm border border-slate-200'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  ไม่มี VAT (0%)
                </button>
                <button
                  type="button"
                  onClick={() => applyVatToAll('include')}
                  className={`py-1.5 px-2 rounded-md font-semibold text-center transition-all ${
                    vatType === 'include'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  รวม VAT (7%)
                </button>
                <button
                  type="button"
                  onClick={() => applyVatToAll('exclude')}
                  className={`py-1.5 px-2 rounded-md font-semibold text-center transition-all ${
                    vatType === 'exclude'
                      ? 'bg-sky-600 text-white shadow-sm'
                      : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  แยก VAT (+7%)
                </button>
              </div>
            </div>

            {vatAmount > 0 && (
              <>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>มูลค่าก่อนภาษี</span>
                  <span className="font-medium text-slate-700">{formatCurrency(netBeforeVat)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-700">
                  <span>
                    ภาษีซื้อ (VAT) {liveBill.lines.filter((l) => l.vatType !== 'NONE' && l.baseAmount > 0).length}/{cartItems.length} รายการ
                  </span>
                  <span className="font-bold text-sky-700">{formatCurrency(vatAmount)}</span>
                </div>
              </>
            )}

            <div className="flex items-end justify-between border-t border-slate-200 pt-2">
              <span className="text-base font-bold text-slate-800">ยอดรวมสุทธิ</span>
              <span className="text-2xl font-bold text-sky-600">{formatCurrency(cartTotal)}</span>
            </div>
            <Button
              className={`h-12 w-full text-base font-bold text-white shadow-md ${
                editingPo 
                  ? 'bg-amber-600 hover:bg-amber-700' 
                  : 'bg-sky-500 hover:bg-sky-600'
              }`}
              disabled={cartItems.length === 0}
              onClick={handleCreatePO}
            >
              {editingPo ? 'บันทึกการแก้ไขใบสั่งซื้อ (Ctrl + Enter)' : 'สร้างใบสั่งซื้อ (Ctrl + Enter)'}
            </Button>
          </div>
        </div>
      </div>

      {/* Keyboard Shortcut Hints Bar */}
      <div className="bg-slate-900 text-slate-200 px-4 py-2 text-xs flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 shrink-0">
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1 font-semibold text-amber-400">
            <Keyboard className="w-4 h-4" /> ทางลัดคีย์บอร์ด:
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">↑ / ↓</kbd> เลื่อนเลือกสินค้า
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Enter</kbd> เพิ่มสินค้าลงตาราง
          </span>
          <span className="flex items-center gap-1">
            <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Ctrl + Enter</kbd> บันทึกใบ PO
          </span>
        </div>
        <div className="text-slate-400">
          กด <kbd className="bg-slate-800 border border-slate-700 px-1.5 py-0.5 rounded text-[10px] font-mono">Esc</kbd> เพื่อยกเลิก
        </div>
      </div>
    </>
  );
}
