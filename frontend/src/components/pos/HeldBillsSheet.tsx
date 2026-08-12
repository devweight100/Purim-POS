import { useCartStore } from '@/lib/store/cart-store';
import { formatCurrency, formatDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { PlayCircle, Trash2, Clock } from 'lucide-react';

interface HeldBillsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HeldBillsSheet({ open, onOpenChange }: HeldBillsSheetProps) {
  const cart = useCartStore();
  const heldBills = cart.heldBills;

  const handleRecall = (id: string) => {
    cart.recallBill(id);
    onOpenChange(false);
  };

  const handleRemove = (id: string) => {
    cart.removeHeldBill(id);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-[400px] sm:w-[540px] bg-white border-l border-slate-200 text-slate-900">
        <SheetHeader className="mb-6">
          <SheetTitle className="text-xl font-bold text-primary flex items-center">
            <PlayCircle className="w-5 h-5 mr-2" />
            รายการบิลที่พักไว้ ({heldBills.length})
          </SheetTitle>
        </SheetHeader>

        <div className="flex flex-col gap-4 overflow-y-auto h-[calc(100vh-120px)] no-scrollbar pb-10">
          {heldBills.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-slate-500">
              <Clock className="w-12 h-12 mb-2 opacity-20" />
              <p>ไม่มีบิลพัก</p>
            </div>
          ) : (
            heldBills.map((bill) => {
              // Calculate total for this bill
              const subtotal = bill.items.reduce((sum, item) => {
                const price = item.customPrice ?? item.originalPrice;
                const lineBefore = price * item.quantity;
                let discount = 0;
                if (item.discountType === 'baht') discount = Math.min(item.discountValue, lineBefore);
                if (item.discountType === 'percent') discount = lineBefore * (item.discountValue / 100);
                return sum + Math.max(0, lineBefore - discount);
              }, 0);
              
              let billDiscountAmount = 0;
              if (bill.billDiscountType === 'baht') billDiscountAmount = Math.min(bill.billDiscountValue, subtotal);
              if (bill.billDiscountType === 'percent') billDiscountAmount = subtotal * (bill.billDiscountValue / 100);
              
              const total = subtotal - billDiscountAmount;

              return (
                <div key={bill.id} className="bg-slate-50 border border-slate-200 rounded-xl p-4 flex flex-col gap-3">
                  <div className="flex justify-between items-start border-b border-slate-200 pb-2">
                    <div>
                      <h4 className="font-bold text-slate-900">{bill.label}</h4>
                      <p className="text-xs text-slate-500 mt-1">เวลา: {formatDate(new Date(bill.heldAt))}</p>
                      {bill.customerName && (
                        <p className="text-xs text-primary mt-1">ลูกค้า: {bill.customerName}</p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-lg text-slate-900">{formatCurrency(total)}</p>
                      <p className="text-xs text-slate-500">{bill.items.reduce((sum, i) => sum + i.quantity, 0)} ชิ้น</p>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      className="flex-1 bg-primary hover:bg-primary/90 border-none text-white h-10"
                      onClick={() => handleRecall(bill.id)}
                    >
                      <PlayCircle className="w-4 h-4 mr-2" />
                      เรียกคืนบิลนี้
                    </Button>
                    <Button 
                      variant="outline" 
                      className="w-12 h-10 border-slate-300 bg-white text-slate-500 hover:text-red-600 hover:bg-red-50"
                      onClick={() => handleRemove(bill.id)}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
