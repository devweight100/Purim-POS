'use client';

import { useState, useEffect } from 'react';
import { useShiftStore } from '@/lib/store/shift-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { 
  Coins, ArrowDownCircle, ArrowUpCircle, KeyRound, 
  CheckCircle2, AlertCircle, Sparkles, DollarSign, Wallet, Store
} from 'lucide-react';
import { toast } from 'sonner';

interface CashDrawerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenShiftRequired?: () => void;
}

export function CashDrawerModal({
  open,
  onOpenChange,
  onOpenShiftRequired,
}: CashDrawerModalProps) {
  const { currentShift, isShiftOpen, getExpectedCash, addCashTransaction } = useShiftStore();

  const [mode, setMode] = useState<'in' | 'out' | 'open_only'>('in');
  const [amountStr, setAmountStr] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state when opening
  useEffect(() => {
    if (open) {
      setAmountStr('');
      setReason('');
      setMode('in');
      setIsSubmitting(false);
    }
  }, [open]);

  const shiftOpen = isShiftOpen();
  const currentExpectedCash = getExpectedCash();
  const parsedAmount = parseFloat(amountStr) || 0;

  // Calculate new expected cash preview
  let newExpectedCash = currentExpectedCash;
  if (mode === 'in') {
    newExpectedCash += parsedAmount;
  } else if (mode === 'out') {
    newExpectedCash = Math.max(0, currentExpectedCash - parsedAmount);
  }

  // Presets
  const amountPresets = [50, 100, 200, 500, 1000, 2000];
  const cashInReasons = ['เติมเงินทอน', 'ใส่เงินสดเพิ่ม', 'รับเงินทอนย่อย', 'สำรองเงินสด'];
  const cashOutReasons = ['ส่งเงินสด/ตัดยอด', 'จ่ายค่าพัสดุ/ค่าส่ง', 'ซื้อของใช้ในร้าน', 'นำเงินฝากธนาคาร', 'ค่าใช้จ่ายเบ็ดเตล็ด'];

  const handleAddAmount = (add: number) => {
    setAmountStr((prev) => {
      const cur = parseFloat(prev) || 0;
      return String(cur + add);
    });
  };

  const handleSelectPresetReason = (r: string) => {
    setReason(r);
  };

  // Simulate or execute cash drawer kick pulse
  const triggerDrawerKick = () => {
    try {
      // Audio beep feedback for cash drawer opening
      if (typeof window !== 'undefined' && 'AudioContext' in window) {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, audioCtx.currentTime);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start();
        osc.stop(audioCtx.currentTime + 0.15);
      }
    } catch {}
  };

  const handleSubmit = () => {
    if (mode === 'open_only') {
      triggerDrawerKick();
      toast.success('🔓 สั่งเปิดลิ้นชักเก็บเงินเรียบร้อยแล้ว');
      onOpenChange(false);
      return;
    }

    if (parsedAmount <= 0) {
      toast.error('กรุณาระบุจำนวนเงินที่ถูกต้อง (มากกว่า 0 บาท)');
      return;
    }

    if (mode === 'out') {
      if (currentExpectedCash <= 0) {
        toast.error('เงินในลิ้นชักเป็น ฿0.00 ไม่สามารถนำเงินสดออกได้ (เว้นแต่จะมีการขายสินค้า หรือนำเงินเข้ามาก่อน)');
        return;
      }
      if (parsedAmount > currentExpectedCash) {
        toast.error(`ยอดเงินที่นำออก (฿${parsedAmount.toLocaleString()}) มากกว่าเงินสดที่มีในลิ้นชัก (฿${currentExpectedCash.toLocaleString()})`);
        return;
      }
    }

    if (!reason.trim()) {
      toast.error('กรุณาระบุหมายเหตุหรือเหตุผลในการนำเงินเข้า/ออก');
      return;
    }

    setIsSubmitting(true);
    try {
      addCashTransaction(mode, parsedAmount, reason.trim());
      triggerDrawerKick();

      toast.success(
        mode === 'in'
          ? `📥 บันทึกนำเงินเข้าลิ้นชัก ฿${parsedAmount.toLocaleString()} สำเร็จ (เปิดลิ้นชัก)`
          : `📤 บันทึกนำเงินออกจากลิ้นชัก ฿${parsedAmount.toLocaleString()} สำเร็จ (เปิดลิ้นชัก)`
      );

      onOpenChange(false);
    } catch (err) {
      console.error('Failed to add cash transaction:', err);
      toast.error('เกิดข้อผิดพลาดในการบันทึกรายการ');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] sm:w-[540px] max-w-[540px] bg-white border-slate-200 text-slate-900 rounded-3xl p-5 sm:p-6 shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <DialogHeader className="pb-3 border-b border-slate-100 shrink-0">
          <div className="flex items-center justify-between">
            <DialogTitle className="text-xl font-black text-slate-900 flex items-center gap-2.5">
              <div className="w-9 h-9 rounded-2xl bg-amber-600 text-white flex items-center justify-center shadow-xs">
                <Coins className="w-5 h-5" />
              </div>
              <span>เปิดลิ้นชัก / จัดการเงินสด (Cash Drawer)</span>
            </DialogTitle>
          </div>
          <p className="text-xs text-slate-500 font-medium">
            บันทึกเงินเข้า-ออกลิ้นชักระหว่างกะ หรือสั่งเด้งเปิดลิ้นชักเก็บเงิน
          </p>
        </DialogHeader>

        <div className="space-y-4 py-2 flex-1 overflow-y-auto pr-1">
          {/* Shift Status & Current Balance Card */}
          <div className="bg-gradient-to-br from-slate-50 to-slate-100 p-4 rounded-2xl border border-slate-200 flex items-center justify-between text-xs shadow-2xs">
            <div>
              <div className="flex items-center gap-1.5 text-slate-500 font-semibold mb-0.5">
                <Wallet className="w-3.5 h-3.5 text-slate-400" />
                <span>สถานะลิ้นชัก:</span>
                <b className={currentExpectedCash > 0 ? 'text-emerald-700 font-bold' : 'text-slate-600 font-bold'}>
                  {currentExpectedCash > 0 ? 'มีเงินสดพร้อมใช้งาน' : 'ลิ้นชักว่าง (฿0.00)'}
                </b>
              </div>
              <p className="text-slate-400 text-[11px]">
                {shiftOpen 
                  ? `พนักงาน: ${currentShift?.userName || 'พนักงานขาย'}` 
                  : 'พร้อมบันทึกนำเงินเข้า-ออก หรือเปิดลิ้นชัก'}
              </p>
            </div>

            <div className="text-right">
              <span className="text-[11px] text-slate-500 font-semibold block">เงินสดในลิ้นชักปัจจุบัน</span>
              <span className="text-xl font-black text-slate-900 font-mono">
                {formatCurrency(currentExpectedCash)}
              </span>
            </div>
          </div>

          {/* Mode Selector (3 Options) */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-slate-700 block">
              เลือกประเภทการทำรายการ:
            </label>
            <div className="grid grid-cols-3 gap-2">
              {/* Option 1: Cash In */}
              <button
                type="button"
                onClick={() => setMode('in')}
                className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                  mode === 'in'
                    ? 'border-emerald-500 bg-emerald-50 text-emerald-900 ring-2 ring-emerald-400/30 shadow-xs font-black'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700 font-bold'
                }`}
              >
                <ArrowDownCircle className={`w-5 h-5 ${mode === 'in' ? 'text-emerald-600' : 'text-slate-400'}`} />
                <span className="text-xs">นำเงินเข้า (In)</span>
              </button>

              {/* Option 2: Cash Out */}
              <button
                type="button"
                onClick={() => setMode('out')}
                className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                  mode === 'out'
                    ? 'border-rose-500 bg-rose-50 text-rose-900 ring-2 ring-rose-400/30 shadow-xs font-black'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700 font-bold'
                }`}
              >
                <ArrowUpCircle className={`w-5 h-5 ${mode === 'out' ? 'text-rose-600' : 'text-slate-400'}`} />
                <span className="text-xs">นำเงินออก (Out)</span>
              </button>

              {/* Option 3: Open Only */}
              <button
                type="button"
                onClick={() => setMode('open_only')}
                className={`p-3 rounded-2xl border flex flex-col items-center justify-center gap-1.5 transition-all ${
                  mode === 'open_only'
                    ? 'border-amber-500 bg-amber-50 text-amber-900 ring-2 ring-amber-400/30 shadow-xs font-black'
                    : 'border-slate-200 hover:border-slate-300 bg-white text-slate-700 font-bold'
                }`}
              >
                <KeyRound className={`w-5 h-5 ${mode === 'open_only' ? 'text-amber-600' : 'text-slate-400'}`} />
                <span className="text-xs">เปิดลิ้นชักเฉยๆ</span>
              </button>
            </div>
          </div>

          {/* Amount & Reason Section (Only when in or out) */}
          {mode !== 'open_only' ? (
            <div className="space-y-3.5 pt-1">
              {/* Alert when drawer has 0 cash and user chooses Cash Out */}
              {mode === 'out' && currentExpectedCash <= 0 && (
                <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-2xl text-rose-900 text-xs font-bold flex items-start gap-2.5 shadow-2xs">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-0.5">
                    <p className="font-extrabold text-rose-950">เงินสดในลิ้นชักเป็น ฿0.00 ไม่สามารถนำเงินออกได้</p>
                    <p className="text-[11.5px] text-rose-700 font-medium leading-relaxed">
                      เนื่องจากขณะนี้ไม่มีเงินสดในลิ้นชัก คุณต้องทำการขายสินค้าเป็นเงินสด หรือบันทึกนำเงินเข้าลิ้นชัก (Cash In) ก่อนจึงจะสามารถนำเงินสดออกได้
                    </p>
                  </div>
                </div>
              )}

              {/* Amount Input */}
              <div className="space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <label className="font-bold text-slate-700">
                    จำนวนเงิน{mode === 'in' ? 'ที่นำเข้า' : 'ที่นำออก'} (บาท):
                  </label>
                  {parsedAmount > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmountStr('')}
                      className="text-slate-400 hover:text-red-500 font-bold text-[11px]"
                    >
                      ล้างจำนวน
                    </button>
                  )}
                </div>

                <div className="relative">
                  <Input
                    type="number"
                    min="0"
                    step="any"
                    autoFocus
                    value={amountStr}
                    onChange={(e) => setAmountStr(e.target.value)}
                    className="h-12 text-2xl font-black text-slate-900 pr-12 font-mono text-right"
                    placeholder="0.00"
                  />
                  <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-sm font-bold text-slate-400">
                    บาท
                  </span>
                </div>

                {/* Preset Chips */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {amountPresets.map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handleAddAmount(p)}
                      className="text-xs font-bold bg-slate-100 hover:bg-slate-200 text-slate-700 px-2.5 py-1 rounded-lg transition-colors border border-slate-200"
                    >
                      +{p.toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Reason / Note Input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 block">
                  หมายเหตุ / เหตุผล:
                </label>
                <Input
                  type="text"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={mode === 'in' ? 'เช่น เติมเงินทอนรอบบ่าย, ทอนเพิ่ม...' : 'เช่น ส่งยอดเงินสด, ค่าส่งพัสดุ, จ่ายค่าของ...'}
                  className="h-10 text-xs bg-white border-slate-300 rounded-xl"
                />

                {/* Preset Reason Tags */}
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {(mode === 'in' ? cashInReasons : cashOutReasons).map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => handleSelectPresetReason(r)}
                      className={`text-[11px] font-bold px-2 py-0.5 rounded-lg border transition-all ${
                        reason === r
                          ? 'bg-slate-800 text-white border-slate-800'
                          : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
              </div>

              {/* Balance Preview Card */}
              <div className={`p-3.5 rounded-2xl border text-xs space-y-1.5 ${
                mode === 'in'
                  ? 'bg-emerald-50/70 border-emerald-200 text-emerald-950'
                  : 'bg-rose-50/70 border-rose-200 text-rose-950'
              }`}>
                <div className="flex justify-between font-medium text-slate-600">
                  <span>เงินสดก่อนทำรายการ:</span>
                  <span className="font-mono font-bold">{formatCurrency(currentExpectedCash)}</span>
                </div>
                <div className="flex justify-between font-bold">
                  <span>{mode === 'in' ? '(+) เงินเข้าลิ้นชัก:' : '(-) เงินออกลิ้นชัก:'}</span>
                  <span className={`font-mono ${mode === 'in' ? 'text-emerald-700' : 'text-rose-700'}`}>
                    {mode === 'in' ? '+' : '-'}{formatCurrency(parsedAmount)}
                  </span>
                </div>
                <div className="border-t border-slate-200/80 pt-1.5 flex justify-between items-center text-sm font-black text-slate-900">
                  <span>เงินสดในลิ้นชักใหม่:</span>
                  <span className="text-lg font-mono font-black text-slate-900">
                    {formatCurrency(newExpectedCash)}
                  </span>
                </div>
              </div>
            </div>
          ) : (
            /* Open Drawer Only Mode Notice */
            <div className="p-6 text-center bg-amber-50/60 rounded-2xl border border-amber-200 text-xs space-y-2">
              <KeyRound className="w-8 h-8 text-amber-600 mx-auto" />
              <p className="font-bold text-amber-950 text-sm">เปิดลิ้นชักโดยไม่บันทึกยอดเงิน</p>
              <p className="text-slate-500 leading-relaxed">
                ระบบจะสั่งเด้งเปิดลิ้นชักเก็บเงินโดยไม่มีการเพิ่มหรือลดเงินสดในระบบ (ยอดเงินในกะจะคงเดิมเท่าเดิมที่ {formatCurrency(currentExpectedCash)})
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="pt-3 border-t border-slate-100 flex justify-between items-center shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="h-10 px-5 border-slate-300 text-slate-700 font-bold rounded-xl"
          >
            ยกเลิก
          </Button>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              (mode === 'out' && currentExpectedCash <= 0) ||
              (mode !== 'open_only' && (parsedAmount <= 0 || (mode === 'out' && parsedAmount > currentExpectedCash)))
            }
            className={`h-10 px-6 text-white font-black text-sm rounded-xl shadow-md gap-2 ${
              mode === 'in'
                ? 'bg-emerald-600 hover:bg-emerald-700'
                : mode === 'out'
                ? 'bg-rose-600 hover:bg-rose-700 disabled:bg-rose-300'
                : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            <CheckCircle2 className="w-4 h-4" />
            <span>
              {mode === 'open_only'
                ? 'เด้งเปิดลิ้นชัก'
                : mode === 'out' && currentExpectedCash <= 0
                ? 'เงินในลิ้นชักไม่เพียงพอ (฿0.00)'
                : 'บันทึกและเปิดลิ้นชัก'}
            </span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}