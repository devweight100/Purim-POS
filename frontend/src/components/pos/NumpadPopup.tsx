import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { Delete, Keyboard } from 'lucide-react';

interface NumpadPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (amount: number) => void;
  title?: string;
  initialValue?: number;
}

export function NumpadPopup({ open, onOpenChange, onConfirm, title = "ระบุจำนวนเงิน", initialValue = 0 }: NumpadPopupProps) {
  const [value, setValue] = useState(initialValue >= 0 ? initialValue.toString() : '');
  const [isFirstKey, setIsFirstKey] = useState(true);

  useEffect(() => {
    if (open) {
      setValue(initialValue >= 0 ? initialValue.toString() : '');
      setIsFirstKey(true); // First keypress after opening will REPLACE value instead of appending
    }
  }, [open, initialValue]);

  const handleKey = (key: string) => {
    if (key === 'C') {
      setValue('0');
      setIsFirstKey(false);
    } else if (key === 'BACK') {
      if (isFirstKey) {
        setValue('0');
        setIsFirstKey(false);
      } else {
        setValue(v => (v.length <= 1 ? '0' : v.slice(0, -1)));
      }
    } else if (key === '.') {
      if (isFirstKey) {
        setValue('0.');
        setIsFirstKey(false);
      } else if (!value.includes('.')) {
        setValue(v => (v === '' ? '0.' : v + '.'));
      }
    } else {
      if (isFirstKey) {
        setValue(key);
        setIsFirstKey(false);
      } else {
        if (value === '0' && key !== '.') {
          setValue(key);
        } else {
          setValue(v => v + key);
        }
      }
    }
  };

  const handleConfirm = () => {
    const num = parseFloat(value);
    if (!isNaN(num) && num >= 0) {
      onConfirm(num);
      onOpenChange(false);
      setValue('');
    }
  };

  // Keyboard navigation for physical keyboard (0-9, Backspace, Enter, Esc)
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        handleKey(e.key);
      } else if (e.key === '.') {
        handleKey('.');
      } else if (e.key === 'Backspace') {
        handleKey('BACK');
      } else if (e.key === 'Delete' || e.key === 'c' || e.key === 'C') {
        setValue('0');
        setIsFirstKey(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const num = parseFloat(value);
        if (!isNaN(num) && num >= 0) {
          onConfirm(num);
          onOpenChange(false);
          setValue('');
        }
      } else if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, value, isFirstKey, onConfirm, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] sm:max-w-md bg-white border-slate-200 text-slate-900 rounded-2xl p-6 shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-center text-xl font-bold flex items-center justify-center gap-2">
            <Keyboard className="w-5 h-5 text-sky-500" />
            {title}
          </DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          {/* Display */}
          <div className="bg-slate-900 text-white border border-slate-800 rounded-xl p-4 text-right h-20 flex flex-col justify-center overflow-hidden shadow-inner">
            <span className="text-xs text-slate-400 font-medium">จำนวนเงินที่ระบุ</span>
            <span className="text-4xl font-extrabold text-sky-400 font-mono">
              {value !== '' && !isNaN(parseFloat(value)) ? formatCurrency(parseFloat(value)).replace('฿', '') : '0.00'}
            </span>
          </div>

          {/* Keypad */}
          <div className="grid grid-cols-3 gap-2.5">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((n) => (
              <Button
                key={n}
                variant="outline"
                className="h-16 text-2xl font-bold border-slate-200 bg-slate-50 hover:bg-sky-500 hover:text-white hover:border-sky-500 transition-all rounded-xl shadow-sm"
                onClick={() => handleKey(n)}
              >
                {n}
              </Button>
            ))}
            <Button
              variant="outline"
              className="h-16 text-2xl font-bold border-slate-200 bg-slate-50 hover:bg-sky-500 hover:text-white hover:border-sky-500 transition-all rounded-xl shadow-sm"
              onClick={() => handleKey('.')}
            >
              .
            </Button>
            <Button
              variant="outline"
              className="h-16 text-2xl font-bold border-slate-200 bg-slate-50 hover:bg-sky-500 hover:text-white hover:border-sky-500 transition-all rounded-xl shadow-sm"
              onClick={() => handleKey('0')}
            >
              0
            </Button>
            <Button
              variant="outline"
              className="h-16 text-2xl font-bold border-slate-200 bg-red-50 text-red-600 hover:bg-red-500 hover:text-white transition-all rounded-xl shadow-sm"
              onClick={() => handleKey('BACK')}
            >
              <Delete className="w-7 h-7" />
            </Button>
          </div>

          <div className="text-center text-xs text-slate-400">
            💡 เมื่อเปิด Numpad พิมพ์เลขใหม่จะเปลี่ยนแทนที่เลขเดิมทันที
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 pt-2">
            <Button
              variant="outline"
              className="flex-1 h-12 border-slate-300 text-slate-600 font-semibold"
              onClick={() => {
                setValue('0');
                setIsFirstKey(false);
              }}
            >
              ล้างเป็น 0 (C)
            </Button>
            <Button
              className="flex-1 h-12 bg-sky-500 hover:bg-sky-600 text-white font-bold text-base shadow-md"
              onClick={handleConfirm}
              disabled={value === '' || isNaN(parseFloat(value)) || parseFloat(value) < 0}
            >
              ตกลง (Enter ↵)
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
