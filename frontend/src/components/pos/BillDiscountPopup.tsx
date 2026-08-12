import { useState, useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Percent, Receipt, RefreshCcw } from 'lucide-react';

interface BillDiscountPopupProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function BillDiscountPopup({ open, onOpenChange }: BillDiscountPopupProps) {
  const cart = useCartStore();
  
  const [discountType, setDiscountType] = useState<'none' | 'baht' | 'percent'>('none');
  const [discountValue, setDiscountValue] = useState<string>('');

  useEffect(() => {
    if (open) {
      setDiscountType(cart.billDiscountType);
      setDiscountValue(cart.billDiscountValue > 0 ? cart.billDiscountValue.toString() : '');
    }
  }, [open, cart.billDiscountType, cart.billDiscountValue]);

  const handleConfirm = () => {
    const newDiscVal = parseFloat(discountValue);
    if (!isNaN(newDiscVal) && newDiscVal > 0 && discountType !== 'none') {
      cart.setBillDiscount(discountType, newDiscVal);
    } else {
      cart.setBillDiscount('none', 0);
    }
    onOpenChange(false);
  };

  const handleResetDiscount = () => {
    setDiscountType('none');
    setDiscountValue('');
  };

  const subtotal = cart.getSubtotal();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] bg-white border-slate-200 text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-primary flex items-center">
            <Receipt className="w-5 h-5 mr-2" />
            ส่วนลดท้ายบิล
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-6">
          <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 text-center">
            <p className="text-slate-500 text-sm mb-1">ยอดรวมก่อนหักส่วนลด</p>
            <p className="text-2xl font-bold text-slate-900">{formatCurrency(subtotal)}</p>
          </div>

          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <label className="text-sm font-medium text-slate-500">ระบุส่วนลดท้ายบิล</label>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-500 hover:text-red-600 px-2" onClick={handleResetDiscount}>
                <RefreshCcw className="w-3 h-3 mr-1" /> ล้างส่วนลด
              </Button>
            </div>
            
            <div className="flex gap-2">
              <Button
                variant={discountType === 'none' ? 'default' : 'outline'}
                onClick={() => setDiscountType('none')}
                className={`flex-1 ${discountType === 'none' ? 'bg-primary text-white' : 'border-slate-300 text-slate-500'}`}
              >
                ไม่มี
              </Button>
              <Button
                variant={discountType === 'baht' ? 'default' : 'outline'}
                onClick={() => setDiscountType('baht')}
                className={`flex-1 ${discountType === 'baht' ? 'bg-primary text-white' : 'border-slate-300 text-slate-500 hover:text-primary hover:border-primary/50'}`}
              >
                ฿ บาท
              </Button>
              <Button
                variant={discountType === 'percent' ? 'default' : 'outline'}
                onClick={() => setDiscountType('percent')}
                className={`flex-1 ${discountType === 'percent' ? 'bg-primary text-white' : 'border-slate-300 text-slate-500 hover:text-primary hover:border-primary/50'}`}
              >
                <Percent className="w-4 h-4 mr-1" /> เปอร์เซ็นต์
              </Button>
            </div>

            {discountType !== 'none' && (
              <Input 
                type="number"
                value={discountValue}
                onChange={(e) => setDiscountValue(e.target.value)}
                className="bg-slate-50 border-slate-300 h-12 text-lg text-slate-900"
                placeholder={discountType === 'baht' ? 'ระบุจำนวนเงิน (บาท)' : 'ระบุเปอร์เซ็นต์ (%)'}
                autoFocus
              />
            )}
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <Button variant="outline" className="flex-1 border-slate-300 text-slate-700" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button className="flex-1 bg-primary hover:bg-primary/90 text-white" onClick={handleConfirm}>
            บันทึกส่วนลด
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
