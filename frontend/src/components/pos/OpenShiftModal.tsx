import { useState, useMemo } from 'react';
import { useShiftStore } from '@/lib/store/shift-store';
import { useAuthStore } from '@/lib/store/auth-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { NumpadPopup } from '@/components/pos/NumpadPopup';
import {
  Dialog,
  DialogContent,
  DialogHeader,
} from '@/components/ui/dialog';
import { LogIn, Coins, SkipForward, RotateCcw, Calculator } from 'lucide-react';
import { toast } from 'sonner';

interface OpenShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
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

// Banknotes & Coins styled with clean theme-consistent colors
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

export function OpenShiftModal({ open, onOpenChange }: OpenShiftModalProps) {
  const { openShift } = useShiftStore();
  const { user } = useAuthStore();

  // Quantities for each banknote / coin
  const [counts, setCounts] = useState<Record<string, number>>({});
  // Direct total override input
  const [directTotal, setDirectTotal] = useState<string>('');
  const [isDirectMode, setIsDirectMode] = useState<boolean>(false);

  // Active Numpad Target State
  const [numpadItem, setNumpadItem] = useState<MoneyItem | null>(null);
  const [showTotalNumpad, setShowTotalNumpad] = useState<boolean>(false);

  // Calculated total from banknote/coin inputs
  const calculatedTotal = useMemo(() => {
    return MONEY_ITEMS.reduce((sum, item) => {
      const qty = counts[item.key] || 0;
      return sum + qty * item.value;
    }, 0);
  }, [counts]);

  // Active total to use
  const activeTotal = useMemo(() => {
    if (isDirectMode) {
      const val = parseFloat(directTotal);
      return isNaN(val) ? 0 : val;
    }
    return calculatedTotal;
  }, [isDirectMode, directTotal, calculatedTotal]);

  const handleQtyChange = (key: string, val: number) => {
    setIsDirectMode(false);
    setCounts((prev) => ({
      ...prev,
      [key]: isNaN(val) || val < 0 ? 0 : val,
    }));
  };

  const handleDirectTotalChange = (valStr: string) => {
    setIsDirectMode(true);
    setDirectTotal(valStr);
  };

  const handleReset = () => {
    setCounts({});
    setDirectTotal('');
    setIsDirectMode(false);
  };

  const handleConfirmOpen = () => {
    if (activeTotal < 0) {
      toast.error('กรุณาระบุจำนวนเงินตั้งต้นให้ถูกต้อง');
      return;
    }

    openShift(user?.name || 'พนักงานขาย', activeTotal);
    toast.success(`✅ เปิดกะสำเร็จ! เงินตั้งต้นลิ้นชัก ${formatCurrency(activeTotal)}`);
    onOpenChange(false);
    handleReset();
  };

  const handleSkipOpenShift = () => {
    try {
      const todayStr = new Date().toISOString().split('T')[0];
      localStorage.setItem('pos_shift_skipped_date', todayStr);
    } catch (e) {}

    openShift(user?.name || 'พนักงานขาย', 0);
    toast.info('⏩ ข้ามการระบุเงินตั้งต้น (เงินในลิ้นชักเริ่มต้น ฿0.00)');
    onOpenChange(false);
    handleReset();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[95vw] sm:max-w-3xl max-h-[92vh] bg-white border-slate-200 text-slate-900 rounded-3xl p-5 shadow-2xl flex flex-col overflow-hidden">
          
          {/* Top Header: POSPOS Style - Large Total Display */}
          <div className="bg-slate-100/90 border border-slate-200 rounded-2xl p-4 flex items-center justify-between shrink-0 mb-3">
            <div className="space-y-1">
              <div className="text-sm font-bold text-slate-700 flex items-center gap-2">
                <LogIn className="w-5 h-5 text-sky-600" />
                <span>ระบุเงินในลิ้นชัก</span>
              </div>
              <div className="text-xs text-slate-500">
                พนักงาน: <strong className="text-slate-800">{user?.name || 'พนักงานขาย'}</strong>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Direct Edit / Display with Numpad Trigger */}
              <div 
                className="text-right cursor-pointer flex items-center gap-2 group"
                onClick={() => setShowTotalNumpad(true)}
                title="กรอกยอดเงินรวมโดยตรง"
              >
                <Calculator className="w-5 h-5 text-slate-400 group-hover:text-sky-600 transition-colors" />
                <input
                  type="number"
                  value={isDirectMode ? directTotal : (calculatedTotal > 0 ? calculatedTotal : '')}
                  onChange={(e) => handleDirectTotalChange(e.target.value)}
                  placeholder="ยอดรวม"
                  className="text-3xl sm:text-4xl font-black text-right bg-transparent border-b-2 border-transparent focus:border-sky-500 outline-none w-40 sm:w-52 text-slate-900 font-mono tracking-tight cursor-pointer"
                  aria-label="ยอดเงินรวมในลิ้นชัก"
                />
              </div>
              <div className="text-2xl text-slate-400 font-sans font-bold">฿</div>
              {(calculatedTotal > 0 || directTotal) && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="p-2 text-slate-400 hover:text-rose-600 transition-colors"
                  title="ล้างข้อมูลทั้งหมด"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>

          {/* Section Title */}
          <div className="flex items-center justify-between text-xs font-black text-slate-700 px-1 mb-2 shrink-0">
            <div className="flex items-center gap-1.5">
              <Coins className="w-4 h-4 text-sky-600" />
              <span>ธนบัตร / เหรียญ</span>
            </div>
            <span className="text-[11px] text-slate-500 font-normal">ช่องด้านล่างป้อนจำนวนใบ/เหรียญ ระบบคูณมูลค่าให้อัตโนมัติ</span>
          </div>

          {/* Main 3-Column Grid Layout (POSPOS Design with Theme Colors) */}
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
                    {/* Visual Banknote Rectangle OR Coin Circle (Theme Colors) */}
                    <div className="flex items-center justify-center shrink-0">
                      {item.type === 'note' ? (
                        /* Rectangular Banknote Badge with Theme-Matching Elegant Colors */
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
                        /* Special 10 Baht Coin (Theme Silver Ring + Gold Inner Circle) */
                        <div className="w-11 h-11 rounded-full bg-slate-200 border-2 border-amber-400 p-0.5 flex items-center justify-center shadow-xs group-hover:scale-105 transition-transform">
                          <div className="w-full h-full rounded-full bg-amber-300 border border-amber-400 flex items-center justify-center shadow-inner">
                            <span className="font-extrabold text-xs text-amber-950">10</span>
                          </div>
                        </div>
                      ) : (
                        /* Standard Circular Coin Badge */
                        <div 
                          className={`w-11 h-11 rounded-full ${item.colorBg} border-2 ${item.borderColor} shadow-xs flex items-center justify-center group-hover:scale-105 transition-transform`}
                        >
                          <span className={`font-extrabold text-xs ${item.textColor}`}>
                            {item.value}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Quantity Display / Input Box */}
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

          {/* Bottom Action Bar: POSPOS Large Blue Confirm Button & Skip Button */}
          <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row gap-3 shrink-0">
            <Button
              type="button"
              variant="outline"
              onClick={handleSkipOpenShift}
              className="sm:w-1/3 h-13 border-slate-300 text-slate-600 hover:bg-slate-100 font-bold rounded-xl text-sm"
            >
              <SkipForward className="w-4 h-4 mr-1.5 text-slate-500" />
              <span>ข้ามการเปิดกะ</span>
            </Button>

            <Button
              type="button"
              onClick={handleConfirmOpen}
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

      {/* Numpad Popup for Direct Total Cash */}
      {showTotalNumpad && (
        <NumpadPopup
          open={showTotalNumpad}
          onOpenChange={setShowTotalNumpad}
          title="ระบุเงินในลิ้นชักทั้งหมด (บาท)"
          subtitle="จำนวนเงินสดทั้งหมดที่ระบุ"
          initialValue={activeTotal}
          allowDecimals={true}
          onConfirm={(amount) => {
            handleDirectTotalChange(amount.toString());
            setShowTotalNumpad(false);
          }}
        />
      )}
    </>
  );
}
