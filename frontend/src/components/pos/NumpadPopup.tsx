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
  subtitle?: string;
  initialValue?: number;
  allowDecimals?: boolean;
}

export function NumpadPopup({
  open,
  onOpenChange,
  onConfirm,
  title = "ระบุจำนวนเงิน",
  subtitle,
  initialValue = 0,
  allowDecimals = true
}: NumpadPopupProps) {
  const [value, setValue] = useState(initialValue >= 0 ? Math.floor(initialValue).toString() : '');
  const [isFirstKey, setIsFirstKey] = useState(true);

  useEffect(() => {
    if (open) {
      const initStr = allowDecimals
        ? (initialValue >= 0 ? initialValue.toString() : '')
        : (initialValue >= 0 ? Math.floor(initialValue).toString() : '');
      setValue(initStr);
      setIsFirstKey(true); // First keypress after opening will REPLACE value instead of appending
    }
  }, [open, initialValue, allowDecimals]);

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
      if (!allowDecimals) return;
      if (isFirstKey) {
        setValue('0.');
        setIsFirstKey(false);
      } else if (!value.includes('.')) {
        setValue(v => (v === '' ? '0.' : v + '.'));
      }
    } else if (key === '00') {
      if (isFirstKey) {
        setValue('0');
        setIsFirstKey(false);
      } else if (value !== '0' && value !== '') {
        setValue(v => v + '00');
      }
    } else {
      if (isFirstKey) {
        setValue(key);
        setIsFirstKey(false);
      } else {
        if (value === '0') {
          setValue(key);
        } else {
          setValue(v => v + key);
        }
      }
    }
  };

  const handleConfirm = () => {
    const num = allowDecimals ? parseFloat(value) : parseInt(value, 10);
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
      const code = e.code;
      const key = e.key;

      const digitMatch = code.match(/^(Digit|Numpad)([0-9])$/);
      if (digitMatch) {
        handleKey(digitMatch[2]);
      } else if ((key >= '0' && key <= '9')) {
        handleKey(key);
      } else if ((key === '.' || code === 'Period' || code === 'NumpadDecimal') && allowDecimals) {
        handleKey('.');
      } else if (key === 'Backspace' || code === 'Backspace') {
        handleKey('BACK');
      } else if (key === 'Delete' || code === 'Delete' || key?.toLowerCase() === 'c' || code === 'KeyC') {
        setValue('0');
        setIsFirstKey(false);
      } else if (key === 'Enter' || code === 'Enter' || code === 'NumpadEnter') {
        e.preventDefault();
        const num = allowDecimals ? parseFloat(value) : parseInt(value, 10);
        if (!isNaN(num) && num >= 0) {
          onConfirm(num);
          onOpenChange(false);
          setValue('');
        }
      } else if (key === 'Escape' || code === 'Escape') {
        onOpenChange(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, value, isFirstKey, onConfirm, onOpenChange, allowDecimals]);

  const displayFormatted = allowDecimals
    ? (value !== '' && !isNaN(parseFloat(value)) ? formatCurrency(parseFloat(value)).replace('฿', '') : '0.00')
    : (value !== '' && !isNaN(parseInt(value, 10)) ? parseInt(value, 10).toLocaleString('th-TH') : '0');

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
            <span className="text-xs text-slate-400 font-medium">
              {subtitle || (allowDecimals ? 'จำนวนเงินที่ระบุ' : 'จำนวนที่ระบุ')}
            </span>
            <span className="text-4xl font-extrabold text-sky-400 font-mono">
              {displayFormatted}
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
            {allowDecimals ? (
              <Button
                variant="outline"
                className="h-16 text-2xl font-bold border-slate-200 bg-slate-50 hover:bg-sky-500 hover:text-white hover:border-sky-500 transition-all rounded-xl shadow-sm"
                onClick={() => handleKey('.')}
              >
                .
              </Button>
            ) : (
              <Button
                variant="outline"
                className="h-16 text-xl font-extrabold border-slate-200 bg-slate-50 hover:bg-sky-500 hover:text-white hover:border-sky-500 transition-all rounded-xl shadow-sm"
                onClick={() => handleKey('00')}
              >
                00
              </Button>
            )}
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
            💡 พิมพ์เลขใหม่จะเปลี่ยนแทนที่เลขเดิมทันที กด Enter หรือ ตกลง เพื่อยืนยัน
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
