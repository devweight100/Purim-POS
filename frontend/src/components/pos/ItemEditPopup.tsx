import { useState, useEffect } from 'react';
import { useCartStore } from '@/lib/store/cart-store';
import { CartItem } from '@/lib/types';
import { formatCurrency } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Percent, DollarSign, Tag, RefreshCcw } from 'lucide-react';

interface ItemEditPopupProps {
  item: CartItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ItemEditPopup({ item, open, onOpenChange }: ItemEditPopupProps) {
  const cart = useCartStore();
  
  const [customPrice, setCustomPrice] = useState<string>('');
  const [discountType, setDiscountType] = useState<'none' | 'baht' | 'percent'>('none');
  const [discountValue, setDiscountValue] = useState<string>('');

  useEffect(() => {
    if (item && open) {
      setCustomPrice(item.customPrice !== null ? item.customPrice.toString() : item.originalPrice.toString());
      setDiscountType(item.discountType);
      setDiscountValue(item.discountValue > 0 ? item.discountValue.toString() : '');
    }
  }, [item, open]);

  const handleConfirm = () => {
    if (!item) return;

    // Save Price
    const newPrice = parseFloat(customPrice);
    if (!isNaN(newPrice) && newPrice !== item.originalPrice) {
      cart.setCustomPrice(item.productId, newPrice);
    } else {
      cart.setCustomPrice(item.productId, null); // reset to original
    }

    // Save Discount
    const newDiscVal = parseFloat(discountValue);
    if (!isNaN(newDiscVal) && newDiscVal > 0 && discountType !== 'none') {
      cart.setItemDiscount(item.productId, discountType, newDiscVal);
    } else {
      cart.setItemDiscount(item.productId, 'none', 0);
    }

    onOpenChange(false);
  };

  const handleResetPrice = () => {
    if (item) setCustomPrice(item.originalPrice.toString());
  };

  const handleResetDiscount = () => {
    setDiscountType('none');
    setDiscountValue('');
  };

  if (!item) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[400px] bg-white border-slate-200 text-slate-900">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold text-primary flex items-center">
            <Tag className="w-5 h-5 mr-2" />
            แก้ไขรายการ: {item.name}
          </DialogTitle>
        </DialogHeader>

        <div className="py-4 space-y-6">
          
          {/* Price Edit */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <label className="text-sm font-medium text-slate-500">ราคาขายต่อหน่วย ({item.unitName})</label>
              <Button variant="ghost" size="sm" className="h-6 text-xs text-slate-500 hover:text-primary px-2" onClick={handleResetPrice}>
                <RefreshCcw className="w-3 h-3 mr-1" /> คืนค่าเดิม
              </Button>
            </div>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input 
                type="number"
                value={customPrice}
                onChange={(e) => setCustomPrice(e.target.value)}
                className="pl-9 bg-slate-50 border-slate-300 h-12 text-lg text-slate-900"
                placeholder={item.originalPrice.toString()}
              />
            </div>
            <p className="text-xs text-slate-500">
              ราคาปกติ: {formatCurrency(item.originalPrice)}
            </p>
          </div>

          <div className="h-px bg-slate-50 w-full" />

          {/* Discount Edit */}
          <div className="space-y-3">
            <div className="flex justify-between items-end">
              <label className="text-sm font-medium text-slate-500">ส่วนลดรายการนี้</label>
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
            บันทึก
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
