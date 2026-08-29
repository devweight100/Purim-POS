import { useState, useMemo } from 'react';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumpadPopup } from '@/components/pos/NumpadPopup';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Coins, Calculator, RotateCcw } from 'lucide-react';

interface CountCashModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (totalCash: number) => void;
}

interface MoneyItem {
  key: string;
  value: number;
  label: string;
  type: 'note' | 'coin';
  colorBg: string;
  textColor: string;
  borderColor: string;
}

const MONEY_ITEMS: MoneyItem[] = [
  // Banknotes (Rectangles with theme-consistent elegant colors)
  { key: 'b1000', value: 1000, label: 'แบงค์ 1,000 ฿', type: 'note', colorBg: 'bg-slate-700', textColor: 'text-slate-100', borderColor: 'border-slate-600' },
  { key: 'b500', value: 500, label: 'แบงค์ 500 ฿', type: 'note', colorBg: 'bg-purple-600/90', textColor: 'text-purple-50', borderColor: 'border-purple-500' },
  { key: 'b100', value: 100, label: 'แบงค์ 100 ฿', type: 'note', colorBg: 'bg-rose-600/90', textColor: 'text-rose-50', borderColor: 'border-rose-500' },
  { key: 'b50', value: 50, label: 'แบงค์ 50 ฿', type: 'note', colorBg: 'bg-sky-600/90', textColor: 'text-sky-50', borderColor: 'border-sky-500' },
  { key: 'b20', value: 20, label: 'แบงค์ 20 ฿', type: 'note', colorBg: 'bg-emerald-600/90', textColor: 'text-emerald-50', borderColor: 'border-emerald-500' },
  
  // Coins (Circles)
  { key: 'c10', value: 10, label: 'เหรียญ 10 ฿', type: 'coin', colorBg: 'bg-slate-200', textColor: 'text-slate-900', borderColor: 'border-amber-400' },
  { key: 'c5', value: 5, label: 'เหรียญ 5 ฿', type: 'coin', colorBg: 'bg-slate-200', textColor: 'text-slate-800', borderColor: 'border-slate-300' },
  { key: 'c2', value: 2, label: 'เหรียญ 2 ฿', type: 'coin', colorBg: 'bg-amber-200', textColor: 'text-amber-950', borderColor: 'border-amber-300' },
  { key: 'c1', value: 1, label: 'เหรียญ 1 ฿', type: 'coin', colorBg: 'bg-slate-100', textColor: 'text-slate-800', borderColor: 'border-slate-300' },
  { key: 'c050', value: 0.5, label: 'เหรียญ 0.50 ฿', type: 'coin', colorBg: 'bg-amber-600/80', textColor: 'text-amber-50', borderColor: 'border-amber-500' },
  { key: 'c025', value: 0.25, label: 'เหรียญ 0.25 ฿', type: 'coin', colorBg: 'bg-amber-600/80', textColor: 'text-amber-50', borderColor: 'border-amber-500' },
];

