import { useState } from 'react';
import { useShiftStore } from '@/lib/store/shift-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { LogOut, Calculator } from 'lucide-react';
import { NumpadPopup } from './NumpadPopup';

interface CloseShiftModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CloseShiftModal({ open, onOpenChange }: CloseShiftModalProps) {
  const { currentShift, closeShift, getExpectedCash } = useShiftStore();
  
  const [actualCash, setActualCash] = useState<number | null>(null);
  const [showNumpad, setShowNumpad] = useState(false);

  const expectedCash = getExpectedCash();
  const diff = actualCash !== null ? actualCash - expectedCash : 0;

  const handleCloseShift = () => {
    closeShift();
    onOpenChange(false);
    setActualCash(null);
  };

  if (!currentShift) return null;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-[500px] bg-white border-slate-200 text-slate-900">
          <DialogHeader>
            <DialogTitle className="text-xl font-bold text-red-600 flex items-center">
              <LogOut className="w-5 h-5 mr-2" />
              ปิดกะ (Close Shift)
            </DialogTitle>
          </DialogHeader>

          <div className="py-4 space-y-4">
            
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">พนักงาน</p>
                <p className="font-medium text-slate-900">{currentShift.userName}</p>
              </div>
              <div className="bg-slate-50 p-3 rounded-lg border border-slate-200">
                <p className="text-xs text-slate-500">จำนวนบิลขาย</p>
                <p className="font-medium text-slate-900">{currentShift.orderCount} บิล</p>
              </div>
            </div>

            <div className="space-y-2 border-t border-slate-200 pt-4">
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">เงินสดตั้งต้น (เปิดกะ)</span>
                <span>{formatCurrency(currentShift.openingCash)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">ยอดขายเงินสด</span>
                <span className="text-emerald-600">+{formatCurrency(currentShift.cashSales)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">เงินเข้าลิ้นชัก (Cash In)</span>
                <span className="text-emerald-600">+{formatCurrency(currentShift.cashIn)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-500">เงินออกลิ้นชัก (Cash Out)</span>
                <span className="text-red-600">-{formatCurrency(currentShift.cashOut)}</span>
              </div>
            </div>

            <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-center mt-2">
              <p className="text-slate-500 text-sm mb-1">เงินสดที่ควรมีในลิ้นชัก</p>
              <p className="text-3xl font-bold text-primary">{formatCurrency(expectedCash)}</p>
            </div>

            <div className="space-y-3 pt-4 border-t border-slate-200 relative">
              <label className="text-sm font-medium text-slate-500">ระบุยอดเงินสดที่นับได้จริง (บาท)</label>
              <div className="flex gap-2">
                <Input 
                  type="number"
                  value={actualCash === null ? '' : actualCash}
                  onChange={(e) => setActualCash(e.target.value ? parseFloat(e.target.value) : null)}
                  className="bg-slate-50 border-slate-300 h-12 text-lg text-slate-900 font-bold"
                  placeholder="0.00"
                />
                <Button 
                  variant="outline" 
                  className="h-12 w-12 shrink-0 border-slate-300 bg-slate-50 hover:text-primary"
                  onClick={() => setShowNumpad(true)}
                >
                  <Calculator className="w-5 h-5" />
                </Button>
              </div>

              {actualCash !== null && (
                <div className={`p-3 rounded-lg border flex justify-between items-center ${diff === 0 ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : diff > 0 ? 'bg-sky-50 border-sky-200 text-sky-600' : 'bg-red-50 border-red-200 text-red-600'}`}>
                  <span>{diff === 0 ? 'พอดี' : diff > 0 ? 'เงินเกิน' : 'เงินขาด'}</span>
                  <span className="font-bold">{formatCurrency(Math.abs(diff))}</span>
                </div>
              )}
            </div>

          </div>

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1 border-slate-300 text-slate-700" onClick={() => onOpenChange(false)}>
              ยกเลิก
            </Button>
            <Button 
              className="flex-1 bg-red-600 hover:bg-red-700 text-white" 
              onClick={handleCloseShift}
              disabled={actualCash === null}
            >
              ยืนยันปิดกะ
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <NumpadPopup 
        open={showNumpad}
        onOpenChange={setShowNumpad}
        onConfirm={(val) => setActualCash(val)}
        title="นับเงินสดในลิ้นชัก"
        initialValue={actualCash || 0}
      />
    </>
  );
}
