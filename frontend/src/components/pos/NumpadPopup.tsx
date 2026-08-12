import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { formatCurrency } from '@/lib/utils';
import { Delete } from 'lucide-react';

interface NumpadPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (amount: number) => void;
  title?: string;
  initialValue?: number;
}

export function NumpadPopup({ open, onOpenChange, onConfirm, title = "ระบุจำนวนเงิน", initialValue = 0 }: NumpadPopupProps) {
  const [value, setValue] = useState(initialValue > 0 ? initialValue.toString() : '');

  const handleKey = (key: string) => {
    if (key === 'C') {
      setValue('');
    } else if (key === 'BACK') {
      setValue(v => v.slice(0, -1));
    } else if (key === '.') {
      if (!value.includes('.')) setValue(v => v + '.');
    } else {
      if (value === '0' && key !== '.') {
        setValue(key);
      } else {
        setValue(v => v + key);
      }
    }
  };

  const handleConfirm = () => {
    const num = parseFloat(value);
    if (!isNaN(num) && num > 0) {
      onConfirm(num);
      onOpenChange(false);
      setValue('');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[320px] bg-white border-slate-200 text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-center">{title}</DialogTitle>
        </DialogHeader>

        <div className="py-4">
          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-right mb-6 h-16 flex flex-col justify-center overflow-hidden">
            <span className="text-3xl font-bold text-primary">
              {value ? formatCurrency(parseFloat(value)).replace('฿', '') : '0.00'}
            </span>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {['7', '8', '9', '4', '5', '6', '1', '2', '3'].map((n) => (
              <Button
                key={n}
                variant="outline"
                className="h-14 text-xl font-medium border-slate-300 bg-slate-50 hover:bg-primary hover:text-slate-900"
                onClick={() => handleKey(n)}
              >
                {n}
              </Button>
            ))}
            <Button
              variant="outline"
              className="h-14 text-xl font-medium border-slate-300 bg-slate-50 hover:bg-primary hover:text-slate-900"
              onClick={() => handleKey('.')}
            >
              .
            </Button>
            <Button
              variant="outline"
              className="h-14 text-xl font-medium border-slate-300 bg-slate-50 hover:bg-primary hover:text-slate-900"
              onClick={() => handleKey('0')}
            >
              0
            </Button>
            <Button
              variant="outline"
              className="h-14 text-xl font-medium border-slate-300 bg-slate-50 hover:bg-rose-900/50 hover:text-rose-400 text-rose-500"
              onClick={() => handleKey('BACK')}
            >
              <Delete className="w-6 h-6" />
            </Button>
          </div>

          <div className="flex gap-2 mt-4">
            <Button
              variant="outline"
              className="flex-1 h-12 border-slate-300 text-slate-500"
              onClick={() => {
                setValue('');
                handleKey('C');
              }}
            >
              ล้าง (C)
            </Button>
            <Button
              className="flex-1 h-12 bg-primary hover:bg-primary/90 text-white font-semibold"
              onClick={handleConfirm}
              disabled={!value || parseFloat(value) <= 0}
            >
              ตกลง
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