export function CountCashModal({ open, onOpenChange, onConfirm }: CountCashModalProps) {
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [numpadItem, setNumpadItem] = useState<MoneyItem | null>(null);

  const calculatedTotal = useMemo(() => {
    return MONEY_ITEMS.reduce((sum, item) => {
      const qty = counts[item.key] || 0;
      return sum + qty * item.value;
    }, 0);
  }, [counts]);

  const handleQtyChange = (key: string, val: number) => {
    setCounts((prev) => ({
      ...prev,
      [key]: isNaN(val) || val < 0 ? 0 : val,
    }));
  };

  const handleReset = () => {
    setCounts({});
  };

  const handleConfirm = () => {
    onConfirm(calculatedTotal);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[92vh] bg-white border-slate-200 text-slate-900 rounded-3xl p-5 shadow-2xl flex flex-col overflow-hidden">
          {/* Header Display */}
          <DialogHeader className="pb-2 border-b border-slate-100 shrink-0">
            <DialogTitle className="text-xl font-bold text-slate-900 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sky-600">
                <Coins className="w-6 h-6" />
                <span>นับจำนวนธนบัตรและเหรียญในลิ้นชัก</span>
              </div>
              {calculatedTotal > 0 && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="text-xs text-slate-400 hover:text-rose-600 font-normal flex items-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>ล้างข้อมูล</span>
                </button>
              )}
            </DialogTitle>
          </DialogHeader>

          {/* Top Total Summary Banner */}
          <div className="my-2 bg-slate-900 text-white p-4 rounded-2xl flex items-center justify-between shadow-inner shrink-0">
            <div className="space-y-0.5">
              <span className="text-xs text-slate-400 font-semibold">ยอดเงินสดจากการนับแบงค์/เหรียญ</span>
              <div className="text-[11px] text-sky-400">คำนวณอัตโนมัติตามจำนวนใบและเหรียญที่ระบุ</div>
            </div>
            <div className="text-2xl sm:text-3xl font-black text-sky-400 tracking-tight font-mono">
              {formatCurrency(calculatedTotal)}
            </div>
          </div>

          {/* POSPOS Grid Layout */}
          <div className="flex-1 overflow-y-auto pr-1 pb-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {MONEY_ITEMS.map((item) => {
                const qty = counts[item.key] ?? '';

                return (
                  <div
                    key={item.key}
                    onClick={() => setNumpadItem(item)}
                    className="flex items-center justify-between bg-slate-50 hover:bg-sky-50/50 hover:border-sky-300 p-2.5 rounded-2xl border border-slate-200 transition-all shadow-2xs group cursor-pointer"
                    title={`คลิกเพื่อใส่จำนวน ${item.label}`}
                  >
                    {/* Visual Badge */}
                    <div className="flex items-center justify-center shrink-0">
                      {item.type === 'note' ? (
                        <div
                          className={`w-20 h-11 rounded-lg ${item.colorBg} border ${item.borderColor} shadow-xs flex flex-col items-center justify-center relative overflow-hidden group-hover:scale-105 transition-transform`}
                        >
                          <div className="absolute inset-0 border border-white/20 rounded-lg pointer-events-none" />
                          <span className={`font-black text-sm tracking-tighter ${item.textColor} font-sans drop-shadow-xs`}>
                            {item.value.toLocaleString()}
                          </span>
                          <span className="text-[8px] font-bold text-white/70 tracking-widest uppercase">
                            BAHT
                          </span>
                        </div>
                      ) : item.key === 'c10' ? (
                        <div className="w-11 h-11 rounded-full bg-slate-200 border-2 border-amber-400 p-0.5 flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                          <div className="w-full h-full rounded-full bg-amber-300 border border-amber-400 flex items-center justify-center shadow-inner">
                            <span className="font-extrabold text-xs text-amber-950">10</span>
                          </div>
                        </div>
                      ) : (
                        <div
                          className={`w-11 h-11 rounded-full ${item.colorBg} border-2 ${item.borderColor} shadow-xs flex items-center justify-center group-hover:scale-105 transition-transform`}
                        >
                          <span className={`font-extrabold text-xs ${item.textColor}`}>
                            {item.value}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Input Box */}
                    <div className="flex-1 ml-3">
                      <Input
                        type="number"
                        min="0"
                        value={qty}
                        readOnly
                        onClick={(e) => {
                          e.stopPropagation();
                          setNumpadItem(item);
                        }}
                        placeholder="0"
                        className="h-11 text-center font-extrabold text-base bg-white border-slate-300 rounded-xl focus:border-sky-500 text-slate-900 shadow-inner cursor-pointer"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Action Button */}
          <div className="pt-3 border-t border-slate-100 flex gap-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              className="flex-1 h-13 border-slate-300 text-slate-700 font-bold rounded-xl"
            >
              ยกเลิก
            </Button>
            <Button
              type="button"
              onClick={handleConfirm}
              className="flex-1 h-13 bg-sky-500 hover:bg-sky-600 active:bg-sky-700 text-white font-black text-lg rounded-xl shadow-lg shadow-sky-500/25 transition-all"
            >
              ตกลง
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Numpad Popup for Banknote / Coin Quantity */}
      {numpadItem && (
        <NumpadPopup
          open={!!numpadItem}
          onOpenChange={(open) => !open && setNumpadItem(null)}
          title={`ระบุจำนวน: ${numpadItem.label}`}
          subtitle="จำนวนใบ/เหรียญที่ระบุ"
          initialValue={counts[numpadItem.key] || 0}
          allowDecimals={false}
          onConfirm={(amount) => {
            handleQtyChange(numpadItem.key, amount);
            setNumpadItem(null);
          }}
        />
      )}
    </>
  );
}
